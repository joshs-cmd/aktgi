

## Add Light/Dark Mode Toggle

### Overview
Add a theme toggle button to the site header that switches between light and dark mode, persisting the choice in localStorage.

### What Already Exists
- `tailwind.config.ts` already has `darkMode: ["class"]` — no change needed.
- `src/index.css` already defines both `:root` (light) and `.dark` (dark) CSS variables for all semantic tokens — no change needed.
- Components already use Tailwind semantic classes (`bg-background`, `text-foreground`, etc.) — no change needed.

### Plan

**1. Create `src/hooks/useTheme.ts`**
- Custom hook that reads `localStorage.getItem("theme")`, defaults to `"light"`.
- On mount and on change, adds/removes `dark` class on `document.documentElement`.
- Returns `{ theme, setTheme }`.

**2. Update `src/components/UserMenu.tsx`**
- Accept optional `theme` and `onToggleTheme` props.
- Render a Sun/Moon icon button (from `lucide-react`) immediately before the sign-out button.
- Sun icon shown in light mode, Moon in dark mode. Click calls `setTheme(theme === "light" ? "dark" : "light")`.
- Button styled consistently with the existing sign-out button (`variant="outline"`, `size="icon"`, same height classes).

**3. Wire up in page headers**
- In `SearchGallery.tsx`, `ProductDetail.tsx`, `AdminTools.tsx`, `AliasManager.tsx`, and `DataManagement.tsx`: call `useTheme()` and pass `theme`/`onToggleTheme` to `UserMenu`.
- The toggle appears next to the username/sign-out button on every page.

### Technical Details

```
useTheme.ts
├── useState<"light" | "dark">  (init from localStorage, default "light")
├── useEffect → toggle "dark" class on <html>, write to localStorage
└── return { theme, setTheme }

UserMenu.tsx
├── New optional props: theme?, onToggleTheme?
├── Sun/Moon icon button (before sign-out button)
└── onClick → onToggleTheme()
```

Files changed: 7 (1 new hook, 1 component edit, 5 page wiring edits). No CSS or Tailwind config changes needed.

