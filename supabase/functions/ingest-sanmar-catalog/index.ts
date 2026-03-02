import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parse } from "https://deno.land/std@0.224.0/csv/parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Limit rows for initial testing
const ROW_LIMIT = 100;
const BATCH_SIZE = 50;

/**
 * Fetch the SanMar EPDD CSV.
 * Priority: SANMAR_CSV_URL (direct HTTPS) > FTP (SANMAR_FTP_HOST/USER/PASS)
 */
async function fetchCsvText(): Promise<string> {
  const csvUrl = Deno.env.get("SANMAR_CSV_URL");
  if (csvUrl) {
    console.log(`[ingest-sanmar] Fetching CSV via HTTPS: ${csvUrl.substring(0, 60)}...`);
    const resp = await fetch(csvUrl);
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`HTTPS fetch failed (${resp.status}): ${body.substring(0, 200)}`);
    }
    return await resp.text();
  }

  // FTP path
  const ftpHost = Deno.env.get("SANMAR_FTP_HOST");
  const ftpUser = Deno.env.get("SANMAR_FTP_USER");
  const ftpPass = Deno.env.get("SANMAR_FTP_PASS");

  if (!ftpHost || !ftpUser || !ftpPass) {
    throw new Error(
      "No CSV source configured. Set SANMAR_CSV_URL for HTTPS or SANMAR_FTP_HOST/USER/PASS for FTP."
    );
  }

  // Use basic-ftp for FTP download — stream partial content to avoid timeouts on large files
  const { Client } = await import("npm:basic-ftp@5.0.5");
  const { Writable } = await import("node:stream");
  const client = new Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: ftpHost,
      user: ftpUser,
      password: ftpPass,
      secure: false,
    });

    // Search root and subdirectories for the EPDD CSV
    let epddFile: any = null;
    let epddDir = "/";

    const searchDir = async (dir: string) => {
      await client.cd(dir);
      const entries = await client.list();
      for (const f of entries) {
        if (f.isDirectory) {
          if (dir === "/") {
            await searchDir(`/${f.name}`);
            if (epddFile) return;
            await client.cd(dir);
          }
        } else if (
          f.name.toLowerCase().endsWith(".csv") &&
          (f.name.toLowerCase().includes("epdd") || f.name.toLowerCase().includes("pdd"))
        ) {
          epddFile = f;
          epddDir = dir;
          return;
        }
      }
    };

    await searchDir("/");

    if (!epddFile) {
      await client.cd("/");
      const rootFiles = await client.list();
      const allNames: string[] = [];
      for (const f of rootFiles) {
        if (f.isDirectory) {
          await client.cd(`/${f.name}`);
          const sub = await client.list();
          allNames.push(`${f.name}/: ${sub.map((s: any) => s.name).join(", ")}`);
          await client.cd("/");
        } else {
          allNames.push(f.name);
        }
      }
      throw new Error(`No EPDD/PDD CSV found on FTP. Structure: ${allNames.join(" | ")}`);
    }

    await client.cd(epddDir);
    console.log(`[ingest-sanmar] Found CSV: ${epddDir}/${epddFile.name}`);

    // Stream only enough lines for our ROW_LIMIT (header + N data rows)
    // This avoids downloading the entire 50MB+ file
    const MAX_LINES = ROW_LIMIT + 500; // extra headroom for dedup
    let lineCount = 0;
    let csvChunks: string[] = [];
    let done = false;

    console.log(`[ingest-sanmar] Streaming first ${MAX_LINES} lines from FTP...`);
    const writable = new Writable({
      write(chunk: Buffer, _encoding: string, callback: () => void) {
        if (done) { callback(); return; }
        const text = chunk.toString("utf-8");
        csvChunks.push(text);
        lineCount += (text.match(/\n/g) || []).length;
        if (lineCount >= MAX_LINES) {
          done = true;
          // Close connection to stop transfer
          try { client.close(); } catch { /* expected */ }
        }
        callback();
      },
    });

    try {
      await client.downloadTo(writable, epddFile.name);
    } catch (e: any) {
      // If we intentionally closed, that's fine
      if (!done) throw e;
    }

    const fullText = csvChunks.join("");
    // Trim to MAX_LINES actual lines
    const lines = fullText.split("\n").slice(0, MAX_LINES);
    console.log(`[ingest-sanmar] Captured ${lines.length} lines`);
    return lines.join("\n");
  } finally {
    try { client.close(); } catch { /* already closed */ }
  }
}

