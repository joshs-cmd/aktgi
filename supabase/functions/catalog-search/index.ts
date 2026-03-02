import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---------- Types (must match src/types/catalog.ts) ----------

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
}

interface CatalogSearchResponse {
  query: string;
  products: CatalogProduct[];
  searchedAt: string;
}

// ---------- Normalization helpers ----------

const PREFIX_BRAND_MAP: Record<string, string[]> = {
  "BC":  ["BELLA+CANVAS", "BELLA + CANVAS", "BELLA CANVAS", "BELLACANVAS"],
  "NL":  ["NEXT LEVEL", "NEXT LEVEL APPAREL", "NEXTLEVEL"],
  "G":   ["GILDAN"],
  "GD":  ["GILDAN"],
  "PC":  ["PORT & COMPANY", "PORT AND COMPANY", "PORT COMPANY", "PORTCOMPANY"],
  "DT":  ["DISTRICT", "DISTRICT MADE"],
  "J":   ["JERZEES"],
  "H":   ["HANES"],
  "CC":  ["COMFORT COLORS", "COMFORTCOLORS"],
  "SS":  ["SPORT-TEK", "SPORT TEK", "SPORTEK"],
};
const ORDERED_PREFIXES = Object.keys(PREFIX_BRAND_MAP).sort((a, b) => b.length - a.length);

function normalizeSKU(styleNumber: string): string {
  const sn = styleNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const prefix of ORDERED_PREFIXES) {
    if (sn.startsWith(prefix) && sn.length > prefix.length) {
      const rest = sn.slice(prefix.length);
      if (/^\d/.test(rest)) return rest;
    }
  }
  return sn;
}

function generateFingerprint(styleNumber: string, brand: string): string {
  const sn = styleNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const upperBrand = brand.toUpperCase().replace(/[^A-Z0-9 &+\-]/g, "").trim();
  for (const prefix of ORDERED_PREFIXES) {
    if (sn.startsWith(prefix) && sn.length > prefix.length) {
      const rest = sn.slice(prefix.length);
      if (!/^\d/.test(rest)) continue;
      const allowedBrands = PREFIX_BRAND_MAP[prefix];
      const brandMatches = allowedBrands.some((b) => {
        const normalB = b.toUpperCase().replace(/[^A-Z0-9 &+\-]/g, "").trim();
        return upperBrand.includes(normalB) || normalB.includes(upperBrand);
      });
      if (brandMatches) return rest;
    }
  }
  return sn;
}

