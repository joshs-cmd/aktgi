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
const PROMOSTANDARDS_PRICING_ENDPOINT = "https://ws.sanmar.com:8080/promostandards/PricingAndConfigurationServiceBinding";

// SanMar warehouse mapping
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

// Size order mapping
const SIZE_ORDER: Record<string, number> = {
  XS: 1, S: 2, M: 3, L: 4, XL: 5,
  "2XL": 6, "3XL": 7, "4XL": 8, "5XL": 9, "6XL": 10,
  "2X": 6, "3X": 7, "4X": 8, "5X": 9, "6X": 10,
  XXL: 6, XXXL: 7, XXXXL: 8,
  OSFA: 50, OS: 50, "ONE SIZE": 50,
};

// Brand patterns for fuzzy matching
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
  isCapped?: boolean;
}

interface StandardSize {
  code: string;
  order: number;
  price: number;
  isProgramPrice?: boolean;
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

const SANMAR_INVENTORY_CAP = 3000;

function getSizeOrder(sizeCode: string): number {
  const normalized = sizeCode.toUpperCase().trim();
  if (SIZE_ORDER[normalized]) return SIZE_ORDER[normalized];
  if (normalized === "XXL") return SIZE_ORDER["2XL"];
  if (normalized === "XXXL") return SIZE_ORDER["3XL"];
  return 99;
}

function generateQueryVariants(query: string): string[] {
  const variants: string[] = [];
  const trimmed = query.trim();
  
  variants.push(trimmed);
  
  if (trimmed !== trimmed.toUpperCase()) {
    variants.push(trimmed.toUpperCase());
  }
  
  for (const { pattern } of BRAND_PATTERNS) {
    const match = trimmed.toLowerCase().match(pattern);
    if (match) {
      const suffix = match[2].trim();
      if (suffix && !variants.includes(suffix.toUpperCase())) {
        variants.push(suffix.toUpperCase());
      }
      break;
    }
  }
  
  const alphaNumMatch = trimmed.match(/^([a-zA-Z]+)(\d+)$/);
  if (alphaNumMatch) {
    const formatted = `${alphaNumMatch[1].toUpperCase()}${alphaNumMatch[2]}`;
    if (!variants.includes(formatted)) {
      variants.push(formatted);
    }
  }
  
  if (trimmed.includes(" ")) {
    const parts = trimmed.split(/\s+/);
    const lastPart = parts[parts.length - 1].toUpperCase();
    if (!variants.includes(lastPart)) {
      variants.push(lastPart);
    }
  }
  
  return variants;
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
 * Build SOAP request for getProductInfoByStyleColorSize
 * This returns product info INCLUDING pricing (benefitPrice/contractPrice if account is enrolled)
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
 * Build PromoStandards getPricingAndConfiguration request for customer-specific pricing.
 * priceType="Customer" returns negotiated account rates.
 */
function buildPricingRequest(
  style: string,
  customerNumber: string,
  username: string,
  password: string
): string {
  // PromoStandards PricingAndConfiguration v2.0.0
  // Operation: GetConfigurationAndPricing  (note: Config BEFORE Pricing in operation name)
  // Namespace: http://www.promostandards.org/WSDL/PricingAndConfiguration/2.0.0/
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/PricingAndConfiguration/2.0.0/"
                  xmlns:shar="http://www.promostandards.org/WSDL/PricingAndConfiguration/2.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:GetConfigurationAndPricingRequest>
      <shar:wsVersion>2.0.0</shar:wsVersion>
      <shar:id>${escapeXml(username)}</shar:id>
      <shar:password>${escapeXml(password)}</shar:password>
      <shar:productId>${escapeXml(style)}</shar:productId>
      <shar:currency>USD</shar:currency>
      <shar:fobId>1</shar:fobId>
      <shar:priceType>Customer</shar:priceType>
      <shar:localizationCountry>US</shar:localizationCountry>
      <shar:localizationLanguage>en</shar:localizationLanguage>
      <shar:configurationType>Blank</shar:configurationType>
    </ns:GetConfigurationAndPricingRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Fetch customer-specific pricing from SanMar's PromoStandards endpoint.
 * Returns a map of sizeCode -> price for priceType="Customer".
 */
async function fetchCustomerPricing(
  style: string,
  customerNumber: string,
  username: string,
  password: string,
  parser: XMLParser
): Promise<{ priceMap: Map<string, number>; debugXml: string }> {
  const priceMap = new Map<string, number>();
  let debugXml = "";
  try {
    const body = buildPricingRequest(style, customerNumber, username, password);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(PROMOSTANDARDS_PRICING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": "" },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      debugXml = `DEBUG ERROR: HTTP ${response.status} from PromoStandards endpoint`;
      console.log(`[provider-sanmar] PromoStandards pricing HTTP ${response.status}`);
      return { priceMap, debugXml };
    }

    const xmlText = await response.text();
    debugXml = "DEBUG PROMO: " + xmlText.substring(0, 800);
    console.log(`[provider-sanmar] PromoStandards pricing XML length: ${xmlText.length}`);

    const result = parser.parse(xmlText);
    const envelope = result["soapenv:Envelope"] || result["S:Envelope"] || result["soap:Envelope"] || result.Envelope;
    const bodyEl = envelope?.["soapenv:Body"] || envelope?.["S:Body"] || envelope?.["soap:Body"] || envelope?.Body;
    if (!bodyEl) return priceMap;

    const respKey = Object.keys(bodyEl).find(k => k.toLowerCase().includes("pricingandconfiguration"));
    if (!respKey) {
      console.log(`[provider-sanmar] PromoStandards: no pricing response key, keys=${Object.keys(bodyEl).join(", ")}`);
      return priceMap;
    }

    const resp = bodyEl[respKey];
    // Navigate into Configuration > Part > PartPriceArray > PartPrice
    const configuration = resp?.Configuration || resp?.["ns2:Configuration"] || resp?.configuration;
    const parts = configuration?.Part || configuration?.part;
    if (!parts) {
      console.log(`[provider-sanmar] PromoStandards: no Part in Configuration`);
      return priceMap;
    }

    const partArray = Array.isArray(parts) ? parts : [parts];
    for (const part of partArray) {
      const partId = String(part?.partId || part?.PartId || "").toUpperCase().trim();
      const priceArrays = part?.PartPriceArray || part?.partPriceArray;
      if (!priceArrays) continue;

      const prices = priceArrays?.PartPrice || priceArrays?.partPrice;
      if (!prices) continue;

      const priceList = Array.isArray(prices) ? prices : [prices];
      // Take the first (qty=1) price
      for (const p of priceList) {
        const minQty = parseFloat(String(p?.minQuantity || p?.MinQuantity || "0"));
        if (minQty <= 1 || !priceMap.has(partId)) {
          const price = parseFloat(String(p?.price || p?.Price || p?.unitPrice || "0"));
          if (price > 0) {
            priceMap.set(partId, price);
          }
        }
      }
    }

    console.log(`[provider-sanmar] PromoStandards customer pricing: ${priceMap.size} size prices found`);
    if (priceMap.size > 0) {
      const sample = Array.from(priceMap.entries()).slice(0, 3).map(([k, v]) => `${k}=$${v}`).join(", ");
      console.log(`[provider-sanmar] Sample customer prices: ${sample}`);
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      debugXml = "DEBUG ERROR: PromoStandards request timed out after 5s";
      console.log("[provider-sanmar] PromoStandards pricing timed out");
    } else {
      debugXml = `DEBUG ERROR: ${err.message || String(err)}`;
      console.error("[provider-sanmar] PromoStandards pricing error:", err);
    }
  }
  return { priceMap, debugXml };
}

/**
 * Build SOAP request for getInventoryQtyForStyleColorSize
 */
function buildInventoryRequest(
  style: string,
  customerNumber: string,
  username: string,
  password: string
): string {
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

/**
 * Deep search for any pricing-related fields in an object
 * Returns all fields that look like prices
 */
function findAllPriceFields(obj: any, prefix = ""): Record<string, any> {
  const priceFields: Record<string, any> = {};
  
  if (!obj || typeof obj !== 'object') return priceFields;
  
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const lowerKey = key.toLowerCase();
    
    // Check if this looks like a price field
    if (lowerKey.includes('price') || 
        lowerKey.includes('cost') || 
        lowerKey.includes('benefit') || 
        lowerKey.includes('contract') ||
        lowerKey.includes('rate') ||
        lowerKey.includes('tier') ||
        lowerKey.includes('program')) {
      priceFields[fullKey] = value;
    }
    
    // Recurse into nested objects (but not arrays of many items)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(priceFields, findAllPriceFields(value, fullKey));
    }
  }
  
  return priceFields;
}

/**
 * Parse product info from SOAP response
 * IMPORTANT: This extracts ALL pricing fields and prioritizes benefitPrice/contractPrice
 */
function parseProductResponse(xmlData: string, parser: XMLParser, logRaw = false, customerPricingMap: Map<string, number> = new Map()): any[] {
  try {
    // Log a sample of raw XML to understand structure
    if (logRaw) {
      console.log(`[provider-sanmar] ===== RAW getProductInfo XML (first 2000 chars) =====`);
      console.log(xmlData.substring(0, 2000));
      console.log(`[provider-sanmar] ===== END RAW XML (total: ${xmlData.length} chars) =====`);
    }
    
    const result = parser.parse(xmlData);
    
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
    
    if (returnVal.errorOccured === true || returnVal.errorOccured === "true") {
      console.log(`[provider-sanmar] Error in response: ${returnVal.message}`);
      return [];
    }
    
    const listResponse = returnVal.listResponse;
    if (!listResponse) {
      console.log("[provider-sanmar] No listResponse found");
      return [];
    }
    
    const items = Array.isArray(listResponse) ? listResponse : [listResponse];
    
    // Debug: Log ALL price-related fields in first item to discover benefitPrice location
    if (items.length > 0) {
      const firstItem = items[0];
      const allPriceFields = findAllPriceFields(firstItem);
      console.log(`[provider-sanmar] ALL price-related fields in first item:`);
      console.log(JSON.stringify(allPriceFields, null, 2));
      
      // Also log the full structure of productPriceInfo
      if (firstItem.productPriceInfo) {
        console.log(`[provider-sanmar] Full productPriceInfo structure:`);
        console.log(JSON.stringify(firstItem.productPriceInfo, null, 2).substring(0, 1500));
      }
    }
    
    return items.map((item, idx) => {
      const basic = item.productBasicInfo || {};
      const price = item.productPriceInfo || {};
      const images = item.productImageInfo || {};
      
      // Extract ALL possible price fields to find benefitPrice/contractPrice
      // Priority order: benefitPrice > contractPrice > customerPrice > piecePrice
      
      // Check direct fields
      let benefitPrice = parseFloat(price.benefitPrice || price.BenefitPrice || item.benefitPrice || "") || null;
      let contractPrice = parseFloat(price.contractPrice || price.ContractPrice || item.contractPrice || "") || null;
      let piecePrice = parseFloat(price.piecePrice || price.PiecePrice || item.piecePrice || "") || null;
      let listPrice = parseFloat(price.listPrice || price.ListPrice || item.listPrice || "") || null;

      // Inject customer-specific price from PromoStandards endpoint (priceType="Customer")
      // The partId in PromoStandards corresponds to the size code (e.g., "S", "M", "XL")
      const sizeCode = (basic.size || item.size || "").toString().toUpperCase().trim();
      let customerPrice: number | null = null;
      if (customerPricingMap.size > 0) {
        customerPrice = customerPricingMap.get(sizeCode) || customerPricingMap.get(sizeCode.replace("XL", "EXL")) || null;
        // Fallback: if size not found, use the smallest size price as a baseline
        if (!customerPrice && idx === 0) {
          const firstVal = Array.from(customerPricingMap.values())[0];
          if (firstVal) customerPrice = firstVal;
        }
      }
      if (!customerPrice) {
        customerPrice = parseFloat(price.customerPrice || price.CustomerPrice || item.customerPrice || "") || null;
      }
      
      // Check nested pricingArray/programPricing for tiered pricing
      const pricingArrays = [
        price.pricingArray,
        price.programPricing,
        price.tierPricing,
        item.pricingArray,
        item.programPricing,
        item.customerPricing
      ].filter(Boolean);
      
      for (const pricingData of pricingArrays) {
        const pricingList = Array.isArray(pricingData) ? pricingData : [pricingData];
        for (const tier of pricingList) {
          if (!tier) continue;
          
          // Check for benefit/contract in each tier
          if (!benefitPrice && tier.benefitPrice) {
            benefitPrice = parseFloat(tier.benefitPrice) || null;
          }
          if (!contractPrice && tier.contractPrice) {
            contractPrice = parseFloat(tier.contractPrice) || null;
          }
        }
      }
      
      // Determine final price and whether it's a program price
      // Priority order per SanMar docs:
      //   benefitPrice (program enrolled) > contractPrice (contract enrolled) >
      //   customerPrice (account-specific "Customer" rate) > piecePrice (standard net) > listPrice
      let finalPrice = 0;
      let isProgramPrice = false;
      
      if (benefitPrice && benefitPrice > 0) {
        finalPrice = benefitPrice;
        isProgramPrice = true;
        if (idx === 0) console.log(`[provider-sanmar] Using BENEFIT price: $${benefitPrice}`);
      } else if (contractPrice && contractPrice > 0) {
        finalPrice = contractPrice;
        isProgramPrice = true;
        if (idx === 0) console.log(`[provider-sanmar] Using CONTRACT price: $${contractPrice}`);
      } else if (customerPrice && customerPrice > 0) {
        // "Customer" price — account-specific negotiated rate; preferred over piece price
        finalPrice = customerPrice;
        if (idx === 0) console.log(`[provider-sanmar] Using CUSTOMER price: $${customerPrice}`);
      } else if (piecePrice && piecePrice > 0) {
        finalPrice = piecePrice;
        if (idx === 0) console.log(`[provider-sanmar] Using PIECE price: $${piecePrice}`);
      } else if (listPrice && listPrice > 0) {
        finalPrice = listPrice;
        if (idx === 0) console.log(`[provider-sanmar] Using LIST price: $${listPrice}`);
      }
      
      if (idx === 0) {
        console.log(`[provider-sanmar] Price summary: benefit=${benefitPrice}, contract=${contractPrice}, piece=${piecePrice}, customer=${customerPrice}, list=${listPrice}, FINAL=$${finalPrice}, isProgramPrice=${isProgramPrice}`);
      }
      
      return {
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
        
        // Store pricing info
        finalPrice: finalPrice,
        isProgramPrice: isProgramPrice,
        benefitPrice: benefitPrice,
        contractPrice: contractPrice,
        piecePrice: piecePrice,
        customerPrice: customerPrice,
        listPrice: listPrice,
        
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

function filterByExactStyle(products: any[], targetStyle: string): any[] {
  const normalizedTarget = targetStyle.toUpperCase().trim();
  
  const filtered = products.filter(p => {
    let styleVal = p.style ?? p.styleCode ?? "";
    
    if (typeof styleVal === "object" && styleVal !== null) {
      styleVal = styleVal["#text"] || styleVal.value || styleVal.toString?.() || "";
    }
    
    const productStyle = String(styleVal).toUpperCase().trim();
    return productStyle === normalizedTarget;
  });
  
  console.log(`[provider-sanmar] Strict filter: ${products.length} -> ${filtered.length} products (target: ${normalizedTarget})`);
  
  return filtered;
}

function parseInventoryResponse(xmlData: string, parser: XMLParser): any[] {
  try {
    const result = parser.parse(xmlData);
    
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
    
    const returnVal = response?.return;
    
    if (!returnVal) {
      console.log("[provider-sanmar] Inventory: No return value");
      return [];
    }
    
    console.log(`[provider-sanmar] Inventory return type: ${Array.isArray(returnVal) ? 'array' : typeof returnVal}`);
    
    if (Array.isArray(returnVal)) {
      console.log(`[provider-sanmar] Inventory: Direct array with ${returnVal.length} items`);
      if (returnVal.length > 0) {
        console.log(`[provider-sanmar] First item keys: ${Object.keys(returnVal[0]).join(", ")}`);
      }
      return returnVal;
    }
    
    console.log(`[provider-sanmar] Return object keys: ${Object.keys(returnVal).join(", ")}`);
    
    if (returnVal.errorOccurred === true || returnVal.errorOccurred === "true" || 
        returnVal.errorOccured === true || returnVal.errorOccured === "true") {
      console.log(`[provider-sanmar] Inventory: Error - ${returnVal.message}`);
      return [];
    }
    
    const inventoryResponse = returnVal.response || returnVal.listResponse;
    if (inventoryResponse) {
      const items = Array.isArray(inventoryResponse) ? inventoryResponse : [inventoryResponse];
      console.log(`[provider-sanmar] Inventory: response field with ${items.length} items`);
      if (items.length > 0) {
        console.log(`[provider-sanmar] First inv item keys: ${Object.keys(items[0]).join(", ")}`);
        
        const firstItem = items[0];
        if (firstItem.skus) {
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

interface WarehouseInventory {
  quantity: number;
  isCapped: boolean;
}

function buildInventoryMap(inventoryList: any[]): Map<string, Map<string, WarehouseInventory>> {
  const inventoryMap = new Map<string, Map<string, WarehouseInventory>>();
  
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
    const catalogColor = (inv.color || inv.catalogColor || "").toString().trim();
    const size = (inv.size || "").toString().trim();
    const key = `${catalogColor}|${size}`;
    
    if (!inventoryMap.has(key)) {
      inventoryMap.set(key, new Map());
    }
    
    const warehouseMap = inventoryMap.get(key)!;
    
    const addInventory = (whCode: string, qty: number) => {
      if (!whCode || qty <= 0) return;
      
      const isCapped = qty === SANMAR_INVENTORY_CAP;
      const existing = warehouseMap.get(whCode);
      
      if (existing) {
        warehouseMap.set(whCode, {
          quantity: existing.quantity + qty,
          isCapped: existing.isCapped || isCapped
        });
      } else {
        warehouseMap.set(whCode, { quantity: qty, isCapped });
      }
    };
    
    const whseData = inv.whse;
    if (whseData) {
      const whseArray = Array.isArray(whseData) ? whseData : [whseData];
      for (const wh of whseArray) {
        const whCode = String(wh.whseID || wh.whseNo || wh.warehouseNo || wh.whseCode || wh.warehouse || wh.whse || "");
        const qty = parseInt(String(wh.qty || wh.quantity || wh.inventoryQty || wh.avail || "0"), 10);
        addInventory(whCode, qty);
      }
    }
    
    const directWhseNo = inv.whseNo || inv.warehouseNo || inv.warehouseCode;
    const directQty = inv.qty || inv.quantity || inv.inventoryQty;
    
    if (directWhseNo !== undefined && directQty !== undefined) {
      const whCode = String(directWhseNo);
      const qty = parseInt(String(directQty), 10) || 0;
      addInventory(whCode, qty);
    }
    
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
 * Uses pricing extracted from product info (benefitPrice > contractPrice > piecePrice)
 */
function aggregateProducts(
  productList: any[],
  inventoryMap: Map<string, Map<string, WarehouseInventory>>
): StandardProduct | null {
  if (!productList || productList.length === 0) return null;
  
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
      isProgramPrice: boolean;
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
        hexCode: null,
        swatchUrl: product.colorSquareImage || product.colorSwatchImage || null,
        imageUrl: product.colorProductImage || product.productImage || null,
        sizesMap: new Map(),
      });
    }
    
    const colorEntry = colorMap.get(colorName)!;
    const sizeName = (product.size || "OS").trim();
    
    if (!colorEntry.sizesMap.has(sizeName)) {
      // Use pre-extracted pricing from parseProductResponse
      const finalPrice = product.finalPrice || 0;
      const isProgramPrice = product.isProgramPrice || false;
      
      colorEntry.sizesMap.set(sizeName, {
        code: sizeName,
        order: getSizeOrder(sizeName),
        price: finalPrice,
        isProgramPrice: isProgramPrice,
        inventory: new Map(),
      });
    }
    
    const sizeEntry = colorEntry.sizesMap.get(sizeName)!;
    
    const invKey = `${catalogColor}|${sizeName}`;
    const invForKey = inventoryMap.get(invKey);
    if (invForKey) {
      for (const [whCode, invData] of invForKey) {
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
  
  const colors: StandardColor[] = Array.from(colorMap.entries()).map(([_, colorData]) => {
    const sizes: StandardSize[] = Array.from(colorData.sizesMap.values())
      .map((sizeData) => ({
        code: sizeData.code,
        order: sizeData.order,
        price: sizeData.price,
        isProgramPrice: sizeData.isProgramPrice,
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
  
  // Log pricing summary
  let programPriceCount = 0;
  let totalPrices = 0;
  let totalStock = 0;
  for (const color of colors) {
    for (const size of color.sizes) {
      totalPrices++;
      if (size.isProgramPrice) programPriceCount++;
      for (const inv of size.inventory) {
        totalStock += inv.quantity;
      }
    }
  }
  
  console.log(`[provider-sanmar] Aggregated: ${colors.length} colors, ${programPriceCount}/${totalPrices} with program pricing, total stock: ${totalStock}`);
  
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

    if (!query || typeof query !== "string" || query.length > 100 || !/^[a-zA-Z0-9\s\-\+\&\.]+$/.test(query)) {
      return new Response(
        JSON.stringify({ error: "Invalid query format" }),
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
        JSON.stringify({ error: "Service temporarily unavailable", product: null }),
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
    let isFirstVariant = true;

    // Fetch customer-specific pricing from PromoStandards in parallel with product info loop
    // We kick this off early using the first variant (most likely the style number)
    const firstVariant = variants[0];
    let promoDebugXml = "";
    const customerPricingPromise = fetchCustomerPricing(firstVariant, customerNumber, username, password, parser);

    // Get product info using getProductInfoByStyleColorSize
    for (const variant of variants) {
      try {
        console.log(`[provider-sanmar] Trying variant: ${variant}`);
        
        const soapRequest = buildProductInfoRequest(variant, customerNumber, username, password);
        
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
        
        if (xmlText.includes("Fault") || xmlText.includes("fault")) {
          console.log(`[provider-sanmar] SOAP fault for variant ${variant}`);
          continue;
        }
        
        // Log raw XML for first variant to debug pricing structure
        // Await the customer pricing map (resolved by now since product info takes ~2s)
        const { priceMap: customerPricingMap, debugXml: promoXml } = isFirstVariant ? await customerPricingPromise : { priceMap: new Map<string, number>(), debugXml: "" };
        if (isFirstVariant) promoDebugXml = promoXml;
        const parsed = parseProductResponse(xmlText, parser, isFirstVariant, customerPricingMap);
        isFirstVariant = false;
        
        if (parsed && parsed.length > 0) {
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

    // Fetch inventory
    console.log(`[provider-sanmar] Fetching inventory for: ${matchedVariant}`);
    
    let inventoryList: any[] = [];
    
    try {
      const invRequest = buildInventoryRequest(matchedVariant, customerNumber, username, password);
      
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

    // Build inventory map
    const inventoryMap = buildInventoryMap(inventoryList);

    // Aggregate into normalized structure
    const standardProduct = aggregateProducts(productList, inventoryMap) as any;

    if (!standardProduct) {
      console.log(`[provider-sanmar] Failed to aggregate products`);
      return new Response(
        JSON.stringify({ product: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // DEBUG: Inject raw PromoStandards XML into description for frontend visibility
    standardProduct.description = promoDebugXml || "DEBUG: PromoStandards call was not made";

    console.log(`[provider-sanmar] Returning: ${standardProduct.brand} ${standardProduct.styleNumber} with ${standardProduct.colors.length} colors`);

    return new Response(
      JSON.stringify({ product: standardProduct }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[provider-sanmar] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: "Service temporarily unavailable",
        product: null,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
