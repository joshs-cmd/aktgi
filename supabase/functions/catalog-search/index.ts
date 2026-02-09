import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SS_API_BASE = "https://api.ssactivewear.com/v2";
const MAX_STYLES_TO_FETCH = 20;

// ---------- Types ----------

interface RawCatalogProduct {
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
}

interface DedupedCatalogProduct {
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

// ---------- SKU Normalization & Matching ----------

/** Common distributor prefixes to strip for normalization */
const DISTRIBUTOR_PREFIXES = ["BC", "NL", "SAN", "PC", "G"];

/**
 * Strip known distributor prefixes from a style number.
 * e.g. "BC3001" → "3001", "G5000" → "5000", "PC61" → "61", "3001CVC" → "3001CVC"
 */
function normalizeSKU(styleNumber: string): string {
  const sn = styleNumber.toUpperCase().trim();
  for (const prefix of DISTRIBUTOR_PREFIXES) {
    if (sn.startsWith(prefix) && sn.length > prefix.length) {
      const rest = sn.slice(prefix.length);
      // Only strip if remainder starts with a digit (avoids stripping from e.g. "GRAND")
      if (/^\d/.test(rest)) return rest;
    }
  }
  return sn;
}

/**
 * Extract the "SKU part" from a query: last whitespace-separated token, then normalize.
 * e.g. "Bella Canvas 3001" → "3001", "BC3001" → "3001"
 */
function extractQuerySKU(query: string): string {
  const parts = query.trim().split(/\s+/);
  const raw = (parts.pop() || query.trim()).toUpperCase();
  return normalizeSKU(raw);
}

/**
 * Match a style number against the query SKU using normalized comparison.
 * Returns: "exact" | "starts" | "contains" | null
 *
 * Exact: normalized styleNumber equals querySKU
 * Starts: normalized styleNumber starts with querySKU (e.g. 3001CVC, 3001T)
 * Contains: querySKU appears in the normalized styleNumber (e.g. FF3001)
 * null: no match in the SKU itself
 */
function matchRootSKU(styleNumber: string, querySKU: string): "exact" | "starts" | "contains" | null {
  const normalized = normalizeSKU(styleNumber);
  const q = querySKU.toUpperCase().trim();

  if (!q || !normalized) return null;

  // Exact match after normalization
  if (normalized === q) return "exact";

  // Starts with query (family variants like 3001CVC, 3001T)
  if (normalized.startsWith(q)) return "starts";

  // Contains query as a segment (e.g. FF3001)
  if (normalized.endsWith(q)) return "contains";

  // Check hyphen/space-separated parts
  const parts = normalized.split(/[-\s]/);
  for (const part of parts) {
    if (part === q) return "contains";
  }

  // Check if query appears as contiguous digits in the SKU
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const containsRegex = new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`);
  if (containsRegex.test(normalized)) return "contains";

  return null;
}

// ---------- Scoring ----------

function calculateScore(
  matchType: "exact" | "starts" | "contains",
  colorCount: number,
  totalInventory: number
): number {
  let score = matchType === "exact" ? 2000 : matchType === "starts" ? 1000 : 500;
  score += colorCount * 10;
  score += Math.floor(totalInventory / 100);
  return score;
}

// ---------- Deduplication ----------

function deduplicateProducts(
  products: RawCatalogProduct[],
  querySKU: string
): DedupedCatalogProduct[] {
  const groups = new Map<string, {
    items: RawCatalogProduct[];
    matchType: "exact" | "starts" | "contains";
  }>();

  for (const p of products) {
    const matchType = matchRootSKU(p.styleNumber, querySKU);
    if (!matchType) continue; // Filter out non-matching results

    // Group key: normalized brand + normalized style number (merges BC3001 + 3001)
    const normalizedSKU = normalizeSKU(p.styleNumber);
    const key = `${p.brand.toUpperCase().trim()}::${normalizedSKU}`;

    const existing = groups.get(key);
    if (existing) {
      existing.items.push(p);
      // Promote match type: exact > starts > contains
      if (matchType === "exact" || (matchType === "starts" && existing.matchType === "contains")) {
        existing.matchType = matchType;
      }
    } else {
      groups.set(key, { items: [p], matchType });
    }
  }

  const deduped: DedupedCatalogProduct[] = [];

  for (const [, group] of groups) {
    const primary = group.items[0];
    const sources = [...new Set(group.items.map((i) => i.distributorName))];
    const totalInventory = group.items.reduce((sum, i) => sum + i.totalInventory, 0);
    const colorCount = Math.max(...group.items.map((i) => i.colorCount));
    const isProgramItem = group.items.some((i) => i.isProgramItem);

    const score = calculateScore(group.matchType, colorCount, totalInventory);

    deduped.push({
      styleNumber: primary.styleNumber,
      normalizedSKU: normalizeSKU(primary.styleNumber),
      name: primary.name,
      brand: primary.brand,
      category: primary.category,
      imageUrl: primary.imageUrl || group.items.find((i) => i.imageUrl)?.imageUrl,
      colorCount,
      totalInventory,
      isProgramItem,
      distributorCode: primary.distributorCode,
      distributorName: sources.join(", "),
      distributorSources: sources,
      score,
    });
  }

  // Sort: score descending
  deduped.sort((a, b) => b.score - a.score);
  return deduped;
}

// ---------- Image helpers ----------

function buildImageUrl(relativePath: string | undefined): string | null {
  if (!relativePath) return null;
  if (relativePath.startsWith("http")) return relativePath;
  const largePath = relativePath.replace(/_fm\./i, "_fl.");
  return `https://www.ssactivewear.com/${largePath}`;
}

// ---------- S&S Activewear ----------

async function fetchSSActivewearCatalog(
  query: string,
  authHeader: string
): Promise<RawCatalogProduct[]> {
  const fetchOpts = {
    headers: { Authorization: authHeader, Accept: "application/json" },
  };

  const variants = [query.trim()];
  const lower = query.trim().toLowerCase();
  const m = lower.match(/^([a-z]+)(\d+)$/);
  if (m) variants.push(`${m[1]} ${m[2]}`);
  if (query.includes(" ")) {
    const parts = query.trim().split(/\s+/);
    variants.push(parts[parts.length - 1]);
  }

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

  // Pre-filter styles by root-SKU match before fetching products
  const querySKU = extractQuerySKU(query);
  const matchedStyles = allStyles.filter((s) => {
    const sn = s.styleName || "";
    return matchRootSKU(sn, querySKU) !== null;
  });

  console.log(`[catalog-search] S&S: ${matchedStyles.length}/${allStyles.length} styles pass root-SKU filter`);

  const stylesToFetch = matchedStyles.slice(0, MAX_STYLES_TO_FETCH);

  const results = await Promise.allSettled(
    stylesToFetch.map(async (style): Promise<RawCatalogProduct | null> => {
      if (!style.styleID) return null;

      try {
        const url = `${SS_API_BASE}/products/?styleid=${style.styleID}`;
        const res = await fetch(url, fetchOpts);
        if (!res.ok) {
          await res.text();
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
          };
        }

        const products: SSProduct[] = await res.json();
        if (!Array.isArray(products) || products.length === 0) return null;

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

        return {
          styleNumber,
          name: style.title || products[0].title || `${products[0].brandName} ${styleNumber}`,
          brand: style.brandName || products[0].brandName || "",
          category: style.baseCategory || products[0].baseCategory || "",
          imageUrl: imageUrl || buildImageUrl(style.styleImage) || undefined,
          colorCount: colorNames.size,
          totalInventory,
          isProgramItem: false,
          distributorCode: "ss-activewear",
          distributorName: "S&S Activewear",
        };
      } catch (err) {
        console.error(`[catalog-search] S&S products error for style ${style.styleID}:`, err);
        return null;
      }
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<RawCatalogProduct | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((p): p is RawCatalogProduct => p !== null);
}

// ---------- SanMar ----------

async function fetchSanMarCatalog(
  query: string,
  supabase: ReturnType<typeof createClient>
): Promise<RawCatalogProduct[]> {
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
    }];
  } catch (err) {
    console.error("[catalog-search] SanMar exception:", err);
    return [];
  }
}

// ---------- Handler ----------

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

    const ssUsername = Deno.env.get("SS_ACTIVEWEAR_USERNAME");
    const ssPassword = Deno.env.get("SS_ACTIVEWEAR_PASSWORD");
    const ssAuthHeader = ssUsername && ssPassword
      ? "Basic " + btoa(`${ssUsername}:${ssPassword}`)
      : "";

    const [ssResults, sanmarResults] = await Promise.all([
      ssAuthHeader
        ? fetchSSActivewearCatalog(query, ssAuthHeader)
        : Promise.resolve([]),
      fetchSanMarCatalog(query, supabase),
    ]);

    console.log(`[catalog-search] S&S returned ${ssResults.length}, SanMar returned ${sanmarResults.length}`);

    // Combine raw results, then deduplicate + filter + score
    const allRaw = [...ssResults, ...sanmarResults];
    const querySKU = extractQuerySKU(query);
    const dedupedProducts = deduplicateProducts(allRaw, querySKU);

    console.log(`[catalog-search] After dedup/filter: ${dedupedProducts.length} products`);

    return new Response(JSON.stringify({
      query,
      products: dedupedProducts,
      searchedAt: new Date().toISOString(),
    }), {
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