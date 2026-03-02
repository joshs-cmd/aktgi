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

  // Use basic-ftp for FTP download
  const { Client } = await import("npm:basic-ftp@5.0.5");
  const client = new Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: ftpHost,
      user: ftpUser,
      password: ftpPass,
      secure: false,
    });

    // List files to find the EPDD CSV
    const files = await client.list();
    const epddFile = files.find(
      (f: any) =>
        f.name.toLowerCase().includes("epdd") && f.name.toLowerCase().endsWith(".csv")
    );
    if (!epddFile) {
      const names = files.map((f: any) => f.name).join(", ");
      throw new Error(`No EPDD CSV found on FTP. Files: ${names}`);
    }

    console.log(`[ingest-sanmar] Downloading FTP file: ${epddFile.name}`);
    const chunks: Uint8Array[] = [];
    const writable = new WritableStream({
      write(chunk) {
        chunks.push(chunk);
      },
    });
    await client.downloadTo(writable, epddFile.name);
    const decoder = new TextDecoder();
    return chunks.map((c) => decoder.decode(c, { stream: true })).join("") +
      decoder.decode();
  } finally {
    client.close();
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
  const brandCol = findColumn(headers, "MILL_NAME", "MILL NAME", "BRAND", "BRAND_NAME");
  const styleCol = findColumn(headers, "STYLE", "UNIQUE_KEY", "STYLE_NUMBER", "STYLE_NUM");
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
