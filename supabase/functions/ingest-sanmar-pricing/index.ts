import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 500;
// 10 MB per chunk to stay within CPU/memory limits
const CHUNK_BYTES = 10 * 1024 * 1024;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function findColumnIndex(headers: string[], ...candidates: string[]): number {
  const normalized = headers.map((h) => h.trim().toLowerCase().replace(/[\s_\-]+/g, ""));
  for (const candidate of candidates) {
    const norm = candidate.toLowerCase().replace(/[\s_\-]+/g, "");
    const idx = normalized.indexOf(norm);
    if (idx !== -1) return idx;
  }
  return -1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    let startOffset = 0;
    let headerLine = "";
    let priceFileNameHint = "";

    try {
      const body = await req.json();
      startOffset = body.offset ?? 0;
      headerLine = body.headerLine ?? "";
      priceFileNameHint = body.priceFile ?? "";
    } catch { /* no body = start from 0 */ }

    console.log(`[ingest-sanmar-pricing] Starting at offset=${startOffset}`);

    const ftpHost = Deno.env.get("SANMAR_FTP_HOST")!;
    const ftpUser = Deno.env.get("SANMAR_FTP_USER")!;
    const ftpPass = Deno.env.get("SANMAR_FTP_PASS")!;

    if (!ftpHost || !ftpUser || !ftpPass) {
      throw new Error("Missing SANMAR_FTP_HOST/USER/PASS");
    }

    const { Client } = await import("npm:basic-ftp@5.0.5");
    const { Writable } = await import("node:stream");
    const client = new Client();
    client.ftp.verbose = false;

    await client.access({ host: ftpHost, user: ftpUser, password: ftpPass, secure: false });

    // ---- Locate the pricing CSV on first invocation ----
    let priceFile: any = null;
    let priceDir = "/";

    if (priceFileNameHint) {
      // Continuation: we already know the file name & directory
      const parts = priceFileNameHint.split("|");
      priceDir = parts[0];
      priceFile = { name: parts[1], size: Number(parts[2] ?? 0) };
      console.log(`[ingest-sanmar-pricing] Resuming: dir=${priceDir} file=${priceFile.name}`);
    } else {
      // First invocation: scan for the daily pricing CSV
      // SanMar naming conventions: "Daily_Pricing_File*.csv", "pricing*.csv", "*price*.csv"
      const searchDir = async (dir: string) => {
        await client.cd(dir);
        const entries = await client.list();
        for (const f of entries) {
          if (f.isDirectory && dir === "/") {
            await searchDir(`/${f.name}`);
            if (priceFile) return;
            await client.cd(dir);
          } else if (!f.isDirectory && f.name.toLowerCase().endsWith(".csv")) {
            const lower = f.name.toLowerCase();
            if (
              lower.includes("price") ||
              lower.includes("pricing") ||
              lower.includes("daily") ||
              lower.includes("sdl") ||   // SanMar Standard Distribution List (net pricing)
              lower.includes("net")
            ) {
              priceFile = f;
              priceDir = dir;
              console.log(`[ingest-sanmar-pricing] Found pricing file: ${dir}/${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB)`);
              return;
            }
          }
        }
      };
      await searchDir("/");

      if (!priceFile) {
        // List all CSVs so we can debug
        const allCsvs: string[] = [];
        const listAll = async (dir: string) => {
          try {
            await client.cd(dir);
            const entries = await client.list();
            for (const f of entries) {
              if (!f.isDirectory && f.name.toLowerCase().endsWith(".csv")) {
                allCsvs.push(`${dir}/${f.name}`);
              } else if (f.isDirectory && dir === "/") {
                await listAll(`/${f.name}`);
                await client.cd(dir);
              }
            }
          } catch { /* ignore */ }
        };
        await listAll("/");
        throw new Error(`No daily pricing CSV found. Available CSVs: ${allCsvs.slice(0, 10).join(", ")}`);
      }
    }

    await client.cd(priceDir);
    const fileSize = priceFile.size || 0;
    const fileHint = `${priceDir}|${priceFile.name}|${fileSize}`;

    console.log(`[ingest-sanmar-pricing] File: ${priceFile.name} (${(fileSize / 1024 / 1024).toFixed(1)}MB), offset=${startOffset}`);

    // ---- Stream chunk ----
    if (startOffset > 0) {
      await client.send(`REST ${startOffset}`);
    }

    let bytesRead = 0;
    let csvChunks: string[] = [];
    let aborted = false;

    await new Promise<void>((resolve, reject) => {
      const writable = new Writable({
        write(chunk: Buffer, _enc: string, callback: (err?: Error | null) => void) {
          if (aborted) { callback(); return; }
          bytesRead += chunk.length;
          csvChunks.push(chunk.toString("utf-8"));
          if (bytesRead >= CHUNK_BYTES) {
            aborted = true;
            try { client.close(); } catch { /* expected */ }
          }
          callback();
        },
      });
      writable.on("finish", () => resolve());
      writable.on("error", (e) => { if (aborted) resolve(); else reject(e); });
      client.downloadTo(writable, priceFile.name)
        .then(() => resolve())
        .catch((e) => { if (aborted) resolve(); else reject(e); });
    });

    try { client.close(); } catch { /* ignore */ }

    const rawText = csvChunks.join("");
    csvChunks = [];
    console.log(`[ingest-sanmar-pricing] Read ${(bytesRead / 1024 / 1024).toFixed(1)}MB`);

    const allLines = rawText.split("\n");

    let headers: string[] = [];
    let dataLines: string[];

    if (startOffset === 0) {
      headerLine = allLines[0];
      dataLines = allLines.slice(1);
    } else {
      dataLines = allLines.slice(1); // skip partial first line
    }

    headers = parseCsvLine(headerLine);
    console.log(`[ingest-sanmar-pricing] Headers (first 10): ${headers.slice(0, 10).join(", ")}`);

    // Locate style and price columns
    // Common SanMar Daily Pricing File columns:
    //   STYLE#, UNIQUE_KEY, STYLE → style number
    //   PIECE_PRICE, PIECE PRICE, NET_PRICE, CUSTOMER_PRICE, PRICE → piece/net price
    const styleIdx = findColumnIndex(headers,
      "STYLE#", "STYLE", "UNIQUE_KEY", "STYLE_NUMBER", "STYLENUMBER"
    );
    const priceIdx = findColumnIndex(headers,
      "PIECE_PRICE", "PIECE PRICE", "PIECEPRICE",
      "NET_PRICE", "NETPRICE",
      "CUSTOMER_PRICE", "CUSTOMERPRICE",
      "YOUR_PRICE", "YOURPRICE",
      "PRICE"
    );

    if (styleIdx === -1) {
      throw new Error(`No style column found. Headers: ${headerLine.substring(0, 300)}`);
    }
    if (priceIdx === -1) {
      throw new Error(`No price column found. Headers: ${headerLine.substring(0, 300)}`);
    }

    console.log(`[ingest-sanmar-pricing] styleIdx=${styleIdx} (${headers[styleIdx]}), priceIdx=${priceIdx} (${headers[priceIdx]})`);

    // Handle incomplete last line
    const lastLineIncomplete = aborted;
    const lastLineBytes = lastLineIncomplete
      ? new TextEncoder().encode(allLines[allLines.length - 1]).length
      : 0;
    if (lastLineIncomplete && dataLines.length > 0) dataLines.pop();

    // Parse: lowest piece price per style (file may have one row per style/size)
    const stylePriceMap = new Map<string, number>();

    for (const line of dataLines) {
      if (!line.trim()) continue;
      const fields = parseCsvLine(line);
      const style = (fields[styleIdx] ?? "").trim();
      if (!style) continue;

      const rawPrice = (fields[priceIdx] ?? "").replace(/[$,\s]/g, "");
      const price = parseFloat(rawPrice);
      if (isNaN(price) || price <= 0) continue;

      // Keep the lowest piece price per style (best price = piece price for qty 1)
      const existing = stylePriceMap.get(style);
      if (existing === undefined || price < existing) {
        stylePriceMap.set(style, price);
      }
    }

    console.log(`[ingest-sanmar-pricing] Parsed ${stylePriceMap.size} unique styles with prices`);

    // Update base_price in catalog_products (UPDATE only — preserves brand/title from EPDD ingest)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Use UPDATE (not upsert) to only touch base_price without overwriting brand/title

    let totalUpdated = 0;
    const errors: string[] = [];

    // Use UPDATE (not upsert) to only touch base_price without overwriting brand/title
    const updatePromises: Promise<void>[] = [];
    for (const [style, price] of stylePriceMap.entries()) {
      updatePromises.push(
        supabase
          .from("catalog_products")
          .update({ base_price: price, updated_at: new Date().toISOString() })
          .eq("distributor", "sanmar")
          .eq("style_number", style)
          .then(({ error }) => {
            if (error) errors.push(`${style}: ${error.message}`);
            else totalUpdated++;
          })
      );
      // Run in batches of BATCH_SIZE concurrent promises to avoid overwhelming the DB
      if (updatePromises.length >= BATCH_SIZE) {
        await Promise.all(updatePromises.splice(0, BATCH_SIZE));
      }
    }
    if (updatePromises.length > 0) await Promise.all(updatePromises);

    // Calculate next offset
    const nextOffset = startOffset + bytesRead - lastLineBytes;
    const isComplete = !aborted || nextOffset >= fileSize;

    let nextChunkStatus = "";
    if (!isComplete) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      console.log(`[ingest-sanmar-pricing] Scheduling next chunk at offset=${nextOffset} (${((nextOffset / fileSize) * 100).toFixed(1)}%)`);

      fetch(`${supabaseUrl}/functions/v1/ingest-sanmar-pricing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ offset: nextOffset, headerLine, priceFile: fileHint }),
      }).catch((e) => console.error(`[ingest-sanmar-pricing] Failed to trigger next chunk: ${e.message}`));

      nextChunkStatus = `Next chunk queued at offset ${nextOffset} (${((nextOffset / fileSize) * 100).toFixed(1)}%)`;
    } else {
      console.log(`[ingest-sanmar-pricing] ALL CHUNKS COMPLETE`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = {
      status: isComplete ? "complete" : "chunk_done",
      pricingFile: priceFile.name,
      chunkOffset: startOffset,
      bytesRead,
      stylesInChunk: stylePriceMap.size,
      updated: totalUpdated,
      errors: errors.slice(0, 3),
      nextChunkStatus,
      elapsedSeconds: elapsed,
      progress: fileSize > 0 ? `${((nextOffset / fileSize) * 100).toFixed(1)}%` : "unknown",
    };

    console.log(`[ingest-sanmar-pricing] ${JSON.stringify(summary)}`);

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(`[ingest-sanmar-pricing] Fatal: ${e.message}`);
    return new Response(
      JSON.stringify({ status: "error", message: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
