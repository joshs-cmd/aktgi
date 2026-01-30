import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.3.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// SanMar SOAP endpoints
const PRODUCT_INFO_ENDPOINT = "https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort";
const INVENTORY_ENDPOINT = "https://ws.sanmar.com:8080/SanMarWebService/SanMarWebServicePort";

// SanMar warehouse mapping
const WAREHOUSE_NAMES: Record<string, string> = {
  "1": "Seattle, WA",
  "2": "Cincinnati, OH",
  "3": "Dallas, TX",
  "4": "Reno, NV",
  "5": "Robbinsville, NJ",
  "6": "Jacksonville, FL",
  "7": "Minneapolis, MN",
  "12": "Phoenix, AZ",
  "31": "Richmond, VA",
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
  { pattern: /^(port\s*authority)(.+)/i, brand: "port authority" },
  { pattern: /^(port\s*&?\s*co)(.+)/i, brand: "port & company" },
  { pattern: /^(sport-?tek)(.+)/i, brand: "sport-tek" },
  { pattern: /^(cornerstone)(.+)/i, brand: "cornerstone" },
  { pattern: /^(district)(.+)/i, brand: "district" },
  { pattern: /^(nike)(.+)/i, brand: "nike" },
  { pattern: /^(ogio)(.+)/i, brand: "ogio" },
  { pattern: /^(eddie\s*bauer)(.+)/i, brand: "eddie bauer" },
  { pattern: /^(carhartt)(.+)/i, brand: "carhartt" },
  { pattern: /^(north\s*face)(.+)/i, brand: "the north face" },
  { pattern: /^(new\s*era)(.+)/i, brand: "new era" },
  { pattern: /^(bella)(.+)/i, brand: "bella+canvas" },
  { pattern: /^(gildan)(.+)/i, brand: "gildan" },
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
  
  // Always include original
  variants.push(trimmed);
  
  // Also try uppercase (SanMar styles are often uppercase like PC61, K500)
  if (trimmed !== trimmed.toUpperCase()) {
    variants.push(trimmed.toUpperCase());
  }
  
  // Try to detect brand+style patterns without space
  for (const { pattern, brand } of BRAND_PATTERNS) {
    const match = trimmed.toLowerCase().match(pattern);
    if (match) {
      const suffix = match[2].trim();
      // Just use the style number without brand
      if (suffix && !variants.includes(suffix.toUpperCase())) {
        variants.push(suffix.toUpperCase());
      }
      break;
    }
  }
  
  // Generic pattern: letters followed by numbers without space (PC61 -> PC61)
  const alphaNumMatch = trimmed.match(/^([a-zA-Z]+)(\d+)$/);
  if (alphaNumMatch) {
    const formatted = `${alphaNumMatch[1].toUpperCase()}${alphaNumMatch[2]}`;
    if (!variants.includes(formatted)) {
      variants.push(formatted);
    }
  }
  
  // If query has spaces, try without (Port Authority K500 -> K500)
  if (trimmed.includes(" ")) {
    const parts = trimmed.split(/\s+/);
    const lastPart = parts[parts.length - 1].toUpperCase();
    if (!variants.includes(lastPart)) {
      variants.push(lastPart);
    }
  }
  
  return variants;
}

/**
 * Build SOAP request for getProductInfoByStyleColorSize
 */
