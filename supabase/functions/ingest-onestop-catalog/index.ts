import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

          const priceFactor = Number(first.price_factor ?? first.pricing?.price_factor ?? 2);
          const divisor = Math.pow(10, priceFactor);
          const pricing = first.pricing as Record<string, number> | null;
          const rawPrice = Number(
            first.my_price ?? pricing?.my_price ?? first.piece ?? pricing?.piece ?? 0
          );
          const basePrice = rawPrice > 0 ? rawPrice / divisor : null;

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
