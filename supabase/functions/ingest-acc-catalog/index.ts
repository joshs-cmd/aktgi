import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.3.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "distributor-archives";
const BATCH_SIZE = 500;
const ACC_PRODUCT_DATA_ENDPOINT = "https://promo.acc-api.com/live/productData.php";
const ACC_PRICING_ENDPOINT      = "https://promo.acc-api.com/live/productPricingAndConfig.php";

// ---------------------------------------------------------------------------
// Canonical brand normalization (mirrors styleNormalization.ts)
// ---------------------------------------------------------------------------
const BRAND_ALIASES: [RegExp, string][] = [
  [/bella\s*[\+&]\s*canvas|bellacanvas/i, "BELLA+CANVAS"],
  [/next\s*level(\s*apparel)?/i,          "NEXT LEVEL"],
  [/sport[\s\-]?tek/i,                    "SPORT-TEK"],
  [/port\s*&?\s*company/i,                "PORT & COMPANY"],
  [/comfort\s*colors?/i,                  "COMFORT COLORS"],
  [/gildan/i,                             "GILDAN"],
  [/hanes/i,                             "HANES"],
  [/jerzees/i,                            "JERZEES"],
  [/\ba4\b/i,                             "A4"],
  [/district(\s*made)?/i,                 "DISTRICT"],
  [/new\s*era/i,                          "NEW ERA"],
  [/independent\s*trading(\s*co\.?)?/i,   "INDEPENDENT TRADING"],
  [/alternative(\s*apparel)?/i,           "ALTERNATIVE"],
];

const BRAND_PREFIX_MAP: Record<string, string[]> = {
  "BELLA+CANVAS":       ["BC"],
  "NEXT LEVEL":         ["NL"],
  "A4":                 ["A4"],
  "GILDAN":             ["GH400", "GH000", "G"],
  "SPORT-TEK":          ["BST", "ST"],
  "PORT & COMPANY":     ["PC"],
  "COMFORT COLORS":     ["CC"],
  "DISTRICT":           ["DT"],
  "JERZEES":            ["J"],
  "HANES":              ["H"],
  "NEW ERA":            ["NE"],
  "INDEPENDENT TRADING":["IND"],
  "ALTERNATIVE":        ["AA"],
};

function normalizeBrandName(brand: string): string {
  const s = brand.trim();
  for (const [pattern, canonical] of BRAND_ALIASES) {
    if (pattern.test(s)) return canonical;
  }
  return s.toUpperCase();
}

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
// Helpers
// ---------------------------------------------------------------------------
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function getEnvelopeBody(parsed: any): any | null {
  const env =
    parsed["soapenv:Envelope"] || parsed["soap:Envelope"] ||
    parsed["S:Envelope"] || parsed.Envelope;
  if (!env) return null;
  return env["soapenv:Body"] || env["soap:Body"] || env["S:Body"] || env.Body || null;
}

async function saveArchive(
  supabase: ReturnType<typeof createClient>,
  filename: string,
  content: string
): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`acc/${filename}`, new TextEncoder().encode(content), {
      contentType: "application/json",
      upsert: true,
    });
  if (error) console.error("[ingest-acc-catalog] Archive upload error:", error.message);
}

