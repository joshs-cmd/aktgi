import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.3.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ACC PromoStandards endpoints (LIVE)
const ACC_INVENTORY_ENDPOINT = "https://promo.acc-api.com/live/inventory2.php";         // v2.0.0
const ACC_PRICING_ENDPOINT   = "https://promo.acc-api.com/live/productPricingAndConfig.php"; // v1.0.0

// ---------------------------------------------------------------------------
// Standard interfaces (matching our app-wide sourcing types)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Canonical style normalization (mirrors sourcing-engine & styleNormalization.ts)
// Allows ACC styles to pair with existing SanMar / S&S cards.
// ---------------------------------------------------------------------------

const BRAND_ALIASES: [RegExp, string][] = [
  [/bella\s*[\+&]\s*canvas|bellacanvas/i,        "BELLA+CANVAS"],
  [/next\s*level(\s*apparel)?/i,                  "NEXT LEVEL"],
  [/sport[\s\-]?tek/i,                            "SPORT-TEK"],
  [/port\s*&?\s*company/i,                        "PORT & COMPANY"],
  [/comfort\s*colors?/i,                          "COMFORT COLORS"],
  [/gildan/i,                                     "GILDAN"],
  [/hanes/i,                                      "HANES"],
  [/jerzees/i,                                    "JERZEES"],
  [/\ba4\b/i,                                     "A4"],
  [/district(\s*made)?/i,                         "DISTRICT"],
  [/new\s*era/i,                                  "NEW ERA"],
  [/independent\s*trading(\s*co\.?)?/i,           "INDEPENDENT TRADING"],
  [/alternative(\s*apparel)?/i,                   "ALTERNATIVE"],
  [/atlantic\s*coast\s*cotton/i,                  "ATLANTIC COAST COTTON"],
];

const BRAND_PREFIX_MAP: Record<string, string[]> = {
  "BELLA+CANVAS":          ["BC"],
  "NEXT LEVEL":            ["NL"],
  "A4":                    ["A4"],
  "GILDAN":                ["GH400", "GH000", "G"],
  "SPORT-TEK":             ["BST", "ST"],
  "PORT & COMPANY":        ["PC"],
  "COMFORT COLORS":        ["CC"],
  "DISTRICT":              ["DT"],
  "JERZEES":               ["J"],
  "HANES":                 ["H"],
  "NEW ERA":               ["NE"],
  "INDEPENDENT TRADING":   ["IND"],
  "ALTERNATIVE":           ["AA"],
};

function normalizeBrandName(brand: string): string {
  const s = brand.trim();
  for (const [pattern, canonical] of BRAND_ALIASES) {
    if (pattern.test(s)) return canonical;
  }
  return s.toUpperCase();
}

/** Strip known brand prefix → bare numeric base (e.g. "BC3001" → "3001"). */
function getCanonicalBase(styleNumber: string, brand: string): string {
  const normalBrand = normalizeBrandName(brand);
  const sn = styleNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const prefixes = BRAND_PREFIX_MAP[normalBrand] ?? [];
  for (const prefix of prefixes) {
    if (sn.startsWith(prefix) && sn.length > prefix.length) {
      const rest = sn.slice(prefix.length);
      if (/^\d/.test(rest)) return rest;
    }
  }
  return sn;
}

// ---------------------------------------------------------------------------
// Size ordering (consistent with other providers)
// ---------------------------------------------------------------------------
const SIZE_ORDER: Record<string, number> = {
  XS: 1, S: 2, M: 3, L: 4, XL: 5,
  "2XL": 6, "3XL": 7, "4XL": 8, "5XL": 9, "6XL": 10,
  XXL: 6, XXXL: 7, XXXXL: 8,
  OSFA: 50, OS: 50, "ONE SIZE": 50,
};

