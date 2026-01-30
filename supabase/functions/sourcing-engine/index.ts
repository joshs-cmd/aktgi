import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const { query } = await req.json();

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

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all distributors
    const { data: distributors, error: distError } = await supabase
      .from("distributors")
      .select("*")
      .order("name");

    if (distError) {
      console.error("[sourcing-engine] Error fetching distributors:", distError);
      throw new Error("Failed to fetch distributors");
    }

    console.log(`[sourcing-engine] Found ${distributors?.length || 0} distributors`);

    // Fan out to each provider in parallel
    const results: DistributorResult[] = await Promise.all(
      (distributors || []).map(async (distributor) => {
        if (!distributor.is_active) {
          // Return pending status for inactive distributors
          return {
            distributorId: distributor.id,
            distributorCode: distributor.code,
            distributorName: distributor.name,
            status: "pending" as const,
            product: null,
            lastSynced: null,
          };
        }

        try {
          // Call the specific provider function
          const providerFnName = `provider-${distributor.code}`;
          console.log(`[sourcing-engine] Calling ${providerFnName} for query: ${query}`);

          const { data, error } = await supabase.functions.invoke(providerFnName, {
            body: { query, distributorId: distributor.id },
          });

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
    // GLOBAL SKU RESOLVER: Tiered Relevance Ranking
    // ===============================================================
    const normalizedQuery = query.toUpperCase().trim();
    const queryLastPart = normalizedQuery.split(/\s+/).pop() || normalizedQuery;
    
    // Priority brands for Tier 2 ranking
    const PRIORITY_BRANDS = [
      "GILDAN", "PORT & COMPANY", "PORT AND COMPANY", "BELLA + CANVAS", 
      "BELLA+CANVAS", "BELLACANVAS", "NEXT LEVEL", "NEXT LEVEL APPAREL",
      "HANES", "JERZEES", "FRUIT OF THE LOOM", "CHAMPION", "AMERICAN APPAREL"
    ];
    
    // Helper to extract fields from product (type-safe with sanitization)
    const getProductField = (product: unknown, field: string): string => {
      if (!product || typeof product !== "object") return "";
      const p = product as Record<string, unknown>;
      return String(p[field] ?? "").toUpperCase().trim();
    };
    
    // Helper to calculate total inventory for a product
    const getTotalInventory = (product: unknown): number => {
      if (!product || typeof product !== "object") return 0;
      const p = product as Record<string, unknown>;
      let total = 0;
      
      // Check colors array
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
      
      // Check direct sizes array (backward compat)
      const sizes = p.sizes as Array<{ inventory?: Array<{ quantity?: number }> }> | undefined;
      if (Array.isArray(sizes) && total === 0) {
        for (const size of sizes) {
          if (Array.isArray(size?.inventory)) {
            for (const inv of size.inventory) {
              total += Number(inv?.quantity || 0);
            }
          }
        }
      }
      
      return total;
    };
    
    // Score each result for relevance ranking
    interface ScoredResult {
      result: DistributorResult;
      tier: number;
      brandPriority: number;
      inventory: number;
      styleMatch: string;
    }
    
    const scoredResults: ScoredResult[] = results.map(r => {
      if (r.status !== "success" || !r.product) {
        return { result: r, tier: 99, brandPriority: 999, inventory: 0, styleMatch: "" };
      }
      
      const styleNumber = getProductField(r.product, "styleNumber");
      const brand = getProductField(r.product, "brand");
      const inventory = getTotalInventory(r.product);
      
      // Tier 1: Exact SKU match
      let tier = 3; // Default: partial/keyword match
      if (styleNumber === normalizedQuery || styleNumber === queryLastPart) {
        tier = 1; // Exact match
      } else if (styleNumber.includes(queryLastPart) || queryLastPart.includes(styleNumber)) {
        tier = 2; // Partial match
      }
      
      // Brand priority (lower = better)
      let brandPriority = 999;
      const brandIdx = PRIORITY_BRANDS.findIndex(pb => brand.includes(pb) || pb.includes(brand));
      if (brandIdx !== -1) {
        brandPriority = brandIdx;
      }
      
      return { result: r, tier, brandPriority, inventory, styleMatch: styleNumber };
    });
    
    // Find the best tier achieved
    const bestTier = Math.min(...scoredResults.filter(s => s.tier < 99).map(s => s.tier));
    
    // If we have Tier 1 exact matches, filter out lower tiers
    let finalResults: DistributorResult[];
    
    if (bestTier === 1) {
      // Keep only exact matches, discard partial/keyword matches
      finalResults = scoredResults.map(scored => {
        if (scored.tier === 99) return scored.result; // Keep pending/error as-is
        if (scored.tier === 1) return scored.result; // Keep exact matches
        
        console.log(`[sourcing-engine] Discarding Tier ${scored.tier} result: ${scored.styleMatch} (${scored.result.distributorName})`);
        return { ...scored.result, product: null }; // Null out non-exact matches
      });
      
      console.log(`[sourcing-engine] Tier 1 exact matches found - filtered to exact SKU matches only`);
    } else {
      // No exact matches - use Tier 2/3 with brand + inventory ranking
      // Group by styleNumber to pick best per product
      const productGroups = new Map<string, ScoredResult[]>();
      
      for (const scored of scoredResults) {
        if (scored.tier === 99) continue;
        const key = scored.styleMatch || "__none__";
        if (!productGroups.has(key)) productGroups.set(key, []);
        productGroups.get(key)!.push(scored);
      }
      
      // For each product group, pick the best based on brand + inventory
      const bestProducts = new Set<string>();
      
      for (const [styleKey, group] of productGroups) {
        // Sort by: tier ASC, brandPriority ASC, inventory DESC
        group.sort((a, b) => {
          if (a.tier !== b.tier) return a.tier - b.tier;
          if (a.brandPriority !== b.brandPriority) return a.brandPriority - b.brandPriority;
          return b.inventory - a.inventory;
        });
        
        const best = group[0];
        const bestBrand = getProductField(best.result.product, "brand");
        bestProducts.add(`${styleKey}|${bestBrand}`);
        
        console.log(`[sourcing-engine] Best for ${styleKey}: ${bestBrand} (tier=${best.tier}, brandPri=${best.brandPriority}, inv=${best.inventory})`);
      }
      
      // Keep results that match best products, null out others
      finalResults = scoredResults.map(scored => {
        if (scored.tier === 99) return scored.result;
        
        const brand = getProductField(scored.result.product, "brand");
        const key = `${scored.styleMatch}|${brand}`;
        
        if (bestProducts.has(key)) {
          return scored.result;
        }
        
        console.log(`[sourcing-engine] Discarding non-preferred result: ${scored.styleMatch} by ${brand}`);
        return { ...scored.result, product: null };
      });
    }
    
    // SANITIZE: Ensure all products have string fields
    finalResults = finalResults.map(r => {
      if (!r.product) return r;
      
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
