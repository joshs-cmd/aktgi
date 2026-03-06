import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.3.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "distributor-archives";
const DB_BATCH_SIZE = 500;
const CONCURRENCY = 4;
const CHUNK_SIZE = 50;
const SAFETY_CUTOFF_MS = 42_000;
const ACC_PRODUCT_DATA_ENDPOINT = "https://promo.acc-api.com/live/productData.php";
const ACC_PRICING_ENDPOINT      = "https://promo.acc-api.com/live/productPricingAndConfig.php";

// ---------------------------------------------------------------------------
// Brand normalization
// ---------------------------------------------------------------------------

/**
 * ACC-specific: map 2-letter style prefix → canonical brand name.
 * The productId from ACC carries the prefix (e.g. "BC3001"), so we derive
 * the brand from the prefix BEFORE calling the API.
 * Ordered longest-first so "BE" doesn't beat "BG", etc.
 */
const ACC_PREFIX_TO_BRAND: [string, string][] = [
  // Apparel — major brands
  ["BC", "Bella + Canvas"],
  ["BE", "Bella + Canvas"],
  ["NL", "Next Level"],
  ["GL", "Gildan"],
  ["HN", "Hanes"],
  ["CC", "Comfort Colors"],
  ["CO", "Comfort Colors"],
  ["CP", "Champion"],
  ["DB", "Champion"],
  ["CV", "Code V"],
  ["BS", "Burnside"],
  ["BA", "Badger"],
  ["BG", "Badger"],
  ["DK", "Dickies"],
  ["DN", "Dyenomite"],
  ["LA", "Rabbit Skins"],
  ["RS", "Rabbit Skins"],
  ["DS", "Rabbit Skins"],
  ["AA", "American Apparel"],
  ["AS", "American Apparel"],
  ["AN", "Anvil"],
  ["CW", "ComfortWash"],
  ["AG", "Augusta Sportswear"],
  ["YP", "Yupoong"],
  ["FF", "Yupoong"],
  ["VH", "Van Heusen"],
  ["AL", "Alternative"],
  ["JA", "J-America"],
  ["RK", "Red Kap"],
  // A4 — note: A4 uses "A4N" and "A4L" style prefixes as well as bare "A4"
  ["A4", "A4"],
  // Headwear brands
  ["AD", "Adams Headwear"],
  ["HP", "Pacific Headwear"],    // HP#### = Pacific Headwear
  ["PH", "Pacific Headwear"],    // PH#### = Pacific Headwear
  ["PG", "Pacific Headwear"],    // PG#### = Pacific Headwear
  ["OC", "Outdoor Cap"],         // OC#### = Outdoor Cap
  ["KC", "Koozie"],              // KC#### = Koozie / ACCO Brands
  // Bags / accessories
  ["LB", "Liberty Bags"],        // LB#### = Liberty Bags
  ["QT", "Q-Tees"],              // QT#### = Q-Tees
  // Promotional / outdoor / towel brands
  ["OD", "OAD"],                 // OD/ODOAD = OAD promotional
  ["HP", "Pacific Headwear"],
  // Blankets / fleece
  ["AF", "Alpine Fleece"],       // AF#### = Alpine Fleece
  // Sundog / Alpha Factor (sportswear)
  ["SD", "Sundog"],              // SD/AF/AP/GE/GEM = Sundog brand items
  ["AP", "Sundog"],
  ["GE", "Sundog"],
  // Holloway / Sport Supply
  ["HO", "Holloway"],            // HO#### = Holloway Sportswear
  // Fence / SP brand items
  ["FT", "Fence"],               // FT#### = Fence/Sport Supply polo/fleece
  ["SP", "Sport Supply"],        // SP#### = Sport Supply
  // Harriton
  ["HT", "Harriton"],            // HT#### = Harriton
  // Johnnie-O / JC
  ["JC", "Johnnie-O"],           // JC#### = Johnnie-O
  // Stormtech
  ["SW", "Stormtech"],           // SW#### = Stormtech
  // Twin Hill
  ["TW", "Twin Hill"],           // TW#### = Twin Hill
  // Vantage
  ["VT", "Vantage"],             // VT#### = Vantage
  // LS = L/S miscellaneous
  ["LS", "LS"],
  // RP = Rappelling/misc
  ["RP", "RP"],
  // RB = Red Bridge
  ["RB", "Red Bridge"],
  // JH = J. America Headwear
  ["JH", "J-America"],
  // TP = Team Player
  ["TP", "Team Player"],
  // PS = Pro Spirits / Pennant
  ["PS", "Pennant"],
  // CR = ?
  ["CR", "CR"],
  // SU = Sun Hats
  ["SU", "SU"],
  // LC = Lemon & Cloud
  ["LC", "LC"],
  // IH = Independent Headwear
  ["IH", "Independent Headwear"],
  // MS, RE, RT, US, YF = misc
  ["MS", "MS"],
  ["RE", "RE"],
  ["RT", "RT"],
  ["US", "US"],
  ["YF", "YF"],
];

