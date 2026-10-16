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
  if (body.designs.length === 0 || body.designs.length > 40) return "designs must have 1-40 items";
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

async function callProvider(url: string, key: string, code: string, body: unknown): Promise<{ ok: boolean; product: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${url}/functions/v1/provider-${code}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) { await res.body?.cancel(); return { ok: false, product: null }; }
    const data = await res.json().catch(() => null);
    if (!data || data.error) return { ok: false, product: null };
    return { ok: true, product: data.product ?? null };
  } catch {
    return { ok: false, product: null };
  } finally {
    clearTimeout(t);
  }
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
    await Promise.all([...styles.entries()].map(async ([sk, { brand, style }]) => {
      const skuMap = await resolveDistributorSkus(supabase, brand, style).catch(() => ({} as Record<string, string>));
      const results = await Promise.all(dists.map(async (d) => {
        const sku = skuMap[d.code] ?? style;
        const r = await callProvider(url, key, d.code, { query: sku, distributorId: `${d.code}-001`, brand, force_refresh: false });
        return { code: d.code, name: d.name, ok: r.ok, product: r.product, sku };
      }));
      fetched.set(sk, results);
    }));

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
