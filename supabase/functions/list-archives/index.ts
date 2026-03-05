import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "distributor-archives";
const DISTRIBUTORS = ["sanmar", "ss-activewear", "onestop"];
const FILES_PER_DISTRIBUTOR = 1;

type ArchiveFile = { name: string; size: number; created_at: string; downloadUrl: string };

async function listFolder(
  supabase: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>,
  folder: string,
  limit: number
): Promise<ArchiveFile[]> {
  const { data: files, error } = await supabase.storage
    .from(BUCKET)
    .list(folder, { limit, sortBy: { column: "created_at", order: "desc" } });

  if (error || !files) return [];

  return Promise.all(
    files
      .filter(f => f.name !== ".emptyFolderPlaceholder" && !f.name.endsWith("-ids.json") && !f.name.endsWith("-enriched-"))
      .slice(0, limit)
      .map(async (file) => {
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

    // Standard distributors — single root folder
    for (const distributor of DISTRIBUTORS) {
      result[distributor] = await listFolder(supabase, distributor, FILES_PER_DISTRIBUTOR);
    }

    // ACC: merge root JSON files + csv subfolder, interleaved by date
    const [accJson, accCsv] = await Promise.all([
      listFolder(supabase, "acc", FILES_PER_DISTRIBUTOR),
      listFolder(supabase, "acc/csv", FILES_PER_DISTRIBUTOR),
    ]);

    // Merge: pair JSON + CSV by date slug, then sort by date desc
    const allAcc = [...accJson, ...accCsv].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    result["acc"] = allAcc.slice(0, FILES_PER_DISTRIBUTOR * 2);

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
