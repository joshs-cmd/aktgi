

## Plan: Add user email display, sign-out button, and admin banner

### What we're building
Based on the screenshot reference:
1. **Yellow admin banner** at the very top of the page: "You are logged in as an administrator." — only shown when `userRole === "admin"`
2. **User email + Sign Out button** in the top-right of the header, replacing or alongside the existing Data Management button

### Changes

**1. Pass `userEmail` and `onSignOut` to page components**
- In `App.tsx`, retrieve the user's email from the session and pass it (along with `handleSignOut`) as props to `SearchGallery`, `ProductDetail`, and `DataManagement`.

**2. Update `SearchGallery` header**
- Add a yellow banner above the header when `role === "admin"`: full-width amber/yellow background with centered bold text "You are logged in as an administrator."
- In the header's right side, show the user's email and a "Sign Out" button with a `LogOut` icon, styled similarly to the screenshot (outlined button).
- Keep the Data Management link for admins (can move it or keep it alongside).

**3. Update `ProductDetail` page**
- Add the same admin banner and user email/sign-out display to maintain consistency across pages.

**4. Update `DataManagement` page**
- Same admin banner and user info display.

### Implementation approach
- Create a shared `AdminBanner` and `UserMenu` component (or inline them) to avoid duplication across pages.
- The yellow banner uses Tailwind classes like `bg-amber-400 text-gray-900 text-center py-2 font-semibold`.
- Sign Out button uses `variant="outline"` with `LogOut` icon from lucide-react.

