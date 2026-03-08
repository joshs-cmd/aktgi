

## Plan: Apply Inter font globally via Google Fonts

### Changes

**1. `index.html`** — Add Google Fonts import in `<head>`:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

**2. `tailwind.config.ts`** — Set `fontFamily.sans` to `['Inter', 'sans-serif']` in `theme.extend`.

**3. `src/pages/SearchGallery.tsx`** — Remove the inline `style={{ fontFamily: 'Inter, sans-serif' }}` from the title (now handled globally). Remove any custom letter-spacing if present.

