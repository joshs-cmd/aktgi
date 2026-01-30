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

    // STRICT SKU CLEANUP: If any provider found exact match, discard non-matching results
    const normalizedQuery = query.toUpperCase().trim();
    const queryLastPart = normalizedQuery.split(/\s+/).pop() || normalizedQuery;
    
    // Helper to extract styleNumber from product (type-safe)
    const getStyleNumber = (product: unknown): string => {
      if (!product || typeof product !== "object") return "";
      const p = product as Record<string, unknown>;
      return String(p.styleNumber || "").toUpperCase().trim();
    };
    
    // Check if any provider has an exact styleNumber match
    const exactMatches = results.filter(r => {
      if (r.status !== "success" || !r.product) return false;
      const styleUpper = getStyleNumber(r.product);
      return styleUpper === normalizedQuery || styleUpper === queryLastPart;
    });
    
    let finalResults = results;
    
    if (exactMatches.length > 0) {
      // We have exact matches - filter out non-matching products but keep pending/error rows
      finalResults = results.map(r => {
        if (r.status !== "success" || !r.product) return r;
        
        const styleUpper = getStyleNumber(r.product);
        const isExactMatch = styleUpper === normalizedQuery || styleUpper === queryLastPart;
        
        if (!isExactMatch) {
          console.log(`[sourcing-engine] Discarding non-matching result: ${styleUpper} from ${r.distributorName}`);
          return { ...r, product: null };
        }
        return r;
      });
      
      console.log(`[sourcing-engine] Strict cleanup: kept ${exactMatches.length} exact matches, discarded non-matching`);
    }

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
