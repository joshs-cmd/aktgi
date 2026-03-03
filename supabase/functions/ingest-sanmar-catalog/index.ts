import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ARCHIVE_BUCKET = "distributor-archives";

async function saveArchive(
  supabase: ReturnType<typeof createClient>,
  distributor: string,
  filename: string,
  content: string | Uint8Array,
  contentType: string
): Promise<void> {
  try {
    const path = `${distributor}/${filename}`;
    const body = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const { error } = await supabase.storage
      .from(ARCHIVE_BUCKET)
      .upload(path, body, { contentType, upsert: true });
    if (error) console.warn(`[archive] Failed to save ${path}: ${error.message}`);
    else console.log(`[archive] Saved ${path} (${body.byteLength} bytes)`);
  } catch (e) {
    console.warn(`[archive] Exception saving archive: ${e}`);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 500;
// Process ~10MB per invocation to stay within CPU/memory limits
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
  const normalized = headers.map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  for (const candidate of candidates) {
    const norm = candidate.toLowerCase().replace(/[\s_-]+/g, "");
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
    // Accept optional offset parameter to resume from a byte position
    let startOffset = 0;
    let headerLine = "";
    try {
      const body = await req.json();
      startOffset = body.offset ?? 0;
      headerLine = body.headerLine ?? "";
    } catch { /* no body = start from 0 */ }

    console.log(`[ingest-sanmar] Chunk ingest starting at offset=${startOffset}`);

    const ftpHost = Deno.env.get("SANMAR_FTP_HOST")!;
    const ftpUser = Deno.env.get("SANMAR_FTP_USER")!;
    const ftpPass = Deno.env.get("SANMAR_FTP_PASS")!;

    if (!ftpHost || !ftpUser || !ftpPass) {
      throw new Error("Set SANMAR_FTP_HOST/USER/PASS");
    }

    const { Client } = await import("npm:basic-ftp@5.0.5");
    const { Writable } = await import("node:stream");
    const client = new Client();
    client.ftp.verbose = false;

    await client.access({ host: ftpHost, user: ftpUser, password: ftpPass, secure: false });

    // Find the CSV file
    let epddFile: any = null;
    let epddDir = "/";
    const searchDir = async (dir: string) => {
      await client.cd(dir);
      const entries = await client.list();
      for (const f of entries) {
        if (f.isDirectory && dir === "/") {
          await searchDir(`/${f.name}`);
          if (epddFile) return;
          await client.cd(dir);
        } else if (
          !f.isDirectory &&
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
    if (!epddFile) throw new Error("No EPDD CSV found on FTP");

    await client.cd(epddDir);
    const fileSize = epddFile.size || 0;
    console.log(`[ingest-sanmar] File: ${epddFile.name} (${(fileSize / 1024 / 1024).toFixed(0)}MB), reading from offset ${startOffset}`);

    // If starting from offset > 0, use REST command to resume
    if (startOffset > 0) {
      await client.send(`REST ${startOffset}`);
    }

    // Stream and collect up to CHUNK_BYTES
    let bytesRead = 0;
    let csvChunks: string[] = [];
    let aborted = false;

    await new Promise<void>((resolve, reject) => {
      const writable = new Writable({
        write(chunk: Buffer, _encoding: string, callback: (err?: Error | null) => void) {
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
      writable.on("error", (e) => {
        if (aborted) resolve();
        else reject(e);
      });

      client.downloadTo(writable, epddFile.name).then(() => resolve()).catch((e) => {
        if (aborted) resolve();
        else reject(e);
      });
    });

    try { client.close(); } catch { /* ignore */ }

    const rawText = csvChunks.join("");
    csvChunks = []; // free memory
    console.log(`[ingest-sanmar] Read ${(bytesRead / 1024 / 1024).toFixed(1)}MB`);

    // Split into lines
    const allLines = rawText.split("\n");

    // Parse headers
    let headers: string[] = [];
    let brandIdx = -1, styleIdx = -1, titleIdx = -1, descIdx = -1, imgIdx = -1;
    let dataLines: string[];

    if (startOffset === 0) {
      // First chunk — first line is the header
      headerLine = allLines[0];
      dataLines = allLines.slice(1);
    } else {
      // Continuation — first line is partial (skip it), use provided headerLine
      dataLines = allLines.slice(1); // skip partial first line
    }

    headers = parseCsvLine(headerLine);
    brandIdx = findColumnIndex(headers, "MILL", "MILL_NAME", "BRAND");
    styleIdx = findColumnIndex(headers, "STYLE#", "STYLE", "UNIQUE_KEY");
    titleIdx = findColumnIndex(headers, "PRODUCT_TITLE", "TITLE");
    descIdx = findColumnIndex(headers, "PRODUCT_DESCRIPTION", "DESCRIPTION");
    imgIdx = findColumnIndex(headers, "FRONT_MODEL_IMAGE_URL", "COLOR_FRONT_IMAGE_URL");

    if (styleIdx === -1) throw new Error(`No style column in headers: ${headerLine.substring(0, 200)}`);

    // Last line may be incomplete — don't process it, account for in next offset
    const lastLineIncomplete = !aborted ? false : true;
    const lastLineBytes = lastLineIncomplete ? new TextEncoder().encode(allLines[allLines.length - 1]).length : 0;
    if (lastLineIncomplete && dataLines.length > 0) {
      dataLines.pop(); // remove incomplete last line
    }

    // Map and deduplicate
    const seen = new Set<string>();
    const now = new Date().toISOString();
    interface MappedProduct {
      distributor: string;
      brand: string;
      style_number: string;
      title: string;
      description: string | null;
      image_url: string | null;
      updated_at: string;
    }
    const mapped: MappedProduct[] = [];

    for (const line of dataLines) {
      if (!line.trim()) continue;
      const fields = parseCsvLine(line);
      const style = (fields[styleIdx] ?? "").trim();
      if (!style || seen.has(style)) continue;
      seen.add(style);

      mapped.push({
        distributor: "sanmar",
        brand: (brandIdx >= 0 ? fields[brandIdx] : "").trim() || "SanMar",
        style_number: style,
        title: (titleIdx >= 0 ? fields[titleIdx] : "").trim() || style,
        description: (descIdx >= 0 ? fields[descIdx] : "").trim() || null,
        image_url: (imgIdx >= 0 ? fields[imgIdx] : "").trim() || null,
        updated_at: now,
      });
    }

    console.log(`[ingest-sanmar] Chunk: ${dataLines.length} data lines, ${mapped.length} unique styles`);

    // Save raw CSV chunk archive on first chunk (offset=0) only to avoid duplicate files per day
    if (startOffset === 0) {
      const dateStr = new Date().toISOString().slice(0, 10);
      const csvContent = [headerLine, ...dataLines].join("\n");
      await saveArchive(supabase, "sanmar", `sanmar-${dateStr}.csv`, csvContent, "text/csv");
    }

    // Upsert to DB
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let totalUpserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
      const batch = mapped.slice(i, i + BATCH_SIZE);
      const { error, count } = await supabase
        .from("catalog_products")
        .upsert(batch, { onConflict: "distributor,style_number", count: "exact" });
      if (error) {
        errors.push(error.message);
      } else {
        totalUpserted += count ?? batch.length;
      }
    }

    // Calculate next offset
    const nextOffset = startOffset + bytesRead - lastLineBytes;
    const isComplete = !aborted || nextOffset >= fileSize;

    // If not complete, self-invoke the next chunk
    let nextChunkStatus = "";
    if (!isComplete) {
      console.log(`[ingest-sanmar] Scheduling next chunk at offset=${nextOffset} (${((nextOffset / fileSize) * 100).toFixed(1)}%)`);
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // Fire-and-forget the next chunk
      fetch(`${supabaseUrl}/functions/v1/ingest-sanmar-catalog`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ offset: nextOffset, headerLine }),
      }).catch((e) => console.error(`[ingest-sanmar] Failed to trigger next chunk: ${e.message}`));

      nextChunkStatus = `Next chunk queued at offset ${nextOffset} (${((nextOffset / fileSize) * 100).toFixed(1)}%)`;
    } else {
      console.log(`[ingest-sanmar] ALL CHUNKS COMPLETE`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = {
      status: isComplete ? "complete" : "chunk_done",
      chunkOffset: startOffset,
      bytesRead,
      stylesInChunk: mapped.length,
      upserted: totalUpserted,
      errors: errors.slice(0, 3),
      nextChunkStatus,
      elapsedSeconds: elapsed,
      progress: `${((nextOffset / fileSize) * 100).toFixed(1)}%`,
    };

    console.log(`[ingest-sanmar] ${JSON.stringify(summary)}`);

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
