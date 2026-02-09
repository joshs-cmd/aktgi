import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SS_API_BASE = "https://api.ssactivewear.com/v2";
const MAX_STYLES_TO_FETCH = 50;

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
  distributorSkuMap: Record<string, string>; // e.g. { sanmar: "NL3600", "ss-activewear": "3600" }
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

// ---------- SKU Normalization & Fingerprinting ----------

/**
 * Brand-aware prefix mapping: prefix → list of brand name variations it belongs to.
 * A prefix is ONLY stripped when the product's brand matches the mapping.
 */
const PREFIX_BRAND_MAP: Record<string, string[]> = {
  "BC":  ["BELLA+CANVAS", "BELLA + CANVAS", "BELLA CANVAS", "BELLACANVAS"],
  "NL":  ["NEXT LEVEL", "NEXT LEVEL APPAREL", "NEXTLEVEL"],
  "G":   ["GILDAN"],
  "PC":  ["PORT & COMPANY", "PORT AND COMPANY", "PORT COMPANY", "PORTCOMPANY"],
  "CP":  ["CORNERSTONE", "CORNER STONE"],
  "DT":  ["DISTRICT", "DISTRICT MADE"],
  "SAN": ["SANMAR"],
  "J":   ["JERZEES"],
  "H":   ["HANES"],
  "CC":  ["COMFORT COLORS", "COMFORTCOLORS"],
  "SS":  ["SPORT-TEK", "SPORT TEK", "SPORTEK"],
};

/** Ordered by length descending so longer prefixes match first (SAN before S) */
const ORDERED_PREFIXES = Object.keys(PREFIX_BRAND_MAP).sort((a, b) => b.length - a.length);

/** All known prefixes for blind (no-brand) normalization */
const ALL_PREFIXES = ORDERED_PREFIXES;

/**
 * Blind SKU normalization (no brand context).
 * Strips any known prefix if remainder starts with a digit.
 * Preserves suffixes (CVC, T, B, etc.) — only strips leading vendor codes.
 */
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

/**
 * Brand-aware fingerprint: only strips prefix when brand actually matches.
 * This prevents false merges (e.g. "G" prefix on a non-Gildan product).
 * Suffixes like CVC, T, B are PRESERVED — they differentiate products.
 */
function generateFingerprint(styleNumber: string, brand: string): string {
  // Step A: uppercase, strip non-alphanumeric
  const sn = styleNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const upperBrand = brand.toUpperCase().replace(/[^A-Z0-9 &+\-]/g, "").trim();

  // Step B: try to strip prefix only if brand matches
  for (const prefix of ORDERED_PREFIXES) {
    if (sn.startsWith(prefix) && sn.length > prefix.length) {
      const rest = sn.slice(prefix.length);
      if (!/^\d/.test(rest)) continue; // remainder must start with digit

      const allowedBrands = PREFIX_BRAND_MAP[prefix];
      const brandMatches = allowedBrands.some((b) => {
        const normalB = b.toUpperCase().replace(/[^A-Z0-9 &+\-]/g, "").trim();
        return upperBrand.includes(normalB) || normalB.includes(upperBrand);
      });

      if (brandMatches) return rest; // Step C: stripped fingerprint
    }
  }

  // No prefix matched brand — return cleaned SKU as-is
  return sn;
}

/**
 * Normalize brand name for grouping: strip common suffixes like "Apparel", 
 * remove non-alphanumeric chars. "Next Level Apparel" and "Next Level" both → "NEXTLEVEL"
 */
