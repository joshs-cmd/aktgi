import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "distributor-archives";
const DISTRIBUTORS = ["sanmar", "ss-activewear", "onestop", "acc"];
const FILES_PER_DISTRIBUTOR = 7;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const result: Record<string, { name: string; size: number; created_at: string; downloadUrl: string }[]> = {};

    for (const distributor of DISTRIBUTORS) {
      const { data: files, error } = await supabase.storage
        .from(BUCKET)
        .list(distributor, {
          limit: FILES_PER_DISTRIBUTOR,
          sortBy: { column: "created_at", order: "desc" },
        });

      if (error) {
        console.error(`[list-archives] Error listing ${distributor}:`, error.message);
        result[distributor] = [];
        continue;
      }

      result[distributor] = await Promise.all(
        (files || [])
          .filter(f => f.name !== ".emptyFolderPlaceholder")
          .slice(0, FILES_PER_DISTRIBUTOR)
          .map(async (file) => {
            const filePath = `${distributor}/${file.name}`;
            const { data: signedData } = await supabase.storage
              .from(BUCKET)
              .createSignedUrl(filePath, 3600); // 1-hour download link

            return {
              name: file.name,
              size: file.metadata?.size ?? 0,
              created_at: file.created_at ?? file.updated_at ?? new Date().toISOString(),
              downloadUrl: signedData?.signedUrl ?? "",
            };
          })
      );
    }

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
