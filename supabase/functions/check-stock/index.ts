import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorize } from "../_shared/authGuard.ts";
import { resolveDistributorSkus } from "../_shared/catalogResolve.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-akt-service-key",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const KNOWN_ORDER = ["sanmar", "ss-activewear", "onestop", "acc"];
const DISPLAY: Record<string, string> = { sanmar: "SanMar", "ss-activewear": "S&S", onestop: "OneStop", acc: "ACC" };

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function normSize(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || /^quote$/i.test(s)) return null;
  const u = s.toUpperCase();
  const map: Record<string, string> = {
    "X SMALL": "XS", XS: "XS", SMALL: "S", S: "S", MEDIUM: "M", M: "M", LARGE: "L", L: "L",
    "X LARGE": "XL", XL: "XL", XXL: "2XL", XXXL: "3XL", "ONE SIZE": "OS", OS: "OS", OSFA: "OS",
  };
  if (map[u]) return map[u];
  const m = s.match(/^(\d)X Large$/i) || s.match(/^(\d)XL$/i) || s.match(/^(\d)X$/i);
  if (m) return `${m[1]}XL`;
  return u;
}

interface InSize { size: string; quantity: number }
interface InDesign { name?: string; rms?: string; brand: string; style: string; color: string; sizes: InSize[] }

function validate(body: any): InDesign[] | string {
  if (!body || !Array.isArray(body.designs)) return "designs must be an array";
  if (body.designs.length === 0 || body.designs.length > 100) return "designs must have 1-100 items";
  for (const [i, d] of body.designs.entries()) {
    if (!d || typeof d !== "object") return `designs[${i}] invalid`;
    for (const f of ["brand", "style", "color"]) {
      if (typeof d[f] !== "string" || !d[f].trim() || d[f].length > 200) return `designs[${i}].${f} required`;
    }
    if (d.name != null && typeof d.name !== "string") return `designs[${i}].name must be string`;
    if (d.rms != null && typeof d.rms !== "string" && typeof d.rms !== "number") return `designs[${i}].rms invalid`;
    if (!Array.isArray(d.sizes) || d.sizes.length > 50) return `designs[${i}].sizes must be an array`;
    for (const s of d.sizes) {
      if (!s || typeof s.size !== "string" || typeof s.quantity !== "number" || !isFinite(s.quantity)) {
        return `designs[${i}].sizes entries need size (string) and quantity (number)`;
      }
    }
  }
  return body.designs as InDesign[];
}

const STYLE_CONCURRENCY = 3;
const RETRY_DELAYS_MS = [500, 1500];
const CALL_TIMEOUT_MS = 20000;

type CallResult = { ok: boolean; product: any; retryable: boolean; rateLimited?: boolean };
// Platform caps edge-function-to-edge-function calls at 30 per trace per 60s; stay under it.
const CALL_BUDGET = 28;

async function callProviderOnce(url: string, key: string, code: string, body: unknown): Promise<CallResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/functions/v1/provider-${code}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = (await res.text().catch(() => "")).slice(0, 120);
      console.warn(`[check-stock] provider-${code} HTTP ${res.status}: ${txt}`);
      return { ok: false, product: null, retryable: res.status === 429 || res.status >= 500 };
    }
    const data = await res.json().catch(() => undefined);
    if (data === undefined || data === null) return { ok: false, product: null, retryable: true };
    if (data.error) return { ok: false, product: null, retryable: false };
    return { ok: true, product: data.product ?? null, retryable: false };
  } catch (e) {
    const name = (e as Error).name;
    console.warn(`[check-stock] provider-${code} fetch failed: ${name}`);
    // Platform per-trace budget (30 fn-to-fn calls / 60s): retrying inside this request cannot succeed.
    if (name === "RateLimitError") return { ok: false, product: null, retryable: false, rateLimited: true };
    return { ok: false, product: null, retryable: true };
  } finally {
    clearTimeout(t);
  }
}

