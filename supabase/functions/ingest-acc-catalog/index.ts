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
const CHUNK_SIZE = 80; // Products enriched per function invocation
const SAFETY_CUTOFF_MS = 50_000; // 50s safety cutoff (edge function limit ~60s CPU)
const ACC_PRODUCT_DATA_ENDPOINT = "https://promo.acc-api.com/live/productData.php";
const ACC_PRICING_ENDPOINT      = "https://promo.acc-api.com/live/productPricingAndConfig.php";

// ---------------------------------------------------------------------------
// Brand normalization
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
  "BELLA+CANVAS":        ["BC"],
  "NEXT LEVEL":          ["NL"],
  "A4":                  ["A4"],
  "GILDAN":              ["GH400", "GH000", "G"],
  "SPORT-TEK":           ["BST", "ST"],
  "PORT & COMPANY":      ["PC"],
  "COMFORT COLORS":      ["CC"],
  "DISTRICT":            ["DT"],
  "JERZEES":             ["J"],
  "HANES":               ["H"],
  "NEW ERA":             ["NE"],
  "INDEPENDENT TRADING": ["IND"],
  "ALTERNATIVE":         ["AA"],
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

const unwrap = (val: any): string => {
  if (val == null) return "";
  if (typeof val === "object") return String(val["#text"] ?? val["__text"] ?? "").trim();
  return String(val).trim();
};

async function saveArchive(
  supabase: ReturnType<typeof createClient>,
  filename: string,
  content: string,
  subfolder = ""
): Promise<void> {
  const path = subfolder ? `acc/${subfolder}/${filename}` : `acc/${filename}`;
  const contentType = filename.endsWith(".csv") ? "text/csv" : "application/json";
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, new TextEncoder().encode(content), { contentType, upsert: true });
  if (error) console.error("[ingest-acc-catalog] Archive upload error:", error.message);
}

// ---------------------------------------------------------------------------
// Generate CSV from catalog records (matches master format)
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
    console.log("[ingest-acc-catalog] Calling GetProductSellable (full catalog)...");
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
              console.log(`[ingest-acc-catalog] GetProductSellable: ${ids.length} product IDs`);
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
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": '"GetProductDateModified"',
    },
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
  if (!respKey) throw new Error(`No key found. Keys: ${Object.keys(bodyEl).join(", ")}`);
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
  const ids = Array.from(seen);
  return { ids, method: "GetProductDateModified" };
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
// Self-chaining invoke
// ---------------------------------------------------------------------------
async function invokeSelf(
  supabase: ReturnType<typeof createClient>,
  offset: number,
  productIds: string[],
  dateStr: string
): Promise<void> {
  const projectId = Deno.env.get("SUPABASE_URL")?.match(/https:\/\/([^.]+)/)?.[1];
  if (!projectId) return;
  const url = `https://${projectId}.supabase.co/functions/v1/ingest-acc-catalog`;
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ offset, productIds, dateStr }),
  }).catch(e => console.error("[ingest-acc-catalog] Self-chain invoke error:", e.message));
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

    // Check if this is a continuation (self-chained) call
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body on initial trigger */ }

    let productIds: string[] = body.productIds ?? [];
    let offset: number = body.offset ?? 0;
    const dateStr: string = body.dateStr ?? new Date().toISOString().split("T")[0];
    let method = "continuation";

    if (productIds.length === 0) {
      // Initial call — fetch all IDs
      console.log("[ingest-acc-catalog] Initial call: fetching all product IDs...");
      const result = await fetchAllProductIds(username, password, parser);
      productIds = result.ids;
      method = result.method;
      offset = 0;

      if (productIds.length === 0) {
        return new Response(
          JSON.stringify({ message: "No products found", upserted: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Archive the ID list
      await saveArchive(
        supabase,
        `acc-${dateStr}-ids.json`,
        JSON.stringify({ fetchedAt: new Date().toISOString(), method, totalProducts: productIds.length, productIds }, null, 2)
      );

      console.log(`[ingest-acc-catalog] Total: ${productIds.length} IDs via ${method}. Starting at offset 0.`);
    }

    const startTime = Date.now();
    const chunk = productIds.slice(offset, offset + CHUNK_SIZE);
    const records: any[] = [];
    const errors: string[] = [];

    console.log(`[ingest-acc-catalog] Processing offset ${offset}-${offset + chunk.length} of ${productIds.length}...`);

    for (let i = 0; i < chunk.length; i += CONCURRENCY) {
      if (Date.now() - startTime > SAFETY_CUTOFF_MS) {
        console.log("[ingest-acc-catalog] Safety cutoff hit, will self-chain");
        break;
      }
      const batch = chunk.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (productId) => {
          const [detailResult, basePriceResult] = await Promise.allSettled([
            fetchProductDetail(productId, username, password, parser),
            fetchBasePrice(productId, username, password, parser),
          ]);
          const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
          const basePrice = basePriceResult.status === "fulfilled" ? basePriceResult.value : null;
          const brand = detail?.brand || "ATLANTIC COAST COTTON";
          const title = detail?.name || productId;
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

    console.log(`[ingest-acc-catalog] Chunk done: processed=${records.length}, upserted=${upserted}, offset=${newOffset}/${productIds.length}, done=${isDone}`);

    // Self-chain if more products remain
    if (!isDone) {
      console.log(`[ingest-acc-catalog] Self-chaining for offset ${newOffset}...`);
      await invokeSelf(supabase, newOffset, productIds, dateStr);
    } else {
      // Final run: query ALL acc records from DB to build complete CSV
      console.log("[ingest-acc-catalog] All products processed! Generating final CSV...");
      const { data: allRows, error: queryErr } = await supabase
        .from("catalog_products")
        .select("style_number, brand, title, description, base_price, image_url, updated_at")
        .eq("distributor", "acc")
        .order("style_number");

      if (queryErr) {
        console.error("[ingest-acc-catalog] CSV query error:", queryErr.message);
      } else if (allRows && allRows.length > 0) {
        const csv = recordsToCsv(allRows);
        await saveArchive(supabase, `acc-${dateStr}.csv`, csv, "csv");
        console.log(`[ingest-acc-catalog] CSV saved: acc/csv/acc-${dateStr}.csv (${allRows.length} rows)`);
      }

      // Save final JSON summary
      await saveArchive(
        supabase,
        `acc-${dateStr}.json`,
        JSON.stringify({
          fetchedAt: new Date().toISOString(),
          method,
          totalProducts: productIds.length,
          status: "complete",
        }, null, 2)
      );
    }

    return new Response(
      JSON.stringify({
        method,
        offset,
        chunkProcessed: records.length,
        upserted,
        totalIds: productIds.length,
        newOffset,
        isDone,
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
