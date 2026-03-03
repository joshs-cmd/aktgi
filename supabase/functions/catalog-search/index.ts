import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---------- Types ----------

interface CatalogProduct {
  styleNumber: string;
  normalizedSKU: string;
  name: string;
  brand: string;
  category: string;
  imageUrl?: string;
  colorCount: number;
  totalInventory: number;
  isProgramItem: boolean;
  distributorCode: string;
  distributorName: string;
  distributorSources: string[];
  distributorSkuMap: Record<string, string>;
  score: number;
  basePrice?: number | null;
}

interface CatalogSearchResponse {
  query: string;
  products: CatalogProduct[];
  searchedAt: string;
}

// ---------- Distributor display names ----------

const DIST_DISPLAY: Record<string, string> = {
  sanmar: "SanMar",
  "ss-activewear": "S&S Activewear",
  onestop: "OneStop",
};

// ---------- Main handler ----------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const q = query.trim();
    console.log(`[catalog-search] query="${q}"`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---------- Call SQL-level deduped search ----------
    // This function groups by (brand_slug, canonical_base) at the DB level,
    // returning one "best" row per canonical style plus a JSON array of all
    // distributors that carry it. No client-side dedup needed.
    const { data, error: rpcError } = await supabase.rpc("catalog_search_deduped", { query_text: q });

    if (rpcError) throw new Error(`DB error: ${rpcError.message}`);

    const rows = (data ?? []) as Array<{
      id: string;
      distributor: string;
      brand: string;
      style_number: string;
      title: string;
      description: string | null;
      image_url: string | null;
      base_price: number | null;
      rank: number;
      all_distributors: Array<{ distributor: string; style_number: string }>;
    }>;

    console.log(`[catalog-search] SQL deduped returned ${rows.length} grouped products for "${q}"`);

    // ---------- ILIKE fallback for unusual alphanumeric codes ----------
    if (rows.length < 5) {
      const fallbackResult = await supabase
        .from("catalog_products")
        .select("id, distributor, brand, style_number, title, description, image_url, base_price")
        .ilike("style_number", `%${q}%`)
        .limit(200);

      if (!fallbackResult.error && fallbackResult.data) {
        // Only add rows whose id isn't already in the result set
        const seenIds = new Set(rows.map((r) => r.id));
        for (const row of fallbackResult.data) {
          if (!seenIds.has(row.id)) {
            seenIds.add(row.id);
            rows.push({
              ...row,
              rank: 0.5,
              all_distributors: [{ distributor: row.distributor, style_number: row.style_number }],
            });
          }
        }
        console.log(`[catalog-search] After ILIKE fallback: ${rows.length} rows`);
      }
    }

    // ---------- Map to CatalogProduct[] ----------
    const products: CatalogProduct[] = rows.map((row) => {
      const distributorSkuMap: Record<string, string> = {};
      const distributorSources: string[] = [];

      for (const d of row.all_distributors) {
        if (!distributorSkuMap[d.distributor]) {
          distributorSkuMap[d.distributor] = d.style_number;
          distributorSources.push(DIST_DISPLAY[d.distributor] ?? d.distributor);
        }
      }

      // Canonical base: strip non-alphanum
      const normalizedSKU = row.style_number.toUpperCase().replace(/[^A-Z0-9]/g, "");

      return {
        styleNumber: row.style_number,
        normalizedSKU,
        name: row.title,
        brand: row.brand,
        category: "",
        imageUrl: row.image_url ?? undefined,
        colorCount: 1,
        totalInventory: 0,
        isProgramItem: false,
        distributorCode: row.distributor,
        distributorName: distributorSources.join(", "),
        distributorSources,
        distributorSkuMap,
        score: row.rank,
        basePrice: row.base_price,
      };
    });

    // Sort by relevance score descending
    products.sort((a, b) => b.score - a.score);

    console.log(`[catalog-search] Returning ${products.length} products for "${q}"`);

    const response: CatalogSearchResponse = {
      query: q,
      products,
      searchedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(`[catalog-search] Error: ${e.message}`);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
