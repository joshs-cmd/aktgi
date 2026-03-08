

## Plan: Replace Password Auth with Google OAuth + Domain Restriction + Admin Table

### Overview
Replace the current password-based Gatekeeper with Google OAuth sign-in, restricted to `aktenterprises.com` and `smartpunk.com` domains. Admin status is determined by an `admin_emails` database table. Non-admins with valid domains get "viewer" role.

### 1. Database: Create `admin_emails` table

```sql
CREATE TABLE public.admin_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;
-- Read-only for authenticated users (role lookup), insert/update/delete via service role only
CREATE POLICY "Allow authenticated read" ON public.admin_emails FOR SELECT TO authenticated USING (true);
```

### 2. Edge Function: `check-user-role`
New edge function that:
- Receives the authenticated user's email (from JWT or request body)
- Validates domain is `aktenterprises.com` or `smartpunk.com` — rejects otherwise
- Checks `admin_emails` table for the email
- Returns `{ role: "admin" }` or `{ role: "viewer" }`

### 3. Google OAuth Setup (your own credentials)
- You'll configure a Google Cloud OAuth 2.0 client with:
  - Authorized redirect URL from Lovable Cloud auth settings
  - Scopes: `userinfo.email`, `userinfo.profile`, `openid`
  - Authorized domains: your Lovable app domain
- Add your Client ID and Secret in Lovable Cloud → Authentication Settings → Google
- Use `lovable.auth.signInWithOAuth("google", ...)` in code (managed SDK)

### 4. Rewrite `Gatekeeper.tsx`
- Remove password form entirely
- Center the AKT logo above a single "Sign in with Google" button
- On click: `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin })`
- Branded styling matching current dark theme

### 5. Rewrite `App.tsx` Auth Flow
- Replace `sessionStorage`-based auth with `supabase.auth.onAuthStateChange` listener
- On auth state change (signed in):
  - Extract email domain, reject if not `aktenterprises.com` or `smartpunk.com` (sign out + show error)
  - Call `check-user-role` edge function to get role
  - Store role in state, render app
- On sign out: show Gatekeeper
- Add a sign-out button somewhere accessible (header/nav)

### 6. Update `src/types/auth.ts`
- Remove `sessionStorage` helpers (`setAuthState`, `getAuthState`, `clearAuthState`, session keys)
- Keep `UserRole`, `AuthState`, and `canViewPrices`

### 7. Clean Up
- Remove or deprecate `verify-shop-password` edge function (no longer needed)
- Remove `SHOP_PASSWORD`, `ADMIN_PASSWORD`, `STANDARD_PASSWORD` secrets (optional, can leave)

### Setup Steps You'll Need To Do
1. In Google Cloud Console: create OAuth 2.0 client, add redirect URL from Lovable Cloud auth settings
2. In Lovable Cloud: paste your Google Client ID and Secret into Authentication Settings → Google
3. After deployment: add admin emails to the `admin_emails` table via the backend data view

### File Changes Summary
| File | Action |
|------|--------|
| `admin_emails` table | Create (migration) |
| `supabase/functions/check-user-role/index.ts` | Create |
| `src/components/Gatekeeper.tsx` | Rewrite (Google sign-in button) |
| `src/App.tsx` | Rewrite auth flow (Supabase auth listener) |
| `src/types/auth.ts` | Simplify (remove session helpers) |