// ---------------------------------------------------------------------------
// Fetch all product IDs via PromoStandards ProductData v2.0.0
// ---------------------------------------------------------------------------
function buildGetProductSellableRequest(username: string, password: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/ProductData/2.0.0/"
                  xmlns:shared="http://www.promostandards.org/WSDL/ProductData/2.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:GetProductSellableRequest>
      <shared:wsVersion>2.0.0</shared:wsVersion>
      <shared:id>${escapeXml(username)}</shared:id>
      <shared:password>${escapeXml(password)}</shared:password>
      <shared:isSellable>true</shared:isSellable>
      <shared:localizationCountry>US</shared:localizationCountry>
      <shared:localizationLanguage>en</shared:localizationLanguage>
    </ns:GetProductSellableRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function buildGetProductRequest(productId: string, username: string, password: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
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
}

function buildPricingRequest(productId: string, username: string, password: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/"
                  xmlns:shared="http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:GetConfigurationAndPricingRequest>
      <shared:wsVersion>1.0.0</shared:wsVersion>
      <shared:id>${escapeXml(username)}</shared:id>
      <shared:password>${escapeXml(password)}</shared:password>
      <shared:productId>${escapeXml(productId)}</shared:productId>
      <shared:currency>USD</shared:currency>
      <shared:fobId>1</shared:fobId>
      <shared:priceType>Customer</shared:priceType>
      <shared:localizationCountry>US</shared:localizationCountry>
      <shared:localizationLanguage>en</shared:localizationLanguage>
      <shared:configurationType>Blank</shared:configurationType>
    </ns:GetConfigurationAndPricingRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

interface ProductSummary {
  productId: string;
  productName?: string;
  brandName?: string;
  primaryImageUrl?: string;
  productCategory?: string;
}

async function fetchSellableProducts(
  username: string,
  password: string,
  parser: XMLParser
): Promise<ProductSummary[]> {
  const res = await fetch(ACC_PRODUCT_DATA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": '"GetProductSellable"',
    },
    body: buildGetProductSellableRequest(username, password),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`GetProductSellable HTTP ${res.status}`);
  }

  const xml = await res.text();
  console.log(`[ingest-acc-catalog] GetProductSellable response (${xml.length} chars): ${xml.substring(0, 500)}`);

  const parsed = parser.parse(xml);
  const bodyEl = getEnvelopeBody(parsed);
  if (!bodyEl) throw new Error("No SOAP body in GetProductSellable response");

  const respKey = Object.keys(bodyEl).find(k =>
    k.toLowerCase().includes("productsellable") || k.toLowerCase().includes("getproduct")
  );
  if (!respKey) {
    console.log(`[ingest-acc-catalog] GetProductSellable keys: ${Object.keys(bodyEl).join(", ")}`);
    throw new Error("No ProductSellable response key found");
  }

  const resp = bodyEl[respKey];
  const productArrayEl =
    resp?.["ns2:ProductSellableArray"] || resp?.ProductSellableArray ||
    resp?.["ns2:ProductArray"] || resp?.ProductArray || resp;

  const rawProducts =
    productArrayEl?.["ns2:ProductSellable"] || productArrayEl?.ProductSellable ||
    productArrayEl?.["ns2:Product"] || productArrayEl?.Product || [];

  const products = Array.isArray(rawProducts) ? rawProducts : (rawProducts ? [rawProducts] : []);
  console.log(`[ingest-acc-catalog] Found ${products.length} sellable products`);

  return products.map((p: any) => ({
    productId: String(p?.productId || p?.["ns2:productId"] || "").trim(),
    productName: String(p?.productName || p?.["ns2:productName"] || p?.name || "").trim() || undefined,
    brandName: String(p?.brandName || p?.["ns2:brandName"] || p?.brand || "").trim() || undefined,
    primaryImageUrl: String(p?.primaryImageUrl || p?.["ns2:primaryImageUrl"] || p?.imageUrl || "").trim() || undefined,
    productCategory: String(p?.productCategory || p?.["ns2:productCategory"] || "").trim() || undefined,
  })).filter((p: ProductSummary) => p.productId);
}

/** Fetch a single product's detailed metadata (for brand, image, description). */
async function fetchProductDetail(
  productId: string,
  username: string,
  password: string,
  parser: XMLParser
): Promise<{ brand: string; name: string; imageUrl?: string; description?: string; category?: string } | null> {
  try {
    const res = await fetch(ACC_PRODUCT_DATA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": '"GetProduct"',
      },
      body: buildGetProductRequest(productId, username, password),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const parsed = parser.parse(xml);
    const bodyEl = getEnvelopeBody(parsed);
    if (!bodyEl) return null;

    const respKey = Object.keys(bodyEl).find(k => k.toLowerCase().includes("product"));
    if (!respKey) return null;
    const resp = bodyEl[respKey];
    const productEl = resp?.["ns2:Product"] || resp?.Product || resp?.product;
    if (!productEl) return null;

    return {
      name: String(productEl?.productName || productEl?.["ns2:productName"] || productId).trim(),
      brand: String(productEl?.brandName || productEl?.["ns2:brandName"] || "Atlantic Coast Cotton").trim(),
      imageUrl: String(productEl?.primaryImageUrl || productEl?.["ns2:primaryImageUrl"] || "").trim() || undefined,
      description: String(productEl?.description || productEl?.["ns2:description"] || "").trim() || undefined,
      category: String(productEl?.productCategory || productEl?.["ns2:productCategory"] || "").trim() || undefined,
    };
  } catch {
    return null;
  }
}