/**
 * Service/fee item prefixes — freight, handling, folding fees etc.
 * These are NOT real garments and should never be ingested.
 */
const ACC_SERVICE_PREFIXES = new Set(["FB", "FO", "FR", "HA", "PF", "SF", "SS", "ST", "TA", "TB", "TF", "XT"]);

/**
 * Prefixes that are stripped from ACC style numbers before storing in the DB,
 * so they align with the canonical base used by SanMar / S&S / OneStop.
 * Only stripped when followed by a digit.
 */
const ACC_STRIP_PREFIXES: string[] = ACC_PREFIX_TO_BRAND.map(([p]) => p);

/**
 * Given an ACC productId (e.g. "BC3001"), return the real brand name.
 * Also handles A4's 3-char prefixes like "A4N3013".
 * Falls back to the raw brandName from the API if no prefix match.
 */
function getBrandFromAccProductId(productId: string, apiBrand?: string): string {
  const sn = productId.trim().toUpperCase();

  // Special case: A4 uses "A4N" and "A4L" prefixes (3 chars before digit)
  if (/^A4[A-Z]\d/.test(sn)) return "A4";

  for (const [prefix, brand] of ACC_PREFIX_TO_BRAND) {
    if (sn.startsWith(prefix) && sn.length > prefix.length && /^\d/.test(sn.slice(prefix.length))) {
      return brand;
    }
  }
  // Fall back to API brand if it's meaningful (not the generic distributor name)
  if (apiBrand && apiBrand.toLowerCase() !== "atlantic coast cotton") return apiBrand;
  return "Atlantic Coast Cotton";
}

/**
 * Strip the ACC prefix from a style number so it stores as the
 * canonical base (e.g. "BC3001" → "3001", "A4N3013" → "N3013").
 * The full original productId is always passed to the ACC API for pricing / inventory.
 */
