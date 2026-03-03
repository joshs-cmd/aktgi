import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---------------------------------------------------------------------------
// Canonical style normalization (mirrors src/lib/styleNormalization.ts)
// ---------------------------------------------------------------------------

const BRAND_ALIASES: [RegExp, string][] = [
  [/bella\s*[\+&]\s*canvas|bellacanvas/i,         "BELLA+CANVAS"],
  [/next\s*level(\s*apparel)?/i,                   "NEXT LEVEL"],
  [/sport[\s\-]?tek/i,                             "SPORT-TEK"],
  [/port\s*&?\s*company/i,                         "PORT & COMPANY"],
  [/comfort\s*colors?/i,                           "COMFORT COLORS"],
  [/gildan/i,                                      "GILDAN"],
  [/hanes/i,                                       "HANES"],
  [/jerzees/i,                                     "JERZEES"],
  [/a4/i,                                          "A4"],
  [/district(\s*made)?/i,                          "DISTRICT"],
  [/new\s*era/i,                                   "NEW ERA"],
  [/independent\s*trading(\s*co\.?)?/i,            "INDEPENDENT TRADING"],
  [/alternative(\s*apparel)?/i,                    "ALTERNATIVE"],
];

/** Longest-first so "BST" is tried before "B". */
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
};

function normalizeBrandName(brand: string): string {
  const s = brand.trim();
  for (const [pattern, canonical] of BRAND_ALIASES) {
    if (pattern.test(s)) return canonical;
  }
  return s.toUpperCase();
}

/** Strip brand prefix → bare numeric+suffix (e.g. "BC3001" → "3001"). */
function getCanonicalBase(styleNumber: string, brand: string): string {
  const normalBrand = normalizeBrandName(brand);
  const sn = styleNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const prefixes = BRAND_PREFIX_MAP[normalBrand] ?? [];
  for (const prefix of prefixes) {
    if (sn.startsWith(prefix) && sn.length > prefix.length) {
      const rest = sn.slice(prefix.length);
      if (/^\d/.test(rest)) return rest;
    }
  }
  return sn;
}

/**
 * Returns the style number a specific distributor expects.
 * SanMar → prefixed form (e.g. "BC3001").
 * S&S / OneStop → bare numeric form (e.g. "3001").
 */
function getDistributorStyle(canonicalBase: string, brand: string, distributor: string): string {
  const normalBrand = normalizeBrandName(brand);
  if (distributor === "sanmar") {
    const prefixes = BRAND_PREFIX_MAP[normalBrand];
    if (prefixes && prefixes.length > 0) {
      // Primary prefix = last entry (shortest)
      const primaryPrefix = prefixes[prefixes.length - 1];
      if (!canonicalBase.startsWith(primaryPrefix)) {
        return `${primaryPrefix}${canonicalBase}`;
      }
    }
  }
  return canonicalBase;
}

interface DistributorResult {
  distributorId: string;
  distributorCode: string;
  distributorName: string;
  status: "success" | "error" | "pending";
  product: unknown | null;
  lastSynced: string | null;
  errorMessage?: string;
}

interface SourcingResponse {
  query: string;
  results: DistributorResult[];
  searchedAt: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const query: string = body.query;
    const distributorSkuMap: Record<string, string> | undefined = body.distributorSkuMap;
    const brand: string | undefined = body.brand;

