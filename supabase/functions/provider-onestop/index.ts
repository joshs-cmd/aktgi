import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ONESTOP_API_BASE = "https://api.onestopinc.com";
const ONESTOP_MEDIA_BASE = "https://media.onestopinc.com/";

// ---------- Size Normalization ----------

/** Map OneStop shorthand size codes to industry-standard codes used by S&S/SanMar */
function normalizeSize(sizeCode: string): string {
  const upper = sizeCode.toUpperCase().trim();
  const SIZE_MAP: Record<string, string> = {
    SM: "S",
    MD: "M",
    LG: "L",
    "2X": "2XL",
    "3X": "3XL",
    "4X": "4XL",
    "5X": "5XL",
    "6X": "6XL",
  };
  return SIZE_MAP[upper] ?? upper;
}

// Size order mapping for sorting
const SIZE_ORDER: Record<string, number> = {
  XS: 1, SM: 2, S: 2, M: 3, MD: 3, L: 4, LG: 4, XL: 5,
  "2XL": 6, "3XL": 7, "4XL": 8, "5XL": 9, "6XL": 10,
  "2X": 6, "3X": 7, "4X": 8, "5X": 9, "6X": 10,
  XXL: 6, XXXL: 7, XXXXL: 8,
  OSFA: 50, OS: 50, "ONE SIZE": 50,
};

// ---------- Interfaces ----------

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

// OneStop item from /items/?style= endpoint
interface OneStopItem {
  uid?: string;
  code?: string;
  mill_code?: string;
  style_code?: string;
  color_code?: string;
  size_code?: string;
  color_name?: string;
  description?: string;
  on_hand?: number;
  mill_name?: string;
  mill_style_code?: string;
  style?: string;
  web_name?: string;
  images?: {
    main?: string;
    front?: string;
    back?: string;
    swatch?: string;
    side?: string;
    other?: string;
  };
  filters?: string;
  size_number?: string;
  active_flag?: string;
  // Pricing fields
  my_price?: number;
  piece?: number;
  dozen?: number;
  case_qty?: number;
  case_price?: number;
  price_factor?: number;
  pricing?: {
    my_price?: number;
    piece?: number;
    dozen?: number;
    case?: number;
    price_factor?: number;
  };
}

function getSizeOrder(sizeCode: string): number {
  const normalized = normalizeSize(sizeCode).toUpperCase().trim();
  return SIZE_ORDER[normalized] ?? SIZE_ORDER[sizeCode.toUpperCase().trim()] ?? 99;
}

