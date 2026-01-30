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

// SanMar warehouse mapping (from Integration Guide)
const WAREHOUSE_NAMES: Record<string, string> = {
  "1": "Seattle, WA",
  "2": "Cincinnati, OH",
  "3": "Dallas, TX",
  "4": "Reno, NV",
  "5": "Robbinsville, NJ",
  "6": "Jacksonville, FL",
  "7": "Minneapolis, MN",
  "10": "Seattle, WA",
  "12": "Phoenix, AZ",
  "31": "Richmond, VA",
  "80": "Cincinnati, OH",
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
  isCapped?: boolean; // True when quantity equals 3000 (SanMar cap)
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

// SanMar inventory cap constant
const SANMAR_INVENTORY_CAP = 3000;

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
  for (const { pattern } of BRAND_PATTERNS) {
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
 * Uses the SanMarWebServicePort endpoint with webservice namespace
 */
function buildInventoryRequest(
  style: string,
  customerNumber: string,
  username: string,
  password: string
): string {
  // SanMar inventory uses webservice namespace, not impl namespace
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
                  xmlns:web="http://webservice.integration.sanmar.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:getInventoryQtyForStyleColorSize>
      <arg0>${escapeXml(customerNumber)}</arg0>
      <arg1>${escapeXml(username)}</arg1>
      <arg2>${escapeXml(password)}</arg2>
      <arg3>${escapeXml(style)}</arg3>
    </web:getInventoryQtyForStyleColorSize>
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
    return items.map((item, idx) => {
      const basic = item.productBasicInfo || {};
      const price = item.productPriceInfo || {};
      const images = item.productImageInfo || {};
      
      // Debug: Log price structure for first item
      if (idx === 0) {
        console.log(`[provider-sanmar] Price info keys: ${Object.keys(price).join(", ")}`);
        console.log(`[provider-sanmar] Item keys: ${Object.keys(item).join(", ")}`);
        console.log(`[provider-sanmar] piecePrice: ${price.piecePrice}, item.customerPrice: ${item.customerPrice}`);
      }
      
      // PROGRAM PRICING: Extract the pricingArray and prioritize benefitPrice/contractPrice
      // for account-specific 1-piece tier pricing over generic customerPrice
      const pricingArray = price.pricingArray || item.pricingArray || price.programPricing || item.programPricing || [];
      const pricingList = Array.isArray(pricingArray) ? pricingArray : (pricingArray ? [pricingArray] : []);
      
      if (idx === 0 && pricingList.length > 0) {
        console.log(`[provider-sanmar] pricingArray has ${pricingList.length} entries, first keys: ${Object.keys(pricingList[0] || {}).join(", ")}`);
      }
      
      // Find the best program price (1-piece tier)
      let programPrice = "";
      for (const pricing of pricingList) {
        if (!pricing) continue;
        // Look for benefitPrice or contractPrice in each pricing tier
        const benefitPrice = pricing.benefitPrice || pricing.benefit || pricing.BenefitPrice || "";
        const contractPrice = pricing.contractPrice || pricing.contract || pricing.ContractPrice || "";
        const piecePrice = pricing.piecePrice || pricing.piece || pricing.PiecePrice || "";
        
        // Prioritize: benefitPrice > contractPrice > piecePrice
        if (benefitPrice && !programPrice) {
          programPrice = String(benefitPrice);
          console.log(`[provider-sanmar] Found benefitPrice: ${programPrice}`);
        } else if (contractPrice && !programPrice) {
          programPrice = String(contractPrice);
          console.log(`[provider-sanmar] Found contractPrice: ${programPrice}`);
        } else if (piecePrice && !programPrice) {
          programPrice = String(piecePrice);
        }
      }
      
      // Also check direct fields on price object for program pricing
      if (!programPrice && (price.benefitPrice || price.BenefitPrice)) {
        programPrice = String(price.benefitPrice || price.BenefitPrice);
        console.log(`[provider-sanmar] Found direct benefitPrice: ${programPrice}`);
      }
      if (!programPrice && (price.contractPrice || price.ContractPrice)) {
        programPrice = String(price.contractPrice || price.ContractPrice);
        console.log(`[provider-sanmar] Found direct contractPrice: ${programPrice}`);
      }
      
      // CRITICAL: Use piecePrice as the primary price source 
      // SanMar's piecePrice is the 1-piece wholesale rate which reflects program pricing better
      // than the generic customerPrice field
      const finalPrice = programPrice || 
        price.piecePrice || item.piecePrice ||
        price.customerPrice || item.customerPrice || "";
      
      if (idx === 0) {
        console.log(`[provider-sanmar] Final price: ${finalPrice} (program: ${programPrice || "none"})`);
      }
      
      return {
        // Basic info
        style: basic.style || item.style || "",
        styleCode: basic.styleCode || item.styleCode || basic.style || item.style || "",
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
        
        // Price info - CRITICAL: Use program pricing for account-specific rates
        customerPrice: finalPrice,
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
 * STRICT FILTERING: Filter products to only those matching exact styleCode
 * Safely handles non-string values (objects, numbers, etc.)
 */
function filterByExactStyle(products: any[], targetStyle: string): any[] {
  const normalizedTarget = targetStyle.toUpperCase().trim();
  
  const filtered = products.filter(p => {
    // Safely extract style - handle objects, numbers, nulls gracefully
    let styleVal = p.style ?? p.styleCode ?? "";
    
    // If it's an object, try to get a string from it
    if (typeof styleVal === "object" && styleVal !== null) {
      styleVal = styleVal["#text"] || styleVal.value || styleVal.toString?.() || "";
    }
    
    // Convert to string and normalize
    const productStyle = String(styleVal).toUpperCase().trim();
    return productStyle === normalizedTarget;
  });
  
  console.log(`[provider-sanmar] Strict filter: ${products.length} -> ${filtered.length} products (target: ${normalizedTarget})`);
  
  return filtered;
}

/**
 * Parse inventory from SOAP response - handles multiple SanMar response formats
 */
function parseInventoryResponse(xmlData: string, parser: XMLParser): any[] {
  try {
    const result = parser.parse(xmlData);
    
    // Log top-level keys to understand structure
    console.log(`[provider-sanmar] Inventory XML top keys: ${Object.keys(result).join(", ")}`);
    
    const envelope = result["S:Envelope"] || result["soap:Envelope"] || result["soapenv:Envelope"] || result.Envelope;
    if (!envelope) {
      console.log("[provider-sanmar] Inventory: No envelope found");
      return [];
    }
    
    console.log(`[provider-sanmar] Inventory envelope keys: ${Object.keys(envelope).join(", ")}`);
    
    const body = envelope["S:Body"] || envelope["soap:Body"] || envelope["soapenv:Body"] || envelope.Body;
    if (!body) {
      console.log("[provider-sanmar] Inventory: No body found");
      return [];
    }
    
    console.log(`[provider-sanmar] Inventory body keys: ${Object.keys(body).join(", ")}`);
    
    // Find the response element - may have ns2: prefix
    const responseKey = Object.keys(body).find(k => 
      k.includes("getInventoryQtyForStyleColorSizeResponse") || 
      k.includes("Inventory")
    );
    
    if (!responseKey) {
      console.log("[provider-sanmar] Inventory: No response element found in body");
      return [];
    }
    
    console.log(`[provider-sanmar] Inventory response key: ${responseKey}`);
    const response = body[responseKey];
    console.log(`[provider-sanmar] Inventory response keys: ${Object.keys(response || {}).join(", ")}`);
    
    // Handle 'return' which may be an array directly or contain listResponse
    const returnVal = response?.return;
    
    if (!returnVal) {
      console.log("[provider-sanmar] Inventory: No return value");
      return [];
    }
    
    console.log(`[provider-sanmar] Inventory return type: ${Array.isArray(returnVal) ? 'array' : typeof returnVal}`);
    
    // SanMar may return the inventory items directly in 'return' as an array
    if (Array.isArray(returnVal)) {
      console.log(`[provider-sanmar] Inventory: Direct array with ${returnVal.length} items`);
      if (returnVal.length > 0) {
        console.log(`[provider-sanmar] First item keys: ${Object.keys(returnVal[0]).join(", ")}`);
      }
      return returnVal;
    }
    
    // Or it may wrap them in an object
    console.log(`[provider-sanmar] Return object keys: ${Object.keys(returnVal).join(", ")}`);
    
    if (returnVal.errorOccurred === true || returnVal.errorOccurred === "true" || 
        returnVal.errorOccured === true || returnVal.errorOccured === "true") {
      console.log(`[provider-sanmar] Inventory: Error - ${returnVal.message}`);
      return [];
    }
    
    // SanMar uses 'response' field (not 'listResponse') for inventory data
    const inventoryResponse = returnVal.response || returnVal.listResponse;
    if (inventoryResponse) {
      const items = Array.isArray(inventoryResponse) ? inventoryResponse : [inventoryResponse];
      console.log(`[provider-sanmar] Inventory: response field with ${items.length} items`);
      if (items.length > 0) {
        console.log(`[provider-sanmar] First inv item keys: ${Object.keys(items[0]).join(", ")}`);
        
        // SanMar returns: { style: "PC61", skus: { sku: [ ...inventory SKUs... ] } }
        // We need to extract the skus.sku array
        const firstItem = items[0];
        if (firstItem.skus) {
          // Handle nested structure: skus.sku contains the actual array
          const skusObj = firstItem.skus;
          const skuArray = skusObj.sku || skusObj;
          const skus = Array.isArray(skuArray) ? skuArray : [skuArray];
          console.log(`[provider-sanmar] Inventory: Extracted ${skus.length} SKUs from nested structure`);
          if (skus.length > 0 && skus[0]) {
            console.log(`[provider-sanmar] SKU item keys: ${Object.keys(skus[0]).join(", ")}`);
          }
          return skus;
        }
      }
      return items;
    }
    
    console.log("[provider-sanmar] Inventory: No listResponse found");
    return [];
  } catch (error) {
    console.error("[provider-sanmar] Error parsing inventory response:", error);
    return [];
  }
}

/**
 * Inventory data with cap flag
 */
interface WarehouseInventory {
  quantity: number;
  isCapped: boolean;
}

/**
 * Build inventory lookup map from inventory response
 * Key format: "catalogColor|size" -> Map of warehouseCode -> { quantity, isCapped }
 * CRITICAL: Sums ALL warehouse quantities for complete inventory visibility
 * CRITICAL: Flags quantities at exactly 3000 as capped (SanMar API limit)
 * 
 * SanMar SKU structure: { color: "White", size: "M", whse: [...warehouse data...] }
 */
function buildInventoryMap(inventoryList: any[]): Map<string, Map<string, WarehouseInventory>> {
  const inventoryMap = new Map<string, Map<string, WarehouseInventory>>();
  
  // Log first item for debugging
  if (inventoryList.length > 0) {
    const sample = inventoryList[0];
    console.log(`[provider-sanmar] Sample SKU: color=${sample.color}, size=${sample.size}, whse type=${typeof sample.whse}, whse is array=${Array.isArray(sample.whse)}`);
    if (sample.whse) {
      const whseArr = Array.isArray(sample.whse) ? sample.whse : [sample.whse];
      if (whseArr[0]) {
        console.log(`[provider-sanmar] Warehouse item keys: ${Object.keys(whseArr[0]).join(", ")}`);
      }
    }
  }
  
  for (const inv of inventoryList) {
    // SanMar uses 'color' field for the catalog color name
    const catalogColor = (inv.color || inv.catalogColor || "").toString().trim();
    const size = (inv.size || "").toString().trim();
    const key = `${catalogColor}|${size}`;
    
    if (!inventoryMap.has(key)) {
      inventoryMap.set(key, new Map());
    }
    
    const warehouseMap = inventoryMap.get(key)!;
    
    // Helper to add inventory with cap detection
    const addInventory = (whCode: string, qty: number) => {
      if (!whCode || qty <= 0) return;
      
      const isCapped = qty === SANMAR_INVENTORY_CAP;
      const existing = warehouseMap.get(whCode);
      
      if (existing) {
        // Sum quantities and mark as capped if either entry was capped
        warehouseMap.set(whCode, {
          quantity: existing.quantity + qty,
          isCapped: existing.isCapped || isCapped
        });
      } else {
        warehouseMap.set(whCode, { quantity: qty, isCapped });
      }
    };
    
    // Handle SanMar's 'whse' field - array of warehouse inventory
    const whseData = inv.whse;
    if (whseData) {
      const whseArray = Array.isArray(whseData) ? whseData : [whseData];
      for (const wh of whseArray) {
        // SanMar uses whseID for warehouse identifier and qty for quantity
        const whCode = String(wh.whseID || wh.whseNo || wh.warehouseNo || wh.whseCode || wh.warehouse || wh.whse || "");
        const qty = parseInt(String(wh.qty || wh.quantity || wh.inventoryQty || wh.avail || "0"), 10);
        addInventory(whCode, qty);
      }
    }
    
    // Handle direct warehouse fields as fallback
    const directWhseNo = inv.whseNo || inv.warehouseNo || inv.warehouseCode;
    const directQty = inv.qty || inv.quantity || inv.inventoryQty;
    
    if (directWhseNo !== undefined && directQty !== undefined) {
      const whCode = String(directWhseNo);
      const qty = parseInt(String(directQty), 10) || 0;
      addInventory(whCode, qty);
    }
    
    // Handle nested quantities array
    const quantities = inv.quantities || inv.inventoryList || inv.inventory || inv.warehouseInventory;
    if (quantities) {
      const qtyArray = Array.isArray(quantities) ? quantities : [quantities];
      for (const qItem of qtyArray) {
        const whCode = String(qItem.whseNo || qItem.warehouseNo || qItem.warehouseCode || qItem.warehouse || "");
        const qty = parseInt(String(qItem.qty || qItem.quantity || qItem.inventoryQty || "0"), 10);
        addInventory(whCode, qty);
      }
    }
  }
  
  // Log inventory totals for debugging
  let totalInventoryItems = 0;
  let cappedCount = 0;
  for (const [key, whMap] of inventoryMap) {
    for (const inv of whMap.values()) {
      totalInventoryItems += inv.quantity;
      if (inv.isCapped) cappedCount++;
    }
  }
  console.log(`[provider-sanmar] Built inventory map with ${inventoryMap.size} color/size combinations, total qty: ${totalInventoryItems}, capped entries: ${cappedCount}`);
  
  return inventoryMap;
}

/**
 * Aggregate products into normalized structure with colors
 * Uses program pricing (benefitPrice/contractPrice) and sums all warehouse inventory
 * Passes through isCapped flag for 3,000+ display in UI
 */
function aggregateProducts(
  productList: any[],
  inventoryMap: Map<string, Map<string, WarehouseInventory>>
): StandardProduct | null {
  if (!productList || productList.length === 0) return null;
  
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
      inventory: Map<string, WarehouseInventory>;
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
      // CRITICAL: Use customerPrice which now contains program pricing
      const price = parseFloat(product.customerPrice || product.piecePrice || "0");
      
      // Log first few price assignments to diagnose
      if (colorMap.size <= 2 && colorEntry.sizesMap.size === 0) {
        console.log(`[provider-sanmar] Price for ${colorName}/${sizeName}: ${price} (raw: ${product.customerPrice}, piecePrice: ${product.piecePrice})`);
      }
      
      colorEntry.sizesMap.set(sizeName, {
        code: sizeName,
        order: getSizeOrder(sizeName),
        price: price,
        inventory: new Map(),
      });
    }
    
    const sizeEntry = colorEntry.sizesMap.get(sizeName)!;
    
    // Get inventory from our pre-built lookup map (now with cap info)
    const invKey = `${catalogColor}|${sizeName}`;
    const invForKey = inventoryMap.get(invKey);
    if (invForKey) {
      for (const [whCode, invData] of invForKey) {
        // Merge inventory, preserving cap flags
        const existing = sizeEntry.inventory.get(whCode);
        if (existing) {
          sizeEntry.inventory.set(whCode, {
            quantity: existing.quantity + invData.quantity,
            isCapped: existing.isCapped || invData.isCapped
          });
        } else {
          sizeEntry.inventory.set(whCode, { ...invData });
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
          .map(([code, invData]) => ({
            warehouseCode: code,
            warehouseName: WAREHOUSE_NAMES[code] || `Warehouse ${code}`,
            quantity: invData.quantity,
            isCapped: invData.isCapped,
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
  
  // Calculate total inventory for logging
  let totalStock = 0;
  for (const color of colors) {
    for (const size of color.sizes) {
      for (const inv of size.inventory) {
        totalStock += inv.quantity;
      }
    }
  }
  
  console.log(`[provider-sanmar] Aggregated: ${colors.length} colors, total stock: ${totalStock}`);
  
  return {
    styleNumber: firstProduct.style || firstProduct.styleCode || "",
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
        
        // 5-second timeout for product info
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(PRODUCT_INFO_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": "",
          },
          body: soapRequest,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const xmlText = await response.text();
        
        if (!response.ok) {
          console.log(`[provider-sanmar] HTTP ${response.status} for variant ${variant}`);
          continue;
        }
        
        // Check for SOAP fault
        if (xmlText.includes("Fault") || xmlText.includes("fault")) {
          console.log(`[provider-sanmar] SOAP fault for variant ${variant}`);
          continue;
        }
        
        const parsed = parseProductResponse(xmlText, parser);
        
        if (parsed && parsed.length > 0) {
          // STRICT FILTERING: Only keep products with exact style match
          const filtered = filterByExactStyle(parsed, variant);
          
          if (filtered.length > 0) {
            productList = filtered;
            matchedVariant = variant;
            console.log(`[provider-sanmar] Found ${productList.length} products with exact match: ${variant}`);
            break;
          } else {
            console.log(`[provider-sanmar] No exact style match for variant ${variant} (had ${parsed.length} results)`);
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log(`[provider-sanmar] Timeout for variant ${variant}`);
        } else {
          console.error(`[provider-sanmar] Error with variant ${variant}:`, err);
        }
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
      
      // 5-second timeout for inventory
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
        
        // Log a sample of the XML for debugging inventory structure
        if (invXml.length > 0 && invXml.length < 5000) {
          console.log(`[provider-sanmar] Inventory XML sample: ${invXml.substring(0, 1000)}`);
        }
        
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

    // Build inventory map with summed warehouse quantities
    const inventoryMap = buildInventoryMap(inventoryList);

    // Aggregate into normalized structure
    const standardProduct = aggregateProducts(productList, inventoryMap);

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
