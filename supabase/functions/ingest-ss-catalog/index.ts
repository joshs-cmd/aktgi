import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SS_API_BASE = "https://api.ssactivewear.com/v2";

// Rate limit: 60 req/min → 1 req/sec + buffer
const REQUEST_DELAY_MS = 1100; // ~54 req/min — safely under limit
const BATCH_SIZE = 500;        // DB upsert batch size
const MAX_PAGE_SIZE = 500;     // SS API max page size

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  // Support resuming from a specific page offset
  const startPage: number = typeof body.startPage === "number" ? body.startPage : 1;
  // Optional: filter by brand (e.g. ?brand=Gildan for targeted runs)
  const brandFilter: string | null = typeof body.brand === "string" ? body.brand : null;

  console.log(`[ingest-ss-catalog] Starting — page ${startPage}${brandFilter ? ` brand=${brandFilter}` : ""}`);

  let page = startPage;
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  const requestCount = { n: 0 };

  /**
   * Fetch one page of styles from S&S /v2/styles endpoint.
   * Uses per-page + page params; returns empty array when done.
   */
  async function fetchStylesPage(p: number): Promise<SSStyle[]> {
    // Enforce rate limit — 1 request per REQUEST_DELAY_MS
    if (requestCount.n > 0) await sleep(REQUEST_DELAY_MS);
    requestCount.n++;

    const params = new URLSearchParams({
      pageSize: String(MAX_PAGE_SIZE),
      page: String(p),
    });
    if (brandFilter) params.set("brand", brandFilter);

    const url = `${SS_API_BASE}/styles/?${params}`;
    console.log(`[ingest-ss-catalog] GET ${url}`);

    const res = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`S&S API ${res.status}: ${text.substring(0, 300)}`);
    }

    const data = await res.json();
    // API returns array directly or wrapped in { styles: [] }
    return Array.isArray(data) ? data : (data?.styles ?? []);
  }

  try {
    // Paginate until we get an empty page
    while (true) {
      const styles = await fetchStylesPage(page);

      if (!styles || styles.length === 0) {
        console.log(`[ingest-ss-catalog] No more styles at page ${page} — done`);
        break;
      }

      totalFetched += styles.length;
      console.log(`[ingest-ss-catalog] Page ${page}: ${styles.length} styles (total so far: ${totalFetched})`);

      // Map to catalog_products rows
      const rows = styles
        .filter((s) => s.styleName && s.brandName)
        .map((s) => ({
          distributor: "ss-activewear",
          style_number: (s.styleName ?? "").trim(),
          brand: (s.brandName ?? "").trim(),
          title: (s.title ?? `${s.brandName ?? ""} ${s.styleName ?? ""}`).trim(),
          description: null as string | null,
          // Prefer colorFrontImage for product thumbnails, fall back to styleImage
          image_url: buildImageUrl(s.colorFrontImage ?? s.styleImage),
          base_price: s.basePrice ?? null,
          updated_at: new Date().toISOString(),
        }));

      // Upsert in batches to avoid payload limits
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from("catalog_products")
          .upsert(batch, { onConflict: "distributor,style_number" });

        if (error) {
          console.error(`[ingest-ss-catalog] Upsert error (page ${page}, batch ${i / BATCH_SIZE + 1}):`, error.message);
          totalErrors++;
        } else {
          totalUpserted += batch.length;
        }
      }

      // If fewer records than page size, this was the last page
      if (styles.length < MAX_PAGE_SIZE) {
        console.log(`[ingest-ss-catalog] Last page reached (got ${styles.length} < ${MAX_PAGE_SIZE})`);
        break;
      }

      page++;

      // Safety: stop after 55 minutes to stay within Supabase's 60s function timeout
      // For large catalogs the caller should use startPage to resume
      if (Date.now() - startedAt > 55_000) {
        console.log(`[ingest-ss-catalog] Approaching timeout — pausing at page ${page}. Resume with startPage=${page}`);
        return new Response(
          JSON.stringify({
            status: "partial",
            message: `Timeout approaching — resume with startPage=${page}`,
            totalFetched,
            totalUpserted,
            totalErrors,
            nextPage: page,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[ingest-ss-catalog] Done in ${elapsed}s — fetched=${totalFetched} upserted=${totalUpserted} errors=${totalErrors}`);

    return new Response(
      JSON.stringify({
        status: "complete",
        totalFetched,
        totalUpserted,
        totalErrors,
        pagesProcessed: page - startPage + 1,
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
