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

// Canonical brand aliases → normalised name
const BRAND_ALIASES: [RegExp, string][] = [
  [/bella\s*[\+&]\s*canvas|bellacanvas/i,         "BELLA+CANVAS"],
  [/next\s*level(\s*apparel)?/i,                   "NEXT LEVEL"],
  [/sport[\s\-]?tek/i,                             "SPORT-TEK"],
  [/port\s*&?\s*company/i,                         "PORT & COMPANY"],
  [/comfort\s*colors?/i,                           "COMFORT COLORS"],
  [/gildan/i,                                      "GILDAN"],
  [/hanes/i,                                       "HANES"],
  [/jerzees/i,                                     "JERZEES"],
  [/independent\s*trading(\s*co\.?)?/i,            "INDEPENDENT TRADING"],
  [/alternative(\s*apparel)?/i,                    "ALTERNATIVE"],
  [/a4/i,                                          "A4"],
  [/district(\s*made)?/i,                          "DISTRICT"],
  [/new\s*era/i,                                   "NEW ERA"],
  [/augusta\s*sportswear/i,                        "AUGUSTA SPORTSWEAR"],
];

// Ordered longest-first so "BST" is tried before bare "B" etc.
const BRAND_PREFIX_MAP: Record<string, string[]> = {
  "BELLA+CANVAS":        ["BC"],
  "NEXT LEVEL":          ["NL"],
  "A4":                  ["A4"],
  "GILDAN":              ["GH400", "GH000", "G"],
  "SPORT-TEK":           ["BST", "ST"],
  "PORT & COMPANY":      ["PC"],
  "COMFORT COLORS":      ["CC"],
  "DISTRICT":            ["DT"],
  "JERZEES":             ["J"],
  "HANES":               ["H"],
  "NEW ERA":             ["NE"],
  "INDEPENDENT TRADING": ["IND"],
  "ALTERNATIVE":         ["AA"],
  "ECONSCIOUS":          ["EC"],
};

/**
 * Slugify a brand string for fuzzy comparison.
 * Strips all punctuation/spaces so "Bella + Canvas", "Bella+Canvas",
 * "BELLA+CANVAS", "Bella & Canvas" all collapse to "BELLACANVAS".
 */
function brandSlug(brand: string): string {
  return brand.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Pre-computed slug map: slug → canonical brand name
const BRAND_SLUG_MAP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [pattern, canonical] of BRAND_ALIASES) {
    // Derive a slug from each alias pattern's source string (strip regex meta chars)
    m.set(brandSlug(canonical), canonical);
  }
  return m;
})();

function normalizeBrandName(brand: string): string {
  const s = brand.trim();
  // First try exact regex match (most precise)
  for (const [pattern, canonical] of BRAND_ALIASES) {
    if (pattern.test(s)) return canonical;
  }
  // Fallback: slug-based lookup handles punctuation/spacing variants
  const slug = brandSlug(s);
  const fromSlug = BRAND_SLUG_MAP.get(slug);
  if (fromSlug) return fromSlug;
  return s.toUpperCase();
}

/**
 * ALL known prefixes ordered longest-first for prefix-agnostic stripping.
 * Used when we want to normalise a bare style number whose brand is unknown
 * or ambiguous (e.g. S&S "3001" for Bella+Canvas, SanMar "BC3001").
 */
const ALL_PREFIXES_LONGEST_FIRST: string[] = Object.values(BRAND_PREFIX_MAP)
  .flat()
  .sort((a, b) => b.length - a.length);

/**
 * Strips the brand-specific distributor prefix from a style number.
 * Returns the bare numeric+suffix portion (e.g. "BC3001" → "3001",
 * "G5000L" → "5000L"). Suffixes like L/Y/B/T are intentionally preserved.
 *
 * When brand is provided, only that brand's prefixes are tried (precise).
 * When brand is omitted or unknown, ALL known prefixes are tried (broad).
 */
