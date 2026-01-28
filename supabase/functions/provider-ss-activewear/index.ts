import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// S&S API base URL
const SS_API_BASE = "https://api.ssactivewear.com/v2";

// Warehouse code to name mapping
const WAREHOUSE_NAMES: Record<string, string> = {
  TX: "Texas (Dallas)",
  NV: "Nevada (Reno)",
  OH: "Ohio (Columbus)",
  KS: "Kansas (Olathe)",
  PA: "Pennsylvania (Harrisburg)",
  GA: "Georgia (Atlanta)",
  MN: "Minnesota",
  UT: "Utah",
  WA: "Washington",
};

interface StandardInventory {
  warehouseCode: string;
  warehouseName: string;
  quantity: number;
}

interface StandardSize {
  code: string;
  order: number;
  price: number;
  inventory: StandardInventory[];
}

interface StandardProduct {
  styleNumber: string;
  name: string;
  brand: string;
  category: string;
  imageUrl?: string;
  sizes: StandardSize[];
}

// Size order mapping for sorting
const SIZE_ORDER: Record<string, number> = {
  XS: 1,
  S: 2,
  M: 3,
  L: 4,
  XL: 5,
  "2XL": 6,
  "3XL": 7,
  "4XL": 8,
  "5XL": 9,
  "6XL": 10,
  OSFA: 50,
  OS: 50,
};

function getSizeOrder(sizeCode: string): number {
  return SIZE_ORDER[sizeCode.toUpperCase()] || 99;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query, distributorId } = await req.json();

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query parameter is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[provider-ss-activewear] Searching for: ${query}`);

    // Get credentials from secrets
    const username = Deno.env.get("SS_ACTIVEWEAR_USERNAME");
    const password = Deno.env.get("SS_ACTIVEWEAR_PASSWORD");

    console.log(`[provider-ss-activewear] Username configured: ${username ? 'YES (' + username.substring(0, 3) + '...)' : 'NO'}`);
    console.log(`[provider-ss-activewear] Password configured: ${password ? 'YES (length: ' + password.length + ')' : 'NO'}`);

    if (!username || !password) {
      console.error("[provider-ss-activewear] Missing API credentials");
      return new Response(
        JSON.stringify({
          error: "S&S Activewear API credentials not configured",
          product: null,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create Basic Auth header
    const authHeader = "Basic " + btoa(`${username}:${password}`);

    // Fetch product info, inventory, and prices in parallel
    // S&S API uses style parameter for style name lookups
    const [productRes, inventoryRes, pricesRes] = await Promise.all([
      fetch(
        `${SS_API_BASE}/products/?style=${encodeURIComponent(query)}&fields=StyleID,StyleName,BrandName,ColorName,CatDescription,MediaFullUrl`,
        { headers: { Authorization: authHeader, Accept: "application/json" } }
      ),
      fetch(
        `${SS_API_BASE}/inventory/?style=${encodeURIComponent(query)}&fields=StyleID,SizeName,Qty,WarehouseAbbr`,
        { headers: { Authorization: authHeader, Accept: "application/json" } }
      ),
      fetch(
        `${SS_API_BASE}/prices/?style=${encodeURIComponent(query)}&fields=StyleID,SizeName,CustomerPrice`,
        { headers: { Authorization: authHeader, Accept: "application/json" } }
      ),
    ]);

    // Handle 404 as "product not found" (not an error)
    if (productRes.status === 404) {
      console.log(`[provider-ss-activewear] Product not found for query: ${query}`);
      return new Response(
        JSON.stringify({ product: null }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check for other API errors
    if (!productRes.ok) {
      const errorText = await productRes.text();
      console.error(`[provider-ss-activewear] Product API error: ${productRes.status} - ${errorText}`);
      return new Response(
        JSON.stringify({
          error: `S&S API error: ${productRes.status}`,
          product: null,
        }),
        {
          status: productRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const products = await productRes.json();
    // Consume inventory and prices response bodies
    const inventory = inventoryRes.ok ? await inventoryRes.json() : [];
    const prices = pricesRes.ok ? await pricesRes.json() : [];
    
    // Also consume response bodies for non-ok responses to prevent leaks
    if (!inventoryRes.ok) await inventoryRes.text();
    if (!pricesRes.ok) await pricesRes.text();

    console.log(`[provider-ss-activewear] Found ${products?.length || 0} products, ${inventory?.length || 0} inventory items, ${prices?.length || 0} prices`);

    if (!products || products.length === 0) {
      return new Response(
        JSON.stringify({ product: null }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get the first product as reference
    const firstProduct = products[0];

    // Build price map: size -> price
    const priceMap = new Map<string, number>();
    for (const p of prices) {
      if (p.SizeName && p.CustomerPrice) {
        priceMap.set(p.SizeName, parseFloat(p.CustomerPrice));
      }
    }

    // Build inventory map: size -> warehouse -> quantity
    const inventoryMap = new Map<string, Map<string, number>>();
    for (const inv of inventory) {
      if (inv.SizeName && inv.WarehouseAbbr) {
        if (!inventoryMap.has(inv.SizeName)) {
          inventoryMap.set(inv.SizeName, new Map());
        }
        const warehouseMap = inventoryMap.get(inv.SizeName)!;
        const currentQty = warehouseMap.get(inv.WarehouseAbbr) || 0;
        warehouseMap.set(inv.WarehouseAbbr, currentQty + (inv.Qty || 0));
      }
    }

    // Get unique sizes from inventory
    const uniqueSizes = new Set<string>();
    inventory.forEach((inv: { SizeName?: string }) => {
      if (inv.SizeName) uniqueSizes.add(inv.SizeName);
    });

    // Build sizes array
    const sizes: StandardSize[] = Array.from(uniqueSizes)
      .map((sizeCode) => {
        const warehouseMap = inventoryMap.get(sizeCode) || new Map();
        const inventoryItems: StandardInventory[] = Array.from(warehouseMap.entries()).map(
          ([warehouseCode, quantity]) => ({
            warehouseCode,
            warehouseName: WAREHOUSE_NAMES[warehouseCode] || warehouseCode,
            quantity,
          })
        );

        return {
          code: sizeCode,
          order: getSizeOrder(sizeCode),
          price: priceMap.get(sizeCode) || 0,
          inventory: inventoryItems.sort((a, b) => b.quantity - a.quantity),
        };
      })
      .sort((a, b) => a.order - b.order);

    // Build standard product response
    const standardProduct: StandardProduct = {
      styleNumber: firstProduct.StyleID || query,
      name: firstProduct.StyleName || "Unknown Product",
      brand: firstProduct.BrandName || "",
      category: firstProduct.CatDescription || "",
      imageUrl: firstProduct.MediaFullUrl || undefined,
      sizes,
    };

    console.log(`[provider-ss-activewear] Returning product: ${standardProduct.name} with ${sizes.length} sizes`);

    return new Response(
      JSON.stringify({ product: standardProduct }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[provider-ss-activewear] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
        product: null,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
