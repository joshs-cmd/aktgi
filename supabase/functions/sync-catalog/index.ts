import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CatalogRecord {
  distributor: string;
  brand: string;
  style_number: string;
  title: string;
  description?: string;
  image_url?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const records: CatalogRecord[] = Array.isArray(body) ? body : body.records;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return new Response(
        JSON.stringify({ error: "Provide a non-empty array of product records." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate required fields
    for (const r of records) {
      if (!r.distributor || !r.style_number || !r.title || !r.brand) {
        return new Response(
          JSON.stringify({ error: "Each record must have distributor, brand, style_number, and title." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Upsert in batches of 500
    const BATCH = 500;
    let upserted = 0;
    let errors: string[] = [];

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH).map((r) => ({
        distributor: r.distributor,
        brand: r.brand,
        style_number: r.style_number,
        title: r.title,
        description: r.description || null,
        image_url: r.image_url || null,
        updated_at: new Date().toISOString(),
      }));

      const { error, count } = await supabase
        .from("catalog_products")
        .upsert(batch, { onConflict: "distributor,style_number", count: "exact" });

      if (error) {
        errors.push(`Batch ${i / BATCH}: ${error.message}`);
      } else {
        upserted += count ?? batch.length;
      }
    }

    return new Response(
      JSON.stringify({ upserted, total: records.length, errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
