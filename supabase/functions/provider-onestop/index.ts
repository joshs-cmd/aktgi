import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ONESTOP_API_BASE = "https://api.onestopinc.com";

// Size order mapping for sorting
const SIZE_ORDER: Record<string, number> = {
  XS: 1, S: 2, M: 3, L: 4, XL: 5,
  "2XL": 6, "3XL": 7, "4XL": 8, "5XL": 9, "6XL": 10,
  "2X": 6, "3X": 7, "4X": 8, "5X": 9, "6X": 10,
  XXL: 6, XXXL: 7, XXXXL: 8,
  OSFA: 50, OS: 50, "ONE SIZE": 50,
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

interface StandardColor {
  code: string;
  name: string;
  hexCode: string | null;
  swatchUrl: string | null;
  imageUrl: string | null;
  sizes: StandardSize[];
}

interface StandardProduct {
  styleNumber: string;
  name: string;
  brand: string;
  category: string;
  imageUrl?: string;
  colors: StandardColor[];
}

// OneStop API item shape (partial — only fields we use)
interface OneStopItem {
  mill_id?: string;
  mill_name?: string;
  color?: string;
  color_code?: string;
  color_hex?: string;
  size?: string;
  my_price?: number;       // price in CENTS
  on_hand?: number;
  image?: string;
  swatch_image?: string;
  description?: string;
  category?: string;
  style?: string;          // e.g. "3600"
  item_number?: string;    // e.g. "GD-110-36-XL" (raw OneStop code)
}

function getSizeOrder(sizeCode: string): number {
  const normalized = sizeCode.toUpperCase().trim();
  if (SIZE_ORDER[normalized]) return SIZE_ORDER[normalized];
  if (normalized === "XXL") return SIZE_ORDER["2XL"];
  if (normalized === "XXXL") return SIZE_ORDER["3XL"];
  return 99;
}

/**
 * Aggregate flat OneStop items into a color-grouped StandardProduct
 */
function aggregateItems(items: OneStopItem[]): StandardProduct | null {
  if (!items || items.length === 0) return null;

  const first = items[0];

  // Group by color
  const colorMap = new Map<string, {
    code: string;
    name: string;
    hexCode: string | null;
    swatchUrl: string | null;
    imageUrl: string | null;
    sizesMap: Map<string, { code: string; order: number; price: number; quantity: number }>;
  }>();

  for (const item of items) {
    const colorName = item.color || "Default";
    const colorCode = item.color_code || "00";

    if (!colorMap.has(colorName)) {
      colorMap.set(colorName, {
        code: colorCode,
        name: colorName,
        hexCode: item.color_hex ? `#${item.color_hex}` : null,
        swatchUrl: item.swatch_image || null,
        imageUrl: item.image || null,
        sizesMap: new Map(),
      });
    }

    const colorEntry = colorMap.get(colorName)!;
    const sizeName = item.size || "OS";

    if (!colorEntry.sizesMap.has(sizeName)) {
      colorEntry.sizesMap.set(sizeName, {
        code: sizeName,
        order: getSizeOrder(sizeName),
        price: 0,
        quantity: 0,
      });
    }

    const sizeEntry = colorEntry.sizesMap.get(sizeName)!;

    // my_price is in cents → convert to dollars
    if (item.my_price && item.my_price > 0) {
      const dollars = item.my_price / 100;
      if (sizeEntry.price === 0 || dollars < sizeEntry.price) {
        sizeEntry.price = Math.round(dollars * 100) / 100;
      }
    }

    // Accumulate on_hand inventory
    sizeEntry.quantity += item.on_hand || 0;
  }

  // Convert to StandardColor array
  const colors: StandardColor[] = Array.from(colorMap.values()).map((c) => {
    const sizes: StandardSize[] = Array.from(c.sizesMap.values())
      .map((s) => ({
        code: s.code,
        order: s.order,
        price: s.price,
        inventory: [
          {
            warehouseCode: "OS-WH",
            warehouseName: "OneStop Warehouse",
            quantity: s.quantity,
          },
        ],
      }))
      .sort((a, b) => a.order - b.order);

    return {
      code: c.code,
      name: c.name,
      hexCode: c.hexCode,
      swatchUrl: c.swatchUrl,
      imageUrl: c.imageUrl,
      sizes,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    styleNumber: first.style || first.item_number || "",
    name: first.description || `${first.mill_name || ""} ${first.style || ""}`.trim(),
    brand: first.mill_name || "",
    category: first.category || "",
    imageUrl: first.image || undefined,
    colors,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query, distributorId } = await req.json();

    if (!query || typeof query !== "string" || query.length > 100 || !/^[a-zA-Z0-9\s\-\+\&\.]+$/.test(query)) {
      return new Response(
        JSON.stringify({ error: "Invalid query format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[provider-onestop] Searching for: ${query}`);

    const apiToken = Deno.env.get("ONESTOP_API_TOKEN");
    if (!apiToken) {
      console.error("[provider-onestop] Missing ONESTOP_API_TOKEN");
      return new Response(
        JSON.stringify({ error: "Service temporarily unavailable", product: null }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fetchOpts: RequestInit = {
      headers: {
        "Authorization": `Token ${apiToken}`,
        "Accept": "application/json; version=1.0",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10_000),
    };

    // Search OneStop items API
    const searchUrl = `${ONESTOP_API_BASE}/items/?search=${encodeURIComponent(query)}&flat=Y`;
    console.log(`[provider-onestop] Fetching: ${searchUrl}`);

    const res = await fetch(searchUrl, fetchOpts);

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 403) {
        console.error(`[provider-onestop] Cloudflare Block (403) — not retrying to avoid IP ban. Body: ${body.substring(0, 300)}`);
      } else {
        console.error(`[provider-onestop] API error ${res.status}: ${body.substring(0, 200)}`);
      }
      return new Response(
        JSON.stringify({ error: "Service temporarily unavailable", product: null }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();

    // Debug: log the shape of the response to understand structure
    const dataType = Array.isArray(data) ? "array" : typeof data;
    const topKeys = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).slice(0, 10) : [];
    console.log(`[provider-onestop] Response type: ${dataType}, top keys: [${topKeys.join(", ")}]`);

    // OneStop may return { results: [...] }, { count, results: [...] }, or a flat array
    let items: OneStopItem[];
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === "object") {
      // Try common pagination wrappers
      items = data.results || data.items || data.data || [];
      if (!Array.isArray(items)) {
        console.log(`[provider-onestop] Unexpected response structure, wrapping single object`);
        items = [data as OneStopItem];
      }
    } else {
      items = [];
    }

    console.log(`[provider-onestop] Got ${items.length} items for "${query}"`);

    if (items.length === 0) {
      return new Response(
        JSON.stringify({ product: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter items to those matching the query style
    const queryUpper = query.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const relevantItems = items.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const style = (item.style || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const itemNum = (item.item_number || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      return style.includes(queryUpper) || itemNum.includes(queryUpper) || queryUpper.includes(style);
    });

    const itemsToAggregate = relevantItems.length > 0 ? relevantItems : items;
    console.log(`[provider-onestop] Using ${itemsToAggregate.length} relevant items (filtered from ${items.length})`);

    const product = aggregateItems(itemsToAggregate);

    if (!product) {
      return new Response(
        JSON.stringify({ product: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[provider-onestop] Returning: ${product.brand} ${product.styleNumber} with ${product.colors.length} colors`);

    return new Response(
      JSON.stringify({ product }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      console.error("[provider-onestop] Request timed out after 10s");
    } else {
      console.error("[provider-onestop] Fatal error:", error);
    }
    return new Response(
      JSON.stringify({ error: "Service temporarily unavailable", product: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
