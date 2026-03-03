import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Brand-aware prefix mapping for fallback retries */
const PREFIX_BRAND_MAP: Record<string, string[]> = {
  "BC":  ["BELLA+CANVAS", "BELLA + CANVAS", "BELLA CANVAS", "BELLACANVAS"],
  "NL":  ["NEXT LEVEL", "NEXT LEVEL APPAREL", "NEXTLEVEL"],
  "G":   ["GILDAN"],
  "GD":  ["GILDAN"],
  "OS":  ["ONESTOP", "ONE STOP"],
  "PC":  ["PORT & COMPANY", "PORT AND COMPANY", "PORT COMPANY"],
  "CP":  ["CORNERSTONE", "CORNER STONE"],
  "DT":  ["DISTRICT", "DISTRICT MADE"],
  "J":   ["JERZEES"],
  "H":   ["HANES"],
  "CC":  ["COMFORT COLORS", "COMFORTCOLORS"],
  "SS":  ["SPORT-TEK", "SPORT TEK"],
};

/** Get the appropriate vendor prefix for a brand */
function getPrefixForBrand(brand: string): string | null {
  const upper = brand.toUpperCase().trim();
  for (const [prefix, brands] of Object.entries(PREFIX_BRAND_MAP)) {
    if (brands.some((b) => upper.includes(b) || b.includes(upper))) {
      return prefix;
    }
  }
  return null;
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

    // Hardcoded distributor roster (5 distributors)
    const distributors = [
      { id: "sanmar-001", code: "sanmar", name: "SanMar", is_active: true },
      { id: "ss-activewear-001", code: "ss-activewear", name: "S&S Activewear", is_active: true },
      { id: "onestop-001", code: "onestop", name: "OneStop", is_active: true },
      { id: "as-colour-001", code: "as-colour", name: "AS Colour", is_active: false },
      { id: "mccreary-001", code: "mccreary", name: "McCreary's", is_active: false },
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

        // Determine the SKU to use for this distributor
        const originalSku = distributorSkuMap?.[distributor.code];
        const queryForProvider = originalSku || query;

        try {
          const providerFnName = `provider-${distributor.code}`;
          console.log(`[sourcing-engine] Calling ${providerFnName} with SKU: "${queryForProvider}" (original: ${originalSku ? "yes" : "no, using query"})`);

          const { data, error } = await supabase.functions.invoke(providerFnName, {
            body: { query: queryForProvider, distributorId: distributor.id, brand },
          });

          if (error || !data?.product) {
            // PREFIX FALLBACK: If the call failed and we have a brand, retry with prefix
            if (brand && !originalSku) {
              const prefix = getPrefixForBrand(brand);
              if (prefix) {
                const prefixedQuery = `${prefix}${query}`;
                console.log(`[sourcing-engine] Retrying ${providerFnName} with prefix fallback: "${prefixedQuery}"`);
                
                const { data: retryData, error: retryError } = await supabase.functions.invoke(providerFnName, {
                  body: { query: prefixedQuery, distributorId: distributor.id, brand },
                });

                if (!retryError && retryData?.product) {
                  console.log(`[sourcing-engine] Prefix fallback succeeded for ${distributor.name}`);
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
    
    /** Strip known vendor prefixes if remainder starts with digit */
    const KNOWN_PREFIXES = ["SAN", "BC", "NL", "PC", "CP", "DT", "CC", "SS", "GD", "OS", "G", "J", "H"];
    const normalizeStyleNumber = (sn: string): string => {
      const upper = sn.toUpperCase().replace(/[^A-Z0-9]/g, "");
      for (const prefix of KNOWN_PREFIXES) {
        if (upper.startsWith(prefix) && upper.length > prefix.length) {
          const rest = upper.slice(prefix.length);
          if (/^\d/.test(rest)) return rest;
        }
      }
      return upper;
    };

    /**
     * Strip well-known style SUFFIXES (Ladies=L, Youth=B/Y, Women=W, Tall=T, Plus=P)
     * to derive the "base style number" (e.g. "5000L" → "5000", "3931B" → "3931").
     * We only strip a suffix if:
     *   1. It is a single letter at the end of the style number, AND
     *   2. The remaining part is purely numeric (or has a non-suffix letter prefix).
     * This prevents stripping legitimate style letters like the "C" in "1717C".
     */
    const GENDER_SUFFIXES = ["L", "B", "Y", "W", "T", "P"];
    const extractBaseStyle = (sn: string): string => {
      const norm = normalizeStyleNumber(sn);
      const lastChar = norm.slice(-1);
      if (GENDER_SUFFIXES.includes(lastChar)) {
        const withoutSuffix = norm.slice(0, -1);
        // Only strip if what remains ends in a digit (prevents over-stripping "BC" → "B")
        if (/\d$/.test(withoutSuffix)) {
          return withoutSuffix;
        }
      }
      return norm;
    };

    /**
     * Strict style match: the result's styleNumber must resolve to the SAME base style
     * as the query AND must not be a different gender/cut variant.
     * e.g. query="5000" → accepts "5000", rejects "5000L", "5000B"
     *      query="5000L" → accepts "5000L" only
     *      query="1717" → accepts "1717", "1717C" (comfort colors pocket tee — no numeric-only base)
     */
    const strictStyleMatch = (resultStyleRaw: string, queryRaw: string): boolean => {
      const resultNorm = normalizeStyleNumber(resultStyleRaw);
      const queryNorm  = normalizeStyleNumber(queryRaw);

      // Exact match always wins
      if (resultNorm === queryNorm) return true;

      const resultBase = extractBaseStyle(resultStyleRaw);
      const queryBase  = extractBaseStyle(queryRaw);

      // If query has no gender suffix, only accept results whose normalized style equals the query
      // (reject 5000L when searching 5000)
      if (queryNorm === queryBase) {
        // Query is a "base" style — result must also be the exact base (no suffix variant)
        return resultNorm === queryNorm;
      }

      // Query itself has a suffix (e.g. "5000L") — only accept that exact variant
      return resultNorm === queryNorm;
    };

    /** Normalize brand: strip suffixes, non-alphanum */
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
    
    const getTotalInventory = (product: unknown): number => {
      if (!product || typeof product !== "object") return 0;
      const p = product as Record<string, unknown>;
      let total = 0;
      const colors = p.colors as Array<{ sizes?: Array<{ inventory?: Array<{ quantity?: number }> }> }> | undefined;
      if (Array.isArray(colors)) {
        for (const color of colors) {
          if (Array.isArray(color?.sizes)) {
            for (const size of color.sizes) {
              if (Array.isArray(size?.inventory)) {
                for (const inv of size.inventory) {
                  total += Number(inv?.quantity || 0);
                }
              }
            }
          }
        }
      }
      return total;
    };

    // Normalize the query to find what style we're actually searching for
    const normalizedQuery = query.toUpperCase().trim();
    const queryLastPart = normalizedQuery.split(/\s+/).pop() || normalizedQuery;
    const queryFingerprint = normalizeStyleNumber(queryLastPart);

    // Compute each result's fingerprint and check if it matches the query
    // A result matches if its normalized styleNumber matches the normalized query
    const successResults = results.filter(r => r.status === "success" && r.product);
    
    // Find the "best" brand for the winner (priority: sanmar > ss-activewear > onestop)
    // to use as the canonical brand when checking cross-distributor matches
    const PRIORITY_ORDER = ["sanmar", "ss-activewear", "onestop"];
    const successByPriority = [...successResults].sort((a, b) => {
      return PRIORITY_ORDER.indexOf(a.distributorCode) - PRIORITY_ORDER.indexOf(b.distributorCode);
    });
    
    const primaryResult = successByPriority[0];
    const primaryBrand = primaryResult 
      ? normBrand(getProductField(primaryResult.product, "brand"))
      : "";
    const primaryStyleNorm = primaryResult
      ? normalizeStyleNumber(getProductField(primaryResult.product, "styleNumber"))
      : queryFingerprint;

    console.log(`[sourcing-engine] Primary: ${primaryBrand}::${primaryStyleNorm} (from ${primaryResult?.distributorName || "none"})`);

    // A result is a "winner" if its style strictly matches the queried style.
    // Uses strict base-style validation to reject gender/cut variants (5000L ≠ 5000).
    const isWinner = (r: DistributorResult): boolean => {
      if (!r.product) return false;
      const resultStyle = getProductField(r.product, "styleNumber");
      const brandNorm = normBrand(getProductField(r.product, "brand"));

      // Strict style match: rejects suffix variants (5000L when querying 5000)
      const styleMatches = strictStyleMatch(resultStyle, query)
        || (primaryResult && strictStyleMatch(resultStyle, getProductField(primaryResult.product, "styleNumber")));

      // Brand family check: prevent completely unrelated brands
      const brandMatches = !primaryBrand || brandNorm === primaryBrand
        || brandNorm.includes(primaryBrand.substring(0, 4))
        || primaryBrand.includes(brandNorm.substring(0, 4));

      return styleMatches && brandMatches;
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