type Stats = { calls: number; retries: number; cacheHits: number; rateLimited: number; budgetSkipped: number; catalogSkipped: number };
async function callProvider(url: string, key: string, code: string, body: unknown, stats: Stats): Promise<{ ok: boolean; product: any }> {
  if (stats.calls >= CALL_BUDGET) { stats.budgetSkipped++; return { ok: false, product: null }; }
  let r = await callProviderOnce(url, key, code, body);
  stats.calls++;
  if (r.rateLimited) stats.rateLimited++;
  for (let i = 0; !r.ok && r.retryable && i < RETRY_DELAYS_MS.length; i++) {
    await new Promise((res) => setTimeout(res, RETRY_DELAYS_MS[i]));
    if (stats.calls >= CALL_BUDGET) { stats.budgetSkipped++; break; }
    stats.retries++;
    stats.calls++;
    r = await callProviderOnce(url, key, code, body);
  }
  return { ok: r.ok, product: r.product };
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  });
  await Promise.all(workers);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await authorize(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const designs = validate(body);
  if (typeof designs === "string") return json({ error: designs }, 400);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, key);

    const { data: distRows, error: dErr } = await supabase.from("distributors").select("code, name").eq("is_active", true);
    if (dErr) throw new Error("distributors lookup failed");
    const dists = (distRows ?? []).slice().sort((a: any, b: any) => {
      const ia = KNOWN_ORDER.indexOf(a.code), ib = KNOWN_ORDER.indexOf(b.code);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return String(a.name).localeCompare(String(b.name));
    }).map((d: any) => ({ code: d.code as string, name: DISPLAY[d.code] ?? (d.name as string) }));

    // Aggregate garments
    type Garment = { key: string; brand: string; style: string; color: string; designs: { name: string | null; rms: string | null }[]; need: Record<string, number> };
    const garments = new Map<string, Garment>();
    for (const d of designs) {
      const key = `${norm(d.brand)}|${norm(d.style)}|${norm(d.color)}`;
      let g = garments.get(key);
      if (!g) { g = { key, brand: d.brand, style: d.style, color: d.color, designs: [], need: {} }; garments.set(key, g); }
      g.designs.push({ name: d.name ?? null, rms: d.rms != null ? String(d.rms) : null });
      for (const s of d.sizes) {
        const sz = normSize(s.size);
        if (!sz || s.quantity <= 0) continue;
        g.need[sz] = (g.need[sz] ?? 0) + s.quantity;
      }
    }

    // Fetch per unique brand+style
    const styleKey = (b: string, s: string) => `${norm(b)}|${norm(s)}`;
    const styles = new Map<string, { brand: string; style: string }>();
    for (const g of garments.values()) styles.set(styleKey(g.brand, g.style), { brand: g.brand, style: g.style });

    type DistResult = { code: string; name: string; ok: boolean; product: any; sku: string };
    const fetched = new Map<string, DistResult[]>();
    const stats: Stats = { calls: 0, retries: 0, cacheHits: 0, rateLimited: 0, budgetSkipped: 0, catalogSkipped: 0 };
    const t0 = Date.now();
    // Resolve SKUs for every style, then read the providers' own fresh cache rows directly
    // (same table/key/payload each provider returns on a cache hit) so only cold lookups cost a call.
    const styleList = [...styles.entries()];
    const skuMaps = new Map<string, Record<string, string>>();
    await runPool(styleList, 5, async ([sk, { brand, style }]) => {
      skuMaps.set(sk, await resolveDistributorSkus(supabase, brand, style).catch(() => ({} as Record<string, string>)));
    });
    const cacheKeyOf = (q: string) => q.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const cache = new Map<string, any>();
    const wantKeys = new Set<string>();
    for (const [sk, { style }] of styleList) for (const d of dists) wantKeys.add(cacheKeyOf(skuMaps.get(sk)?.[d.code] ?? style));
    if (wantKeys.size) {
      const { data: rows } = await supabase.from("product_cache").select("distributor, style_number, response_data")
        .in("distributor", dists.map((d) => d.code)).in("style_number", [...wantKeys]).gt("expires_at", new Date().toISOString());
      for (const r of rows ?? []) if (r.response_data) cache.set(`${r.distributor}|${r.style_number}`, r.response_data);
    }
    await runPool(styleList, STYLE_CONCURRENCY, async ([sk, { brand, style }]) => {
      const skuMap = skuMaps.get(sk) ?? {};
      const results = await Promise.all(dists.map(async (d) => {
        const sku = skuMap[d.code] ?? style;
        // Catalog knows which distributors carry this style; skip the ones it says don't
        // (reported as style not found) so the limited call budget goes to real lookups.
        if (Object.keys(skuMap).length > 0 && !(d.code in skuMap)) {
          stats.catalogSkipped++;
          return { code: d.code, name: d.name, ok: true, product: null, sku };
        }
        const hit = cache.get(`${d.code}|${cacheKeyOf(sku)}`);
        if (hit) {
          stats.cacheHits++;
          return { code: d.code, name: d.name, ok: !hit.error, product: hit.error ? null : (hit.product ?? null), sku };
        }
        const r = await callProvider(url, key, d.code, { query: sku, distributorId: `${d.code}-001`, brand, force_refresh: false }, stats);
        return { code: d.code, name: d.name, ok: r.ok, product: r.product, sku };
      }));
      fetched.set(sk, results);
    });
    const unanswered = [...fetched.values()].filter((rs) => rs.length > 0 && rs.every((r) => !r.ok)).length;
    console.log(`[check-stock] summary: styles=${styles.size} garments=${garments.size} cache_hits=${stats.cacheHits} catalog_skipped=${stats.catalogSkipped} provider_calls=${stats.calls} retries=${stats.retries} rate_limited=${stats.rateLimited} budget_skipped=${stats.budgetSkipped} styles_unanswered=${unanswered} ms=${Date.now() - t0}`);

    const out = [...garments.values()].map((g) => {
      const results = fetched.get(styleKey(g.brand, g.style)) ?? [];
      const sizes = Object.keys(g.need);
      const unavailable = results.filter((r) => !r.ok).map((r) => r.name);
      const colorTarget = norm(g.color);
      const allColors = new Set<string>();

      const by = results.map((r) => {
        const colors: any[] = Array.isArray(r.product?.colors) ? r.product.colors : [];
        const found = r.ok && !!r.product;
        colors.forEach((c) => c?.name && allColors.add(String(c.name)));
        const color = colors.find((c) => norm(c?.name) === colorTarget);
        const available: Record<string, number> = {};
        let capped = false;
        if (color) {
          for (const s of color.sizes ?? []) {
            const sz = normSize(s.code);
            if (!sz) continue;
            let q = 0;
            for (const w of s.inventory ?? []) { q += Number(w.quantity) || 0; if (w.isCapped) capped = true; }
            available[sz] = (available[sz] ?? 0) + q;
          }
        }
        return { distributor: r.name, found, color_found: !!color, available, capped, sku_used: r.sku };
      });

      const combined: Record<string, number> = {};
      for (const s of sizes) combined[s] = by.reduce((t, b) => t + (b.available[s] ?? 0), 0);

      const res: any = { key: g.key, brand: g.brand, style: g.style, color: g.color, designs: g.designs, need: g.need, combined, by_distributor: by };
      if (unavailable.length) res.unavailable = unavailable;

      const anyFound = by.some((b) => b.found);
      const anyColor = by.some((b) => b.color_found);
      if (!anyFound) {
        res.status = "unknown";
        res.reason = unavailable.length === results.length && results.length > 0 ? "no_response" : "style_not_found";
      } else if (!anyColor) {
        res.status = "unknown";
        res.reason = "color_not_found";
        res.available_colors = [...allColors].slice(0, 8);
      } else {
        const covering = by.filter((b) => b.color_found && sizes.every((s) => (b.available[s] ?? 0) >= g.need[s]));
        if (covering.length) {
          const total = (b: typeof by[number]) => Object.values(b.available).reduce((a, c) => a + c, 0);
          let best = covering[0];
          for (const c of covering) if (total(c) > total(best)) best = c;
          res.status = "ok";
          res.best = best.distributor;
        } else if (sizes.every((s) => combined[s] >= g.need[s])) {
          res.status = "combined";
        } else {
          res.status = "short";
          res.short_sizes = sizes.filter((s) => combined[s] < g.need[s]).map((s) => ({ size: s, need: g.need[s], available: combined[s] }));
        }
      }
      return res;
    });

    return json({ ok: true, checked_at: new Date().toISOString(), garments: out });
  } catch (e) {
    console.error(`[check-stock] error: ${(e as Error).message}`);
    return json({ ok: false, error: "internal error" }, 500);
  }
});
