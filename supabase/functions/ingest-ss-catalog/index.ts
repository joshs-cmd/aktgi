import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SS_API_BASE = "https://api.ssactivewear.com/v2";

// Rate limit: 60 req/min → 1 req/sec + buffer
const BATCH_SIZE = 500; // DB upsert batch size

interface SSStyle {
  styleID?: number;
  styleName?: string;
  brandName?: string;
  title?: string;
  baseCategory?: string;
  styleImage?: string;
  colorFrontImage?: string;
  basePrice?: number;
}

function buildImageUrl(path: string | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `https://www.ssactivewear.com/${path.replace(/^\//, "")}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const username = Deno.env.get("SS_ACTIVEWEAR_USERNAME");
  const password = Deno.env.get("SS_ACTIVEWEAR_PASSWORD");

  if (!username || !password) {
    return new Response(
      JSON.stringify({ error: "Missing SS_ACTIVEWEAR credentials" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const authHeader = "Basic " + btoa(`${username}:${password}`);
  const startedAt = Date.now();

  let body: Record<string, unknown> = {};
  try {
    body = req.method === "POST" ? await req.json() : {};
  } catch { /* no body */ }

  // Support optional brand filter (e.g. POST { "brand": "Gildan" } for targeted runs)
  const brandFilter: string | null = typeof body.brand === "string" ? body.brand : null;

  console.log(`[ingest-ss-catalog] Starting${brandFilter ? ` brand=${brandFilter}` : " (all brands)"}`);

  let totalFetched = 0;
  let totalUpserted = 0;
  let totalErrors = 0;

  /**
   * S&S /v2/styles returns ALL variants (one row per color×size) in a single response.
   * Pagination params are ignored — we fetch once and deduplicate by styleName.
   */
  async function fetchAllStyles(): Promise<SSStyle[]> {
    const params = new URLSearchParams();
    if (brandFilter) params.set("brand", brandFilter);

    const url = `${SS_API_BASE}/styles/${params.toString() ? "?" + params : ""}`;
    console.log(`[ingest-ss-catalog] GET ${url}`);

    const res = await fetch(url, {
      headers: { Authorization: authHeader, Accept: "application/json" },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`S&S API ${res.status}: ${text.substring(0, 300)}`);
    }

    const data = await res.json();
    return Array.isArray(data) ? data : (data?.styles ?? []);
  }

  try {
    const allVariants = await fetchAllStyles();
    totalFetched = allVariants.length;
    console.log(`[ingest-ss-catalog] Fetched ${totalFetched} variant rows`);

    // Save raw JSON archive before processing
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const archiveFilename = `ss-activewear-${dateStr}.json`;
    await saveArchive(supabase, "ss-activewear", archiveFilename, JSON.stringify(allVariants), "application/json");

    // Deduplicate by styleName — keep the variant with the best (non-null) colorFrontImage
    const styleMap = new Map<string, Record<string, unknown>>();
    for (const s of allVariants) {
      if (!s.styleName || !s.brandName) continue;
      const key = s.styleName.trim();
      const existing = styleMap.get(key);
      const imageUrl = buildImageUrl(s.colorFrontImage ?? s.styleImage);
      if (!existing || (!existing.image_url && imageUrl)) {
        styleMap.set(key, {
          distributor: "ss-activewear",
          style_number: key,
          brand: s.brandName.trim(),
          title: (s.title ?? `${s.brandName} ${s.styleName}`).trim(),
          description: null,
          image_url: imageUrl,
          base_price: s.basePrice ?? null,
          updated_at: new Date().toISOString(),
        });
      }
    }

    const rows = Array.from(styleMap.values());
    console.log(`[ingest-ss-catalog] Deduped to ${rows.length} unique styles`);

    // Upsert in BATCH_SIZE chunks with a 1-second delay between DB calls
    // (rate limit applies to S&S API calls; we already made exactly 1 above)
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("catalog_products")
        .upsert(batch, { onConflict: "distributor,style_number" });

      if (error) {
        console.error(`[ingest-ss-catalog] Upsert error batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
        totalErrors++;
      } else {
        totalUpserted += batch.length;
        console.log(`[ingest-ss-catalog] Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)} (${totalUpserted} total)`);
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[ingest-ss-catalog] Done in ${elapsed}s — fetched=${totalFetched} unique=${rows.length} upserted=${totalUpserted} errors=${totalErrors}`);

    return new Response(
      JSON.stringify({
        status: "complete",
        totalVariantsFetched: totalFetched,
        uniqueStyles: rows.length,
        totalUpserted,
        totalErrors,
        elapsedSeconds: parseFloat(elapsed),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ingest-ss-catalog] Fatal error:", msg);
    return new Response(
      JSON.stringify({ error: msg, totalFetched, totalUpserted, totalErrors }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
