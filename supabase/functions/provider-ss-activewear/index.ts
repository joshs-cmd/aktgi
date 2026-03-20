import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  IL: "Illinois",
  CA: "California",
  FL: "Florida",
  NC: "North Carolina",
  SC: "South Carolina",
};

// Size order mapping for sorting
const SIZE_ORDER: Record<string, number> = {
  XS: 1, S: 2, M: 3, L: 4, XL: 5,
  "2XL": 6, "3XL": 7, "4XL": 8, "5XL": 9, "6XL": 10,
  OSFA: 50, OS: 50,
};

// Common brand patterns for fuzzy matching
const BRAND_PATTERNS = [
  { pattern: /^(gildan)(\d+)/i, brand: "gildan" },
  { pattern: /^(bella)(\d+)/i, brand: "bella" },
  { pattern: /^(canvas)(\d+)/i, brand: "canvas" },
  { pattern: /^(bellacanvas)(\d+)/i, brand: "bella canvas" },
  { pattern: /^(bella\s*canvas)(\d+)/i, brand: "bella canvas" },
  { pattern: /^(port)(\d+)/i, brand: "port" },
  { pattern: /^(hanes)(\d+)/i, brand: "hanes" },
  { pattern: /^(next)(\d+)/i, brand: "next" },
  { pattern: /^(champion)(\d+)/i, brand: "champion" },
  { pattern: /^(jerzees)(\d+)/i, brand: "jerzees" },
  { pattern: /^(fruit)(\d+)/i, brand: "fruit" },
  { pattern: /^(comfort\s*colors?)(\d+)/i, brand: "comfort colors" },
  { pattern: /^(american\s*apparel)(\d+)/i, brand: "american apparel" },
];

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
  sizes?: StandardSize[]; // Optional for backward compat
}

interface SSProduct {
  sku?: string;
  styleID?: number;
  brandName?: string;
  styleName?: string;
  title?: string;
  baseCategory?: string;
  colorName?: string;
  colorCode?: string;
  colorSwatchImage?: string;
  colorFrontImage?: string;
  color1?: string;
  sizeName?: string;
  sizeOrder?: string;
  customerPrice?: number;
  casePrice?: number;
  warehouses?: Array<{ warehouseAbbr?: string; qty?: number }>;
}

interface SSStyle {
  styleID?: number;
  styleName?: string;
  brandName?: string;
  title?: string;
  baseCategory?: string;
  styleImage?: string;
  partNumber?: string;
}

function getSizeOrder(sizeCode: string): number {
  const normalized = sizeCode.toUpperCase().trim();
  if (SIZE_ORDER[normalized]) return SIZE_ORDER[normalized];
  // Try matching 2XL variants like "XXL"
  if (normalized === "XXL") return SIZE_ORDER["2XL"];
  if (normalized === "XXXL") return SIZE_ORDER["3XL"];
  return 99;
}

function buildImageUrl(relativePath: string | undefined): string | null {
  if (!relativePath) return null;
  if (relativePath.startsWith("http")) return relativePath;
  // Replace _fm with _fl for larger images
  const largePath = relativePath.replace(/_fm\./i, "_fl.");
  return `https://www.ssactivewear.com/${largePath}`;
}

/**
 * Generate query variants for fuzzy matching
 */
function generateQueryVariants(query: string): string[] {
  const variants: string[] = [];
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  
  // Always include original
  variants.push(trimmed);
  
  // Try to detect brand+number patterns without space
  for (const { pattern, brand } of BRAND_PATTERNS) {
    const match = lower.match(pattern);
    if (match) {
      const number = match[2];
      // Add spaced version
      const spaced = `${brand} ${number}`;
      if (!variants.includes(spaced)) variants.push(spaced);
      // Also add just the number as fallback
      if (!variants.includes(number)) variants.push(number);
      break;
    }
  }
  
  // If query has spaces, also try without spaces (collapsed)
  if (trimmed.includes(" ")) {
    const collapsed = trimmed.replace(/\s+/g, "");
    if (!variants.includes(collapsed)) variants.push(collapsed);
  }
  
  return variants;
}

