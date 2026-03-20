import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Distributors to pre-warm (acc excluded — SOAP calls too slow)
const PRE_WARM_DISTRIBUTORS = ["sanmar", "ss-activewear", "onestop"];

// OneStop rate limit: 60 calls/min across all 3 distributors
// With 3 distributors per SKU, batch of 15 SKUs = 45 calls per batch
// 15-second pause ensures well under 60/min limit
const BATCH_SIZE = 15;
const BATCH_PAUSE_MS = 15_000;

interface PopularSku {
  style_number: string;
  brand: string | null;
}

interface CacheSetting {
  distributor: string;
  ttl_hours: number;
}

interface CacheEntry {
  distributor: string;
  style_number: string;
  expires_at: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log("[pre-warm-cache] Starting nightly pre-warm run...");
  const startTime = Date.now();

  // 1. Load active SKUs
  const { data: skus, error: skusError } = await supabase
    .from("popular_skus")
    .select("style_number, brand")
    .eq("active", true)
    .order("annual_units", { ascending: false });

  if (skusError || !skus) {
    console.error("[pre-warm-cache] Failed to load popular_skus:", skusError);
    return new Response(
      JSON.stringify({ error: "Failed to load popular_skus" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[pre-warm-cache] Loaded ${skus.length} active SKUs`);

  // 2. Load TTL settings
  const { data: cacheSettings } = await supabase
    .from("cache_settings")
    .select("distributor, ttl_hours");

  const ttlMap: Record<string, number> = {};
  for (const row of (cacheSettings ?? []) as CacheSetting[]) {
    ttlMap[row.distributor] = row.ttl_hours;
  }
  // Defaults if not in DB
  const getTtl = (dist: string) => ttlMap[dist] ?? 14;

  // 3. Load existing fresh cache entries to skip already-cached SKUs
  const now = new Date();
  const { data: freshEntries } = await supabase
    .from("product_cache")
    .select("distributor, style_number, expires_at")
    .gt("expires_at", now.toISOString());

  const freshSet = new Set<string>();
  for (const entry of (freshEntries ?? []) as CacheEntry[]) {
    freshSet.add(`${entry.distributor}::${entry.style_number.toUpperCase()}`);
  }

  // 4. Determine which SKU+distributor combos need warming
  interface WarmJob {
    sku: PopularSku;
    distributor: string;
  }
  const jobs: WarmJob[] = [];
  for (const sku of skus as PopularSku[]) {
    for (const dist of PRE_WARM_DISTRIBUTORS) {
      const key = `${dist}::${sku.style_number.toUpperCase()}`;
      if (!freshSet.has(key)) {
        jobs.push({ sku, distributor: dist });
      }
    }
  }

  // Group jobs back into per-SKU batches (all 3 distributors for a SKU run in parallel)
  const skuStyleNumbers = [...new Set(jobs.map((j) => j.sku.style_number))];
  const skuMap = new Map<string, PopularSku>();
  for (const sku of skus as PopularSku[]) skuMap.set(sku.style_number, sku);

  const skusNeedingWarm = skuStyleNumbers.filter((sn) =>
    PRE_WARM_DISTRIBUTORS.some(
      (d) => !freshSet.has(`${d}::${sn.toUpperCase()}`)
    )
  );

  const skusSkipped = skus.length - skusNeedingWarm.length;
  console.log(
    `[pre-warm-cache] ${skusNeedingWarm.length} SKUs need warming, ${skusSkipped} already fresh`
  );

  let processed = 0;
  let failed = 0;

  // 5. Process in batches of BATCH_SIZE SKUs
  for (let i = 0; i < skusNeedingWarm.length; i += BATCH_SIZE) {
    const batch = skusNeedingWarm.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(skusNeedingWarm.length / BATCH_SIZE);
    console.log(
      `[pre-warm-cache] Processing batch ${batchNum}/${totalBatches} (${batch.length} SKUs)`
    );

    // For each SKU in batch, call all 3 providers in parallel
    const batchPromises = batch.map(async (styleNumber) => {
      const sku = skuMap.get(styleNumber)!;
      const distPromises = PRE_WARM_DISTRIBUTORS
        .filter((d) => !freshSet.has(`${d}::${styleNumber.toUpperCase()}`))
        .map(async (distributor) => {
          try {
            const functionName = `provider-${distributor}`;
            const body: Record<string, string> = { query: styleNumber };
            if (sku.brand) body.brand = sku.brand;

            const { data, error } = await supabase.functions.invoke(
              functionName,
              { body }
            );

            if (error) {
              console.warn(
                `[pre-warm-cache] ${distributor}/${styleNumber} invoke error:`,
                error.message
              );
              return false;
            }

            // Only cache if product was found
            if (!data?.product) {
              console.log(
                `[pre-warm-cache] ${distributor}/${styleNumber} returned no product — skipping cache`
              );
              return true; // Not a failure, just no result
            }

            const ttlHours = getTtl(distributor);
            const expiresAt = new Date(
              Date.now() + ttlHours * 60 * 60 * 1000
            ).toISOString();

            const { error: upsertError } = await supabase
              .from("product_cache")
              .upsert(
                {
                  distributor,
                  style_number: styleNumber,
                  response_data: data,
                  cached_at: new Date().toISOString(),
                  expires_at: expiresAt,
                },
                { onConflict: "distributor,style_number" }
              );

            if (upsertError) {
              console.error(
                `[pre-warm-cache] Cache upsert failed for ${distributor}/${styleNumber}:`,
                upsertError.message
              );
              return false;
            }

            console.log(
              `[pre-warm-cache] Cached ${distributor}/${styleNumber} (TTL: ${ttlHours}h)`
            );
            return true;
          } catch (err) {
            console.error(
              `[pre-warm-cache] Exception for ${distributor}/${styleNumber}:`,
              err
            );
            return false;
          }
        });

      const results = await Promise.all(distPromises);
      return results;
    });

    const batchResults = await Promise.all(batchPromises);
    for (const skuResults of batchResults) {
      processed++;
      if (skuResults.some((r) => r === false)) failed++;
    }

    // Pause between batches to respect OneStop rate limit (except after last batch)
    if (i + BATCH_SIZE < skusNeedingWarm.length) {
      console.log(
        `[pre-warm-cache] Batch ${batchNum} complete. Pausing ${BATCH_PAUSE_MS / 1000}s before next batch...`
      );
      await sleep(BATCH_PAUSE_MS);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = {
    total_skus: skus.length,
    skus_skipped_fresh: skusSkipped,
    skus_processed: processed,
    skus_failed: failed,
    elapsed_seconds: parseFloat(elapsed),
  };

  console.log("[pre-warm-cache] Run complete:", JSON.stringify(summary));

  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
