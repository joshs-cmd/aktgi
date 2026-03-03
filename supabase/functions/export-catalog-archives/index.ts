import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "distributor-archives";
const DISTRIBUTORS = ["sanmar", "ss-activewear", "onestop"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results: Record<string, unknown> = {};

  for (const distributor of DISTRIBUTORS) {
    try {
      // Fetch all rows for this distributor with pagination
      const PAGE = 1000;
      let allRows: Record<string, unknown>[] = [];
      let from = 0;
      while (true) {
        const { data: page, error } = await supabase
          .from("catalog_products")
          .select("distributor, style_number, brand, title, description, image_url, base_price, updated_at")
          .eq("distributor", distributor)
          .order("brand", { ascending: true })
          .order("style_number", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        if (!page || page.length === 0) break;
        allRows = allRows.concat(page);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      const rows = allRows;
      const error = null;

      if (error) throw new Error(error.message);

      // Use the most recent updated_at date as the file date
      const lastUpdated = rows && rows.length > 0
        ? rows.reduce((max, r) => r.updated_at > max ? r.updated_at : max, rows[0].updated_at)
        : new Date().toISOString();
      const dateStr = lastUpdated.slice(0, 10); // YYYY-MM-DD

      // Build CSV content
      const headers = ["style_number", "brand", "title", "description", "base_price", "image_url", "updated_at"];
      const csvLines = [
        headers.join(","),
        ...(rows || []).map(r =>
          headers.map(h => {
            const val = r[h as keyof typeof r];
            if (val === null || val === undefined) return "";
            const str = String(val).replace(/"/g, '""');
            return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
          }).join(",")
        ),
      ];
      const csvContent = csvLines.join("\n");

      // Save JSON archive (full data)
      const folderKey = distributor === "sanmar" ? "sanmar" : distributor === "ss-activewear" ? "ss-activewear" : "onestop";
      const prefix = distributor === "sanmar" ? "sanmar" : distributor === "ss-activewear" ? "ss-activewear" : "onestop";
      const jsonPath = `${folderKey}/${prefix}-${dateStr}.json`;
      const csvPath = `${folderKey}/${prefix}-${dateStr}.csv`;

      const jsonBody = new TextEncoder().encode(JSON.stringify(rows, null, 2));
      const csvBody = new TextEncoder().encode(csvContent);

      const [jsonResult, csvResult] = await Promise.all([
        supabase.storage.from(BUCKET).upload(jsonPath, jsonBody, { contentType: "application/json", upsert: true }),
        supabase.storage.from(BUCKET).upload(csvPath, csvBody, { contentType: "text/csv", upsert: true }),
      ]);

      results[distributor] = {
        rowCount: rows?.length ?? 0,
        date: dateStr,
        json: jsonResult.error ? `ERROR: ${jsonResult.error.message}` : jsonPath,
        csv: csvResult.error ? `ERROR: ${csvResult.error.message}` : csvPath,
      };

      console.log(`[export-catalog-archives] ${distributor}: ${rows?.length} rows → ${jsonPath}, ${csvPath}`);
    } catch (e) {
      results[distributor] = { error: e instanceof Error ? e.message : String(e) };
      console.error(`[export-catalog-archives] ${distributor} failed:`, e);
    }
  }

  return new Response(JSON.stringify({ status: "complete", results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