/** Fetch the lowest piece price for a product from the pricing endpoint. */
async function fetchBasePrice(
  productId: string,
  username: string,
  password: string,
  parser: XMLParser
): Promise<number | null> {
  try {
    const res = await fetch(ACC_PRICING_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": '"GetConfigurationAndPricing"',
      },
      body: buildPricingRequest(productId, username, password),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const parsed = parser.parse(xml);
    const bodyEl = getEnvelopeBody(parsed);
    if (!bodyEl) return null;

    const respKey = Object.keys(bodyEl).find(k =>
      k.toLowerCase().includes("pricingandconfiguration") ||
      k.toLowerCase().includes("configurationandpricing") ||
      k.toLowerCase().includes("getconfiguration")
    );
    if (!respKey) return null;

    const resp = bodyEl[respKey];
    const configuration = resp?.["ns2:Configuration"] || resp?.Configuration || resp?.configuration;
    const partArrayEl = configuration?.["ns2:PartArray"] || configuration?.PartArray || configuration?.partArray;
    const rawParts =
      (partArrayEl?.["ns2:Part"] || partArrayEl?.Part || partArrayEl?.part) ??
      (configuration?.["ns2:Part"] || configuration?.Part || configuration?.part);

    if (!rawParts) return null;
    const parts = Array.isArray(rawParts) ? rawParts : [rawParts];

    let lowestPrice: number | null = null;
    for (const part of parts) {
      const priceArrayEl = part?.["ns2:PartPriceArray"] || part?.PartPriceArray || part?.partPriceArray;
      const rawPrices = priceArrayEl?.["ns2:PartPrice"] || priceArrayEl?.PartPrice || priceArrayEl?.partPrice;
      if (!rawPrices) continue;
      const priceList = Array.isArray(rawPrices) ? rawPrices : [rawPrices];
      for (const p of priceList) {
        const minQty = parseFloat(String(p?.["ns2:minQuantity"] || p?.minQuantity || "99"));
        if (minQty > 1) continue;
        const val = parseFloat(String(p?.["ns2:price"] || p?.price || p?.Price || "0"));
        if (val > 0 && (lowestPrice === null || val < lowestPrice)) {
          lowestPrice = val;
        }
      }
    }
    return lowestPrice;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const username = Deno.env.get("ACC_USERNAME");
    const password = Deno.env.get("ACC_PASSWORD");

    if (!username || !password) {
      return new Response(
        JSON.stringify({ error: "ACC credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: true,
      parseTagValue: true,
      trimValues: true,
    });

    console.log("[ingest-acc-catalog] Fetching sellable product list...");
    const sellableProducts = await fetchSellableProducts(username, password, parser);

    if (sellableProducts.length === 0) {
      return new Response(
        JSON.stringify({ message: "No sellable products found", upserted: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Save raw index as archive
    const dateStr = new Date().toISOString().split("T")[0];
    await saveArchive(
      supabase,
      `acc-${dateStr}.json`,
      JSON.stringify({ fetchedAt: new Date().toISOString(), products: sellableProducts }, null, 2)
    );
    console.log(`[ingest-acc-catalog] Archived ${sellableProducts.length} product stubs to acc/acc-${dateStr}.json`);

    // Enrich + upsert in batches — fetch detailed metadata + pricing per product
    // We do this in small concurrent batches to avoid hammering ACC API
    const CONCURRENCY = 5;
    const records: any[] = [];
    const errors: string[] = [];

    for (let i = 0; i < sellableProducts.length; i += CONCURRENCY) {
      const chunk = sellableProducts.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async (stub) => {
          const [detail, basePrice] = await Promise.allSettled([
            fetchProductDetail(stub.productId, username, password, parser),
            fetchBasePrice(stub.productId, username, password, parser),
          ]);

          const detailVal = detail.status === "fulfilled" ? detail.value : null;
          const basePriceVal = basePrice.status === "fulfilled" ? basePrice.value : null;

          const brand = detailVal?.brand || stub.brandName || "Atlantic Coast Cotton";
          const title = detailVal?.name || stub.productName || stub.productId;
          const imageUrl = detailVal?.imageUrl || stub.primaryImageUrl || null;
          const description = detailVal?.description || null;
          const category = detailVal?.category || stub.productCategory || null;

          // Apply canonical normalization so ACC styles merge with existing cards
          const canonicalStyleNumber = getCanonicalBase(stub.productId, brand);

          return {
            distributor: "acc",
            brand,
            // Store the canonical (prefix-stripped) style number so dedup works
            style_number: canonicalStyleNumber,
            title,
            description,
            image_url: imageUrl,
            base_price: basePriceVal ?? null,
            updated_at: new Date().toISOString(),
          };
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          records.push(r.value);
        } else {
          errors.push(String(r.reason));
        }
      }

      // Brief pause between batches to be a good API citizen
      if (i + CONCURRENCY < sellableProducts.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Dedup by style_number (keep first)
    const seen = new Set<string>();
    const uniqueRecords = records.filter(r => {
      if (seen.has(r.style_number)) return false;
      seen.add(r.style_number);
      return true;
    });

    console.log(`[ingest-acc-catalog] Upserting ${uniqueRecords.length} unique styles...`);

    let upserted = 0;
    for (let i = 0; i < uniqueRecords.length; i += BATCH_SIZE) {
      const batch = uniqueRecords.slice(i, i + BATCH_SIZE);
      const { error, count } = await supabase
        .from("catalog_products")
        .upsert(batch, { onConflict: "distributor,style_number", count: "exact" });
      if (error) {
        errors.push(`DB batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
      } else {
        upserted += count ?? batch.length;
      }
    }

    console.log(`[ingest-acc-catalog] Done. upserted=${upserted}, errors=${errors.length}`);

    return new Response(
      JSON.stringify({
        fetchedProducts: sellableProducts.length,
        uniqueStyles: uniqueRecords.length,
        upserted,
        errors: errors.slice(0, 20),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[ingest-acc-catalog] Fatal error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