function buildProductInfoRequest(
  style: string,
  customerNumber: string,
  username: string,
  password: string
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
                  xmlns:impl="http://impl.webservice.integration.sanmar.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <impl:getProductInfoByStyleColorSize>
      <arg0>
        <style>${escapeXml(style)}</style>
      </arg0>
      <arg1>
        <sanMarCustomerNumber>${escapeXml(customerNumber)}</sanMarCustomerNumber>
        <sanMarUserName>${escapeXml(username)}</sanMarUserName>
        <sanMarUserPassword>${escapeXml(password)}</sanMarUserPassword>
      </arg1>
    </impl:getProductInfoByStyleColorSize>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Build SOAP request for getInventoryQtyForStyleColorSize
 * Uses the SanMarWebServicePort endpoint with impl namespace
 */
function buildInventoryRequest(
  style: string,
  customerNumber: string,
  username: string,
  password: string
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
                  xmlns:impl="http://impl.webservice.integration.sanmar.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <impl:getInventoryQtyForStyleColorSize>
      <arg0>${escapeXml(customerNumber)}</arg0>
      <arg1>${escapeXml(username)}</arg1>
      <arg2>${escapeXml(password)}</arg2>
      <arg3>${escapeXml(style)}</arg3>
    </impl:getInventoryQtyForStyleColorSize>
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
function parseProductResponse(xmlData: string, parser: XMLParser): any[] {
  try {
    const result = parser.parse(xmlData);
    
    // Navigate SOAP envelope
    const envelope = result["S:Envelope"] || result["soap:Envelope"] || result["soapenv:Envelope"] || result.Envelope;
    if (!envelope) {
      console.log("[provider-sanmar] No envelope found");
      return [];
    }
    
    const body = envelope["S:Body"] || envelope["soap:Body"] || envelope["soapenv:Body"] || envelope.Body;
    if (!body) {
      console.log("[provider-sanmar] No body found");
      return [];
    }
    
    // Find the response element
    const responseKey = Object.keys(body).find(k => k.includes("getProductInfoByStyleColorSizeResponse"));
    if (!responseKey) {
      console.log("[provider-sanmar] No response element found");
      return [];
    }
    
    const response = body[responseKey];
    const returnVal = response?.return || response?.["ns2:return"] || response;
    
    if (!returnVal) {
      console.log("[provider-sanmar] No return value found");
      return [];
    }
    
    // Check for error
    if (returnVal.errorOccured === true || returnVal.errorOccured === "true") {
      console.log(`[provider-sanmar] Error in response: ${returnVal.message}`);
      return [];
    }
    
    // Get list response - can be array or single object
    const listResponse = returnVal.listResponse;
    if (!listResponse) {
      console.log("[provider-sanmar] No listResponse found");
      return [];
    }
    
    const items = Array.isArray(listResponse) ? listResponse : [listResponse];
    
    // SanMar response has nested structure with productBasicInfo, productPriceInfo, etc.
    // Flatten and merge the nested objects
    return items.map(item => {
      const basic = item.productBasicInfo || {};
      const price = item.productPriceInfo || {};
      const images = item.productImageInfo || {};
      
      return {
        // Basic info
        style: basic.style || item.style || "",
        productTitle: basic.productTitle || item.productTitle || "",
        productDescription: basic.productDescription || item.productDescription || "",
        brandName: basic.brandName || item.brandName || "",
        category: basic.category || item.category || "",
        color: basic.color || item.color || "",
        catalogColor: basic.catalogColor || item.catalogColor || "",
        size: basic.size || item.size || "",
        availableSizes: basic.availableSizes || item.availableSizes || "",
        inventoryKey: basic.inventoryKey || item.inventoryKey || "",
        uniqueKey: basic.uniqueKey || item.uniqueKey || "",
        productStatus: basic.productStatus || item.productStatus || "",
        
        // Price info
        piecePrice: price.piecePrice || item.piecePrice || "",
        casePrice: price.casePrice || item.casePrice || "",
        pieceSalePrice: price.pieceSalePrice || item.pieceSalePrice || "",
        caseSalePrice: price.caseSalePrice || item.caseSalePrice || "",
        priceCode: price.priceCode || item.priceCode || "",
        
        // Image info
        productImage: images.productImage || item.productImage || "",
        colorProductImage: images.colorProductImage || item.colorProductImage || "",
        colorSquareImage: images.colorSquareImage || item.colorSquareImage || "",
        colorSwatchImage: images.colorSwatchImage || item.colorSwatchImage || "",
        thumbnailImage: images.thumbnailImage || item.thumbnailImage || "",
        frontModel: images.frontModel || item.frontModel || "",
        backModel: images.backModel || item.backModel || "",
      };
    });
  } catch (error) {
    console.error("[provider-sanmar] Error parsing product response:", error);
    return [];
  }
}

/**
 * Parse inventory from SOAP response
 */
function parseInventoryResponse(xmlData: string, parser: XMLParser): any[] {
  try {
    const result = parser.parse(xmlData);
    
    const envelope = result["S:Envelope"] || result["soap:Envelope"] || result["soapenv:Envelope"] || result.Envelope;
    if (!envelope) return [];
    
    const body = envelope["S:Body"] || envelope["soap:Body"] || envelope["soapenv:Body"] || envelope.Body;
    if (!body) return [];
    
    const responseKey = Object.keys(body).find(k => k.includes("getInventoryQtyForStyleColorSizeResponse"));
    if (!responseKey) return [];
    
    const response = body[responseKey];
    const returnVal = response?.return || response;
    
    if (!returnVal || returnVal.errorOccured === true || returnVal.errorOccured === "true") {
      return [];
    }
    
    const listResponse = returnVal.listResponse;
    if (!listResponse) return [];
    
    return Array.isArray(listResponse) ? listResponse : [listResponse];
  } catch (error) {
    console.error("[provider-sanmar] Error parsing inventory response:", error);
    return [];
  }
}

/**
 * Aggregate products into normalized structure with colors
 */
function aggregateProducts(
  productList: any[],
  inventoryList: any[]
): StandardProduct | null {
  if (!productList || productList.length === 0) return null;
  
  // Build inventory lookup: catalogColor|size -> warehouse -> qty
  const inventoryMap = new Map<string, Map<string, number>>();
  
  for (const inv of inventoryList) {
    const catalogColor = (inv.catalogColor || inv.color || "").trim();
    const size = (inv.size || "").trim();
    const key = `${catalogColor}|${size}`;
    
    if (!inventoryMap.has(key)) {
      inventoryMap.set(key, new Map());
    }
    
    // Parse warehouse quantities from the response structure
    // SanMar returns { whseNo: "1", whseName: "Seattle", qty: 100 }
    const whseNo = String(inv.whseNo || inv.warehouseNo || "");
    const qty = parseInt(inv.qty || inv.quantity || "0", 10);
    
    if (whseNo) {
      inventoryMap.get(key)!.set(whseNo, qty);
    }
    
    // Also handle nested inventory arrays
    if (inv.inventoryList || inv.inventory) {
      const invItems = inv.inventoryList || inv.inventory;
      const items = Array.isArray(invItems) ? invItems : [invItems];
      for (const item of items) {
        const wh = String(item.whseNo || item.warehouseNo || "");
        const q = parseInt(item.qty || item.quantity || "0", 10);
        if (wh) {
          inventoryMap.get(key)!.set(wh, q);
        }
      }
    }
  }
  
  // Group products by color
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
  
  let firstProduct: any = null;
  
  for (const product of productList) {
    if (!firstProduct) firstProduct = product;
    
    const colorName = (product.color || product.colorName || "Default").trim();
    const catalogColor = (product.catalogColor || colorName).trim();
    
    if (!colorMap.has(colorName)) {
      colorMap.set(colorName, {
        code: catalogColor,
        name: colorName,
        hexCode: null, // SanMar doesn't provide hex codes in the API
        swatchUrl: product.colorSquareImage || product.colorSwatchImage || null,
        imageUrl: product.colorProductImage || product.productImage || null,
        sizesMap: new Map(),
      });
    }
    
    const colorEntry = colorMap.get(colorName)!;
    const sizeName = (product.size || "OS").trim();
    
    if (!colorEntry.sizesMap.has(sizeName)) {
      colorEntry.sizesMap.set(sizeName, {
        code: sizeName,
        order: getSizeOrder(sizeName),
        price: parseFloat(product.piecePrice || product.casePrice || "0"),
        inventory: new Map(),
      });
    }
    
    const sizeEntry = colorEntry.sizesMap.get(sizeName)!;
    
    // Get inventory from our lookup
    const invKey = `${catalogColor}|${sizeName}`;
    const invForKey = inventoryMap.get(invKey);
    if (invForKey) {
      for (const [whCode, qty] of invForKey) {
        sizeEntry.inventory.set(whCode, qty);
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
  
  if (!firstProduct) return null;
  
  return {
    styleNumber: firstProduct.style || "",
    name: firstProduct.productTitle || `${firstProduct.brandName || ""} ${firstProduct.style || ""}`.trim(),
    brand: firstProduct.brandName || "SanMar",
    category: firstProduct.category || "",
    imageUrl: firstProduct.productImage || undefined,
    colors,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query, distributorId } = await req.json();

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query parameter is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[provider-sanmar] Searching for: ${query}`);

    const username = Deno.env.get("SANMAR_USERNAME");
    const password = Deno.env.get("SANMAR_PASSWORD");
    const customerNumber = Deno.env.get("SANMAR_CUSTOMER_NUMBER") || "144250";

    if (!username || !password) {
      console.error("[provider-sanmar] Missing API credentials");
      return new Response(
        JSON.stringify({ error: "SanMar API credentials not configured", product: null }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: false,
    });

    const variants = generateQueryVariants(query);
    console.log(`[provider-sanmar] Query variants: ${variants.join(", ")}`);

    let productList: any[] = [];
    let matchedVariant = "";

    // Try each variant until we get a match
    for (const variant of variants) {
      try {
        console.log(`[provider-sanmar] Trying variant: ${variant}`);
        
        const soapRequest = buildProductInfoRequest(variant, customerNumber, username, password);
        
        const response = await fetch(PRODUCT_INFO_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": "",
          },
          body: soapRequest,
        });

        const xmlText = await response.text();
        
        if (!response.ok) {
          console.log(`[provider-sanmar] HTTP ${response.status} for variant ${variant}`);
          console.log(`[provider-sanmar] Response preview: ${xmlText.substring(0, 500)}`);
          continue;
        }
        
        // Check for SOAP fault
        if (xmlText.includes("Fault") || xmlText.includes("fault")) {
          console.log(`[provider-sanmar] SOAP fault for variant ${variant}`);
          continue;
        }
        
        const parsed = parseProductResponse(xmlText, parser);
        
        if (parsed && parsed.length > 0) {
          productList = parsed;
          matchedVariant = variant;
          console.log(`[provider-sanmar] Found ${productList.length} products with variant: ${variant}`);
          break;
        }
      } catch (err) {
        console.error(`[provider-sanmar] Error with variant ${variant}:`, err);
        continue;
      }
    }

    if (productList.length === 0) {
      console.log(`[provider-sanmar] No products found for query: ${query}`);
      return new Response(
        JSON.stringify({ product: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch inventory for the matched style with timeout
    console.log(`[provider-sanmar] Fetching inventory for: ${matchedVariant}`);
    
    let inventoryList: any[] = [];
    
    try {
      const invRequest = buildInventoryRequest(matchedVariant, customerNumber, username, password);
      
      // Use AbortController for timeout (5 seconds for inventory)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const invResponse = await fetch(INVENTORY_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": "",
        },
        body: invRequest,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      console.log(`[provider-sanmar] Inventory response status: ${invResponse.status}`);
      
      if (invResponse.ok) {
        const invXml = await invResponse.text();
        console.log(`[provider-sanmar] Inventory XML length: ${invXml.length}`);
        inventoryList = parseInventoryResponse(invXml, parser);
        console.log(`[provider-sanmar] Got ${inventoryList.length} inventory items`);
      } else {
        const errText = await invResponse.text();
        console.log(`[provider-sanmar] Inventory error: ${errText.substring(0, 300)}`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log("[provider-sanmar] Inventory request timed out");
      } else {
        console.error("[provider-sanmar] Inventory fetch error:", err);
      }
    }

    // Aggregate into normalized structure
    const standardProduct = aggregateProducts(productList, inventoryList);

    if (!standardProduct) {
      console.log(`[provider-sanmar] Failed to aggregate products`);
      return new Response(
        JSON.stringify({ product: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[provider-sanmar] Returning: ${standardProduct.brand} ${standardProduct.styleNumber} with ${standardProduct.colors.length} colors`);

    return new Response(
      JSON.stringify({ product: standardProduct }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[provider-sanmar] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
        product: null,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
