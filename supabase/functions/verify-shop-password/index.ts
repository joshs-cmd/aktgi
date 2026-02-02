import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export type UserRole = "admin" | "viewer";

interface VerifyResponse {
  valid: boolean;
  role?: UserRole;
  error?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { password } = await req.json();

    if (!password || typeof password !== "string") {
      return new Response(
        JSON.stringify({ valid: false, error: "Password is required" } as VerifyResponse),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get passwords from secrets
    const adminPassword = Deno.env.get("ADMIN_PASSWORD");
    const standardPassword = Deno.env.get("STANDARD_PASSWORD");
    // Fallback to legacy SHOP_PASSWORD for backward compatibility
    const legacyPassword = Deno.env.get("SHOP_PASSWORD");

    if (!adminPassword && !standardPassword && !legacyPassword) {
      console.error("[verify-shop-password] No passwords configured");
      return new Response(
        JSON.stringify({ valid: false, error: "Shop password not configured" } as VerifyResponse),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const trimmedPassword = password.trim();

    // Check admin password first (highest privilege)
    if (adminPassword && trimmedPassword === adminPassword) {
      console.log("[verify-shop-password] Admin login successful");
      return new Response(
        JSON.stringify({ valid: true, role: "admin" } as VerifyResponse),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check standard/viewer password
    if (standardPassword && trimmedPassword === standardPassword) {
      console.log("[verify-shop-password] Standard (viewer) login successful");
      return new Response(
        JSON.stringify({ valid: true, role: "viewer" } as VerifyResponse),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Legacy fallback - treat SHOP_PASSWORD as admin for backward compat
    if (legacyPassword && trimmedPassword === legacyPassword) {
      console.log("[verify-shop-password] Legacy password login successful (admin)");
      return new Response(
        JSON.stringify({ valid: true, role: "admin" } as VerifyResponse),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Invalid password
    console.log("[verify-shop-password] Invalid password attempt");
    return new Response(
      JSON.stringify({ valid: false } as VerifyResponse),
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
      } as VerifyResponse),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