/**
 * Normalize a CSV header to a canonical key.
 * SanMar CSVs have varied column names across revisions.
 */
function findColumn(headers: string[], ...candidates: string[]): string | null {
  const normalized = headers.map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  for (const candidate of candidates) {
    const norm = candidate.toLowerCase().replace(/[\s_-]+/g, "");
    const idx = normalized.indexOf(norm);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

interface MappedProduct {
  distributor: string;
  brand: string;
  style_number: string;
  title: string;
  description: string;
  image_url: string;
}

function mapRows(rows: Record<string, string>[]): MappedProduct[] {
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]);
  const brandCol = findColumn(headers, "MILL", "MILL_NAME", "MILL NAME", "BRAND", "BRAND_NAME");
  const styleCol = findColumn(headers, "STYLE#", "STYLE", "UNIQUE_KEY", "STYLE_NUMBER");
  const titleCol = findColumn(headers, "PRODUCT_TITLE", "TITLE", "SHORT_DESCRIPTION");
  const descCol = findColumn(headers, "PRODUCT_DESCRIPTION", "DESCRIPTION", "LONG_DESCRIPTION");
  const imgCol = findColumn(
    headers,
    "FRONT_MODEL_IMAGE_URL",
    "COLOR_FRONT_IMAGE_URL",
    "FRONT_IMAGE_URL",
    "FRONT_IMAGE",
    "IMAGE_URL"
  );

  if (!styleCol) {
    throw new Error(
      `Cannot find style column. Available headers: ${headers.join(", ")}`
    );
  }

  console.log(
    `[ingest-sanmar] Column mapping: brand=${brandCol}, style=${styleCol}, title=${titleCol}, desc=${descCol}, img=${imgCol}`
  );

  const seen = new Set<string>();
  const mapped: MappedProduct[] = [];

  for (const row of rows) {
    const style = (row[styleCol!] ?? "").trim();
    if (!style || seen.has(style)) continue;
    seen.add(style);

    mapped.push({
      distributor: "sanmar",
      brand: (brandCol ? row[brandCol] : "").trim() || "SanMar",
      style_number: style,
      title: (titleCol ? row[titleCol] : "").trim() || style,
      description: (descCol ? row[descCol] : "").trim() || "",
      image_url: (imgCol ? row[imgCol] : "").trim() || "",
    });
  }

  return mapped;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // 1. Fetch CSV
    console.log("[ingest-sanmar] Starting catalog ingest...");
    const csvText = await fetchCsvText();
    console.log(`[ingest-sanmar] CSV fetched: ${csvText.length} bytes`);

    // 2. Parse CSV
    const rows = parse(csvText, {
      skipFirstRow: true,
      strip: true,
    }) as Record<string, string>[];
    console.log(`[ingest-sanmar] Parsed ${rows.length} total rows`);

    // 3. Map and limit
    const allMapped = mapRows(rows);
    const limited = allMapped.slice(0, ROW_LIMIT);
    console.log(
      `[ingest-sanmar] Mapped ${allMapped.length} unique styles, processing first ${limited.length}`
    );

    // 4. Upsert via sync-catalog in batches
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let totalUpserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < limited.length; i += BATCH_SIZE) {
      const batch = limited.slice(i, i + BATCH_SIZE);

      const resp = await fetch(`${supabaseUrl}/functions/v1/sync-catalog`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(batch),
      });

      const result = await resp.json();
      if (resp.ok) {
        totalUpserted += result.upserted ?? batch.length;
      } else {
        errors.push(`Batch ${i / BATCH_SIZE}: ${result.error || resp.statusText}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = {
      status: "complete",
      totalCsvRows: rows.length,
      uniqueStyles: allMapped.length,
      processed: limited.length,
      upserted: totalUpserted,
      errors,
      elapsedSeconds: elapsed,
    };

    console.log(`[ingest-sanmar] Done in ${elapsed}s:`, JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(`[ingest-sanmar] Fatal error: ${e.message}`);
    return new Response(
      JSON.stringify({ status: "error", message: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
