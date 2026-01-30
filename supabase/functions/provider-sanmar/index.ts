import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.3.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// SanMar SOAP endpoint
const SANMAR_ENDPOINT = "https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort";

// Warehouse code to name mapping (from SanMar Integration Guide)
const WAREHOUSE_NAMES: Record<string, string> = {
  "10": "Seattle, WA",
  "20": "Dallas, TX",
  "30": "Cincinnati, OH (Legacy)",
  "40": "Jacksonville, FL",
  "50": "Reno, NV",
  "60": "Kansas City, MO",
  "70": "Robbinsville, NJ",
  "80": "Cincinnati, OH",
  "90": "Minneapolis, MN",
  "100": "Phoenix, AZ",
  "110": "Toronto, ON",
  "120": "Denver, CO",
  "130": "Los Angeles, CA",
};

// Size order mapping for sorting
const SIZE_ORDER: Record<string, number> = {
  XS: 1, S: 2, M: 3, L: 4, XL: 5,
  "2XL": 6, "3XL": 7, "4XL": 8, "5XL": 9, "6XL": 10,
  "2X": 6, "3X": 7, "4X": 8, "5X": 9, "6X": 10,
  XXL: 6, XXXL: 7, XXXXL: 8,
  OSFA: 50, OS: 50, "ONE SIZE": 50,
};

// Common brand patterns for fuzzy matching
const BRAND_PATTERNS = [
  { pattern: /^(sanmar)(\d+)/i, brand: "sanmar" },
  { pattern: /^(port\s*authority)(\d+)/i, brand: "port authority" },
  { pattern: /^(port)(\d+)/i, brand: "port authority" },
  { pattern: /^(nike)(\d+)/i, brand: "nike" },
  { pattern: /^(ogio)(\d+)/i, brand: "ogio" },
  { pattern: /^(eddie\s*bauer)(\d+)/i, brand: "eddie bauer" },
  { pattern: /^(cornerstone)(\d+)/i, brand: "cornerstone" },
  { pattern: /^(district)(\d+)/i, brand: "district" },
  { pattern: /^(red\s*house)(\d+)/i, brand: "red house" },
  { pattern: /^(sport-tek)(\d+)/i, brand: "sport-tek" },
  { pattern: /^(sporttek)(\d+)/i, brand: "sport-tek" },
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
}

function getSizeOrder(sizeCode: string): number {
  const normalized = sizeCode.toUpperCase().trim();
  if (SIZE_ORDER[normalized]) return SIZE_ORDER[normalized];
  // Try matching 2XL variants
  if (normalized === "XXL") return SIZE_ORDER["2XL"];
  if (normalized === "XXXL") return SIZE_ORDER["3XL"];
  return 99;
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
      const spaced = `${brand} ${number}`;
      if (!variants.includes(spaced)) variants.push(spaced);
      if (!variants.includes(number)) variants.push(number);
      break;
    }
  }
  
  // Generic pattern: letters followed by numbers without space
  const genericMatch = lower.match(/^([a-z]+)(\d+)$/);
  if (genericMatch && variants.length === 1) {
    const [, letters, numbers] = genericMatch;
    const spaced = `${letters} ${numbers}`;
    if (!variants.includes(spaced)) variants.push(spaced);
    if (!variants.includes(numbers)) variants.push(numbers);
  }
  
  // If query has spaces, also try without spaces
  if (trimmed.includes(" ")) {
    const collapsed = trimmed.replace(/\s+/g, "");
    if (!variants.includes(collapsed)) variants.push(collapsed);
  }
  
  // Try uppercase variant
  if (!variants.includes(trimmed.toUpperCase())) {
    variants.push(trimmed.toUpperCase());
  }
  
  return variants;
}

/**
 * Build WS-Security SOAP envelope
 */