function resolveImageUrl(path: string | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${ONESTOP_MEDIA_BASE}${path}`;
}

/**
 * Extract wholesale price from a OneStop item.
 * Prices are integers in cents; divide by 10^price_factor (default 100).
 * Priority: my_price > piece > dozen/12 > case/case_qty
 */
function extractPrice(item: OneStopItem): number {
  const priceFactor = item.price_factor ?? item.pricing?.price_factor ?? 2;
  const divisor = Math.pow(10, priceFactor);

  // Check top-level fields first, then nested pricing object
  const myPrice = item.my_price ?? item.pricing?.my_price ?? 0;
  if (myPrice > 0) return myPrice / divisor;

  const piece = item.piece ?? item.pricing?.piece ?? 0;
  if (piece > 0) return piece / divisor;

  const dozen = item.dozen ?? item.pricing?.dozen ?? 0;
  if (dozen > 0) return (dozen / 12) / divisor;

  const casePrice = item.case_price ?? item.pricing?.case ?? 0;
  const caseQty = item.case_qty ?? 1;
  if (casePrice > 0 && caseQty > 0) return (casePrice / caseQty) / divisor;

  return 0;
}

/**
 * Aggregate flat OneStop items into a color-grouped StandardProduct.
 */
function aggregateItems(items: OneStopItem[]): StandardProduct | null {
  if (!items || items.length === 0) return null;

  const first = items[0];

  const colorMap = new Map<string, {
    code: string;
    name: string;
    swatchUrl: string | null;
    imageUrl: string | null;
    sizesMap: Map<string, { code: string; order: number; quantity: number; price: number }>;
  }>();

  for (const item of items) {
    if (item.active_flag && item.active_flag !== "Y") continue;

    const colorName = item.color_name || "Default";
    const colorCode = item.color_code || "00";

    if (!colorMap.has(colorName)) {
      colorMap.set(colorName, {
        code: colorCode,
        name: colorName,
        swatchUrl: resolveImageUrl(item.images?.swatch),
        imageUrl: resolveImageUrl(item.images?.front),
        sizesMap: new Map(),
      });
    }

    const colorEntry = colorMap.get(colorName)!;
    const rawSize = item.size_code || "OS";
    const normalizedSizeCode = normalizeSize(rawSize);

    if (!colorEntry.sizesMap.has(normalizedSizeCode)) {
      colorEntry.sizesMap.set(normalizedSizeCode, {
        code: normalizedSizeCode,
        order: item.size_number ? parseInt(item.size_number, 10) : getSizeOrder(rawSize),
        quantity: 0,
        price: 0,
      });
    }

    const sizeEntry = colorEntry.sizesMap.get(normalizedSizeCode)!;
    sizeEntry.quantity += item.on_hand || 0;

    // Use the best available price (non-zero wins)
    const itemPrice = extractPrice(item);
    if (itemPrice > 0 && sizeEntry.price === 0) {
      sizeEntry.price = itemPrice;
    }
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
      hexCode: null,
      swatchUrl: c.swatchUrl,
      imageUrl: c.imageUrl,
      sizes,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    styleNumber: first.mill_style_code || first.style_code || first.style || "",
    name: first.web_name || first.description || "",
    brand: first.mill_name || "",
    category: first.filters || "",
    imageUrl: resolveImageUrl(first.images?.main),
    colors,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();

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
      },
      signal: AbortSignal.timeout(10_000),
    };

    // Step 1: Search catalog
    const searchUrl = `${ONESTOP_API_BASE}/items/?search=${encodeURIComponent(query)}&flat=Y`;
    console.log(`[provider-onestop] Catalog search: ${searchUrl}`);

    const catalogRes = await fetch(searchUrl, fetchOpts);
    if (!catalogRes.ok) {
      const body = await catalogRes.text();
      console.error(`[provider-onestop] Catalog search failed ${catalogRes.status}: ${body.substring(0, 500)}`);
      return new Response(
        JSON.stringify({ error: "Service temporarily unavailable", product: null }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const catalogData = await catalogRes.json();

    const styleEntries = catalogData.results && typeof catalogData.results === "object" && !Array.isArray(catalogData.results)
      ? Object.entries(catalogData.results) as [string, Record<string, unknown>][]
      : [];

    console.log(`[provider-onestop] Catalog returned ${styleEntries.length} styles`);

    if (styleEntries.length === 0) {
      return new Response(
        JSON.stringify({ product: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find best matching style
    const queryUpper = query.toUpperCase().replace(/[^A-Z0-9]/g, "");
    let bestEntry = styleEntries[0];
    for (const entry of styleEntries) {
      const info = entry[1] as Record<string, unknown>;
      const millStyle = ((info.mill_style_code as string) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const fullStyle = (entry[0]).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (millStyle === queryUpper || fullStyle === queryUpper) {
        bestEntry = entry;
        break;
      }
    }

    const [bestStyleCode, bestInfoRaw] = bestEntry;
    const bestInfo = bestInfoRaw as Record<string, unknown>;
    console.log(`[provider-onestop] Best match: ${bestStyleCode} (${bestInfo.web_name})`);

    // Step 2: Fetch item-level inventory
    const inventoryUrl = `${ONESTOP_API_BASE}/items/?style=${encodeURIComponent(bestStyleCode)}`;
    console.log(`[provider-onestop] Fetching inventory: ${inventoryUrl}`);

    const invRes = await fetch(inventoryUrl, fetchOpts);
    if (!invRes.ok) {
      console.error(`[provider-onestop] Inventory fetch failed: ${invRes.status}`);
      return new Response(
        JSON.stringify({
          product: {
            styleNumber: (bestInfo.mill_style_code as string) || bestStyleCode,
            name: (bestInfo.web_name as string) || "",
            brand: (bestInfo.mill_name as string) || "",
            category: (bestInfo.filters as string) || "",
            imageUrl: resolveImageUrl(bestInfo.generic_image as string),
            colors: [],
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const invData = await invRes.json();
    const items: OneStopItem[] = Array.isArray(invData.results) ? invData.results : [];
    console.log(`[provider-onestop] Got ${items.length} inventory items for ${bestStyleCode}`);

    if (items.length === 0) {
      return new Response(
        JSON.stringify({ product: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const product = aggregateItems(items);

    if (!product) {
      return new Response(
        JSON.stringify({ product: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (bestInfo.mill_style_code && typeof bestInfo.mill_style_code === "string" && bestInfo.mill_style_code.length > 0) {
      product.styleNumber = bestInfo.mill_style_code;
    }

    const totalPricedSizes = product.colors.reduce((sum, c) => sum + c.sizes.filter(s => s.price > 0).length, 0);
    console.log(`[provider-onestop] Returning: ${product.brand} ${product.styleNumber} — ${product.colors.length} colors, ${product.colors.reduce((sum, c) => sum + c.sizes.length, 0)} size rows, ${totalPricedSizes} priced`);

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