// Priority brands for S&S scoring (must match sourcing-engine)
const PRIORITY_BRANDS = [
  "GILDAN", "PORT & COMPANY", "PORT AND COMPANY", "BELLA + CANVAS", 
  "BELLA+CANVAS", "BELLACANVAS", "NEXT LEVEL", "NEXT LEVEL APPAREL",
  "HANES", "JERZEES", "FRUIT OF THE LOOM", "CHAMPION", "AMERICAN APPAREL",
  "INDEPENDENT TRADING", "INDEPENDENT TRADING CO"
];

/**
 * Score a style match for best result selection - prioritizes industry brands
 */
function scoreStyleMatch(style: SSStyle, query: string, originalBrand?: string): number {
  let score = 0;
  const queryLower = query.toLowerCase();
  const styleName = (style.styleName || "").toLowerCase();
  const brandName = (style.brandName || "").toLowerCase().trim();
  const brandUpper = brandName.toUpperCase();
  const title = (style.title || "").toLowerCase();
  const partNumber = (style.partNumber || "").toLowerCase();
  
  // BRAND AUTHORITY BONUS: Priority brands get massive boost
  const brandIdx = PRIORITY_BRANDS.findIndex(pb => 
    brandUpper.includes(pb) || pb.includes(brandUpper)
  );
  if (brandIdx !== -1) {
    score += 500 - (brandIdx * 10); // Gildan gets 500, Port & Co gets 490, etc.
  }

  // Original brand match bonus
  if (originalBrand) {
    const origBrandLower = originalBrand.toLowerCase();
    if (brandName.includes(origBrandLower) || origBrandLower.includes(brandName.split(" ")[0])) {
      score += 200;
    }
  }
  
  // Exact matches get high score
  if (styleName === queryLower) score += 100;
  if (partNumber === queryLower) score += 100;
  
  // Brand + style number match
  const brandStyle = `${brandName} ${styleName}`;
  if (brandStyle === queryLower) score += 90;
  
  // Partial matches
  if (styleName.includes(queryLower)) score += 50;
  if (queryLower.includes(styleName) && styleName.length > 2) score += 40;
  if (brandName.includes(queryLower.split(" ")[0])) score += 30;
  if (title.includes(queryLower)) score += 25;
  
  return score;
}

/**
 * Aggregate SKUs into color-grouped structure
 */
