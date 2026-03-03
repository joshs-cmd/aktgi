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
  [/hanes/i,                              "HANES"],
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
// XML helpers
// ---------------------------------------------------------------------------
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
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
// GetProductDateModified — returns all productIds modified since a timestamp
// Use a very old date to get the full catalog on first run.
// Correct namespace: ProductDataService/2.0.0 with shar prefix
// ---------------------------------------------------------------------------
function buildGetProductDateModifiedRequest(
  changeTimeStamp: string,
  username: string,
  password: string
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/"
                  xmlns:shar="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:GetProductDateModifiedRequest>
      <shar:wsVersion>2.0.0</shar:wsVersion>
      <shar:id>${escapeXml(username)}</shar:id>
      <shar:password>${escapeXml(password)}</shar:password>
      <shar:changeTimeStamp>${escapeXml(changeTimeStamp)}</shar:changeTimeStamp>
    </ns:GetProductDateModifiedRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// GetProductRequest — correct namespace with shar prefix
function buildGetProductRequest(productId: string, username: string, password: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/"
                  xmlns:shar="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:GetProductRequest>
      <shar:wsVersion>2.0.0</shar:wsVersion>
      <shar:id>${escapeXml(username)}</shar:id>
      <shar:password>${escapeXml(password)}</shar:password>
      <shar:productId>${escapeXml(productId)}</shar:productId>
    </ns:GetProductRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// Pricing — correct namespace with shar prefix, minimal required fields
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
// Fetch all ACC product IDs via GetProductDateModified
// ---------------------------------------------------------------------------
async function fetchAllProductIds(
  username: string,
  password: string,
  parser: XMLParser
): Promise<string[]> {
  // Use a date far in the past to get ALL products
  const changeTimeStamp = "20100101";
  const res = await fetch(ACC_PRODUCT_DATA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": '"GetProductDateModified"',
    },
    body: buildGetProductDateModifiedRequest(changeTimeStamp, username, password),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`GetProductDateModified HTTP ${res.status}`);
  }

  const xml = await res.text();
  console.log(`[ingest-acc-catalog] GetProductDateModified response (${xml.length} chars): ${xml.substring(0, 600)}`);

  const parsed = parser.parse(xml);
  const bodyEl = getEnvelopeBody(parsed);
  if (!bodyEl) throw new Error("No SOAP body in GetProductDateModified response");

  // Find response key
  const respKey = Object.keys(bodyEl).find(k =>
    k.toLowerCase().includes("productdatemodified") ||
    k.toLowerCase().includes("getproductdate")
  );
  if (!respKey) {
    console.log(`[ingest-acc-catalog] GetProductDateModified body keys: ${Object.keys(bodyEl).join(", ")}`);
    // Try to find any error message
    const errorKey = Object.keys(bodyEl).find(k => k.toLowerCase().includes("error") || k.toLowerCase().includes("fault"));
    if (errorKey) throw new Error(`ACC API error: ${JSON.stringify(bodyEl[errorKey]).substring(0, 200)}`);
    throw new Error(`No ProductDateModified response key found. Keys: ${Object.keys(bodyEl).join(", ")}`);
  }

  const resp = bodyEl[respKey];
  const productDateArrayEl =
    resp?.["ns2:ProductDateArray"] || resp?.ProductDateArray ||
    resp?.productDateArray || resp;

  const rawItems =
    productDateArrayEl?.["ns2:ProductDate"] || productDateArrayEl?.ProductDate ||
    productDateArrayEl?.productDate || [];

  const items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
  console.log(`[ingest-acc-catalog] Found ${items.length} products from GetProductDateModified`);

  return items
    .map((item: any) => String(item?.productId || item?.["ns2:productId"] || "").trim())
    .filter((id: string) => id.length > 0);
}