    if (!query || typeof query !== "string" || query.length > 100 || !/^[a-zA-Z0-9\s\-\+\&\.]+$/.test(query)) {
      return new Response(
        JSON.stringify({ error: "Invalid query format" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[sourcing-engine] Searching for: ${query}`);
    if (distributorSkuMap) {
      console.log(`[sourcing-engine] SKU map provided:`, JSON.stringify(distributorSkuMap));
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Hardcoded distributor roster
    const distributors = [
      { id: "sanmar-001",        code: "sanmar",        name: "SanMar",                 is_active: true  },
      { id: "ss-activewear-001", code: "ss-activewear", name: "S&S Activewear",          is_active: true  },
      { id: "onestop-001",       code: "onestop",       name: "OneStop",                 is_active: true  },
      { id: "acc-001",           code: "acc",           name: "Atlantic Coast Cotton",   is_active: true  },
      { id: "as-colour-001",     code: "as-colour",     name: "AS Colour",               is_active: false },
      { id: "mccreary-001",      code: "mccreary",      name: "McCreary's",              is_active: false },
    ];

    console.log(`[sourcing-engine] Using hardcoded roster: ${distributors.length} distributors`);

    // Fan out to each provider in parallel
    const results: DistributorResult[] = await Promise.all(
      (distributors || []).map(async (distributor) => {
        if (!distributor.is_active) {
          return {
            distributorId: distributor.id,
            distributorCode: distributor.code,
            distributorName: distributor.name,
            status: "pending" as const,
            product: null,
            lastSynced: null,
          };
        }

        // Determine the SKU to use for this distributor.
        // Priority: explicit distributorSkuMap → canonical routing → raw query
        const originalSku = distributorSkuMap?.[distributor.code];
        let queryForProvider: string;
        if (originalSku) {
          queryForProvider = originalSku;
        } else if (brand) {
          // Derive the canonical base, then re-add the prefix only for SanMar
          const canonicalBase = getCanonicalBase(query, brand);
          queryForProvider = getDistributorStyle(canonicalBase, brand, distributor.code);
        } else {
          queryForProvider = query;
        }

        try {
          const providerFnName = `provider-${distributor.code}`;
          console.log(`[sourcing-engine] Calling ${providerFnName} with SKU: "${queryForProvider}" (original: ${originalSku ? "yes" : "no, using query"})`);

          const { data, error } = await supabase.functions.invoke(providerFnName, {
            body: { query: queryForProvider, distributorId: distributor.id, brand },
          });

          if (error || !data?.product) {
            // CANONICAL FALLBACK: retry with the alternate form of the style number
            // e.g. if we sent "3001" to SanMar and got nothing, retry as "BC3001",
            // or if we sent "BC3001" to S&S and got nothing, retry as "3001".
            if (brand && !originalSku) {
              const canonicalBase = getCanonicalBase(query, brand);
              // The alternate is the opposite routing from what we tried first
              const triedPrefixed = queryForProvider !== canonicalBase;
              const altQuery = triedPrefixed
                ? canonicalBase
                : getDistributorStyle(canonicalBase, brand, distributor.code);

              if (altQuery !== queryForProvider) {
                console.log(`[sourcing-engine] Retrying ${providerFnName} with alt style: "${altQuery}"`);
                const { data: retryData, error: retryError } = await supabase.functions.invoke(providerFnName, {
                  body: { query: altQuery, distributorId: distributor.id, brand },
                });
                if (!retryError && retryData?.product) {
                  console.log(`[sourcing-engine] Alt-style fallback succeeded for ${distributor.name}`);
                  return {
                    distributorId: distributor.id,
                    distributorCode: distributor.code,
                    distributorName: distributor.name,
                    status: "success" as const,
                    product: retryData.product,
                    lastSynced: new Date().toISOString(),
                  };
                }
              }
            }

            if (error) {
              console.error(`[sourcing-engine] Error from ${providerFnName}:`, error);
              return {
                distributorId: distributor.id,
                distributorCode: distributor.code,
                distributorName: distributor.name,
                status: "error" as const,
                product: null,
                lastSynced: null,
                errorMessage: "Provider temporarily unavailable",
              };
            }

            // No product found (not an error, just empty)
            return {
              distributorId: distributor.id,
              distributorCode: distributor.code,
              distributorName: distributor.name,
              status: "success" as const,
              product: null,
              lastSynced: new Date().toISOString(),
            };
          }

          return {
            distributorId: distributor.id,
            distributorCode: distributor.code,
            distributorName: distributor.name,
            status: "success" as const,
            product: data?.product || null,
            lastSynced: new Date().toISOString(),
          };
        } catch (err) {
          console.error(`[sourcing-engine] Exception for ${distributor.code}:`, err);
          return {
            distributorId: distributor.id,
            distributorCode: distributor.code,
            distributorName: distributor.name,
            status: "error" as const,
            product: null,
            lastSynced: null,
            errorMessage: "Provider temporarily unavailable",
          };
        }
      })
    );

    // ===============================================================
    // MULTI-DISTRIBUTOR MERGE: Keep ALL distributors that returned a 
    // product for the queried style. Each distributor's data is shown
    // independently in the comparison table.
    // We only discard products that clearly belong to a DIFFERENT item
    // (different brand+style fingerprint that doesn't match the query).
    // ===============================================================
    
    // ============================================================
    // NORMALIZATION ENGINE: getCanonicalStyle
    // Splits a style number into { base, suffix } where suffix is
    // a known garment-type suffix (L=Ladies, Y/B=Youth, W=Women,
    // T=Tall, V=V-Neck). This is the HARD BOUNDARY for filtering.
    // ============================================================

    /** Known distributor prefixes — stripped before analysis */
    const KNOWN_PREFIXES = ["SAN", "BC", "NL", "PC", "CP", "DT", "CC", "SS", "GD", "OS", "G", "J", "H"];
    
    /** 
     * Garment-type suffixes that represent DIFFERENT products.
     * These are HARD BOUNDARIES — a Ladies '5000L' must never merge with Adult '5000'.
     */
    const GARMENT_SUFFIXES = ["L", "B", "Y", "W", "T", "V"];

    interface CanonicalStyle {
      base: string;   // e.g. "5000"
      suffix: string; // e.g. "L", "B", or "" for adult/unisex
    }

    const getCanonicalStyle = (styleNumber: string): CanonicalStyle => {
      // Strip known distributor prefixes first
      let upper = styleNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
      for (const prefix of KNOWN_PREFIXES) {
        if (upper.startsWith(prefix) && upper.length > prefix.length) {
          const rest = upper.slice(prefix.length);
          if (/^\d/.test(rest)) { upper = rest; break; }
        }
      }
      // Check if the style ends with a garment-type suffix after a numeric base
      // Pattern: digits followed by an optional suffix letter (e.g. "5000L", "18500B")
      const match = upper.match(/^(\d+)([A-Z]*)$/);
      if (match) {
        const numericPart = match[1];
        const letterPart = match[2];
        // Only treat it as a suffix if it's a known garment suffix
        if (letterPart && GARMENT_SUFFIXES.includes(letterPart)) {
          return { base: numericPart, suffix: letterPart };
        }
        return { base: upper, suffix: "" };
      }
      return { base: upper, suffix: "" };
    };

    /** Normalize brand: strip marketing words, non-alphanum */
    const normBrand = (b: string): string => {
      return b.toUpperCase()
        .replace(/\b(APPAREL|CLOTHING|MADE|USA)\b/g, "")
        .replace(/[^A-Z0-9]/g, "");
    };

    const getProductField = (product: unknown, field: string): string => {
      if (!product || typeof product !== "object") return "";
      const p = product as Record<string, unknown>;
      return String(p[field] ?? "").toUpperCase().trim();
    };

    // Parse the query style number  
    const queryLastPart = (query.toUpperCase().trim().split(/\s+/).pop() || query).toUpperCase().trim();
    const queryCanonical = getCanonicalStyle(queryLastPart);

    console.log(`[sourcing-engine] Query canonical: base="${queryCanonical.base}" suffix="${queryCanonical.suffix}"`);

    const successResults = results.filter(r => r.status === "success" && r.product);

    // Priority: sanmar > ss-activewear > onestop
    const PRIORITY_ORDER = ["sanmar", "ss-activewear", "onestop"];
    const successByPriority = [...successResults].sort((a, b) =>
      PRIORITY_ORDER.indexOf(a.distributorCode) - PRIORITY_ORDER.indexOf(b.distributorCode)
    );

    const primaryResult = successByPriority[0];
    const primaryBrand = primaryResult
      ? normBrand(getProductField(primaryResult.product, "brand"))
      : "";

    console.log(`[sourcing-engine] Primary brand: ${primaryBrand} (from ${primaryResult?.distributorName || "none"})`);

    /**
     * TWO-FACTOR MATCH:
     * 1. Base Match  — numeric base must be identical (e.g. "5000" == "5000")
     * 2. Suffix Match — suffix must match the query's suffix (hard boundary)
     *    Query "5000" (suffix="") rejects results with suffix "L", "B", etc.
     *    Query "5000L" (suffix="L") rejects results with suffix "" or "B", etc.
     * 3. Fuzzy Brand Match — brand family check (allows "Gildan" == "Gildan Activewear")
     */
    const isWinner = (r: DistributorResult): boolean => {
      if (!r.product) return false;
      const styleRaw = getProductField(r.product, "styleNumber");
      const { base: resultBase, suffix: resultSuffix } = getCanonicalStyle(styleRaw);
      const brandNorm = normBrand(getProductField(r.product, "brand"));

      // FACTOR 1: Base must match the query base
      const baseMatches = resultBase === queryCanonical.base;
      if (!baseMatches) {
        console.log(`[sourcing-engine] Rejected (base mismatch): ${styleRaw} → base=${resultBase} vs query base=${queryCanonical.base}`);
        return false;
      }

      // FACTOR 2: Suffix must match exactly — this is the DATA POLLUTION BOUNDARY
      const suffixMatches = resultSuffix === queryCanonical.suffix;
      if (!suffixMatches) {
        console.log(`[sourcing-engine] Rejected (suffix mismatch — DATA POLLUTION PREVENTED): ${styleRaw} suffix="${resultSuffix}" vs query suffix="${queryCanonical.suffix}"`);
        return false;
      }

      // FACTOR 3: Fuzzy brand match (allow same brand family, min 4-char prefix)
      const brandMatches = !primaryBrand
        || brandNorm === primaryBrand
        || brandNorm.includes(primaryBrand.substring(0, 4))
        || primaryBrand.includes(brandNorm.substring(0, 4));

      if (!brandMatches) {
        console.log(`[sourcing-engine] Rejected (brand mismatch): ${styleRaw} brand="${brandNorm}" vs primary="${primaryBrand}"`);
        return false;
      }

      return true;
    };

    const winnerIds = new Set<string>();
    for (const r of successResults) {
      if (isWinner(r)) {
        winnerIds.add(r.distributorId);
        console.log(`[sourcing-engine] Including winner: ${getProductField(r.product, "styleNumber")} (${r.distributorName})`);
      } else {
        console.log(`[sourcing-engine] Discarding non-matching: ${getProductField(r.product, "styleNumber")} (${r.distributorName})`);
      }
    }

    console.log(`[sourcing-engine] Winner group has ${winnerIds.size} distributors`);

    const finalResults: DistributorResult[] = results.map(r => {
      // Keep pending/error results as-is
      if (r.status !== "success" || !r.product) {
        return r;
      }
      
      // Keep if this distributor is in the winner group
      if (winnerIds.has(r.distributorId)) {
        const p = r.product as Record<string, unknown>;
        return {
          ...r,
          product: {
            ...p,
            styleNumber: String(p.styleNumber ?? ""),
            brand: String(p.brand ?? ""),
            name: String(p.name ?? ""),
            category: String(p.category ?? ""),
          }
        };
      }
      
      const styleNumber = getProductField(r.product, "styleNumber");
      console.log(`[sourcing-engine] Nulling non-winner: ${styleNumber} (${r.distributorName})`);
      return { ...r, product: null };
    });

    const response: SourcingResponse = {
      query,
      results: finalResults,
      searchedAt: new Date().toISOString(),
    };

    console.log(`[sourcing-engine] Returning ${finalResults.length} results`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[sourcing-engine] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: "Service temporarily unavailable",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