function buildSoapRequest(styleNumber: string, username: string, password: string): string {
  // Create timestamp for WS-Security
  const created = new Date().toISOString();
  const expires = new Date(Date.now() + 300000).toISOString(); // 5 minutes from now
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
                  xmlns:ser="http://service.ws.sanmar.com/"
                  xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
                  xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <soapenv:Header>
    <wsse:Security soapenv:mustUnderstand="1">
      <wsu:Timestamp wsu:Id="TS-1">
        <wsu:Created>${created}</wsu:Created>
        <wsu:Expires>${expires}</wsu:Expires>
      </wsu:Timestamp>
      <wsse:UsernameToken wsu:Id="UsernameToken-1">
        <wsse:Username>${username}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${password}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:getProductInfoByStyleColorSizeRequest>
      <arg0>${escapeXml(styleNumber)}</arg0>
    </ser:getProductInfoByStyleColorSizeRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Build SOAP request for inventory
 */
function buildInventoryRequest(styleNumber: string, username: string, password: string): string {
  const created = new Date().toISOString();
  const expires = new Date(Date.now() + 300000).toISOString();
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
                  xmlns:ser="http://service.ws.sanmar.com/"
                  xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
                  xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <soapenv:Header>
    <wsse:Security soapenv:mustUnderstand="1">
      <wsu:Timestamp wsu:Id="TS-1">
        <wsu:Created>${created}</wsu:Created>
        <wsu:Expires>${expires}</wsu:Expires>
      </wsu:Timestamp>
      <wsse:UsernameToken wsu:Id="UsernameToken-1">
        <wsse:Username>${username}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${password}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:getInventoryQtyForStyleColorSizeRequest>
      <arg0>${escapeXml(styleNumber)}</arg0>
    </ser:getInventoryQtyForStyleColorSizeRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Build SOAP request for pricing
 */
function buildPriceRequest(styleNumber: string, username: string, password: string, customerNumber: string): string {
  const created = new Date().toISOString();
  const expires = new Date(Date.now() + 300000).toISOString();
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
                  xmlns:ser="http://service.ws.sanmar.com/"
                  xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
                  xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <soapenv:Header>
    <wsse:Security soapenv:mustUnderstand="1">
      <wsu:Timestamp wsu:Id="TS-1">
        <wsu:Created>${created}</wsu:Created>
        <wsu:Expires>${expires}</wsu:Expires>
      </wsu:Timestamp>
      <wsse:UsernameToken wsu:Id="UsernameToken-1">
        <wsse:Username>${username}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${password}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:getProductPriceAndAvailability>
      <arg0>${customerNumber}</arg0>
      <arg1>${escapeXml(styleNumber)}</arg1>
    </ser:getProductPriceAndAvailability>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Parse product info from SOAP response
 */
function parseProductResponse(xmlData: string, parser: XMLParser): any {
  try {
    const result = parser.parse(xmlData);
    
    // Navigate through SOAP envelope structure
    const envelope = result["soap:Envelope"] || result["soapenv:Envelope"] || result.Envelope;
    if (!envelope) {
      console.log("[provider-sanmar] No envelope found in response");
      return null;
    }
    
    const body = envelope["soap:Body"] || envelope["soapenv:Body"] || envelope.Body;
    if (!body) {
      console.log("[provider-sanmar] No body found in response");
      return null;
    }
    
    // Look for the response element
    const response = body["ns2:getProductInfoByStyleColorSizeResponse"] || 
                    body["getProductInfoByStyleColorSizeResponse"] ||
                    body["ns1:getProductInfoByStyleColorSizeResponse"];
    
    if (!response) {
      console.log("[provider-sanmar] No product response found");
      return null;
    }
    
    // Extract return value
    const returnVal = response["return"] || response["ns2:return"];
    return returnVal;
  } catch (error) {
    console.error("[provider-sanmar] Error parsing product response:", error);
    return null;
  }
}

/**
 * Parse inventory from SOAP response
 */
function parseInventoryResponse(xmlData: string, parser: XMLParser): any[] {
  try {
    const result = parser.parse(xmlData);
    const envelope = result["soap:Envelope"] || result["soapenv:Envelope"] || result.Envelope;
    if (!envelope) return [];
    
    const body = envelope["soap:Body"] || envelope["soapenv:Body"] || envelope.Body;
    if (!body) return [];
    
    const response = body["ns2:getInventoryQtyForStyleColorSizeResponse"] ||
                    body["getInventoryQtyForStyleColorSizeResponse"];
    if (!response) return [];
    
    const returnVal = response["return"] || response["ns2:return"];
    if (!returnVal) return [];
    
    // Ensure array
    return Array.isArray(returnVal) ? returnVal : [returnVal];
  } catch (error) {
    console.error("[provider-sanmar] Error parsing inventory response:", error);
    return [];
  }
}

/**
 * Parse pricing from SOAP response
 */
function parsePriceResponse(xmlData: string, parser: XMLParser): any[] {
  try {
    const result = parser.parse(xmlData);
    const envelope = result["soap:Envelope"] || result["soapenv:Envelope"] || result.Envelope;
    if (!envelope) return [];
    
    const body = envelope["soap:Body"] || envelope["soapenv:Body"] || envelope.Body;
    if (!body) return [];
    
    const response = body["ns2:getProductPriceAndAvailabilityResponse"] ||
                    body["getProductPriceAndAvailabilityResponse"];
    if (!response) return [];
    
    const returnVal = response["return"] || response["ns2:return"];
    if (!returnVal) return [];
    
    // Look for listPrice or skuList
    const skuList = returnVal.skuList || returnVal.listPrice;
    if (!skuList) return [];
    
    return Array.isArray(skuList) ? skuList : [skuList];
  } catch (error) {
    console.error("[provider-sanmar] Error parsing price response:", error);
    return [];
  }
}

/**
 * Aggregate product data into normalized structure with colors
 */
function aggregateProducts(
  productInfo: any,
  inventoryData: any[],
  priceData: any[]
): StandardProduct | null {
  if (!productInfo) return null;
  
  // Build lookup maps for inventory and pricing
  const inventoryMap = new Map<string, Map<string, number>>(); // color+size -> warehouse -> qty
  for (const inv of inventoryData) {
    const colorCode = inv.colorCode || inv.color || "";
    const sizeCode = inv.sizeCode || inv.size || "";
    const key = `${colorCode}|${sizeCode}`;
    
    if (!inventoryMap.has(key)) {
      inventoryMap.set(key, new Map());
    }
    
    const whCode = String(inv.warehouseCode || inv.warehouse || "");
    const qty = parseInt(inv.quantity || inv.qty || "0", 10);
    inventoryMap.get(key)!.set(whCode, qty);
  }
  
  const priceMap = new Map<string, number>(); // color+size -> price
  for (const price of priceData) {
    const colorCode = price.colorCode || price.color || "";
    const sizeCode = price.sizeCode || price.size || "";
    const key = `${colorCode}|${sizeCode}`;
    const priceVal = parseFloat(price.price || price.listPrice || price.basePrice || "0");
    priceMap.set(key, priceVal);
  }
  
  // Get product list (variants by color/size)
  const productList = productInfo.productPartList || productInfo.productParts || [];
  const parts = Array.isArray(productList) ? productList : [productList];
  
  if (parts.length === 0) {
    console.log("[provider-sanmar] No product parts found");
    return null;
  }
  
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
      price: number;
      inventory: Map<string, number>;
    }>;
  }>();
  
  for (const part of parts) {
    const colorName = part.colorName || part.color || "Default";
    const colorCode = part.colorCode || part.colorId || "00";
    
    if (!colorMap.has(colorName)) {
      // Build image URLs from SanMar's pattern
      const styleNum = productInfo.styleNumber || productInfo.style || "";
      const colorForUrl = colorCode.replace(/\s/g, "");
      
      colorMap.set(colorName, {
        code: colorCode,
        name: colorName,
        hexCode: part.hexCode || part.color1 || null,
        swatchUrl: part.colorSwatchImage || `https://cdnm.sanmar.com/catalog/images/${styleNum}_${colorForUrl}_swatch.jpg`,
        imageUrl: part.productImage || part.frontImage || `https://cdnm.sanmar.com/catalog/images/${styleNum}_${colorForUrl}_front.jpg`,
        sizesMap: new Map(),
      });
    }
    
    const colorEntry = colorMap.get(colorName)!;
    const sizeName = part.sizeName || part.size || "OS";
    
    if (!colorEntry.sizesMap.has(sizeName)) {
      const key = `${colorCode}|${sizeName}`;
      colorEntry.sizesMap.set(sizeName, {
        code: sizeName,
        order: getSizeOrder(sizeName),
        price: priceMap.get(key) || parseFloat(part.price || part.listPrice || "0"),
        inventory: new Map(),
      });
    }
    
    const sizeEntry = colorEntry.sizesMap.get(sizeName)!;
    
    // Add inventory from lookup or from part data
    const key = `${colorCode}|${sizeName}`;
    const invForKey = inventoryMap.get(key);
    if (invForKey) {
      for (const [whCode, qty] of invForKey) {
        sizeEntry.inventory.set(whCode, qty);
      }
    }
    
    // Also check if part has embedded inventory
    if (part.inventoryList || part.inventory) {
      const invList = part.inventoryList || part.inventory;
      const invItems = Array.isArray(invList) ? invList : [invList];
      for (const inv of invItems) {
        const whCode = String(inv.warehouseCode || inv.warehouse || "");
        const qty = parseInt(inv.quantity || inv.qty || "0", 10);
        if (whCode) {
          sizeEntry.inventory.set(whCode, qty);
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
        price: sizeData.price,
        inventory: Array.from(sizeData.inventory.entries())
          .map(([code, qty]) => ({
            warehouseCode: code,
            warehouseName: WAREHOUSE_NAMES[code] || `Warehouse ${code}`,
            quantity: qty,
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
  
  // Build final product
  const styleNumber = productInfo.styleNumber || productInfo.style || "";
  const productName = productInfo.productName || productInfo.name || productInfo.description || "";
  const brand = productInfo.brandName || productInfo.brand || "SanMar";
  const category = productInfo.categoryName || productInfo.category || "";
  const imageUrl = productInfo.productImage || productInfo.mainImage || 
                   (colors.length > 0 ? colors[0].imageUrl : undefined);
  
  return {
    styleNumber,
    name: productName || `${brand} ${styleNumber}`,
    brand,
    category,
    imageUrl: imageUrl || undefined,
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

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query parameter is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[provider-sanmar] Searching for: ${query}`);

    // Get credentials from secrets
    const username = Deno.env.get("SANMAR_USERNAME");
    const password = Deno.env.get("SANMAR_PASSWORD");
    const customerNumber = Deno.env.get("SANMAR_CUSTOMER_NUMBER") || "144250";

    if (!username || !password) {
      console.error("[provider-sanmar] Missing API credentials");
      return new Response(
        JSON.stringify({
          error: "SanMar API credentials not configured",
          product: null,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize XML parser
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
    });

    // Generate query variants for fuzzy matching
    const variants = generateQueryVariants(query);
    console.log(`[provider-sanmar] Query variants: ${variants.join(", ")}`);

    let productInfo: any = null;
    let matchedVariant = "";

    // Try each variant until we get a match
    for (const variant of variants) {
      try {
        console.log(`[provider-sanmar] Trying variant: ${variant}`);
        
        const soapRequest = buildSoapRequest(variant, username, password);
        
        const response = await fetch(SANMAR_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": "getProductInfoByStyleColorSize",
          },
          body: soapRequest,
        });

        if (!response.ok) {
          console.log(`[provider-sanmar] HTTP error for variant ${variant}: ${response.status}`);
          continue;
        }

        const xmlText = await response.text();
        console.log(`[provider-sanmar] Response length: ${xmlText.length}`);
        
        // Check for SOAP fault
        if (xmlText.includes("Fault") || xmlText.includes("fault")) {
          console.log(`[provider-sanmar] SOAP fault for variant ${variant}`);
          continue;
        }
        
        const parsed = parseProductResponse(xmlText, parser);
        
        if (parsed && (parsed.styleNumber || parsed.productPartList || parsed.productParts)) {
          productInfo = parsed;
          matchedVariant = variant;
          console.log(`[provider-sanmar] Found product with variant: ${variant}`);
          break;
        }
      } catch (err) {
        console.error(`[provider-sanmar] Error with variant ${variant}:`, err);
        continue;
      }
    }

    // If no product found, return null
    if (!productInfo) {
      console.log(`[provider-sanmar] No products found for query: ${query}`);
      return new Response(
        JSON.stringify({ product: null }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch inventory and pricing in parallel
    const styleToFetch = productInfo.styleNumber || matchedVariant;
    console.log(`[provider-sanmar] Fetching inventory and pricing for: ${styleToFetch}`);

    const [inventoryResponse, priceResponse] = await Promise.all([
      fetch(SANMAR_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": "getInventoryQtyForStyleColorSize",
        },
        body: buildInventoryRequest(styleToFetch, username, password),
      }).catch(e => {
        console.error("[provider-sanmar] Inventory fetch error:", e);
        return null;
      }),
      fetch(SANMAR_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": "getProductPriceAndAvailability",
        },
        body: buildPriceRequest(styleToFetch, username, password, customerNumber),
      }).catch(e => {
        console.error("[provider-sanmar] Price fetch error:", e);
        return null;
      }),
    ]);

    let inventoryData: any[] = [];
    let priceData: any[] = [];

    if (inventoryResponse && inventoryResponse.ok) {
      const invXml = await inventoryResponse.text();
      inventoryData = parseInventoryResponse(invXml, parser);
      console.log(`[provider-sanmar] Got ${inventoryData.length} inventory items`);
    }

    if (priceResponse && priceResponse.ok) {
      const priceXml = await priceResponse.text();
      priceData = parsePriceResponse(priceXml, parser);
      console.log(`[provider-sanmar] Got ${priceData.length} price items`);
    }

    // Aggregate into normalized structure
    const standardProduct = aggregateProducts(productInfo, inventoryData, priceData);

    if (!standardProduct) {
      console.log(`[provider-sanmar] Failed to aggregate products`);
      return new Response(
        JSON.stringify({ product: null }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[provider-sanmar] Returning: ${standardProduct.brand} ${standardProduct.styleNumber} with ${standardProduct.colors.length} colors`);

    return new Response(
      JSON.stringify({ product: standardProduct }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[provider-sanmar] Fatal error:", error);
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
