import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "distributor-archives";
const DISTRIBUTORS = ["sanmar", "ss-activewear", "onestop"];
// Fetch enough files to find at least 1 CSV + 1 JSON per folder
const SCAN_LIMIT = 10;

type ArchiveFile = { name: string; size: number; created_at: string; downloadUrl: string };

async function listFolder(
  supabase: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>,
  folder: string
): Promise<ArchiveFile[]> {
  const { data: files, error } = await supabase.storage
    .from(BUCKET)
    .list(folder, { limit: SCAN_LIMIT, sortBy: { column: "created_at", order: "desc" } });

  if (error || !files) return [];

  const filtered = files.filter(
    f => f.name !== ".emptyFolderPlaceholder" && !f.name.endsWith("-ids.json") && !f.name.endsWith("-enriched-")
  );

  return Promise.all(
    filtered.map(async (file) => {
      const filePath = `${folder}/${file.name}`;
      const { data: signedData } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(filePath, 3600);
      return {
        name: file.name,
        size: file.metadata?.size ?? 0,
        created_at: file.created_at ?? file.updated_at ?? new Date().toISOString(),
        downloadUrl: signedData?.signedUrl ?? "",
      };
    })
  );
}

/** Return [latestCsv, latestJson] — CSV first, both optional */
function pickLatestPair(files: ArchiveFile[]): ArchiveFile[] {
  const csvFiles = files.filter(f => f.name.endsWith(".csv"));
  const jsonFiles = files.filter(f => f.name.endsWith(".json"));
  const result: ArchiveFile[] = [];
  if (csvFiles.length > 0) result.push(csvFiles[0]); // already sorted desc
  if (jsonFiles.length > 0) result.push(jsonFiles[0]);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const result: Record<string, ArchiveFile[]> = {};

    // Standard distributors — scan root folder, pick latest CSV + JSON
    for (const distributor of DISTRIBUTORS) {
      const all = await listFolder(supabase, distributor);
      result[distributor] = pickLatestPair(all);
    }

    // ACC: root folder has JSON, csv subfolder has CSV
    const [accAll, accCsvAll] = await Promise.all([
      listFolder(supabase, "acc"),
      listFolder(supabase, "acc/csv"),
    ]);

    const latestAccCsv = accCsvAll.filter(f => f.name.endsWith(".csv"))[0];
    const latestAccJson = accAll.filter(f => f.name.endsWith(".json"))[0];
    const accResult: ArchiveFile[] = [];
    if (latestAccCsv) accResult.push(latestAccCsv);
    if (latestAccJson) accResult.push(latestAccJson);
    result["acc"] = accResult;

    return new Response(JSON.stringify({ archives: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