function aggregateProducts(products: SSProduct[], styleInfo?: SSStyle): StandardProduct | null {
  if (!products || products.length === 0) return null;
  
  const first = products[0];
  
  // Group by color
  const colorMap = new Map<string, {
    code: string;
    name: string;
    hexCode: string | null;
    swatchUrl: string | null;
    imageUrl: string | null;
    sizesMap: Map<string, {
      code: string;
      order: number;
      prices: number[];
      inventory: Map<string, number>;
    }>;
  }>();
  
  for (const sku of products) {
    const colorName = sku.colorName || "Default";
    const colorCode = sku.colorCode || "00";
    
    if (!colorMap.has(colorName)) {
      colorMap.set(colorName, {
        code: colorCode,
        name: colorName,
        hexCode: sku.color1 || null,
        swatchUrl: buildImageUrl(sku.colorSwatchImage),
        imageUrl: buildImageUrl(sku.colorFrontImage),
        sizesMap: new Map(),
      });
    }
    
    const colorEntry = colorMap.get(colorName)!;
    const sizeName = sku.sizeName || "OS";
    
    if (!colorEntry.sizesMap.has(sizeName)) {
      colorEntry.sizesMap.set(sizeName, {
        code: sizeName,
        order: getSizeOrder(sizeName),
        prices: [],
        inventory: new Map(),
      });
    }
    
    const sizeEntry = colorEntry.sizesMap.get(sizeName)!;
    
    // Track prices (we'll use min later)
    if (sku.customerPrice) {
      sizeEntry.prices.push(sku.customerPrice);
    }
    
    // Aggregate inventory by warehouse
    if (sku.warehouses) {
      for (const wh of sku.warehouses) {
        if (wh.warehouseAbbr) {
          const current = sizeEntry.inventory.get(wh.warehouseAbbr) || 0;
          sizeEntry.inventory.set(wh.warehouseAbbr, current + (wh.qty || 0));
        }
      }
    }
  }
  
  // Convert to StandardColor array
  const colors: StandardColor[] = Array.from(colorMap.entries()).map(([_, colorData]) => {
    const sizes: StandardSize[] = Array.from(colorData.sizesMap.values())
      .map((sizeData) => ({
        code: sizeData.code,
        order: sizeData.order,
        price: sizeData.prices.length > 0 ? Math.min(...sizeData.prices) : 0,
        inventory: Array.from(sizeData.inventory.entries())
          .map(([code, qty]) => ({
            warehouseCode: code,
            warehouseName: WAREHOUSE_NAMES[code] || code,
            quantity: qty,
            isCapped: qty >= 500,
          }))
          .sort((a, b) => b.quantity - a.quantity),
      }))
      .sort((a, b) => a.order - b.order);
    
    return {
      code: colorData.code,
      name: colorData.name,
      hexCode: colorData.hexCode,
      swatchUrl: colorData.swatchUrl,
      imageUrl: colorData.imageUrl,
      sizes,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  
  // Build product name
  const productName = styleInfo?.title || 
    first.title || 
    `${first.brandName || ""} ${first.styleName || ""}`.trim() || 
    "Unknown Product";
  
  // Get style image
  const styleImage = styleInfo?.styleImage 
    ? buildImageUrl(styleInfo.styleImage)
    : buildImageUrl(first.colorFrontImage);
  
  const styleID = first.styleID || styleInfo?.styleID;
  const brandName = first.brandName || styleInfo?.brandName || "";
  const styleName = first.styleName || String(styleID) || "";
  const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return {
    styleNumber: styleName,
    name: productName,
    brand: brandName,
    category: first.baseCategory || styleInfo?.baseCategory || "",
    imageUrl: styleImage || undefined,
    productUrl: brandSlug && styleName
      ? `https://www.ssactivewear.com/p/${brandSlug}/${encodeURIComponent(styleName)}`
      : undefined,
    colors,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query, distributorId, brand } = await req.json();
    const brandFilter = brand ? brand.toLowerCase().trim() : null;

    if (!query || typeof query !== "string" || query.length > 100 || !/^[a-zA-Z0-9\s\-\+\&\.]+$/.test(query)) {
      return new Response(
        JSON.stringify({ error: "Invalid query format" }),
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

    if (!username || !password) {
      console.error("[provider-ss-activewear] Missing API credentials");
      return new Response(
        JSON.stringify({
          error: "Service temporarily unavailable",
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
    const fetchOptions = {
      headers: { Authorization: authHeader, Accept: "application/json" },
    };

    // Generate query variants for fuzzy matching
    // For prefixed styles like NL3600, also try the numeric part alone
    const variants = generateQueryVariants(query);
    // If query starts with letters+numbers (e.g. NL3600), add the numeric suffix
    const numericSuffix = query.match(/^[A-Za-z]+(\d+.*)$/)?.[1];
    if (numericSuffix && !variants.includes(numericSuffix)) {
      variants.push(numericSuffix);
    }
    console.log(`[provider-ss-activewear] Query variants: ${variants.join(", ")}`);

    let products: SSProduct[] = [];
    let matchedVariant = "";

    // Step 1 & 2: Try direct products lookup with each variant
    // Skip pure-numeric fallbacks in the direct products lookup —
    // they cause false matches (e.g. SS650 → 650 → VC300Y).
    // The styles search handles fuzzy matching with proper scoring.
    const originalIsAlphanumeric = /[A-Za-z]/.test(query);
    for (const variant of variants) {
      const isNumericOnly = /^\d+$/.test(variant);
      if (isNumericOnly && originalIsAlphanumeric) continue;

      const url = `${SS_API_BASE}/products/?style=${encodeURIComponent(variant)}`;
      console.log(`[provider-ss-activewear] Trying: ${url}`);
      
      const res = await fetch(url, fetchOptions);
      
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          // Brand validation: skip if brand is provided and doesn't match
          if (brand) {
            const brandLower = brand.toLowerCase();
            const brandMatches = data.some((p: SSProduct) =>
              (p.brandName || "").toLowerCase().includes(brandLower) ||
              brandLower.includes((p.brandName || "").toLowerCase().split(" ")[0])
            );
            if (!brandMatches) {
              console.log(`[provider-ss-activewear] Brand mismatch for variant ${variant} — expected ${brand}, got ${data[0]?.brandName ?? "unknown"}, skipping`);
              await res.text().catch(() => {});
              continue;
            }
          }
          products = data;
          matchedVariant = variant;
          console.log(`[provider-ss-activewear] Found ${products.length} SKUs with variant: ${variant}`);
          break;
        }
      } else {
        // Consume response body to prevent leaks
        await res.text();
      }
    }

    // Step 3: If no direct match, try fuzzy search via styles endpoint
    if (products.length === 0) {
      console.log(`[provider-ss-activewear] No direct match, trying styles search`);
      
      for (const variant of variants) {
        const stylesUrl = `${SS_API_BASE}/styles/?search=${encodeURIComponent(variant)}`;
        console.log(`[provider-ss-activewear] Searching styles: ${stylesUrl}`);
        
        const stylesRes = await fetch(stylesUrl, fetchOptions);
        
        if (stylesRes.ok) {
          const styles: SSStyle[] = await stylesRes.json();
          
          if (Array.isArray(styles) && styles.length > 0) {
            console.log(`[provider-ss-activewear] Found ${styles.length} matching styles`);
            
            // Score and sort styles to find best match
            // If brandFilter is set, only consider styles from that brand
            const candidateStyles = brandFilter
              ? styles.filter(s => (s.brandName || "").toLowerCase().includes(brandFilter) || brandFilter.includes((s.brandName || "").toLowerCase()))
              : styles;

            if (candidateStyles.length === 0) {
              console.log(`[provider-ss-activewear] Brand filter "${brandFilter}" excluded all ${styles.length} results`);
              continue;
            }

            const scoredStyles = candidateStyles
              .map((s) => ({ style: s, score: scoreStyleMatch(s, variant, brand ?? undefined) }))
              .sort((a, b) => b.score - a.score);
            
            const bestMatch = scoredStyles[0];
            console.log(`[provider-ss-activewear] Best match: ${bestMatch.style.brandName} ${bestMatch.style.styleName} (score: ${bestMatch.score})`);
            
            if (bestMatch.style.styleID) {
              // Fetch products by styleID
              const productsUrl = `${SS_API_BASE}/products/?styleid=${bestMatch.style.styleID}`;
              console.log(`[provider-ss-activewear] Fetching products by styleID: ${productsUrl}`);
              
              const productsRes = await fetch(productsUrl, fetchOptions);
              
              if (productsRes.ok) {
                const data = await productsRes.json();
                if (Array.isArray(data) && data.length > 0) {
                  products = data;
                  matchedVariant = `styleID:${bestMatch.style.styleID}`;
                  console.log(`[provider-ss-activewear] Found ${products.length} SKUs via style search`);
                  break;
                }
              } else {
                await productsRes.text();
              }
            }
          }
        } else {
          await stylesRes.text();
        }
      }
    }

    // Step 4: No matches found
    if (products.length === 0) {
      console.log(`[provider-ss-activewear] No products found for query: ${query}`);
      return new Response(
        JSON.stringify({ product: null }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Aggregate products into normalized structure with colors
    const standardProduct = aggregateProducts(products);

    if (!standardProduct) {
      console.log(`[provider-ss-activewear] Failed to aggregate products`);
      return new Response(
        JSON.stringify({ product: null }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Brand validation removed — styleNumber uniqueness per distributor is sufficient.
    // Fuzzy brand checks were causing valid items (e.g. "LAT" vs "LAT Apparel") to be rejected.

    console.log(`[provider-ss-activewear] Returning: ${standardProduct.brand} ${standardProduct.styleNumber} with ${standardProduct.colors.length} colors`);
    

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
        error: "Service temporarily unavailable",
        product: null,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
