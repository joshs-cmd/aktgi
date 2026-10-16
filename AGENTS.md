
- Distributor edge functions (provider-*, sourcing-engine) must call `authorize()` from supabase/functions/_shared/authGuard.ts before reading the body; internal callers must send the service role key as an explicit Bearer header, because the guard rejects anon/public callers.
- Style canonicalization and distributor SKU resolution live in supabase/functions/_shared/catalogResolve.ts; catalog-search and check-stock import it so other AKT apps get identical matching without copying logic.