function getSizeOrder(sizeCode: string): number {
  const n = sizeCode.toUpperCase().trim();
  return SIZE_ORDER[n] ?? 99;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getEnvelopeBody(parsed: any): any | null {
  const env =
    parsed["soapenv:Envelope"] || parsed["soap:Envelope"] ||
    parsed["SOAP-ENV:Envelope"] || parsed["S:Envelope"] || parsed.Envelope;
  if (!env) return null;
  return (
    env["soapenv:Body"] || env["soap:Body"] ||
    env["SOAP-ENV:Body"] || env["S:Body"] || env.Body || null
  );
}

// ---------------------------------------------------------------------------
// PromoStandards Inventory v2.0.0 request
// NOTE: alias must be "shar" not "shared" — ACC validates namespace prefixes strictly
// ---------------------------------------------------------------------------
function buildInventoryRequest(productId: string, username: string, password: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/Inventory/2.0.0/"
                  xmlns:shar="http://www.promostandards.org/WSDL/Inventory/2.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:GetInventoryLevelsRequest>
      <shar:wsVersion>2.0.0</shar:wsVersion>
      <shar:id>${escapeXml(username)}</shar:id>
      <shar:password>${escapeXml(password)}</shar:password>
      <shar:productId>${escapeXml(productId)}</shar:productId>
      <shar:Filter>
        <shar:partIdArray/>
      </shar:Filter>
    </ns:GetInventoryLevelsRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ---------------------------------------------------------------------------
// PromoStandards Pricing v1.0.0 request
// Minimal required fields per ACC docs: wsVersion, id, password, productId, priceType
// ---------------------------------------------------------------------------
function buildPricingRequest(productId: string, username: string, password: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/"
                  xmlns:shar="http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:GetConfigurationAndPricingRequest>
      <shar:wsVersion>1.0.0</shar:wsVersion>
      <shar:id>${escapeXml(username)}</shar:id>
      <shar:password>${escapeXml(password)}</shar:password>
      <shar:productId>${escapeXml(productId)}</shar:productId>
      <shar:priceType>Customer</shar:priceType>
    </ns:GetConfigurationAndPricingRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ---------------------------------------------------------------------------
// Fetch pricing → partId → price map
// ---------------------------------------------------------------------------
async function fetchPricing(
  productId: string,
  username: string,
  password: string,
  parser: XMLParser
): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  try {
    const body = buildPricingRequest(productId, username, password);
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(ACC_PRICING_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": '"GetConfigurationAndPricing"',
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(tid);

    if (!res.ok) {
      console.error(`[provider-acc] Pricing HTTP ${res.status}`);
      return priceMap;
    }

    const xml = await res.text();
    console.log(`[provider-acc] Pricing XML (${xml.length} chars): ${xml.substring(0, 600)}`);

    const parsed = parser.parse(xml);
    const bodyEl = getEnvelopeBody(parsed);
    if (!bodyEl) return priceMap;

    // Locate response element
    const respKey = Object.keys(bodyEl).find(k =>
      k.toLowerCase().includes("pricingandconfiguration") ||
      k.toLowerCase().includes("getconfiguration") ||
      k.toLowerCase().includes("configurationandpricing")
    );
    if (!respKey) {
      console.log(`[provider-acc] Pricing: no resp key, keys=${Object.keys(bodyEl).join(", ")}`);
      return priceMap;
    }

    const resp = bodyEl[respKey];
    const configuration =
      resp?.["ns2:Configuration"] || resp?.Configuration || resp?.configuration;

    const partArray =
      configuration?.["ns2:PartArray"] || configuration?.PartArray || configuration?.partArray;
    const rawParts =
      (partArray?.["ns2:Part"] || partArray?.Part || partArray?.part) ??
      (configuration?.["ns2:Part"] || configuration?.Part || configuration?.part);

    if (!rawParts) {
      console.log(`[provider-acc] Pricing: no parts found`);
      return priceMap;
    }

    const parts = Array.isArray(rawParts) ? rawParts : [rawParts];
    console.log(`[provider-acc] Pricing: ${parts.length} parts`);

    for (const part of parts) {
      const partId = String(
        part?.partId || part?.["ns2:partId"] || part?.PartId || ""
      ).trim();
      if (!partId) continue;

      const priceArrayEl =
        part?.["ns2:PartPriceArray"] || part?.PartPriceArray || part?.partPriceArray;
      const rawPrices =
        priceArrayEl?.["ns2:PartPrice"] || priceArrayEl?.PartPrice || priceArrayEl?.partPrice;
      if (!rawPrices) continue;

      const priceList = Array.isArray(rawPrices) ? rawPrices : [rawPrices];
      let bestPrice = 0;

      for (const p of priceList) {
        const minQty = parseFloat(String(p?.["ns2:minQuantity"] || p?.minQuantity || "1"));
        const val    = parseFloat(String(p?.["ns2:price"] || p?.price || p?.Price || "0"));
        if (val > 0 && (minQty <= 1 || bestPrice === 0)) {
          bestPrice = val;
        }
      }

      if (bestPrice > 0) {
        priceMap.set(partId, bestPrice);
      }
    }

    console.log(`[provider-acc] Pricing: ${priceMap.size} parts mapped`);
  } catch (err: any) {
    console.error("[provider-acc] Pricing error:", err.message || err);
  }
  return priceMap;
}

// ---------------------------------------------------------------------------
// Parse Inventory v2.0.0 response
// ---------------------------------------------------------------------------
interface PartEntry {
  partId: string;
  color: string;       // extracted from part description / partId
  size: string;
  warehouses: { code: string; name: string; qty: number }[];
}

function parseInventoryResponse(xml: string, parser: XMLParser): PartEntry[] {
  const entries: PartEntry[] = [];
  try {
    const parsed = parser.parse(xml);
    const bodyEl = getEnvelopeBody(parsed);
    if (!bodyEl) return entries;

    // Find Inventory response element
    const invKey = Object.keys(bodyEl).find(k =>
      k.toLowerCase().includes("inventory") || k.toLowerCase().includes("getinventory")
    );
    if (!invKey) {
      console.log(`[provider-acc] Inventory: no key, keys=${Object.keys(bodyEl).join(", ")}`);
      return entries;
    }

    const invResp = bodyEl[invKey];
    console.log(`[provider-acc] Inventory resp keys: ${Object.keys(invResp || {}).join(", ")}`);

    // v2.0.0 wraps in Inventory > PartInventoryArray > PartInventory
    const invEl =
      invResp?.["ns2:Inventory"] || invResp?.Inventory || invResp?.inventory || invResp;

    const partArrayEl =
      invEl?.["ns2:PartInventoryArray"] || invEl?.PartInventoryArray || invEl?.partInventoryArray;
    const rawParts =
      (partArrayEl?.["ns2:PartInventory"] || partArrayEl?.PartInventory || partArrayEl?.partInventory) ??
      (invEl?.["ns2:PartInventory"] || invEl?.PartInventory || invEl?.partInventory);

    if (!rawParts) {
      console.log(`[provider-acc] Inventory: no PartInventory found`);
      return entries;
    }

    const parts = Array.isArray(rawParts) ? rawParts : [rawParts];
    console.log(`[provider-acc] Inventory: ${parts.length} PartInventory entries`);

    for (const part of parts) {
      const partId = String(
        part?.partId || part?.["ns2:partId"] || part?.PartId || ""
      ).trim();
      if (!partId) continue;

      // v2.0.0 supplies InventoryLocationArray with LocationQuantity entries
      const locArrayEl =
        part?.["ns2:InventoryLocationArray"] || part?.InventoryLocationArray || part?.inventoryLocationArray;
      const rawLocs =
        (locArrayEl?.["ns2:InventoryLocation"] || locArrayEl?.InventoryLocation || locArrayEl?.inventoryLocation) ??
        [];
      const locs = Array.isArray(rawLocs) ? rawLocs : (rawLocs ? [rawLocs] : []);

      const warehouses: { code: string; name: string; qty: number }[] = [];
      for (const loc of locs) {
        const locCode = String(
          loc?.inventoryLocationId || loc?.["ns2:inventoryLocationId"] ||
          loc?.InventoryLocationId || loc?.locationId || "DEFAULT"
        ).trim();
        const locName = String(
          loc?.inventoryLocationName || loc?.["ns2:inventoryLocationName"] ||
          loc?.InventoryLocationName || locCode
        ).trim();

        // Quantity can live at different levels in v2.0.0
        const qtyEl =
          loc?.["ns2:inventoryLevelArray"] || loc?.inventoryLevelArray ||
          loc?.InventoryLevelArray || loc;
        const qty = parseInt(
          String(
            qtyEl?.["ns2:Quantity"]?.["#text"] || qtyEl?.Quantity?.["#text"] ||
            qtyEl?.["ns2:Quantity"] || qtyEl?.Quantity ||
            qtyEl?.quantity || loc?.quantity || "0"
          ),
          10
        ) || 0;

        warehouses.push({ code: locCode, name: locName, qty });
      }

      // If no warehouses from location array, try direct quantity field
      if (warehouses.length === 0) {
        const directQty = parseInt(
          String(part?.["ns2:quantity"] || part?.quantity || part?.Quantity || "0"),
          10
        ) || 0;
        warehouses.push({ code: "DEFAULT", name: "Warehouse", qty: directQty });
      }

      // Parse color and size from partId — ACC typically encodes as "COLOR-SIZE" or similar
      // We'll store partId directly and cross-reference with pricing partId
      entries.push({ partId, color: "", size: "", warehouses });
    }
  } catch (err: any) {
    console.error("[provider-acc] Inventory parse error:", err.message || err);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Build StandardProduct from inventory + pricing + product info
// ---------------------------------------------------------------------------
interface ACCProductInfo {
  styleNumber: string;
  name: string;
  brand: string;
  category: string;
  imageUrl?: string;
  // partId → { colorName, sizeName }
  parts: Map<string, { colorName: string; sizeName: string; colorCode?: string }>;
}

/**
 * ACC v2.0.0 product info — we fall back to fetching /productData if available,
 * otherwise we derive metadata from the inventory response's part descriptors.
 */
async function fetchProductInfo(
  productId: string,
  username: string,
  password: string,
  parser: XMLParser
): Promise<ACCProductInfo | null> {
  // Try PromoStandards Product Data Service v2.0.0 if ACC supports it.
  // Many distributors expose it at a similar path; we'll attempt and fall back gracefully.
  const PS_PRODUCT_ENDPOINT = "https://promo.acc-api.com/live/productData.php";
  const reqBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/ProductData/2.0.0/"
                  xmlns:shared="http://www.promostandards.org/WSDL/ProductData/2.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:GetProductRequest>
      <shared:wsVersion>2.0.0</shared:wsVersion>
      <shared:id>${escapeXml(username)}</shared:id>
      <shared:password>${escapeXml(password)}</shared:password>
      <shared:localizationCountry>US</shared:localizationCountry>
      <shared:localizationLanguage>en</shared:localizationLanguage>
      <shared:productId>${escapeXml(productId)}</shared:productId>
      <shared:isSellable>true</shared:isSellable>
    </ns:GetProductRequest>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(PS_PRODUCT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": '"GetProduct"',
      },
      body: reqBody,
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) {
      console.log(`[provider-acc] ProductData HTTP ${res.status} — will use stub metadata`);
      return null;
    }

    const xml = await res.text();
    console.log(`[provider-acc] ProductData XML (${xml.length} chars): ${xml.substring(0, 600)}`);

    const parsed = parser.parse(xml);
    const bodyEl = getEnvelopeBody(parsed);
    if (!bodyEl) return null;

    const respKey = Object.keys(bodyEl).find(k => k.toLowerCase().includes("product"));
    if (!respKey) return null;

    const resp = bodyEl[respKey];
    const productEl =
      resp?.["ns2:Product"] || resp?.Product || resp?.product;
    if (!productEl) return null;

    const productId2 = String(
      productEl?.productId || productEl?.["ns2:productId"] || productId
    ).trim();
    const name = String(
      productEl?.productName || productEl?.["ns2:productName"] ||
      productEl?.name || productId2
    ).trim();
    const brand = String(
      productEl?.brandName || productEl?.["ns2:brandName"] ||
      productEl?.brand || "Atlantic Coast Cotton"
    ).trim();
    const category = String(
      productEl?.productCategory || productEl?.["ns2:productCategory"] || ""
    ).trim();

    // Image
    const mediaArrayEl =
      productEl?.["ns2:ProductMarketingPointArray"] ||
      productEl?.ProductMarketingPointArray ||
      productEl?.primaryImageUrl ||
      productEl?.primaryImage;
    const imageUrl = String(mediaArrayEl?.primaryImageUrl || mediaArrayEl || "").trim() || undefined;

    // Build part map from ProductPartArray
    const partMap = new Map<string, { colorName: string; sizeName: string; colorCode?: string }>();
    const partArrayEl =
      productEl?.["ns2:ProductPartArray"] || productEl?.ProductPartArray || productEl?.productPartArray;
    const rawParts =
      (partArrayEl?.["ns2:ProductPart"] || partArrayEl?.ProductPart || partArrayEl?.productPart) ?? [];
    const parts = Array.isArray(rawParts) ? rawParts : [rawParts];

    for (const part of parts) {
      const pId = String(part?.partId || part?.["ns2:partId"] || "").trim();
      if (!pId) continue;

      const colorName = String(
        part?.colorName || part?.["ns2:colorName"] ||
        part?.ColorName || part?.color || ""
      ).trim();
      const sizeName = String(
        part?.labelSize || part?.["ns2:labelSize"] ||
        part?.sizeName || part?.size || ""
      ).trim();
      const colorCode = String(
        part?.colorCode || part?.["ns2:colorCode"] || ""
      ).trim() || undefined;

      partMap.set(pId, { colorName, sizeName, colorCode });
    }

    return { styleNumber: productId2, name, brand, category, imageUrl, parts: partMap };
  } catch (err: any) {
    console.log(`[provider-acc] ProductData fetch failed (${err.message}) — using stub metadata`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Aggregate inventory + pricing into StandardProduct
// ---------------------------------------------------------------------------
function buildStandardProduct(
  productId: string,
  inventoryEntries: PartEntry[],
  priceMap: Map<string, number>,
  productInfo: ACCProductInfo | null
): StandardProduct | null {
  if (inventoryEntries.length === 0 && priceMap.size === 0) return null;

  // Merge all partIds seen in either inventory or pricing
  const allPartIds = new Set<string>([
    ...inventoryEntries.map(e => e.partId),
    ...priceMap.keys(),
  ]);

  if (allPartIds.size === 0) return null;

  // partId → metadata (colorName, sizeName)
  const partMeta = new Map<string, { colorName: string; sizeName: string }>();

  for (const entry of inventoryEntries) {
    // If product info has part metadata use it; otherwise try to parse the partId itself.
    const info = productInfo?.parts.get(entry.partId);
    if (info) {
      partMeta.set(entry.partId, { colorName: info.colorName, sizeName: info.sizeName });
    } else {
      // Attempt to split partId by common delimiter (e.g. "WHITE-S", "NAVY-2XL")
      const dashIdx = entry.partId.lastIndexOf("-");
      if (dashIdx > 0) {
        const colorName = entry.partId.substring(0, dashIdx).replace(/_/g, " ");
        const sizeName  = entry.partId.substring(dashIdx + 1).replace(/_/g, " ");
        partMeta.set(entry.partId, { colorName, sizeName });
      } else {
        partMeta.set(entry.partId, { colorName: entry.partId, sizeName: "ONE SIZE" });
      }
    }
  }

  // Also register pricing-only parts
  for (const partId of priceMap.keys()) {
    if (!partMeta.has(partId)) {
      const info = productInfo?.parts.get(partId);
      if (info) {
        partMeta.set(partId, { colorName: info.colorName, sizeName: info.sizeName });
      } else {
        const dashIdx = partId.lastIndexOf("-");
        if (dashIdx > 0) {
          partMeta.set(partId, {
            colorName: partId.substring(0, dashIdx).replace(/_/g, " "),
            sizeName:  partId.substring(dashIdx + 1).replace(/_/g, " "),
          });
        } else {
          partMeta.set(partId, { colorName: partId, sizeName: "ONE SIZE" });
        }
      }
    }
  }

  // Inventory lookup by partId
  const invByPartId = new Map<string, PartEntry>();
  for (const entry of inventoryEntries) {
    invByPartId.set(entry.partId, entry);
  }

  // Group by colorName
  const colorMap = new Map<string, {
    colorCode?: string;
    sizes: Map<string, { price: number; inventory: StandardInventory[] }>;
  }>();

  for (const [partId, meta] of partMeta.entries()) {
    const { colorName, sizeName } = meta;
    if (!colorMap.has(colorName)) {
      colorMap.set(colorName, {
        colorCode: productInfo?.parts.get(partId)?.colorCode,
        sizes: new Map(),
      });
    }

    const price = priceMap.get(partId) ?? 0;
    const invEntry = invByPartId.get(partId);
    const inventory: StandardInventory[] = (invEntry?.warehouses ?? []).map(w => ({
      warehouseCode: w.code,
      warehouseName: w.name,
      quantity: w.qty,
    }));

    if (!colorMap.get(colorName)!.sizes.has(sizeName)) {
      colorMap.get(colorName)!.sizes.set(sizeName, { price, inventory });
    }
  }

  if (colorMap.size === 0) return null;

  const styleNumber = productInfo?.styleNumber || productId;
  const canonicalBase = getCanonicalBase(styleNumber, productInfo?.brand || "Atlantic Coast Cotton");

  const colors: StandardColor[] = Array.from(colorMap.entries()).map(([colorName, colorData]) => {
    const sizes: StandardSize[] = Array.from(colorData.sizes.entries())
      .map(([sizeName, sizeData]) => ({
        code: sizeName,
        order: getSizeOrder(sizeName),
        price: sizeData.price,
        inventory: sizeData.inventory,
      }))
      .sort((a, b) => a.order - b.order);

    return {
      code: colorData.colorCode || colorName.toUpperCase().replace(/\s+/g, "_"),
      name: colorName,
      hexCode: null,
      swatchUrl: null,
      imageUrl: productInfo?.imageUrl || null,
      sizes,
    };
  });

  return {
    styleNumber: canonicalBase,
    name: productInfo?.name || styleNumber,
    brand: productInfo?.brand || "Atlantic Coast Cotton",
    category: productInfo?.category || "",
    imageUrl: productInfo?.imageUrl,
    colors,
  };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const query: string = (body.query || "").trim();

    if (!query) {
      return new Response(
        JSON.stringify({ product: null, error: "Missing query" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const username = Deno.env.get("ACC_USERNAME");
    const password = Deno.env.get("ACC_PASSWORD");

    if (!username || !password) {
      console.error("[provider-acc] Missing ACC_USERNAME or ACC_PASSWORD secret");
      return new Response(
        JSON.stringify({ product: null, error: "Provider credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // productId to query ACC is the raw query (style number)
    // Normalise: strip known brand prefix so we send bare style to ACC
    // ACC stores styles by their own internal code (usually plain numeric)
    const productId = query.toUpperCase().replace(/[^A-Z0-9\-]/g, "");

    console.log(`[provider-acc] Looking up productId: "${productId}" (original: "${query}")`);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: true,
      parseTagValue: true,
      trimValues: true,
    });

    // Fetch inventory and pricing in parallel
    const [inventoryXmlResult, priceMap, productInfo] = await Promise.all([
      (async () => {
        try {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(ACC_INVENTORY_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "text/xml; charset=utf-8",
              "SOAPAction": '"GetInventoryLevels"',
            },
            body: buildInventoryRequest(productId, username, password),
            signal: controller.signal,
          });
          clearTimeout(tid);
          if (!res.ok) {
            console.error(`[provider-acc] Inventory HTTP ${res.status}`);
            return "";
          }
          const xml = await res.text();
          console.log(`[provider-acc] Inventory XML (${xml.length} chars): ${xml.substring(0, 600)}`);
          return xml;
        } catch (err: any) {
          console.error("[provider-acc] Inventory fetch error:", err.message || err);
          return "";
        }
      })(),
      fetchPricing(productId, username, password, parser),
      fetchProductInfo(productId, username, password, parser),
    ]);

    const inventoryEntries = inventoryXmlResult
      ? parseInventoryResponse(inventoryXmlResult, parser)
      : [];

    console.log(`[provider-acc] inventory entries: ${inventoryEntries.length}, pricing parts: ${priceMap.size}`);

    const product = buildStandardProduct(productId, inventoryEntries, priceMap, productInfo);

    if (!product) {
      console.log(`[provider-acc] No product found for "${productId}"`);
      return new Response(
        JSON.stringify({ product: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(
      `[provider-acc] Returning product: ${product.styleNumber} "${product.name}" ` +
      `(${product.colors.length} colors)`
    );

    return new Response(
      JSON.stringify({ product }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[provider-acc] Fatal error:", error);
    return new Response(
      JSON.stringify({ product: null, error: "Service temporarily unavailable" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
