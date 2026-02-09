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

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "Query parameter is required" }),
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
      { id: "as-colour-001", code: "as-colour", name: "AS Colour", is_active: false },
      { id: "onestop-001", code: "onestop", name: "OneStop", is_active: false },
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
                errorMessage: error.message,
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
            errorMessage: err instanceof Error ? err.message : "Unknown error",
          };
        }
      })
    );

    // ===============================================================
    // GLOBAL SKU RESOLVER: Pick ONE "Winner" Product
    // ===============================================================
    const normalizedQuery = query.toUpperCase().trim();
    const queryLastPart = normalizedQuery.split(/\s+/).pop() || normalizedQuery;
    
    const PRIORITY_BRANDS = [
      "GILDAN", "PORT & COMPANY", "PORT AND COMPANY", "BELLA + CANVAS", 
      "BELLA+CANVAS", "BELLACANVAS", "NEXT LEVEL", "NEXT LEVEL APPAREL",
      "HANES", "JERZEES", "FRUIT OF THE LOOM", "CHAMPION", "AMERICAN APPAREL"
    ];
    
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
    
    const getBrandPriority = (b: string): number => {
      const idx = PRIORITY_BRANDS.findIndex(pb => b.includes(pb) || pb.includes(b));
      return idx !== -1 ? idx : 999;
    };
    
    interface ScoredResult {
      result: DistributorResult;
      styleNumber: string;
      brand: string;
      tier: number;
      brandPriority: number;
      inventory: number;
    }
    
    const scoredResults: ScoredResult[] = results
      .filter(r => r.status === "success" && r.product)
      .map(r => {
        const styleNumber = getProductField(r.product, "styleNumber");
        const b = getProductField(r.product, "brand");
        const inventory = getTotalInventory(r.product);
        
        let tier = 3;
        if (styleNumber === normalizedQuery || styleNumber === queryLastPart) {
          tier = 1;
        } else if (styleNumber.includes(queryLastPart) || queryLastPart.includes(styleNumber)) {
          tier = 2;
        }
        
        return { 
          result: r, 
          styleNumber, 
          brand: b, 
          tier, 
          brandPriority: getBrandPriority(b), 
          inventory 
        };
      });
    
    scoredResults.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.brandPriority !== b.brandPriority) return a.brandPriority - b.brandPriority;
      return b.inventory - a.inventory;
    });
    
    const winner = scoredResults[0];
    const winnerKey = winner ? `${winner.styleNumber}|${winner.brand}` : null;
    
    console.log(`[sourcing-engine] Winner product: ${winnerKey || "none"}`);
    if (winner) {
      console.log(`[sourcing-engine] Winner details: tier=${winner.tier}, brand=${winner.brand}, brandPri=${winner.brandPriority}, inv=${winner.inventory}`);
    }
    
    const finalResults: DistributorResult[] = results.map(r => {
      if (r.status !== "success" || !r.product) {
        return r;
      }
      
      const styleNumber = getProductField(r.product, "styleNumber");
      const b = getProductField(r.product, "brand");
      const key = `${styleNumber}|${b}`;
      
      if (winnerKey && key === winnerKey) {
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
      
      console.log(`[sourcing-engine] Discarding non-winner: ${styleNumber} by ${b} (${r.distributorName})`);
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
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
