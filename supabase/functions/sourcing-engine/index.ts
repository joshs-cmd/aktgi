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
            body: { query: queryForProvider, distributorId: distributor.id },
          });

          if (error || !data?.product) {
            // PREFIX FALLBACK: If the call failed and we have a brand, retry with prefix
            if (brand && !originalSku) {
              const prefix = getPrefixForBrand(brand);
              if (prefix) {
                const prefixedQuery = `${prefix}${query}`;
                console.log(`[sourcing-engine] Retrying ${providerFnName} with prefix fallback: "${prefixedQuery}"`);
                
                const { data: retryData, error: retryError } = await supabase.functions.invoke(providerFnName, {
                  body: { query: prefixedQuery, distributorId: distributor.id },
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
            promoDiagnostic: data?.promoDiagnostic || undefined,
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
    // GLOBAL SKU RESOLVER: Keep all products that match the same
    // normalized fingerprint — don't discard cross-distributor dupes
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

    // Build a normalized fingerprint for each successful result
    // Products with the same fingerprint are the SAME product from different distributors
    const normalizedQuery = query.toUpperCase().trim();
    const queryLastPart = normalizedQuery.split(/\s+/).pop() || normalizedQuery;
    const queryFingerprint = normalizeStyleNumber(queryLastPart);

    // Group results by normalized fingerprint
    const fingerprintGroups = new Map<string, DistributorResult[]>();
    
    for (const r of results) {
      if (r.status !== "success" || !r.product) continue;
      
      const styleNumber = getProductField(r.product, "styleNumber");
      const b = getProductField(r.product, "brand");
      const fp = `${normBrand(b)}::${normalizeStyleNumber(styleNumber)}`;
      
      const group = fingerprintGroups.get(fp) || [];
      group.push(r);
      fingerprintGroups.set(fp, group);
    }

    // Find the winning fingerprint group (best match to query)
    let winnerFingerprint: string | null = null;
    let bestTier = 999;
    let bestInventory = -1;

    for (const [fp, group] of fingerprintGroups) {
      const fpNorm = fp.split("::")[1] || "";
      
      // Tier: 1=exact, 2=partial match, 3=other
      let tier = 3;
      if (fpNorm === queryFingerprint) {
        tier = 1;
      } else if (fpNorm.includes(queryFingerprint) || queryFingerprint.includes(fpNorm)) {
        tier = 2;
      }

      const totalInv = group.reduce((sum, r) => sum + getTotalInventory(r.product), 0);

      if (tier < bestTier || (tier === bestTier && totalInv > bestInventory)) {
        bestTier = tier;
        bestInventory = totalInv;
        winnerFingerprint = fp;
      }
    }

    console.log(`[sourcing-engine] Winner fingerprint: ${winnerFingerprint || "none"} (tier=${bestTier})`);
    if (winnerFingerprint) {
      const winners = fingerprintGroups.get(winnerFingerprint) || [];
      console.log(`[sourcing-engine] Winner group has ${winners.length} distributors: ${winners.map(w => w.distributorName).join(", ")}`);
    }

    // Keep all results in the winning fingerprint group, null out others
    const winnerGroup = winnerFingerprint ? fingerprintGroups.get(winnerFingerprint) || [] : [];
    const winnerDistributorIds = new Set(winnerGroup.map(r => r.distributorId));

    const finalResults: DistributorResult[] = results.map(r => {
      // Keep pending/error results as-is
      if (r.status !== "success" || !r.product) {
        return r;
      }
      
      // Keep if this distributor is in the winner group
      if (winnerDistributorIds.has(r.distributorId)) {
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
      console.log(`[sourcing-engine] Discarding non-winner: ${styleNumber} (${r.distributorName})`);
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