function normalizeBrand(brand: string): string {
  return brand
    .toUpperCase()
    .replace(/\b(APPAREL|CLOTHING|MADE|USA|INC|LLC|CO|COMPANY|CORP|CORPORATION)\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

// ---------- Scoring ----------

function matchTier(
  styleNumber: string,
  title: string,
  brand: string,
  querySKU: string
): { tier: "exact" | "starts" | "contains" | "title"; score: number } | null {
  const normalized = normalizeSKU(styleNumber);
  const raw = styleNumber.toUpperCase().trim();
  const q = querySKU.toUpperCase().trim();
  if (!q) return null;

  if (normalized === q || raw === q) return { tier: "exact", score: 2000 };
  if (normalized.startsWith(q) || raw.startsWith(q)) return { tier: "starts", score: 1000 };
  if (normalized.includes(q) || raw.includes(q)) return { tier: "contains", score: 500 };
  if (title.toUpperCase().includes(q) || brand.toUpperCase().includes(q)) return { tier: "title", score: 250 };

  return null;
}

// ---------- DB row → CatalogProduct ----------

interface DbRow {
  id: string;
  distributor: string;
  brand: string;
  style_number: string;
  title: string;
  description: string | null;
  image_url: string | null;
}

function rowToProduct(row: DbRow, querySKU: string): CatalogProduct {
  const match = matchTier(row.style_number, row.title, row.brand, querySKU);
  const score = match?.score ?? 100;

  const distributorSkuMap: Record<string, string> = {
    [row.distributor]: row.style_number,
  };

  return {
    styleNumber: row.style_number,
    normalizedSKU: generateFingerprint(row.style_number, row.brand),
    name: row.title,
    brand: row.brand,
    category: "",
    imageUrl: row.image_url ?? undefined,
    colorCount: 1,
    totalInventory: 0,
    isProgramItem: false,
    distributorCode: row.distributor,
    distributorName: row.distributor === "sanmar" ? "SanMar"
      : row.distributor === "ss-activewear" ? "S&S Activewear"
      : row.distributor,
    distributorSources: [
      row.distributor === "sanmar" ? "SanMar"
        : row.distributor === "ss-activewear" ? "S&S Activewear"
        : row.distributor,
    ],
    distributorSkuMap,
    score,
  };
}

// ---------- Deduplication (same-brand cross-distributor merge) ----------

function deduplicateRows(rows: DbRow[], querySKU: string): CatalogProduct[] {
  const DIST_PRIORITY: Record<string, number> = { sanmar: 3, "ss-activewear": 2, onestop: 1 };

  // Group by brand + fingerprint (same logic as before, brand-partitioned)
  const groups = new Map<string, { rows: DbRow[]; bestTier: number }>();

  for (const row of rows) {
    const fp = generateFingerprint(row.style_number, row.brand);
    const brandKey = normalizeBrand(row.brand);
    const primaryKey = `${brandKey}::${fp}`;
    const numericRoot = fp.match(/^(\d+)/)?.[1] ?? "";
    const aggressiveKey = numericRoot.length >= 3 ? `${brandKey}::${numericRoot}` : "";

    let groupKey = primaryKey;
    if (!groups.has(primaryKey) && aggressiveKey && groups.has(aggressiveKey)) {
      groupKey = aggressiveKey;
    } else if (aggressiveKey && !groups.has(primaryKey)) {
      groupKey = aggressiveKey;
    }

    const match = matchTier(row.style_number, row.title, row.brand, querySKU);
    const tierScore = match?.score ?? 0;

    const existing = groups.get(groupKey);
    if (existing) {
      existing.rows.push(row);
      if (tierScore > existing.bestTier) existing.bestTier = tierScore;
    } else {
      groups.set(groupKey, { rows: [row], bestTier: tierScore });
    }
  }

  const products: CatalogProduct[] = [];

  for (const [, group] of groups) {
    // Select primary distributor
    const primary = group.rows.reduce((best, r) => {
      return (DIST_PRIORITY[r.distributor] ?? 0) > (DIST_PRIORITY[best.distributor] ?? 0)
        ? r
        : best;
    }, group.rows[0]);

    const distributorSkuMap: Record<string, string> = {};
    const distributorSources: string[] = [];
    for (const r of group.rows) {
      if (!distributorSkuMap[r.distributor]) {
        distributorSkuMap[r.distributor] = r.style_number;
        distributorSources.push(
          r.distributor === "sanmar" ? "SanMar"
            : r.distributor === "ss-activewear" ? "S&S Activewear"
            : r.distributor
        );
      }
    }

    products.push({
      styleNumber: primary.style_number,
      normalizedSKU: generateFingerprint(primary.style_number, primary.brand),
      name: primary.title,
      brand: primary.brand,
      category: "",
      imageUrl: primary.image_url ?? group.rows.find((r) => r.image_url)?.image_url ?? undefined,
      colorCount: 1,
      totalInventory: 0,
      isProgramItem: false,
      distributorCode: primary.distributor,
      distributorName: distributorSources.join(", "),
      distributorSources,
      distributorSkuMap,
      score: group.bestTier,
    });
  }

  products.sort((a, b) => b.score - a.score);
  return products;
}

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
    const querySKU = normalizeSKU(q.split(/\s+/).pop() ?? q);
    const qUpper = q.toUpperCase();

    console.log(`[catalog-search] query="${q}" querySKU="${querySKU}"`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Build search conditions using ilike for fast, case-insensitive matching.
    // We search style_number, brand, and title.
    // Run two queries in parallel:
    //   1. style_number match (most precise — exact + prefix)
    //   2. brand + title text match (for brand queries like "gildan" or "bella canvas")
    const stylePattern = `%${q}%`;
    const brandPattern = `%${q}%`;

    const [styleResult, textResult] = await Promise.all([
      // Style number search: ilike on style_number and normalized variants
      supabase
        .from("catalog_products")
        .select("id, distributor, brand, style_number, title, description, image_url")
        .ilike("style_number", stylePattern)
        .limit(200),
      // Brand/title search
      supabase
        .from("catalog_products")
        .select("id, distributor, brand, style_number, title, description, image_url")
        .or(`brand.ilike.${brandPattern},title.ilike.${brandPattern}`)
        .limit(200),
    ]);

    if (styleResult.error) throw new Error(`DB error (style): ${styleResult.error.message}`);
    if (textResult.error) throw new Error(`DB error (text): ${textResult.error.message}`);

    // Merge, deduplicate by id
    const seenIds = new Set<string>();
    const allRows: DbRow[] = [];
    for (const row of [...(styleResult.data ?? []), ...(textResult.data ?? [])]) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        allRows.push(row as DbRow);
      }
    }

    console.log(`[catalog-search] DB returned ${allRows.length} rows for "${q}"`);

    // Filter: only keep rows that actually match our tier scoring
    const matchedRows = allRows.filter(
      (r) => matchTier(r.style_number, r.title, r.brand, querySKU) !== null
    );

    // Deduplicate and build final product list
    const products = deduplicateRows(matchedRows, querySKU);

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
