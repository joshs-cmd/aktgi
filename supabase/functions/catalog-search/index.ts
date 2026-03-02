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

// ---------- Build prefix tsquery string ----------
// Converts "gildan 5000" → "gildan:* & 5000:*" for partial matching

function buildPrefixTsquery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word}:*`)
    .join(" & ");
}

// ---------- DB row type ----------

interface DbRow {
  id: string;
  distributor: string;
  brand: string;
  style_number: string;
  title: string;
  description: string | null;
  image_url: string | null;
  base_price: number | null;
  rank?: number;
}

// ---------- Deduplication (same-brand cross-distributor merge) ----------

const DIST_PRIORITY: Record<string, number> = { sanmar: 3, "ss-activewear": 2, onestop: 1 };

function deduplicateRows(rows: DbRow[]): CatalogProduct[] {
  const groups = new Map<string, { rows: DbRow[]; bestRank: number }>();

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

    const rank = row.rank ?? 0;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.rows.push(row);
      if (rank > existing.bestRank) existing.bestRank = rank;
    } else {
      groups.set(groupKey, { rows: [row], bestRank: rank });
    }
  }

  const products: CatalogProduct[] = [];

  for (const [, group] of groups) {
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
      score: group.bestRank,
      basePrice: primary.base_price ?? group.rows.find((r) => r.base_price != null)?.base_price ?? null,
    });
  }

  // Sort by ts_rank score descending
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
    const prefixTsquery = buildPrefixTsquery(q);

    console.log(`[catalog-search] query="${q}" tsquery="${prefixTsquery}"`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---------- Stage 1: Full-Text Search with prefix matching ----------
    // Uses search_vector (GIN index) + ts_rank for relevance sorting.
    // The RPC call passes the tsquery string; we use a DB function to do the ranked query.
    // Since we can't run raw SQL via the JS client, we use .rpc() with a helper, OR
    // we use the PostgREST filter with textSearch and then sort manually.
    // PostgREST supports: .textSearch('search_vector', prefixTsquery, { type: 'plain', config: 'simple' })
    // but prefix queries need to_tsquery not plainto_tsquery. We'll use the filter approach.

    const ftsResult = await supabase
      .from("catalog_products")
      .select("id, distributor, brand, style_number, title, description, image_url, base_price")
      .filter("search_vector", "@@", `to_tsquery('simple', '${prefixTsquery.replace(/'/g, "''")}')`  )
      .limit(300);

    if (ftsResult.error) throw new Error(`DB error (fts): ${ftsResult.error.message}`);

    let allRows: DbRow[] = (ftsResult.data ?? []) as DbRow[];
    console.log(`[catalog-search] FTS returned ${allRows.length} rows for "${q}"`);

    // ---------- Stage 2: ILIKE fallback on style_number (btree index) ----------
    // Triggered when FTS returns fewer than 5 results (covers unusual alphanumeric codes).
    if (allRows.length < 5) {
      const stylePattern = `%${q}%`;
      const fallbackResult = await supabase
        .from("catalog_products")
        .select("id, distributor, brand, style_number, title, description, image_url, base_price")
        .ilike("style_number", stylePattern)
        .limit(200);

      if (fallbackResult.error) throw new Error(`DB error (fallback): ${fallbackResult.error.message}`);

      // Merge fallback rows, avoiding duplicates
      const seenIds = new Set(allRows.map((r) => r.id));
      for (const row of (fallbackResult.data ?? [])) {
        if (!seenIds.has(row.id)) {
          seenIds.add(row.id);
          allRows.push(row as DbRow);
        }
      }
      console.log(`[catalog-search] After ILIKE fallback: ${allRows.length} rows`);
    }

    // ---------- Stage 3: Client-side ts_rank approximation ----------
    // Since PostgREST can't return ts_rank directly, we approximate relevance:
    // Weight A (style_number exact) = 4, starts-with = 3, contains = 2; brand/title = 1.
    const qUpper = q.toUpperCase().replace(/[^A-Z0-9]/g, "");

    for (const row of allRows) {
      const sn = row.style_number.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const snNorm = normalizeSKU(row.style_number);
      const brand = row.brand.toUpperCase();
      const title = row.title.toUpperCase();

      let rank = 0;
      if (sn === qUpper || snNorm === qUpper) rank = 4;
      else if (sn.startsWith(qUpper) || snNorm.startsWith(qUpper)) rank = 3;
      else if (sn.includes(qUpper) || snNorm.includes(qUpper)) rank = 2;
      else if (brand.includes(q.toUpperCase()) || title.includes(q.toUpperCase())) rank = 1;
      else rank = 0.5; // matched via FTS token (e.g. partial word in title)

      (row as DbRow).rank = rank;
    }

    const products = deduplicateRows(allRows);

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
