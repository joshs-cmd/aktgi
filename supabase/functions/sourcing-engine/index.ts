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
    // GLOBAL SKU RESOLVER: Pick ONE "Winner" Product
    // ===============================================================
    const normalizedQuery = query.toUpperCase().trim();
    const queryLastPart = normalizedQuery.split(/\s+/).pop() || normalizedQuery;
    
    // Priority brands for ranking (lower index = higher priority)
    const PRIORITY_BRANDS = [
      "GILDAN", "PORT & COMPANY", "PORT AND COMPANY", "BELLA + CANVAS", 
      "BELLA+CANVAS", "BELLACANVAS", "NEXT LEVEL", "NEXT LEVEL APPAREL",
      "HANES", "JERZEES", "FRUIT OF THE LOOM", "CHAMPION", "AMERICAN APPAREL"
    ];
    
    // Helper to extract fields from product (type-safe)
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
    
    // Get brand priority (lower = better, 999 = unknown)
    const getBrandPriority = (brand: string): number => {
      const idx = PRIORITY_BRANDS.findIndex(pb => brand.includes(pb) || pb.includes(brand));
      return idx !== -1 ? idx : 999;
    };
    
    // Score each result with a product
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
        const brand = getProductField(r.product, "brand");
        const inventory = getTotalInventory(r.product);
        
        // Tier 1: Exact SKU match, Tier 2: Partial match, Tier 3: Other
        let tier = 3;
        if (styleNumber === normalizedQuery || styleNumber === queryLastPart) {
          tier = 1;
        } else if (styleNumber.includes(queryLastPart) || queryLastPart.includes(styleNumber)) {
          tier = 2;
        }
        
        return { 
          result: r, 
          styleNumber, 
          brand, 
          tier, 
          brandPriority: getBrandPriority(brand), 
          inventory 
        };
      });
    
    // Sort to find the ONE winner: tier ASC, brandPriority ASC, inventory DESC
    scoredResults.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.brandPriority !== b.brandPriority) return a.brandPriority - b.brandPriority;
      return b.inventory - a.inventory;
    });
    
    // The winner is the first result after sorting
    const winner = scoredResults[0];
    const winnerKey = winner ? `${winner.styleNumber}|${winner.brand}` : null;
    
    console.log(`[sourcing-engine] Winner product: ${winnerKey || "none"}`);
    if (winner) {
      console.log(`[sourcing-engine] Winner details: tier=${winner.tier}, brand=${winner.brand}, brandPri=${winner.brandPriority}, inv=${winner.inventory}`);
    }
    
    // Build final results: keep only products matching the winner, null out others
    const finalResults: DistributorResult[] = results.map(r => {
      // Keep pending/error results as-is
      if (r.status !== "success" || !r.product) {
        return r;
      }
      
      const styleNumber = getProductField(r.product, "styleNumber");
      const brand = getProductField(r.product, "brand");
      const key = `${styleNumber}|${brand}`;
      
      // If this result matches the winner, keep it
      if (winnerKey && key === winnerKey) {
        // Sanitize the product fields
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
      
      // Otherwise, null out the product (distributor still shows in table)
      console.log(`[sourcing-engine] Discarding non-winner: ${styleNumber} by ${brand} (${r.distributorName})`);
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
