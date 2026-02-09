import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CatalogProduct {
  styleNumber: string;
  name: string;
  brand: string;
  category: string;
  imageUrl?: string;
  colorCount: number;
  totalInventory: number;
  isProgramItem: boolean;
  distributorCode: string;
  distributorName: string;
  score: number;
}

/**
 * Weighted ranking algorithm:
 * - Primary: Match Quality (1000 pts exact, 500 pts partial)
 * - Secondary: Color Depth (10 pts per unique color)
 * - Tertiary: Inventory Depth (1 pt per 100 units)
 */
function calculateScore(
  styleNumber: string,
  query: string,
  colorCount: number,
  totalInventory: number
): number {
  const normalizedQuery = query.toUpperCase().trim();
  const normalizedStyle = styleNumber.toUpperCase().trim();
  const queryLastPart = normalizedQuery.split(/\s+/).pop() || normalizedQuery;

  let score = 0;

  // Primary: Match Quality
  if (normalizedStyle === normalizedQuery || normalizedStyle === queryLastPart) {
    score += 1000;
  } else if (
    normalizedStyle.includes(queryLastPart) ||
    queryLastPart.includes(normalizedStyle)
  ) {
    score += 500;
  }

  // Secondary: Color Depth (10 pts per color)
  score += colorCount * 10;

  // Tertiary: Inventory Depth (1 pt per 100 units)
  score += Math.floor(totalInventory / 100);

  return score;
}

/**
 * Extract lightweight catalog info from a full product response
 */
function extractCatalogInfo(
  product: Record<string, unknown>,
  distributorCode: string,
  distributorName: string,
  query: string
): CatalogProduct | null {
  if (!product) return null;

  const styleNumber = String(product.styleNumber ?? "");
  const name = String(product.name ?? "");
  const brand = String(product.brand ?? "");
  const category = String(product.category ?? "");
  const imageUrl = product.imageUrl ? String(product.imageUrl) : undefined;

  const colors = product.colors as
    | Array<{
        sizes?: Array<{
          isProgramPrice?: boolean;
          inventory?: Array<{ quantity?: number }>;
        }>;
      }>
    | undefined;

  const colorCount = Array.isArray(colors) ? colors.length : 0;

  let totalInventory = 0;
  let isProgramItem = false;

  if (Array.isArray(colors)) {
    for (const color of colors) {
      if (Array.isArray(color?.sizes)) {
        for (const size of color.sizes) {
          if (size?.isProgramPrice) isProgramItem = true;
          if (Array.isArray(size?.inventory)) {
            for (const inv of size.inventory) {
              totalInventory += Number(inv?.quantity || 0);
            }
          }
        }
      }
    }
  }

  const score = calculateScore(styleNumber, query, colorCount, totalInventory);

  return {
    styleNumber,
    name,
    brand,
    category,
    imageUrl,
    colorCount,
    totalInventory,
    isProgramItem,
    distributorCode,
    distributorName,
    score,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "Query parameter is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[catalog-search] Searching for: ${query}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Active distributors to query
    const distributors = [
      { code: "sanmar", name: "SanMar" },
      { code: "ss-activewear", name: "S&S Activewear" },
    ];

    // Fan out to all active providers in parallel
    const providerResults = await Promise.allSettled(
      distributors.map(async (dist) => {
        const fnName = `provider-${dist.code}`;
        console.log(`[catalog-search] Calling ${fnName}`);

        const { data, error } = await supabase.functions.invoke(fnName, {
          body: { query, distributorId: `${dist.code}-001` },
        });

        if (error) {
          console.error(`[catalog-search] Error from ${fnName}:`, error.message);
          return null;
        }

        if (!data?.product) return null;

        return extractCatalogInfo(
          data.product as Record<string, unknown>,
          dist.code,
          dist.name,
          query
        );
      })
    );

    // Collect successful results
    const products: CatalogProduct[] = providerResults
      .filter(
        (r): r is PromiseFulfilledResult<CatalogProduct | null> =>
          r.status === "fulfilled"
      )
      .map((r) => r.value)
      .filter((p): p is CatalogProduct => p !== null);

    // Deduplicate by styleNumber+brand — keep the one with higher score
    const deduped = new Map<string, CatalogProduct>();
    for (const p of products) {
      const key = `${p.styleNumber.toUpperCase()}|${p.brand.toUpperCase()}`;
      const existing = deduped.get(key);
      if (!existing || p.score > existing.score) {
        deduped.set(key, p);
      }
    }

    // Sort by score descending
    const sorted = Array.from(deduped.values()).sort(
      (a, b) => b.score - a.score
    );

    console.log(
      `[catalog-search] Returning ${sorted.length} catalog products`
    );

    const response = {
      query,
      products: sorted,
      searchedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[catalog-search] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
