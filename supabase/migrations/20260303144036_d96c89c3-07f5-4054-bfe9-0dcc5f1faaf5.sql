
-- Tighten storage policies: only service role bypasses RLS naturally,
-- so we drop the overly-permissive policies and replace with false
-- (service role key skips RLS; anon/authenticated users cannot access directly)
DROP POLICY IF EXISTS "Service role can upload archives" ON storage.objects;
DROP POLICY IF EXISTS "Service role can read archives" ON storage.objects;
DROP POLICY IF EXISTS "Service role can delete archives" ON storage.objects;

-- No direct client access to this bucket — only service role (edge functions) can touch it
-- Service role bypasses RLS automatically, so no policies needed for it.
-- We intentionally leave NO policies on this bucket for security.