// ---------------------------------------------------------------------------
// Fetch single product detail
// ---------------------------------------------------------------------------
async function fetchProductDetail(
  productId: string,
  username: string,
  password: string,
  parser: XMLParser
): Promise<{ brand: string; name: string; imageUrl?: string; description?: string } | null> {
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
    const productEl =
      resp?.["ns2:Product"] || resp?.Product || resp?.product ||
      resp?.["Product"] || resp;
    if (!productEl) return null;

    const name = String(
      productEl?.productName || productEl?.["ns2:productName"] || productId
    ).trim();
    const brand = String(
      productEl?.brandName || productEl?.["ns2:brandName"] || "Atlantic Coast Cotton"
    ).trim();

    // Try to get image from ProductPartArray → primaryColor
    let imageUrl: string | undefined;
    const partArrayEl =
      productEl?.["ns2:ProductPartArray"] || productEl?.ProductPartArray;
    const rawParts =
      (partArrayEl?.["ns2:ProductPart"] || partArrayEl?.ProductPart) ?? [];
    const parts = Array.isArray(rawParts) ? rawParts : [rawParts];
    for (const part of parts) {
      const primaryImg = String(
        part?.primaryImage || part?.["ns2:primaryImage"] ||
        part?.ColorAppearanceArray?.["ns2:ColorAppearance"]?.colorImageUrl ||
        ""
      ).trim();
      if (primaryImg) { imageUrl = primaryImg; break; }
    }

    const description = String(
      productEl?.description || productEl?.["ns2:description"] ||
      productEl?.productDescription || ""
    ).trim() || undefined;

    return { name, brand, imageUrl, description };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch lowest piece price for a product
// ---------------------------------------------------------------------------
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
    const configuration =
      resp?.["ns2:Configuration"] || resp?.Configuration || resp?.configuration;
    if (!configuration) return null;

    const partArrayEl =
      configuration?.["ns2:PartArray"] || configuration?.PartArray || configuration?.partArray;
    const rawParts =
      (partArrayEl?.["ns2:Part"] || partArrayEl?.Part || partArrayEl?.part) ??
      (configuration?.["ns2:Part"] || configuration?.Part || configuration?.part);

    if (!rawParts) return null;
    const parts = Array.isArray(rawParts) ? rawParts : [rawParts];

    let lowestPrice: number | null = null;
    for (const part of parts) {
      const priceArrayEl =
        part?.["ns2:PartPriceArray"] || part?.PartPriceArray || part?.partPriceArray;
      const rawPrices =
        priceArrayEl?.["ns2:PartPrice"] || priceArrayEl?.PartPrice || priceArrayEl?.partPrice;
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

    console.log("[ingest-acc-catalog] Fetching all product IDs via GetProductDateModified...");
    const productIds = await fetchAllProductIds(username, password, parser);

    if (productIds.length === 0) {
      return new Response(
        JSON.stringify({ message: "No products found from GetProductDateModified", upserted: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[ingest-acc-catalog] Processing ${productIds.length} product IDs...`);

    // Archive the raw product ID list
    const dateStr = new Date().toISOString().split("T")[0];
    await saveArchive(
      supabase,
      `acc-${dateStr}.json`,
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        totalProducts: productIds.length,
        productIds,
      }, null, 2)
    );

    // Enrich in small concurrent batches to avoid overwhelming ACC API
    const CONCURRENCY = 3;
    const records: any[] = [];
    const errors: string[] = [];

    for (let i = 0; i < productIds.length; i += CONCURRENCY) {
      const chunk = productIds.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async (productId) => {
          const [detailResult, basePriceResult] = await Promise.allSettled([
            fetchProductDetail(productId, username, password, parser),
            fetchBasePrice(productId, username, password, parser),
          ]);

          const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
          const basePrice = basePriceResult.status === "fulfilled" ? basePriceResult.value : null;

          const brand = detail?.brand || "ATLANTIC COAST COTTON";
          const title = detail?.name || productId;

          // Apply canonical normalization so ACC styles merge with cards from other distributors
          const canonicalStyleNumber = getCanonicalBase(productId, brand);

          return {
            distributor: "acc",
            brand,
            style_number: canonicalStyleNumber,
            title,
            description: detail?.description || null,
            image_url: detail?.imageUrl || null,
            base_price: basePrice ?? null,
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

      // Throttle between batches
      if (i + CONCURRENCY < productIds.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Dedup by style_number
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
        fetchedProducts: productIds.length,
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
