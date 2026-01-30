import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { password } = await req.json();

    if (!password || typeof password !== "string") {
      return new Response(
        JSON.stringify({ valid: false, error: "Password is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get the shop password from secrets
    const shopPassword = Deno.env.get("SHOP_PASSWORD");

    if (!shopPassword) {
      console.error("[verify-shop-password] SHOP_PASSWORD not configured");
      return new Response(
        JSON.stringify({ valid: false, error: "Shop password not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Compare passwords (timing-safe comparison would be ideal but this is basic)
    const isValid = password === shopPassword;

    console.log(`[verify-shop-password] Password check: ${isValid ? "valid" : "invalid"}`);

    return new Response(
      JSON.stringify({ valid: isValid }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[verify-shop-password] Error:", error);
    return new Response(
      JSON.stringify({
        valid: false,
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
