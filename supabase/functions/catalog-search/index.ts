import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SS_API_BASE = "https://api.ssactivewear.com/v2";
const MAX_STYLES_TO_FETCH = 12;

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

interface SSStyle {
  styleID?: number;
  styleName?: string;
  brandName?: string;
  title?: string;
  baseCategory?: string;
  styleImage?: string;
  partNumber?: string;
}

interface SSProduct {
  styleID?: number;
  styleName?: string;
  brandName?: string;
  title?: string;
  baseCategory?: string;
  colorName?: string;
  colorFrontImage?: string;
  sizeName?: string;
  customerPrice?: number;
  warehouses?: Array<{ warehouseAbbr?: string; qty?: number }>;
}

/**
 * Weighted ranking:
 * - 1000 pts for exact SKU match
 * - 500 pts if SKU is contained within search string or vice versa
 * - 10 pts per unique color
 * - 1 pt per 100 units of inventory
 */
function calculateScore(
  styleNumber: string,
  query: string,
  colorCount: number,
  totalInventory: number
): number {
  const nq = query.toUpperCase().trim();
  const ns = styleNumber.toUpperCase().trim();
  const queryLastPart = nq.split(/\s+/).pop() || nq;

  let score = 0;

  if (ns === nq || ns === queryLastPart) {
    score += 1000;
  } else if (ns.includes(queryLastPart) || queryLastPart.includes(ns)) {
    score += 500;
  }

  score += colorCount * 10;
  score += Math.floor(totalInventory / 100);

  return score;
}

function buildImageUrl(relativePath: string | undefined): string | null {
  if (!relativePath) return null;
  if (relativePath.startsWith("http")) return relativePath;
  const largePath = relativePath.replace(/_fm\./i, "_fl.");
  return `https://www.ssactivewear.com/${largePath}`;
}

/**
 * Fetch ALL matching styles from S&S Activewear styles search,
 * then fetch products for each to get color counts and inventory.
 */
