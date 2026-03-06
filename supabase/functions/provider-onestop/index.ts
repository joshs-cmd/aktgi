import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ONESTOP_API_BASE = "https://api.onestopinc.com";
const ONESTOP_MEDIA_BASE = "https://media.onestopinc.com/";

// ---------- Size Normalization ----------

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
  my_price?: number;
  customer_price?: number;
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
 * Aggregate flat OneStop items into a color-grouped StandardProduct.
 * Prices are injected from skuPriceMap (keyed by OneStop SKU code e.g. "GD-110-36-XL")
 * and the __color__<prefix> broadcast key ensures ALL sizes of a color get the representative price.
 * catalogFallbackPrice is used when skuPriceMap has no entry at all for that color.
 */
function aggregateItemsWithPricing(
  items: OneStopItem[],
  skuPriceMap: Map<string, number>,
  catalogFallbackPrice: number
): StandardProduct | null {
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

    // --- FIX 1: Price Broadcasting ---
    // Step 1: Try direct SKU lookup
    if (sizeEntry.price === 0 && item.code) {
      const skuPrice = skuPriceMap.get(item.code);
      if (skuPrice && skuPrice > 0) {
        sizeEntry.price = skuPrice;
      }
    }

    // Step 2: Try color-group broadcast key (populated during pricing fetch)
    // This ensures ALL sizes of a color get the representative price even if only
    // one size's SKU was fetched from the API.
    if (sizeEntry.price === 0 && item.code) {
      const parts = item.code.split("-");
      if (parts.length > 1) {
        const colorKey = `__color__${parts.slice(0, -1).join("-")}`;
        const colorPrice = skuPriceMap.get(colorKey);
        if (colorPrice && colorPrice > 0) {
          sizeEntry.price = colorPrice;
        }
      }
    }

    // Step 3: Try color-name broadcast key (set during pricing fetch as __colorname__<name>)
    if (sizeEntry.price === 0) {
      const colorNameKey = `__colorname__${colorName}`;
      const colorNamePrice = skuPriceMap.get(colorNameKey);
      if (colorNamePrice && colorNamePrice > 0) {
        sizeEntry.price = colorNamePrice;
      }
    }

    // Step 4: FIX 3 — Catalog base_price fallback so we never show a blank dash
    if (sizeEntry.price === 0 && catalogFallbackPrice > 0) {
      sizeEntry.price = catalogFallbackPrice;
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

/**
 * Reduce SKU list to at most one SKU per color group.
 * OneStop SKU format: "STYLE-COLOR-SIZE" (e.g. "CV-207-S6-SM").
 */
function deduplicateSkusByColor(skuCodes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const sku of skuCodes) {
    const parts = sku.split("-");
    const colorKey = parts.length > 1 ? parts.slice(0, -1).join("-") : sku;
    if (!seen.has(colorKey)) {
      seen.add(colorKey);
      result.push(sku);
    }
  }
  return result;
}

/**
 * FIX 2: For high-volume styles (Gildan 5000, BC 3001 etc.) with >100 color/size combos,
 * prioritize the top N most-stocked colors to ensure we get prices before timeout.
 * Returns one representative SKU per color, sorted by on_hand desc, capped at MAX_PRICING_SKUS.
 */
function prioritizeSkusForPricing(
  items: OneStopItem[],
  maxSkus: number
): string[] {
  // Group by color, track total on_hand per color and one representative SKU
  const colorGroups = new Map<string, { totalQty: number; repSku: string; colorName: string }>();

  for (const item of items) {
    if (!item.code || item.active_flag === "N") continue;
    const parts = item.code.split("-");
    const colorKey = parts.length > 1 ? parts.slice(0, -1).join("-") : item.code;
    const existing = colorGroups.get(colorKey);
    const qty = item.on_hand || 0;
    if (!existing) {
      colorGroups.set(colorKey, { totalQty: qty, repSku: item.code, colorName: item.color_name || "" });
    } else {
      existing.totalQty += qty;
      // Prefer a medium size as representative (L or M) for more accurate pricing
      const normalized = normalizeSize(item.size_code || "");
      if (normalized === "L" || normalized === "M") {
        existing.repSku = item.code;
      }
    }
  }

  // Sort by total quantity descending (most-stocked colors first)
  const sorted = Array.from(colorGroups.entries())
    .sort((a, b) => b[1].totalQty - a[1].totalQty)
    .slice(0, maxSkus)
    .map(([, v]) => v.repSku);

  console.log(`[provider-onestop] prioritizeSkus: ${colorGroups.size} color groups → ${sorted.length} selected (max=${maxSkus})`);
  return sorted;
}

const MAX_PRICING_SKUS = 250;
const BATCH_DELAY_MS = 200;

/**
 * FIX 4: Each fetch call uses its own AbortSignal.timeout() — no shared signal.
 * Fetch pricing for representative SKUs (one per color) from /items/pricing/?skus=
 * Prices in cents (e.g. 397 = $3.97). Divide by 10^price_factor.
 * Stores both direct SKU key AND __color__<prefix> broadcast key AND __colorname__<name> key.
 */
async function fetchPricingBySku(
  representativeSkus: string[],
  fetchHeaders: Record<string, string>,
  items: OneStopItem[]
): Promise<Map<string, number>> {
  // Build a map of colorKey -> colorName so we can store the colorname broadcast key
  const colorKeyToName = new Map<string, string>();
  for (const item of items) {
    if (!item.code || !item.color_name) continue;
    const parts = item.code.split("-");
    const colorKey = parts.length > 1 ? parts.slice(0, -1).join("-") : item.code;
    if (!colorKeyToName.has(colorKey)) colorKeyToName.set(colorKey, item.color_name);
  }

  const priceMap = new Map<string, number>();
  const BATCH_SIZE = 20;

  for (let i = 0; i < representativeSkus.length; i += BATCH_SIZE) {
    const batch = representativeSkus.slice(i, i + BATCH_SIZE);
    const url = `${ONESTOP_API_BASE}/items/pricing/?skus=${encodeURIComponent(batch.join(","))}`;
    console.log(`[provider-onestop] Fetching pricing batch [${i}..${i + batch.length}]: ${url}`);

    if (i > 0) {
      await new Promise((res) => setTimeout(res, BATCH_DELAY_MS));
    }

    try {
      // FIX 4: Independent AbortSignal per fetch — no shared signal
      const res = await fetch(url, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        console.warn(`[provider-onestop] Pricing batch HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const results: Record<string, unknown>[] = Array.isArray(data.results) ? data.results : [];

      for (const resultItem of results) {
        for (const [skuKey, skuData] of Object.entries(resultItem)) {
          if (!skuData || typeof skuData !== "object") continue;
          const d = skuData as Record<string, unknown>;
          const pricing = d.pricing as Record<string, unknown> | undefined;
          if (!pricing) continue;

          const pfactor = Number(d.pfactor ?? d.price_factor ?? 2);
          const divisor = Math.pow(10, pfactor);

          const myPriceRaw = pricing.my_price ?? pricing.piece ?? pricing.dozen ?? pricing.case;
          if (typeof myPriceRaw === "number" && myPriceRaw > 0) {
            const price = myPriceRaw / divisor;

            // Store by direct SKU code
            priceMap.set(skuKey, price);

            // FIX 1: Store broadcast key by color prefix so ALL sizes of this color get the price
            const parts = skuKey.split("-");
            if (parts.length > 1) {
              const colorKey = parts.slice(0, -1).join("-");
              priceMap.set(`__color__${colorKey}`, price);

              // Also store by color name for the name-based fallback
              const colorName = colorKeyToName.get(colorKey);
              if (colorName) {
                priceMap.set(`__colorname__${colorName}`, price);
              }
            }

            console.log(`[provider-onestop] SKU ${skuKey}: $${price.toFixed(2)}`);
          }
        }
      }
    } catch (e) {
      console.error(`[provider-onestop] Pricing batch error: ${e}`);
    }
  }

  console.log(`[provider-onestop] fetchPricingBySku: resolved ${priceMap.size} price entries for ${representativeSkus.length} SKUs`);
  return priceMap;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { query } = body;

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

    // FIX 4: Build headers only — NO shared signal. Each fetch gets its own AbortSignal.timeout().
    const fetchHeaders: Record<string, string> = {
      "Authorization": `Token ${apiToken}`,
      "Accept": "application/json; version=1.0",
    };

    const fetchWithTimeout = (url: string, timeoutMs = 15_000): Promise<Response> =>
      fetch(url, { headers: fetchHeaders, signal: AbortSignal.timeout(timeoutMs) });

    // Step 1: Search catalog with flat=Y to find the OneStop style code
    const searchUrl = `${ONESTOP_API_BASE}/items/?search=${encodeURIComponent(query)}&flat=Y`;
    console.log(`[provider-onestop] Catalog search: ${searchUrl}`);

    const catalogRes = await fetchWithTimeout(searchUrl, 15_000);
    if (!catalogRes.ok) {
      const errBody = await catalogRes.text();
      console.error(`[provider-onestop] Catalog search failed ${catalogRes.status}: ${errBody.substring(0, 500)}`);
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

    // Find best matching style (exact mill_style_code or style_code match first)
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

    // FIX 3: Look up catalog base_price as fallback for colors/sizes that don't get a live price
    let catalogFallbackPrice = 0;
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const millStyleCode = (bestInfo.mill_style_code as string) || "";
      const { data: catalogRow } = await supabase
        .from("catalog_products")
        .select("base_price")
        .eq("distributor", "onestop")
        .eq("style_number", millStyleCode || bestStyleCode)
        .maybeSingle();
      if (catalogRow?.base_price && Number(catalogRow.base_price) > 0) {
        catalogFallbackPrice = Number(catalogRow.base_price);
        console.log(`[provider-onestop] Catalog fallback price: $${catalogFallbackPrice.toFixed(2)}`);
      }
    } catch (e) {
      console.warn(`[provider-onestop] Could not fetch catalog fallback price: ${e}`);
    }

    // Step 2: Fetch all item-level SKUs for this style (inventory + sku codes)
    const inventoryUrl = `${ONESTOP_API_BASE}/items/?style=${encodeURIComponent(bestStyleCode)}`;
    console.log(`[provider-onestop] Fetching inventory: ${inventoryUrl}`);

    const invRes = await fetchWithTimeout(inventoryUrl, 20_000);
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

    const rawInvData = await invRes.json();
    const items: OneStopItem[] = Array.isArray(rawInvData.results) ? rawInvData.results : [];
    console.log(`[provider-onestop] Got ${items.length} inventory items for ${bestStyleCode}`);

    if (items.length > 0) {
      console.log(`[provider-onestop] FULL Raw Item #0: ${JSON.stringify(items[0])}`);
    }

    if (items.length === 0) {
      return new Response(
        JSON.stringify({ product: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: FIX 2 — Use prioritized SKU selection for high-volume styles.
    // For styles with >100 items (like Gildan 5000 or BC 3001), sort colors by stock
    // and take at most MAX_PRICING_SKUS representative SKUs (one per color, top colors first).
    const representativeSkus = prioritizeSkusForPricing(items, MAX_PRICING_SKUS);

    console.log(`[provider-onestop] Fetching pricing for ${representativeSkus.length} representative SKUs`);
    const skuPriceMap = await fetchPricingBySku(representativeSkus, fetchHeaders, items);

    // Step 4: Aggregate items into product, injecting prices
    const product = aggregateItemsWithPricing(items, skuPriceMap, catalogFallbackPrice);

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
    const totalSizes = product.colors.reduce((sum, c) => sum + c.sizes.length, 0);
    console.log(`[provider-onestop] Returning: ${product.brand} ${product.styleNumber} — ${product.colors.length} colors, ${totalSizes} size rows, ${totalPricedSizes} priced`);

    return new Response(
      JSON.stringify({ product }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      console.error("[provider-onestop] Request timed out");
    } else {
      console.error("[provider-onestop] Fatal error:", error);
    }
    return new Response(
      JSON.stringify({ error: "Service temporarily unavailable", product: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