function normalizeBrand(brand: string): string {
  return brand
    .toUpperCase()
    .replace(/\b(APPAREL|CLOTHING|MADE|USA)\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
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
 * Determine match tier for a product against the query SKU.
 * Uses SOFT ranking — nothing is discarded, everything gets a tier.
 *
 * Tier 1 "exact":    normalized SKU equals query (2000 pts)
 * Tier 2 "starts":   normalized SKU starts with query (1000 pts)
 * Tier 3 "contains": query found anywhere in normalized SKU (500 pts)
 * Tier 4 "title":    query found in product name/title only (250 pts)
 * null:              no match at all (will be excluded)
 */
function matchProduct(
  styleNumber: string,
  productName: string,
  querySKU: string
): "exact" | "starts" | "contains" | "title" | null {
  const normalized = normalizeSKU(styleNumber);
  const q = querySKU.toUpperCase().trim();

  if (!q) return null;

  // Tier 1: Exact normalized match
  if (normalized === q) return "exact";

  // Tier 2: Starts with query
  if (normalized.startsWith(q)) return "starts";

  // Tier 3: Contains query anywhere in SKU
  if (normalized.includes(q)) return "contains";

  // Also check un-normalized SKU for contains
  const raw = styleNumber.toUpperCase().trim();
  if (raw.includes(q)) return "contains";

  // Tier 4: Query found in product title/name
  const upperName = productName.toUpperCase();
  if (upperName.includes(q)) return "title";

  return null;
}

// ---------- Scoring ----------

function calculateScore(
  matchType: "exact" | "starts" | "contains" | "title",
  colorCount: number,
  totalInventory: number
): number {
  const tierPoints = matchType === "exact" ? 2000
    : matchType === "starts" ? 1000
    : matchType === "contains" ? 500
    : 250;
  return tierPoints + (colorCount * 10) + Math.floor(totalInventory / 100);
}

// ---------- Deduplication ----------

function deduplicateProducts(
  products: RawCatalogProduct[],
  querySKU: string
): DedupedCatalogProduct[] {
  const groups = new Map<string, {
    items: RawCatalogProduct[];
    matchType: "exact" | "starts" | "contains" | "title";
  }>();

  for (const p of products) {
    const matchType = matchProduct(p.styleNumber, p.name, querySKU);
    if (!matchType) continue; // Only exclude if zero relevance

    // Group key: normalized brand + fingerprint (merges "Next Level" + "Next Level Apparel")
    const fingerprint = generateFingerprint(p.styleNumber, p.brand);
    const key = `${normalizeBrand(p.brand)}::${fingerprint}`;

    const existing = groups.get(key);
    if (existing) {
      existing.items.push(p);
      // Promote to best match type
      const rank = { exact: 4, starts: 3, contains: 2, title: 1 };
      if (rank[matchType] > rank[existing.matchType]) {
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

    // Build distributorSkuMap: { "sanmar": "NL3600", "ss-activewear": "3600" }
    const distributorSkuMap: Record<string, string> = {};
    for (const item of group.items) {
      if (!distributorSkuMap[item.distributorCode]) {
        distributorSkuMap[item.distributorCode] = item.styleNumber;
      }
    }

    const score = calculateScore(group.matchType, colorCount, totalInventory);

    deduped.push({
      styleNumber: primary.styleNumber,
      normalizedSKU: generateFingerprint(primary.styleNumber, primary.brand),
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
      distributorSkuMap,
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

// ---------- Query Expansion ----------

/** Known brand-prefix mappings for multi-cast search */
const BRAND_PREFIX_MAP: Record<string, string[]> = {
  "BC": ["Bella Canvas", "Bella+Canvas"],
  "G": ["Gildan"],
  "PC": ["Port & Company", "Port Company"],
  "NL": ["Next Level"],
  "SAN": ["SanMar"],
  "CC": ["Comfort Colors"],
  "SS": ["Sport-Tek"],
  "DT": ["District"],
  "J": ["Jerzees"],
  "H": ["Hanes"],
};

/**
 * Generate expanded search variants for the S&S API.
 * For a query like "3001", generates: ["3001", "BC3001", "Bella Canvas 3001", "NL3001", "G3001", ...]
 * For "BC3001", generates: ["BC3001", "3001", "Bella Canvas 3001"]
 */
function generateSearchVariants(query: string): string[] {
  const variants = new Set<string>();
  const trimmed = query.trim();
  const upper = trimmed.toUpperCase();
  
  // Always include the raw query
  variants.add(trimmed);
  
  // Extract the numeric core
  const normalizedSKU = normalizeSKU(trimmed);
  if (normalizedSKU !== upper) {
    variants.add(normalizedSKU); // stripped version (e.g. "3001" from "BC3001")
  }
  
  // If query is purely numeric or starts with digits, try all brand prefixes
  const isNumericQuery = /^\d+[A-Z]*$/i.test(normalizedSKU);
  
  if (isNumericQuery) {
    // Add prefixed variants: BC3001, G3001, PC3001, etc.
    for (const prefix of Object.keys(BRAND_PREFIX_MAP)) {
      variants.add(`${prefix}${normalizedSKU}`);
    }
    
    // Add "Brand SKU" variants: "Bella Canvas 3001", "Gildan 3001", etc.
    for (const brands of Object.values(BRAND_PREFIX_MAP)) {
      variants.add(`${brands[0]} ${normalizedSKU}`);
    }
  }
  
  // If query has spaces, also try just the last token
  if (trimmed.includes(" ")) {
    const parts = trimmed.split(/\s+/);
    variants.add(parts[parts.length - 1]);
  }
  
  // If query is like "bc3001", try "bc 3001"
  const alphaNumMatch = trimmed.match(/^([a-zA-Z]+)(\d+.*)$/);
  if (alphaNumMatch) {
    variants.add(`${alphaNumMatch[1]} ${alphaNumMatch[2]}`);
  }
  
  return [...variants];
}

// ---------- S&S Activewear ----------

/** Common style suffixes for family expansion */
const FAMILY_SUFFIXES = ["CVC", "T", "B", "Y", "W", "L", "C", "P", "H", "LS", "V", "FL", "SW", "VC", "BB", "HVY", "YS"];

async function fetchSSStylesBySearch(
  variants: string[],
  fetchOpts: RequestInit
): Promise<SSStyle[]> {
  const styleSearchResults = await Promise.allSettled(
    variants.map(async (variant) => {
      try {
        const url = `${SS_API_BASE}/styles/?search=${encodeURIComponent(variant)}`;
        const res = await fetch(url, fetchOpts);
        if (res.ok) {
          const data: SSStyle[] = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            console.log(`[catalog-search] S&S found ${data.length} styles for "${variant}"`);
            return data;
          }
        } else {
          await res.text();
        }
      } catch (err) {
        console.error(`[catalog-search] S&S styles error for "${variant}":`, err);
      }
      return [] as SSStyle[];
    })
  );

  const seenIds = new Set<number>();
  const allStyles: SSStyle[] = [];
  for (const result of styleSearchResults) {
    if (result.status === "fulfilled") {
      for (const s of result.value) {
        if (s.styleID && !seenIds.has(s.styleID)) {
          seenIds.add(s.styleID);
          allStyles.push(s);
        }
      }
    }
  }
  return allStyles;
}

/**
 * Phase 2: Brand-level family fetch.
 * After initial search identifies the primary brand, fetch ALL styles for that brand
 * and filter for ones whose styleName contains the query SKU.
 */
async function fetchSSFamilyStyles(
  primaryBrand: string,
  querySKU: string,
  existingIds: Set<number>,
  fetchOpts: RequestInit
): Promise<SSStyle[]> {
  if (!primaryBrand) return [];

  // Try multiple brand name formats (S&S API is picky about encoding)
  const brandVariants = [
    primaryBrand,
    primaryBrand.replace(/\+/g, "and"),
    primaryBrand.replace(/&/g, "and"),
    primaryBrand.replace(/\s*\+\s*/g, " "),
  ];
  // Dedupe
  const uniqueBrands = [...new Set(brandVariants)];

  for (const brand of uniqueBrands) {
    try {
      // S&S API: /v2/styles/{BrandName} returns all styles for a brand
      // Also try search endpoint as fallback
      const urls = [
        `${SS_API_BASE}/styles/${encodeURIComponent(brand)}`,
        `${SS_API_BASE}/styles/?search=${encodeURIComponent(brand)}`,
      ];

      for (const url of urls) {
        console.log(`[catalog-search] S&S family fetch: ${url}`);
        const res = await fetch(url, fetchOpts);

        if (!res.ok) {
          await res.text();
          continue;
        }

        const allBrandStyles: SSStyle[] = await res.json();
        if (!Array.isArray(allBrandStyles) || allBrandStyles.length === 0) continue;

        console.log(`[catalog-search] S&S brand "${brand}": ${allBrandStyles.length} total styles`);

        // Filter for styles containing the query SKU using fuzzy regex
        // For numeric queries like "3600", match any SKU starting with those digits: 3600, 3600SW, 3600LS, etc.
        const q = querySKU.toUpperCase();
        const isNumeric = /^\d+$/.test(q);
        const fuzzyRegex = isNumeric ? new RegExp(`^${q}[A-Z0-9]*$`) : null;
        
        const familyStyles = allBrandStyles.filter((s) => {
          if (!s.styleID || existingIds.has(s.styleID)) return false;
          const sn = normalizeSKU(s.styleName || "");
          // Fuzzy: starts-with for numeric queries, contains for alphanumeric
          if (fuzzyRegex) return fuzzyRegex.test(sn);
          return sn.includes(q);
        });

        console.log(`[catalog-search] S&S family filter: ${familyStyles.length} new styles contain "${querySKU}"`);
        return familyStyles;
      }
    } catch (err) {
      console.error(`[catalog-search] S&S family fetch error for "${brand}":`, err);
    }
  }

  return [];
}

async function fetchSSProductDetails(
  styles: SSStyle[],
  fetchOpts: RequestInit
): Promise<RawCatalogProduct[]> {
  const results = await Promise.allSettled(
    styles.map(async (style): Promise<RawCatalogProduct | null> => {
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

async function fetchSSActivewearCatalog(
  query: string,
  authHeader: string
): Promise<RawCatalogProduct[]> {
  const fetchOpts = {
    headers: { Authorization: authHeader, Accept: "application/json" },
  };

  const querySKU = extractQuerySKU(query);
  const variants = generateSearchVariants(query);
  console.log(`[catalog-search] S&S multi-cast: ${variants.length} search variants`);

  // Phase 1: Multi-cast search
  const phase1Styles = await fetchSSStylesBySearch(variants, fetchOpts);

  if (phase1Styles.length === 0) {
    console.log("[catalog-search] S&S: no styles found across all variants");
    return [];
  }

  console.log(`[catalog-search] S&S Phase 1: ${phase1Styles.length} unique styles from search`);

  // Phase 2: Brand-level family fetch
  // Identify the primary brand from the best-matching style
  const primaryBrand = phase1Styles.find((s) => {
    const sn = normalizeSKU(s.styleName || "");
    return sn === querySKU.toUpperCase() || sn.startsWith(querySKU.toUpperCase());
  })?.brandName || phase1Styles[0]?.brandName || "";

  const existingIds = new Set(phase1Styles.map((s) => s.styleID!).filter(Boolean));
  const familyStyles = await fetchSSFamilyStyles(primaryBrand, querySKU, existingIds, fetchOpts);

  // Combine and limit
  const allStyles = [...phase1Styles, ...familyStyles];
  const stylesToFetch = allStyles.slice(0, MAX_STYLES_TO_FETCH);

  console.log(`[catalog-search] S&S total: ${allStyles.length} styles (Phase1: ${phase1Styles.length}, Family: ${familyStyles.length}), fetching ${stylesToFetch.length}`);

  return fetchSSProductDetails(stylesToFetch, fetchOpts);
}

// ---------- SanMar (with fallback variants) ----------

function generateSanMarVariants(query: string): string[] {
  const variants = new Set<string>();
  const trimmed = query.trim();
  const normalizedSKU = normalizeSKU(trimmed);
  
  // Raw query
  variants.add(trimmed);
  
  // Normalized (prefix-stripped)
  if (normalizedSKU !== trimmed.toUpperCase()) {
    variants.add(normalizedSKU);
  }
  
  const isNumericCore = /^\d+[A-Z]*$/i.test(normalizedSKU);
  if (isNumericCore) {
    // Add common SanMar-style prefixed versions
    for (const prefix of ["BC", "PC", "G", "NL", "DT", "J"]) {
      variants.add(`${prefix}${normalizedSKU}`);
    }
    
    // Add family suffix variants (3001T, 3001B, 3001CVC, etc.)
    for (const suffix of FAMILY_SUFFIXES) {
      variants.add(`${normalizedSKU}${suffix}`);
      // Also try with brand prefix: BC3001CVC, etc.
      variants.add(`BC${normalizedSKU}${suffix}`);
    }
  }
  
  // If query has spaces, try last token
  if (trimmed.includes(" ")) {
    const parts = trimmed.split(/\s+/);
    variants.add(parts[parts.length - 1].toUpperCase());
  }
  
  return [...variants];
}

function parseSanMarProduct(product: Record<string, unknown>): RawCatalogProduct | null {
  const styleNumber = String(product.styleNumber ?? "");
  if (!styleNumber) return null;
  
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

  return {
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
  };
}

async function fetchSanMarCatalog(
  query: string,
  supabase: ReturnType<typeof createClient>
): Promise<RawCatalogProduct[]> {
  const variants = generateSanMarVariants(query);
  console.log(`[catalog-search] SanMar multi-cast: ${variants.length} variants`);
  
  const allProducts: RawCatalogProduct[] = [];
  const seenStyles = new Set<string>();
  
  // Batch into groups of 10 to avoid overwhelming the SOAP API
  const BATCH_SIZE = 10;
  for (let i = 0; i < variants.length; i += BATCH_SIZE) {
    const batch = variants.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (variant) => {
        try {
          const { data, error } = await supabase.functions.invoke("provider-sanmar", {
            body: { query: variant, distributorId: "sanmar-001" },
          });
          if (error || !data?.product) return null;
          return parseSanMarProduct(data.product as Record<string, unknown>);
        } catch (err) {
          // Silently skip failed variants
          return null;
        }
      })
    );
    
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        const key = `${result.value.brand}::${normalizeSKU(result.value.styleNumber)}`;
        if (!seenStyles.has(key)) {
          seenStyles.add(key);
          allProducts.push(result.value);
        }
      }
    }
  }
  
  console.log(`[catalog-search] SanMar: ${allProducts.length} unique products from ${variants.length} variants`);
  return allProducts;
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