function getCanonicalBase(styleNumber: string): string {
  const sn = styleNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Special case: A4 uses "A4N####" / "A4L####" — strip the "A4" leaving "N####"
  if (/^A4[A-Z]\d/.test(sn)) return sn.slice(2);

  for (const prefix of ACC_STRIP_PREFIXES) {
    if (sn.startsWith(prefix) && sn.length > prefix.length && /^\d/.test(sn.slice(prefix.length))) {
      return sn.slice(prefix.length);
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

const unwrap = (val: any): string => {
  if (val == null) return "";
  if (typeof val === "object") return String(val["#text"] ?? val["__text"] ?? "").trim();
  return String(val).trim();
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
async function saveArchive(
  supabase: ReturnType<typeof createClient>,
  path: string,
  content: string,
  contentType = "application/json"
): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, new TextEncoder().encode(content), { contentType, upsert: true });
  if (error) console.error("[ingest-acc-catalog] Archive upload error:", error.message, "path:", path);
}

async function loadArchive(
  supabase: ReturnType<typeof createClient>,
  path: string
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return await data.text();
}

// ---------------------------------------------------------------------------
// CSV generation — master format
// ---------------------------------------------------------------------------
function recordsToCsv(records: any[]): string {
  const columns = ["style_number", "brand", "title", "description", "base_price", "image_url", "updated_at"];
  const escape = (v: any): string => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
  };
  const rows = records.map(r => columns.map(c => escape(r[c])).join(","));
  return [columns.join(","), ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// GetProductSellable — returns ALL active product IDs (full catalog)
// Falls back to GetProductDateModified (14-day) if needed
// ---------------------------------------------------------------------------
async function fetchAllProductIds(
  username: string,
  password: string,
  parser: XMLParser
): Promise<{ ids: string[]; method: string }> {
  try {
    console.log("[ingest-acc-catalog] Calling GetProductSellable...");
    const res = await fetch(ACC_PRODUCT_DATA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": '"GetProductSellable"',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/"
                  xmlns:shar="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:GetProductSellableRequest>
      <shar:wsVersion>2.0.0</shar:wsVersion>
      <shar:id>${escapeXml(username)}</shar:id>
      <shar:password>${escapeXml(password)}</shar:password>
      <shar:isSellable>true</shar:isSellable>
    </ns:GetProductSellableRequest>
  </soapenv:Body>
</soapenv:Envelope>`,
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok) {
      const xml = await res.text();
      const parsed = parser.parse(xml);
      const bodyEl = getEnvelopeBody(parsed);
      if (bodyEl) {
        const respKey = Object.keys(bodyEl).find(k =>
          k.toLowerCase().includes("productsellable") || k.toLowerCase().includes("getproductsellable")
        );
        if (respKey) {
          const resp = bodyEl[respKey];
          const arrayEl = resp?.ProductSellableArray || resp?.["ns2:ProductSellableArray"] || resp;
          const rawItems = arrayEl?.ProductSellable || arrayEl?.["ns2:ProductSellable"] || [];
          const items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
          if (items.length > 0) {
            const seen = new Set<string>();
            for (const item of items) {
              const raw = item?.productId ?? item?.["ns2:productId"] ?? item?.["#text"] ?? "";
              const id = (typeof raw === "object" ? String(raw?.["#text"] ?? "") : String(raw)).trim();
              if (id) seen.add(id);
            }
            const ids = Array.from(seen);
            if (ids.length > 0) {
              console.log(`[ingest-acc-catalog] GetProductSellable: ${ids.length} IDs`);
              return { ids, method: "GetProductSellable" };
            }
          }
        }
      }
    }
  } catch (e: any) {
    console.log(`[ingest-acc-catalog] GetProductSellable failed: ${e.message}`);
  }

  // Fallback: GetProductDateModified (14-day)
  console.log("[ingest-acc-catalog] Falling back to GetProductDateModified...");
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const changeTimeStamp = cutoff.toISOString().split("T")[0].replace(/-/g, "");
  const res = await fetch(ACC_PRODUCT_DATA_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": '"GetProductDateModified"' },
    body: `<?xml version="1.0" encoding="UTF-8"?>
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
</soapenv:Envelope>`,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`GetProductDateModified HTTP ${res.status}`);
  const xml = await res.text();
  const parsed = parser.parse(xml);
  const bodyEl = getEnvelopeBody(parsed);
  if (!bodyEl) throw new Error("No SOAP body");
  const respKey = Object.keys(bodyEl).find(k => k.toLowerCase().includes("productdatemodified"));
  if (!respKey) throw new Error(`No key. Keys: ${Object.keys(bodyEl).join(", ")}`);
  const resp = bodyEl[respKey];
  const arrayEl = resp?.ProductDateModifiedArray || resp?.["ns2:ProductDateModifiedArray"] || resp;
  const rawItems = arrayEl?.ProductDateModified || arrayEl?.["ns2:ProductDateModified"] || [];
  const items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
  const seen = new Set<string>();
  for (const item of items) {
    const raw = item?.productId ?? item?.["ns2:productId"] ?? "";
    const id = (typeof raw === "object" ? String(raw?.["#text"] ?? "") : String(raw)).trim();
    if (id) seen.add(id);
  }
  return { ids: Array.from(seen), method: "GetProductDateModified" };
}

// ---------------------------------------------------------------------------
// Fetch single product detail
// ---------------------------------------------------------------------------
async function fetchProductDetail(
  productId: string, username: string, password: string, parser: XMLParser
): Promise<{ brand: string; name: string; imageUrl?: string; description?: string } | null> {
  try {
    const res = await fetch(ACC_PRODUCT_DATA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": '"GetProduct"' },
      body: `<?xml version="1.0" encoding="UTF-8"?>
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
</soapenv:Envelope>`,
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
    const productEl = resp?.["ns2:Product"] || resp?.Product || resp?.product || resp;
    if (!productEl) return null;

    const name = unwrap(productEl?.productName ?? productEl?.["ns2:productName"]) || productId;
    const brand = unwrap(productEl?.brandName ?? productEl?.["ns2:brandName"]) || "Atlantic Coast Cotton";

    let imageUrl: string | undefined;
    const partArrayEl = productEl?.["ns2:ProductPartArray"] || productEl?.ProductPartArray;
    const rawParts = (partArrayEl?.["ns2:ProductPart"] || partArrayEl?.ProductPart) ?? [];
    const parts = Array.isArray(rawParts) ? rawParts : [rawParts];
    for (const part of parts) {
      const img = String(part?.primaryImage || part?.["ns2:primaryImage"] || "").trim();
      if (img) { imageUrl = img; break; }
    }
    const description = unwrap(productEl?.description ?? productEl?.["ns2:description"] ?? productEl?.productDescription) || undefined;
    return { name, brand, imageUrl, description };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch lowest piece price
// ---------------------------------------------------------------------------
async function fetchBasePrice(
  productId: string, username: string, password: string, parser: XMLParser
): Promise<number | null> {
  try {
    const res = await fetch(ACC_PRICING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": '"GetConfigurationAndPricing"' },
      body: `<?xml version="1.0" encoding="UTF-8"?>
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
</soapenv:Envelope>`,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const parsed = parser.parse(xml);
    const bodyEl = getEnvelopeBody(parsed);
    if (!bodyEl) return null;
    const respKey = Object.keys(bodyEl).find(k =>
      k.toLowerCase().includes("pricingandconfiguration") ||
      k.toLowerCase().includes("configurationandpricing")
    );
    if (!respKey) return null;
    const resp = bodyEl[respKey];
    const configuration = resp?.["ns2:Configuration"] || resp?.Configuration || resp?.configuration;
    if (!configuration) return null;
    const partArrayEl = configuration?.["ns2:PartArray"] || configuration?.PartArray || configuration?.partArray;
    const rawParts = (partArrayEl?.["ns2:Part"] || partArrayEl?.Part || partArrayEl?.part) ??
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
        if (val > 0 && (lowestPrice === null || val < lowestPrice)) lowestPrice = val;
      }
    }
    return lowestPrice;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Self-chain: await the HTTP kick-off (but not the full response) so Deno
// doesn't kill the outgoing request before the next invocation boots.
// ---------------------------------------------------------------------------
async function invokeSelf(offset: number, dateStr: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const url = `${supabaseUrl}/functions/v1/ingest-acc-catalog`;
  try {
    // We await fetch() so the request is actually sent before the parent exits,
    // but we don't wait for the child's full response body.
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
      body: JSON.stringify({ offset, dateStr }),
      signal: AbortSignal.timeout(5000), // just wait for connection, not full response
    });
    console.log(`[ingest-acc-catalog] Self-chain HTTP ${res.status} for offset ${offset}`);
  } catch (e: any) {
    // Timeout on reading response is fine — the child is running
    if (!e.message?.includes("timed out")) {
      console.error("[ingest-acc-catalog] Self-chain error:", e.message);
    } else {
      console.log(`[ingest-acc-catalog] Self-chain dispatched (timeout on read is OK) offset=${offset}`);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* initial trigger has no body */ }

    const dateStr: string = body.dateStr ?? new Date().toISOString().split("T")[0];
    const offset: number = body.offset ?? 0;
    const IDS_PATH = `acc/acc-${dateStr}-ids.json`;
    let method = "continuation";

    // ---- Load or fetch the product ID list ----
    let productIds: string[] = [];

    if (offset === 0) {
      // Initial call — fetch IDs from ACC API and persist to storage
      console.log("[ingest-acc-catalog] Initial call: fetching all product IDs...");
      const result = await fetchAllProductIds(username, password, parser);
      productIds = result.ids;
      method = result.method;

      if (productIds.length === 0) {
        return new Response(
          JSON.stringify({ message: "No products found", upserted: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Persist ID list so continuation chains can reload it without refetching
      await saveArchive(
        supabase,
        IDS_PATH,
        JSON.stringify({ fetchedAt: new Date().toISOString(), method, totalProducts: productIds.length, productIds })
      );
      console.log(`[ingest-acc-catalog] Saved ${productIds.length} IDs to ${IDS_PATH}`);
    } else {
      // Continuation — reload IDs from storage
      const raw = await loadArchive(supabase, IDS_PATH);
      if (!raw) {
        return new Response(
          JSON.stringify({ error: `Cannot find ID list at ${IDS_PATH}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const parsed = JSON.parse(raw);
      productIds = parsed.productIds ?? [];
      method = parsed.method ?? "continuation";
    }

    const startTime = Date.now();
    const chunk = productIds.slice(offset, offset + CHUNK_SIZE);
    const records: any[] = [];
    const errors: string[] = [];

    console.log(`[ingest-acc-catalog] Processing offset ${offset}–${offset + chunk.length} / ${productIds.length} (method=${method})`);

    for (let i = 0; i < chunk.length; i += CONCURRENCY) {
      if (Date.now() - startTime > SAFETY_CUTOFF_MS) {
        console.log("[ingest-acc-catalog] Safety cutoff — will self-chain");
        break;
      }
      const batch = chunk.slice(i, i + CONCURRENCY).filter((productId: string) => {
        // Skip service/fee items (freight, handling, folding, etc.)
        const prefix = productId.trim().toUpperCase().slice(0, 2);
        return !ACC_SERVICE_PREFIXES.has(prefix);
      });
      const results = await Promise.allSettled(
        batch.map(async (productId: string) => {
          const [detailResult, basePriceResult] = await Promise.allSettled([
            fetchProductDetail(productId, username, password, parser),
            fetchBasePrice(productId, username, password, parser),
          ]);
          const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
          const basePrice = basePriceResult.status === "fulfilled" ? basePriceResult.value : null;
          // Derive brand from style prefix first; fall back to API-supplied brand
          const brand = getBrandFromAccProductId(productId, detail?.brand);
          const title = detail?.name || productId;
          // Strip the 2-letter ACC prefix so the style_number aligns with SanMar/S&S canonical keys
          const canonicalStyleNumber = getCanonicalBase(productId);
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
        if (r.status === "fulfilled") records.push(r.value);
        else errors.push(String(r.reason));
      }
      if (i + CONCURRENCY < chunk.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Dedup and upsert
    const seen = new Set<string>();
    const uniqueRecords = records.filter(r => {
      const sn: string = r.style_number ?? "";
      if (!sn || sn === "OBJECTOBJECT" || sn.length < 2) return false;
      if (seen.has(sn)) return false;
      seen.add(sn);
      return true;
    });

    // Filter already applied at fetch time (service prefixes), but double-check here too
    // (getBrandFromAccProductId returns "Atlantic Coast Cotton" for unmapped — keep them filtered)

    let upserted = 0;
    for (let i = 0; i < uniqueRecords.length; i += DB_BATCH_SIZE) {
      const batch = uniqueRecords.slice(i, i + DB_BATCH_SIZE);
      const { error, count } = await supabase
        .from("catalog_products")
        .upsert(batch, { onConflict: "distributor,style_number", count: "exact" });
      if (error) errors.push(`DB: ${error.message}`);
      else upserted += count ?? batch.length;
    }

    const newOffset = offset + records.length;
    const isDone = newOffset >= productIds.length;

    console.log(`[ingest-acc-catalog] Chunk done: processed=${records.length}, upserted=${upserted}, newOffset=${newOffset}/${productIds.length}, isDone=${isDone}`);

    if (!isDone) {
      // Self-chain: pass only offset + dateStr (IDs are stored in the bucket)
      await invokeSelf(newOffset, dateStr);
      console.log(`[ingest-acc-catalog] Self-chain triggered for offset ${newOffset}`);
    } else {
      // Final batch — generate full CSV from DB
      console.log("[ingest-acc-catalog] Final batch — generating CSV from DB...");
      const { data: allRows, error: queryErr } = await supabase
        .from("catalog_products")
        .select("style_number, brand, title, description, base_price, image_url, updated_at")
        .eq("distributor", "acc")
        .order("style_number");

      if (queryErr) {
        console.error("[ingest-acc-catalog] CSV query error:", queryErr.message);
      } else {
        // Paginate to overcome the 1,000-row default limit
        let allRowsPaginated: typeof allRows = allRows ?? [];
        let page = 1;
        while (allRowsPaginated && allRowsPaginated.length === page * 1000) {
          const { data: nextPage } = await supabase
            .from("catalog_products")
            .select("style_number, brand, title, description, base_price, image_url, updated_at")
            .eq("distributor", "acc")
            .order("style_number")
            .range(page * 1000, page * 1000 + 999);
          if (nextPage && nextPage.length > 0) {
            allRowsPaginated = [...allRowsPaginated, ...nextPage];
          }
          page++;
        }
        if (allRowsPaginated && allRowsPaginated.length > 0) {
          const csv = recordsToCsv(allRowsPaginated);
          await saveArchive(supabase, `acc/csv/acc-${dateStr}.csv`, csv, "text/csv");
          console.log(`[ingest-acc-catalog] CSV saved: acc/csv/acc-${dateStr}.csv (${allRowsPaginated.length} rows)`);
        }
      }

      // Save final JSON summary
      await saveArchive(
        supabase,
        `acc/acc-${dateStr}.json`,
        JSON.stringify({
          fetchedAt: new Date().toISOString(),
          method,
          totalProducts: productIds.length,
          status: "complete",
        }, null, 2)
      );
      console.log("[ingest-acc-catalog] Complete.");
    }

    return new Response(
      JSON.stringify({
        method, offset, chunkProcessed: records.length, upserted,
        totalIds: productIds.length, newOffset, isDone,
        errors: errors.slice(0, 10),
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