async function fetchSSActivewearCatalog(
  query: string,
  authHeader: string
): Promise<CatalogProduct[]> {
  const fetchOpts = {
    headers: { Authorization: authHeader, Accept: "application/json" },
  };

  // Generate query variants for fuzzy matching
  const variants = [query.trim()];
  const lower = query.trim().toLowerCase();
  // letters+numbers without space → add spaced version
  const m = lower.match(/^([a-z]+)(\d+)$/);
  if (m) variants.push(`${m[1]} ${m[2]}`);
  // if has space, also try last part alone
  if (query.includes(" ")) {
    const parts = query.trim().split(/\s+/);
    variants.push(parts[parts.length - 1]);
  }

  // 1) Search styles endpoint to get ALL matching styles
  let allStyles: SSStyle[] = [];
  for (const variant of variants) {
    try {
      const url = `${SS_API_BASE}/styles/?search=${encodeURIComponent(variant)}`;
      console.log(`[catalog-search] S&S styles search: ${url}`);
      const res = await fetch(url, fetchOpts);
      if (res.ok) {
        const data: SSStyle[] = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          console.log(`[catalog-search] S&S found ${data.length} styles for "${variant}"`);
          // Merge unique styles by styleID
          for (const s of data) {
            if (s.styleID && !allStyles.find((x) => x.styleID === s.styleID)) {
              allStyles.push(s);
            }
          }
        }
      } else {
        await res.text();
      }
    } catch (err) {
      console.error(`[catalog-search] S&S styles error for "${variant}":`, err);
    }
  }

  if (allStyles.length === 0) {
    console.log("[catalog-search] S&S: no styles found");
    return [];
  }

  // Limit to top N styles to avoid too many API calls
  const stylesToFetch = allStyles.slice(0, MAX_STYLES_TO_FETCH);
  console.log(`[catalog-search] S&S: fetching products for ${stylesToFetch.length} styles`);

  // 2) Fetch products for each style in parallel to get color/inventory details
  const results = await Promise.allSettled(
    stylesToFetch.map(async (style): Promise<CatalogProduct | null> => {
      if (!style.styleID) return null;

      try {
        const url = `${SS_API_BASE}/products/?styleid=${style.styleID}`;
        const res = await fetch(url, fetchOpts);
        if (!res.ok) {
          await res.text();
          // Return a card with just style info, no color/inventory detail
          return {
            styleNumber: style.styleName || String(style.styleID),
            name: style.title || style.styleName || "Unknown",
            brand: style.brandName || "",
            category: style.baseCategory || "",
            imageUrl: buildImageUrl(style.styleImage) || undefined,
            colorCount: 0,
            totalInventory: 0,
            isProgramItem: false,
            distributorCode: "ss-activewear",
            distributorName: "S&S Activewear",
            score: 0,
          };
        }

        const products: SSProduct[] = await res.json();
        if (!Array.isArray(products) || products.length === 0) return null;

        // Count unique colors
        const colorNames = new Set<string>();
        let totalInventory = 0;
        let imageUrl: string | null = null;

        for (const p of products) {
          if (p.colorName) colorNames.add(p.colorName);
          if (!imageUrl && p.colorFrontImage) {
            imageUrl = buildImageUrl(p.colorFrontImage);
          }
          if (p.warehouses) {
            for (const wh of p.warehouses) {
              totalInventory += wh.qty || 0;
            }
          }
        }

        const styleNumber = style.styleName || products[0].styleName || String(style.styleID);
        const colorCount = colorNames.size;
        const score = calculateScore(styleNumber, query, colorCount, totalInventory);

        return {
          styleNumber,
          name: style.title || products[0].title || `${products[0].brandName} ${styleNumber}`,
          brand: style.brandName || products[0].brandName || "",
          category: style.baseCategory || products[0].baseCategory || "",
          imageUrl: imageUrl || buildImageUrl(style.styleImage) || undefined,
          colorCount,
          totalInventory,
          isProgramItem: false,
          distributorCode: "ss-activewear",
          distributorName: "S&S Activewear",
          score,
        };
      } catch (err) {
        console.error(`[catalog-search] S&S products error for style ${style.styleID}:`, err);
        return null;
      }
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<CatalogProduct | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((p): p is CatalogProduct => p !== null);
}

/**
 * Fetch SanMar results via the provider function (returns single product).
 */
async function fetchSanMarCatalog(
  query: string,
  supabase: ReturnType<typeof createClient>
): Promise<CatalogProduct[]> {
  try {
    const { data, error } = await supabase.functions.invoke("provider-sanmar", {
      body: { query, distributorId: "sanmar-001" },
    });

    if (error || !data?.product) {
      if (error) console.error("[catalog-search] SanMar error:", error.message);
      return [];
    }

    const product = data.product as Record<string, unknown>;
    const styleNumber = String(product.styleNumber ?? "");
    const colors = product.colors as Array<{
      sizes?: Array<{
        isProgramPrice?: boolean;
        inventory?: Array<{ quantity?: number }>;
      }>;
    }> | undefined;

    const colorCount = Array.isArray(colors) ? colors.length : 0;
    let totalInventory = 0;
    let isProgramItem = false;

    if (Array.isArray(colors)) {
      for (const c of colors) {
        if (Array.isArray(c?.sizes)) {
          for (const s of c.sizes) {
            if (s?.isProgramPrice) isProgramItem = true;
            if (Array.isArray(s?.inventory)) {
              for (const inv of s.inventory) {
                totalInventory += Number(inv?.quantity || 0);
              }
            }
          }
        }
      }
    }

    const score = calculateScore(styleNumber, query, colorCount, totalInventory);

    return [{
      styleNumber,
      name: String(product.name ?? ""),
      brand: String(product.brand ?? ""),
      category: String(product.category ?? ""),
      imageUrl: product.imageUrl ? String(product.imageUrl) : undefined,
      colorCount,
      totalInventory,
      isProgramItem,
      distributorCode: "sanmar",
      distributorName: "SanMar",
      score,
    }];
  } catch (err) {
    console.error("[catalog-search] SanMar exception:", err);
    return [];
  }
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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[catalog-search] Searching for: ${query}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // S&S credentials for direct API calls
    const ssUsername = Deno.env.get("SS_ACTIVEWEAR_USERNAME");
    const ssPassword = Deno.env.get("SS_ACTIVEWEAR_PASSWORD");
    const ssAuthHeader = ssUsername && ssPassword
      ? "Basic " + btoa(`${ssUsername}:${ssPassword}`)
      : "";

    // Fan out: S&S (direct, multi-result) + SanMar (via provider, single result) in parallel
    const [ssResults, sanmarResults] = await Promise.all([
      ssAuthHeader
        ? fetchSSActivewearCatalog(query, ssAuthHeader)
        : Promise.resolve([]),
      fetchSanMarCatalog(query, supabase),
    ]);

    console.log(`[catalog-search] S&S returned ${ssResults.length} products, SanMar returned ${sanmarResults.length}`);

    // Combine all results
    const allProducts = [...ssResults, ...sanmarResults];

    // Sort by score descending
    allProducts.sort((a, b) => b.score - a.score);

    console.log(`[catalog-search] Returning ${allProducts.length} total catalog products`);

    const response = {
      query,
      products: allProducts,
      searchedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[catalog-search] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
