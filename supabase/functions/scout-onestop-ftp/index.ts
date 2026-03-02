import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PREVIEW_ROWS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const ftpHost = Deno.env.get("ONESTOP_FTP_HOST")!;
  const ftpUser = Deno.env.get("ONESTOP_FTP_USER")!;
  const ftpPass = Deno.env.get("ONESTOP_FTP_PASS")!;

  if (!ftpHost || !ftpUser || !ftpPass) {
    return new Response(
      JSON.stringify({ error: "Missing ONESTOP_FTP_HOST / USER / PASS secrets" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { Client } = await import("npm:basic-ftp@5.0.5");
    const { Writable } = await import("node:stream");

    const client = new Client();
    client.ftp.verbose = false;

    console.log(`[scout-onestop-ftp] Connecting to ${ftpHost} as ${ftpUser}`);
    await client.access({ host: ftpHost, user: ftpUser, password: ftpPass, secure: false });

    // List root directory
    const rootEntries = await client.list("/");
    console.log(`[scout-onestop-ftp] Root entries (${rootEntries.length}):`);
    for (const e of rootEntries) {
      console.log(`  ${e.isDirectory ? "DIR" : "FILE"} ${e.name} ${e.size ? `(${(e.size / 1024).toFixed(0)} KB)` : ""}`);
    }

    // Recursively find all files (up to 2 levels deep) and pick largest ones
    interface FtpFile { path: string; name: string; size: number; }
    const allFiles: FtpFile[] = [];

    const scanDir = async (dir: string, depth: number) => {
      try {
        await client.cd(dir);
        const entries = await client.list();
        for (const e of entries) {
          const fullPath = `${dir === "/" ? "" : dir}/${e.name}`;
          if (e.isDirectory && depth < 2) {
            await scanDir(fullPath, depth + 1);
            await client.cd(dir);
          } else if (!e.isDirectory) {
            allFiles.push({ path: fullPath, name: e.name, size: e.size ?? 0 });
          }
        }
      } catch (e: any) {
        console.warn(`[scout-onestop-ftp] Could not scan ${dir}: ${e.message}`);
      }
    };

    await scanDir("/", 0);

    console.log(`[scout-onestop-ftp] Total files found: ${allFiles.length}`);

    // Sort by size descending — catalog files tend to be largest
    allFiles.sort((a, b) => b.size - a.size);

    // Log top 10 files
    const top10 = allFiles.slice(0, 10);
    console.log("[scout-onestop-ftp] Top 10 files by size:");
    for (const f of top10) {
      console.log(`  ${f.path} (${(f.size / 1024 / 1024).toFixed(2)} MB)`);
    }

    // Find best candidate: prefer .csv / .txt / .tsv in name
    const candidates = allFiles.filter(f =>
      /\.(csv|txt|tsv|dat)$/i.test(f.name)
    );
    console.log(`[scout-onestop-ftp] Delimited-file candidates: ${candidates.length}`);
    for (const f of candidates.slice(0, 10)) {
      console.log(`  ${f.path} (${(f.size / 1024 / 1024).toFixed(2)} MB)`);
    }

    if (candidates.length === 0) {
      client.close();
      return new Response(
        JSON.stringify({
          message: "No CSV/TXT/TSV files found. See logs for full file listing.",
          rootEntries: rootEntries.map(e => ({ name: e.name, isDir: e.isDirectory, size: e.size })),
          allFiles: allFiles.map(f => ({ path: f.path, size: f.size })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Pick largest candidate
    const target = candidates[0];
    console.log(`[scout-onestop-ftp] Previewing: ${target.path}`);

    // Stream just enough bytes for the first PREVIEW_ROWS rows (~64KB should be plenty)
    const PREVIEW_BYTES = 65536;
    let bytesRead = 0;
    const chunks: string[] = [];
    let aborted = false;

    // Navigate to parent dir of file
    const lastSlash = target.path.lastIndexOf("/");
    const fileDir = lastSlash > 0 ? target.path.substring(0, lastSlash) : "/";
    const fileName = target.path.substring(lastSlash + 1);

    await client.cd(fileDir);

    await new Promise<void>((resolve, reject) => {
      const writable = new Writable({
        write(chunk: Buffer, _enc: string, cb: (e?: Error | null) => void) {
          if (aborted) { cb(); return; }
          bytesRead += chunk.length;
          chunks.push(chunk.toString("utf-8"));
          if (bytesRead >= PREVIEW_BYTES) {
            aborted = true;
            try { client.close(); } catch { /* expected */ }
          }
          cb();
        },
      });
      writable.on("finish", () => resolve());
      writable.on("error", (e) => { if (aborted) resolve(); else reject(e); });
      client.downloadTo(writable, fileName)
        .then(() => resolve())
        .catch((e) => { if (aborted) resolve(); else reject(e); });
    });

    try { client.close(); } catch { /* ignore */ }

    const rawText = chunks.join("");
    const lines = rawText.split(/\r?\n/).filter(l => l.trim());
    const previewLines = lines.slice(0, PREVIEW_ROWS + 1); // header + N rows

    console.log(`[scout-onestop-ftp] === RAW PREVIEW of ${target.path} ===`);
    for (let i = 0; i < previewLines.length; i++) {
      console.log(`ROW ${i}: ${previewLines[i].substring(0, 500)}`);
    }

    // Detect delimiter
    const headerLine = previewLines[0] ?? "";
    const tabCount = (headerLine.match(/\t/g) || []).length;
    const commaCount = (headerLine.match(/,/g) || []).length;
    const pipeCount = (headerLine.match(/\|/g) || []).length;
    const delimiter = tabCount > commaCount && tabCount > pipeCount ? "\t"
      : pipeCount > commaCount ? "|"
      : ",";

    const headers = headerLine.split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ""));
    console.log(`[scout-onestop-ftp] Detected delimiter: ${delimiter === "\t" ? "TAB" : delimiter}`);
    console.log(`[scout-onestop-ftp] Headers (${headers.length}): ${headers.join(" | ")}`);

    return new Response(
      JSON.stringify({
        targetFile: target.path,
        fileSizeMB: (target.size / 1024 / 1024).toFixed(2),
        detectedDelimiter: delimiter === "\t" ? "TAB" : delimiter,
        headers,
        previewRows: previewLines.slice(1).map(l =>
          l.split(delimiter).reduce((acc, val, i) => {
            acc[headers[i] ?? `col_${i}`] = val.trim().replace(/^["']|["']$/g, "");
            return acc;
          }, {} as Record<string, string>)
        ),
        allCandidates: candidates.slice(0, 10).map(f => ({ path: f.path, sizeMB: (f.size / 1024 / 1024).toFixed(2) })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e: any) {
    console.error(`[scout-onestop-ftp] Fatal: ${e.message}`);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
