import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BRAND_SLUG_CANONICAL, canonicalBrandSlug, getCanonicalBase } from "../_shared/catalogResolve.ts";

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

// ---------- Helpers ----------

const DIST_LABELS: Record<string, string> = {
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

    // ---- Use the SQL-level deduped search (handles prefix stripping + grouping) ----
    const { data: dedupedRows, error: rpcError } = await supabase.rpc(
      "catalog_search_deduped",
      { query_text: q }
    );

    if (rpcError) throw new Error(`DB error (deduped): ${rpcError.message}`);

    let rows = dedupedRows ?? [];
    console.log(`[catalog-search] Deduped RPC returned ${rows.length} rows for "${q}"`);

    // ---- ILIKE fallback when FTS returns < 5 results ----
    if (rows.length < 5) {
      const fallbackResult = await supabase
        .from("catalog_products")
        .select("id, distributor, brand, style_number, title, description, image_url, base_price")
        .ilike("style_number", `%${q}%`)
        .limit(200);

      if (!fallbackResult.error && fallbackResult.data) {
        // Dedup fallback rows against already-returned IDs
        const seenIds = new Set(rows.map((r: any) => r.id));
        const extras = fallbackResult.data.filter((r: any) => !seenIds.has(r.id));
        if (extras.length > 0) {
          // These aren't SQL-deduped, so we'll client-side dedup below
          rows = [...rows, ...extras.map((r: any) => ({ ...r, rank: 0.1, all_distributors: null }))];
          console.log(`[catalog-search] After ILIKE fallback: ${rows.length} total rows`);
        }
      }
    }

    // ---- Build product cards ----
    // Rows from catalog_search_deduped already have all_distributors JSONB.
    // Fallback rows (all_distributors=null) need client-side grouping.
    
    // First pass: collect already-deduped rows by their canonical key
    const productMap = new Map<string, CatalogProduct>();

    for (const row of rows) {
      const canonicalBase = getCanonicalBase(row.style_number, row.brand);
      const groupKey = `${canonicalBrandSlug(row.brand)}::${canonicalBase}`;

      if (productMap.has(groupKey)) {
        // Merge distributor info into existing card
        const existing = productMap.get(groupKey)!;
        if (!existing.distributorSkuMap[row.distributor]) {
          existing.distributorSkuMap[row.distributor] = row.style_number;
          existing.distributorSources.push(DIST_LABELS[row.distributor] ?? row.distributor);
          existing.distributorName = existing.distributorSources.join(", ");
        }
        if (!existing.imageUrl && row.image_url) existing.imageUrl = row.image_url;
        if (existing.score < (row.rank ?? 0)) existing.score = row.rank ?? 0;
        continue;
      }

      // Build distributorSkuMap from all_distributors JSONB if available
      const distributorSkuMap: Record<string, string> = {};
      const distributorSources: string[] = [];

      if (row.all_distributors && Array.isArray(row.all_distributors)) {
        for (const d of row.all_distributors) {
          if (d.distributor && d.style_number && !distributorSkuMap[d.distributor]) {
            distributorSkuMap[d.distributor] = d.style_number;
            distributorSources.push(DIST_LABELS[d.distributor] ?? d.distributor);
          }
        }
      }

      // Ensure the row's own distributor is included
      if (!distributorSkuMap[row.distributor]) {
        distributorSkuMap[row.distributor] = row.style_number;
        distributorSources.push(DIST_LABELS[row.distributor] ?? row.distributor);
      }

      productMap.set(groupKey, {
        styleNumber: row.style_number,
        normalizedSKU: canonicalBase,
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
        score: row.rank ?? 0,
        basePrice: row.base_price ?? null,
      });
    }

    const products = Array.from(productMap.values()).sort((a, b) => b.score - a.score);

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