function getCanonicalBase(styleNumber: string, brand: string): string {
  const normalBrand = normalizeBrandName(brand);
  const sn = styleNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Try brand-specific prefixes first (most accurate)
  const brandPrefixes = BRAND_PREFIX_MAP[normalBrand] ?? [];
  for (const prefix of brandPrefixes) {
    if (sn.startsWith(prefix) && sn.length > prefix.length) {
      const rest = sn.slice(prefix.length);
      if (/^\d/.test(rest)) return rest;
    }
  }

  // If no brand-specific prefix matched, try all known prefixes.
  // This handles cases where S&S/OneStop store a bare "3001" but SanMar stores
  // "BC3001" — both must resolve to the same canonical base "3001".
  for (const prefix of ALL_PREFIXES_LONGEST_FIRST) {
    if (sn.startsWith(prefix) && sn.length > prefix.length) {
      const rest = sn.slice(prefix.length);
      if (/^\d/.test(rest)) return rest;
    }
  }

  return sn;
}

/**
 * Dedup key uses a SLUG of the brand (strips all punctuation/spaces) to
 * prevent "Bella + Canvas" vs "Bella+Canvas" from producing different keys.
 * Format: "<BRAND_SLUG>::<CANONICAL_BASE>"
 */
function getCanonicalKey(styleNumber: string, brand: string): string {
  const normalBrand = normalizeBrandName(brand);
  const base = getCanonicalBase(styleNumber, brand);
  // Use slug for key so punctuation variants don't split groups
  return `${brandSlug(normalBrand)}::${base}`;
}

// Keep a simple alias for legacy callers inside this file
const normalizeSKU = (sn: string) => sn.toUpperCase().replace(/[^A-Z0-9]/g, "");

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

// ---------- Deduplication (canonical-brand cross-distributor merge) ----------

const DIST_PRIORITY: Record<string, number> = { sanmar: 3, "ss-activewear": 2, onestop: 1 };

function deduplicateRows(rows: DbRow[]): CatalogProduct[] {
  // Group rows by canonical brand + canonical base style.
  // This collapses e.g. SanMar "BC3001" and S&S "3001" into one card.
  const groups = new Map<string, { rows: DbRow[]; bestRank: number }>();

  for (const row of rows) {
    const groupKey = getCanonicalKey(row.style_number, row.brand);
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
    // Primary row: pick the most "complete" row.
    // Scoring: distributor priority (sanmar=3 > ss=2 > onestop=1) +
    //          bonus for having an image (+2) and a non-empty description (+1).
    // This ensures the deduped card always shows the best metadata.
    const primary = group.rows.reduce((best, r) => {
      const score = (DIST_PRIORITY[r.distributor] ?? 0)
        + (r.image_url ? 2 : 0)
        + (r.description && r.description.trim().length > 0 ? 1 : 0);
      const bestScore = (DIST_PRIORITY[best.distributor] ?? 0)
        + (best.image_url ? 2 : 0)
        + (best.description && best.description.trim().length > 0 ? 1 : 0);
      return score > bestScore ? r : best;
    }, group.rows[0]);

    // Build per-distributor SKU map with each distributor's own style number
    const distributorSkuMap: Record<string, string> = {};
    const distributorSources: string[] = [];
    for (const r of group.rows) {
      if (!distributorSkuMap[r.distributor]) {
        distributorSkuMap[r.distributor] = r.style_number;
        distributorSources.push(
          r.distributor === "sanmar"       ? "SanMar"
          : r.distributor === "ss-activewear" ? "S&S Activewear"
          : r.distributor
        );
      }
    }

    const canonicalBase = getCanonicalBase(primary.style_number, primary.brand);

    products.push({
      styleNumber: primary.style_number,
      normalizedSKU: canonicalBase,
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

    const ftsResult = await supabase.rpc("catalog_search_fts", { query_text: q });

    if (ftsResult.error) throw new Error(`DB error (fts): ${ftsResult.error.message}`);

    let allRows: DbRow[] = (ftsResult.data ?? []).map((r: any) => ({ ...r, rank: r.rank })) as DbRow[];
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
      const snCanonical = getCanonicalBase(row.style_number, row.brand);
      const brand = row.brand.toUpperCase();
      const title = row.title.toUpperCase();

      let rank = 0;
      if (sn === qUpper || snCanonical === qUpper) rank = 4;
      else if (sn.startsWith(qUpper) || snCanonical.startsWith(qUpper)) rank = 3;
      else if (sn.includes(qUpper) || snCanonical.includes(qUpper)) rank = 2;
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
