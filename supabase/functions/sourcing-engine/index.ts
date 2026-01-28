import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

    const response: SourcingResponse = {
      query,
      results,
      searchedAt: new Date().toISOString(),
    };

    console.log(`[sourcing-engine] Returning ${results.length} results`);

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
