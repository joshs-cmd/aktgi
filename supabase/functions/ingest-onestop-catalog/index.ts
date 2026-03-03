import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "distributor-archives";

async function saveArchive(
  supabase: ReturnType<typeof createClient>,
  distributor: string,
  filename: string,
  content: string | Uint8Array,
  contentType: string
): Promise<void> {
  try {
    const path = `${distributor}/${filename}`;
    const body = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, body, { contentType, upsert: true });
    if (error) {
      console.warn(`[archive] Failed to save ${path}: ${error.message}`);
    } else {
      console.log(`[archive] Saved ${path} (${body.byteLength} bytes)`);
    }
  } catch (e) {
    console.warn(`[archive] Exception saving archive: ${e}`);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 500;
const ONESTOP_API_BASE = "https://api.onestopinc.com";
const ONESTOP_MEDIA_BASE = "https://media.onestopinc.com/";
const PAGE_SIZE = 100;
const REQUEST_DELAY_MS = 1100; // ~54 req/min to stay under 60 limit

function resolveImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${ONESTOP_MEDIA_BASE}${path.replace(/^\//, "")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const token = Deno.env.get("ONESTOP_API_TOKEN");
  if (!token) {
    return new Response(
      JSON.stringify({ error: "Missing ONESTOP_API_TOKEN secret" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body */ }

  const limit = typeof body.limit === "number" ? body.limit : null;
  const startedAt = Date.now();

  console.log(`[ingest-onestop] Starting${limit ? ` (limit=${limit})` : " (full ingest)"}`);

  const fetchOpts = {
    headers: {
      "Authorization": `Token ${token}`,
      "Accept": "application/json; version=1.0",
    },
    signal: AbortSignal.timeout(25_000),
  };

  // Deduplicate by mill_style_code (manufacturer SKU), fall back to OneStop style_code
  const styleMap = new Map<string, Record<string, unknown>>();
  let totalFetched = 0;
  let nextUrl: string | null = `${ONESTOP_API_BASE}/items/?flat=Y&page_size=${PAGE_SIZE}`;

  try {
    let pageNum = 0;
    while (nextUrl) {
      pageNum++;
      console.log(`[ingest-onestop] GET page ${pageNum}: ${nextUrl}`);

      const res = await fetch(nextUrl, fetchOpts as RequestInit);
      if (!res.ok) {
        let errText = "";
        try { errText = await res.text(); } catch { /* ignore */ }
        throw new Error(`OneStop API ${res.status} on page ${pageNum}: ${(errText || "").substring(0, 400)}`);
      }

      const data = await res.json();

      // Log shape on first page
      if (pageNum === 1) {
        console.log(`[ingest-onestop] Response keys: ${Object.keys(data).join(", ")}`);
        const sampleResults = data.results;
        if (sampleResults && typeof sampleResults === "object" && !Array.isArray(sampleResults)) {
          const firstKey = Object.keys(sampleResults)[0];
          const rawVal = (sampleResults as Record<string, unknown>)[firstKey];
          // Value may be an object directly or an array of items
          const firstVal: unknown = Array.isArray(rawVal) ? rawVal[0] : rawVal;
          console.log(`[ingest-onestop] Sample style key: ${firstKey}`);
          console.log(`[ingest-onestop] Sample item keys: ${firstVal && typeof firstVal === "object" ? Object.keys(firstVal as object).join(", ") : "n/a"}`);
          console.log(`[ingest-onestop] Sample item: ${JSON.stringify(firstVal ?? {}).substring(0, 800)}`);
        } else if (Array.isArray(sampleResults)) {
          const first = sampleResults[0];
          console.log(`[ingest-onestop] Sample item keys: ${first ? Object.keys(first).join(", ") : "n/a"}`);
          console.log(`[ingest-onestop] Sample item: ${JSON.stringify(first ?? {}).substring(0, 800)}`);
        }
      }

      // /items/?flat=Y returns { count, next, previous, results: { styleCode: [items...] } }
      // or results as a flat array depending on the flat param
      let itemsOnPage: Record<string, unknown>[] = [];

      if (data.results && typeof data.results === "object" && !Array.isArray(data.results)) {
        // Grouped by style: { "GD210": {..} or [{...}, ...], "GD500": ... }
        for (const [styleCode, variants] of Object.entries(data.results as Record<string, unknown>)) {
          const items = Array.isArray(variants) ? variants : [variants];
          const first = items[0] as Record<string, unknown>;
          if (!first) continue;

          const millStyle = String(first.mill_style_code ?? first.mill_style ?? styleCode ?? "").trim();
          const styleKey = millStyle || styleCode;
          if (!styleKey) continue;

          const brand = String(first.mill_name ?? first.brand ?? "OneStop").trim();
          const title = String(first.web_name ?? first.description ?? first.name ?? `${brand} ${styleKey}`).trim();
          const desc = String(first.long_description ?? first.details ?? "").trim() || null;

          // Images: generic_image / generic_thumbnail are relative paths
          const rawImage = (first.generic_image ?? first.generic_thumbnail ?? first.image) as string | null;
          const imageUrl = resolveImageUrl(rawImage);
          // Pricing is fetched separately via /items/pricing/?skus= after catalog is built
          const basePrice = null; // will be enriched below

          const existing = styleMap.get(styleKey);
          if (!existing || (!existing.image_url && imageUrl)) {
            styleMap.set(styleKey, {
              distributor: "onestop",
              style_number: styleKey,
              brand,
              title,
              description: desc,
              image_url: imageUrl,
              base_price: basePrice,
              updated_at: new Date().toISOString(),
            });
          }
          itemsOnPage.push(first);
        }
      } else if (Array.isArray(data.results)) {
        // Flat array of items
        itemsOnPage = data.results;
        for (const item of itemsOnPage) {
          const styleKey = String(item.mill_style_code ?? item.style_code ?? item.style ?? "").trim();
          if (!styleKey) continue;
          const brand = String(item.mill_name ?? item.brand ?? "OneStop").trim();
          const title = String(item.web_name ?? item.description ?? item.name ?? `${brand} ${styleKey}`).trim();
          const images = item.images as Record<string, string> | null;
          const rawImage = images?.main ?? images?.front ?? (item.image as string) ?? null;
          const imageUrl = resolveImageUrl(rawImage);
          const existing = styleMap.get(styleKey);
          if (!existing || (!existing.image_url && imageUrl)) {
            styleMap.set(styleKey, {
              distributor: "onestop",
              style_number: styleKey,
              brand,
              title,
              description: null,
              image_url: imageUrl,
              base_price: null,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      totalFetched += itemsOnPage.length;
      console.log(`[ingest-onestop] Page ${pageNum}: +${itemsOnPage.length} items, ${styleMap.size} unique styles so far`);

      if (limit && totalFetched >= limit) {
        console.log(`[ingest-onestop] Reached limit=${limit}, stopping`);
        break;
      }

      nextUrl = data.next ?? null;

      if (nextUrl) {
        await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
      }
    }

    const rows = Array.from(styleMap.values());
    console.log(`[ingest-onestop] Total fetched=${totalFetched} unique=${rows.length}`);

    // Save raw catalog snapshot to storage archive before processing
    const dateStr = new Date().toISOString().slice(0, 10);
    await saveArchive(supabase, "onestop", `onestop-${dateStr}.json`, JSON.stringify(rows), "application/json");

    // Enrich base_price using the documented /items/pricing/?skus= endpoint.
    // We need actual SKU codes (e.g. "GD-110-36-XL") but during catalog ingest we only have
    // style codes. Fetch a representative SKU per style and use its my_price.
    // API docs: prices are integers in cents (e.g. 281 = $2.81), divide by 10^price_factor.
    // my_price = the price you pay at your price_level (case/dozen/piece).
    const PRICING_BATCH = 20;
    let pricesEnriched = 0;
    const styleKeys = Array.from(styleMap.keys());

    // For each style, fetch one SKU to get a representative price
    // We'll batch by fetching /items/?style=X for up to 5 styles at once (per docs: 5 style limit)
    // but since we already have style->items mapping from catalog, we sample a first sku_code
    // from the flat items we stored in styleFirstSku map
    const styleFirstSkuMap = new Map<string, string>(); // styleKey -> sku_code
    // Re-read from styleSkuCodes which we need to populate during catalog loop
    // (We'll use a simpler approach: fetch /items/pricing/?skus= for each style using the style itself
    // since docs show ?skus= accepts sku codes. Instead batch-fetch pricing via style-level endpoint)
    // Fetch pricing for first ~100 styles to seed base_price (full pricing needs per-sku codes)
    const priceSampleStyles = styleKeys.slice(0, 100);
    for (let i = 0; i < priceSampleStyles.length; i += 5) {
      const batch = priceSampleStyles.slice(i, i + 5);
      await Promise.all(batch.map(async (styleKey) => {
        try {
          const invUrl = `${ONESTOP_API_BASE}/items/?style=${encodeURIComponent(styleKey)}&page_size=1`;
          const r = await fetch(invUrl, fetchOpts as RequestInit);
          if (!r.ok) return;
          const d = await r.json();
          const items: Record<string, unknown>[] = Array.isArray(d.results) ? d.results : [];
          if (items.length === 0) return;
          const skuCode = String(items[0].code ?? "");
          if (!skuCode) return;

          const pricingUrl = `${ONESTOP_API_BASE}/items/pricing/?skus=${encodeURIComponent(skuCode)}`;
          const pr = await fetch(pricingUrl, fetchOpts as RequestInit);
          if (!pr.ok) return;
          const pd = await pr.json();
          const results: Record<string, unknown>[] = Array.isArray(pd.results) ? pd.results : [];
          for (const resultItem of results) {
            for (const [, skuData] of Object.entries(resultItem)) {
              if (!skuData || typeof skuData !== "object") continue;
              const sd = skuData as Record<string, unknown>;
              const pricing = sd.pricing as Record<string, unknown> | undefined;
              if (!pricing) continue;
              const pfactor = Number(sd.pfactor ?? sd.price_factor ?? 2);
              const divisor = Math.pow(10, pfactor);
              const rawPrice = pricing.my_price ?? pricing.piece ?? pricing.dozen ?? pricing.case;
              if (typeof rawPrice === "number" && rawPrice > 0) {
                const price = rawPrice / divisor;
                const existing = styleMap.get(styleKey);
                if (existing) {
                  existing.base_price = price;
                  pricesEnriched++;
                  console.log(`[ingest-onestop] Pricing enriched ${styleKey}: $${price.toFixed(2)} (sku=${skuCode}, my_price=${rawPrice}, level=${sd.price_level})`);
                }
              }
            }
          }
        } catch (e) {
          console.warn(`[ingest-onestop] Price fetch error for ${styleKey}: ${e}`);
        }
      }));
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }
    console.log(`[ingest-onestop] Pricing enrichment complete: ${pricesEnriched} styles got base_price`);

    // Upsert in batches
    let totalUpserted = 0;
    let totalErrors = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("catalog_products")
        .upsert(batch, { onConflict: "distributor,style_number" });

      if (error) {
        console.error(`[ingest-onestop] Upsert error batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
        totalErrors++;
      } else {
        totalUpserted += batch.length;
        console.log(`[ingest-onestop] Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)} (${totalUpserted} total)`);
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[ingest-onestop] Done in ${elapsed}s — fetched=${totalFetched} unique=${rows.length} upserted=${totalUpserted} errors=${totalErrors}`);

    return new Response(
      JSON.stringify({
        status: "complete",
        totalItemsFetched: totalFetched,
        uniqueStyles: rows.length,
        totalUpserted,
        totalErrors,
        elapsedSeconds: parseFloat(elapsed),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ingest-onestop] Fatal error:", msg);
    return new Response(
      JSON.stringify({ error: msg, partialStyles: styleMap.size }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
