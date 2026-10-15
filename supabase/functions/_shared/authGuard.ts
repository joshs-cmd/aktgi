// Shared access guard for distributor edge functions.
// Allows: service-role bearer (internal), AKT Purchasing Hub key, or signed-in allowed-domain users.
// Never logs tokens or keys.

const ALLOWED_DOMAINS = ["aktenterprises.com", "smartpunk.com"];

export type AuthResult =
  | { ok: true; via: "service" | "hub" | "user"; email?: string }
  | { ok: false; status: number; error: string };

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export async function authorize(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token && timingSafeEqual(token, serviceKey)) {
    return { ok: true, via: "service" };
  }

  const hubKey = Deno.env.get("AGI_SERVICE_KEY");
  const provided = req.headers.get("x-akt-service-key") ?? "";
  if (hubKey && hubKey.length >= 32 && provided.length === hubKey.length && timingSafeEqual(provided, hubKey)) {
    return { ok: true, via: "hub" };
  }

  if (token) {
    try {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
        headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        await res.body?.cancel();
        return { ok: false, status: 401, error: "unauthorized" };
      }
      const user = await res.json();
      const email = String(user?.email ?? "").toLowerCase();
      const domain = email.split("@")[1] ?? "";
      if (!email || !ALLOWED_DOMAINS.includes(domain)) {
        return { ok: false, status: 403, error: "forbidden" };
      }
      return { ok: true, via: "user", email };
    } catch {
      return { ok: false, status: 401, error: "unauthorized" };
    }
  }

  return { ok: false, status: 401, error: "unauthorized" };
}
