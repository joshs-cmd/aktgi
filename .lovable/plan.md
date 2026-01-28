

# Fix S&S Provider + Add Color Selection with Fuzzy Matching

## Problem Summary

The search function is returning "Product not found" for every query because:
1. The S&S provider uses incorrect API field names (wrong casing)
2. It calls separate `/inventory/` and `/prices/` endpoints instead of using the Products endpoint which includes everything
3. No fallback search strategy for partial/fuzzy matches like "Gildan5000" or "5000"

## Solution Overview

Completely rewrite the S&S provider with:
- **Smart query normalization** with fuzzy matching
- **Single Products endpoint** that returns pricing, inventory, and color data
- **Fallback Styles search** when direct lookup fails
- **Color grouping** so users can view inventory/pricing per color

---

## Technical Implementation

### 1. Query Normalization (Fuzzy Matching)

Before calling any API, the provider will normalize the query to improve match success:

```text
Input Transformations:
- "Gildan5000"     → Try "Gildan 5000" (add space between brand and number)
- "bellacanvas3001" → Try "bella canvas 3001" (common brand patterns)
- "GILDAN 5000"    → Try "gildan 5000" (case normalization)
- "G5000"          → Try "G 5000" (letter+number split)

Algorithm:
1. Trim and lowercase the query
2. Detect patterns like "brand+number" without space using regex
3. Generate alternative queries to try if primary fails
4. Common brand prefixes to detect: gildan, bella, canvas, port, hanes, next, jerzees, champion, fruit
```

### 2. Search Strategy (Multi-Step Fallback)

```text
Step 1: Direct Products Lookup
  GET /v2/products/?style={originalQuery}
  → If 200 with results: SUCCESS, parse products

Step 2: Try Normalized Query (if Step 1 fails)
  GET /v2/products/?style={normalizedQuery}
  → Example: "Gildan5000" becomes "Gildan 5000"
  → If 200 with results: SUCCESS

Step 3: Fuzzy Search via Styles Endpoint (if Step 2 fails)
  GET /v2/styles?search={query}
  → Returns matching styles with styleID
  → Pick best match using scoring:
     - Exact styleName match: +100 points
     - Exact partNumber match: +100 points
     - Brand name contained: +50 points
     - Query contained in title: +25 points
  → Then: GET /v2/products/?styleid={bestMatch.styleID}

Step 4: Return null (no matches found)
```

### 3. S&S Products API Response Structure

Each row from `/v2/products/` is a single SKU containing:

| Field | Type | Description |
|-------|------|-------------|
| styleID | number | Unique style identifier |
| brandName | string | "Gildan", "Bella+Canvas", etc. |
| styleName | string | "5000", "3001", etc. |
| colorName | string | "White", "Black", etc. |
| colorCode | string | Two-digit code |
| colorSwatchImage | string | Relative URL to swatch |
| colorFrontImage | string | Relative URL to product image |
| color1 | string | Hex color code (e.g., "#FFFFFF") |
| sizeName | string | "S", "M", "L", "XL", etc. |
| sizeOrder | string | Sort key (e.g., "B1", "B2") |
| customerPrice | number | Your price for this SKU |
| warehouses | array | Per-warehouse inventory |

### 4. Data Normalization (Grouping by Color)

The provider will aggregate SKUs into a normalized structure:

```text
StandardProduct
├── styleNumber: "5000"
├── name: "Heavy Cotton T-Shirt"
├── brand: "Gildan"
├── category: "T-Shirts"
├── imageUrl: "https://www.ssactivewear.com/Images/Style/39_fl.jpg"
└── colors: StandardColor[]
    ├── code: "00"
    ├── name: "White"
    ├── hexCode: "#FFFFFF"
    ├── swatchUrl: "https://www.ssactivewear.com/Images/ColorSwatch/7229_fm.jpg"
    ├── imageUrl: "https://www.ssactivewear.com/Images/Color/17130_f_fl.jpg"
    └── sizes: StandardSize[]
        ├── code: "M"
        ├── order: 2
        ├── price: 4.50
        └── inventory: StandardInventory[]
            ├── { warehouseCode: "IL", warehouseName: "Illinois", quantity: 10000 }
            ├── { warehouseCode: "NV", warehouseName: "Nevada", quantity: 5000 }
            └── ...
```

---

## Files to Modify/Create

### Backend Changes

**supabase/functions/provider-ss-activewear/index.ts** - Complete rewrite:
- Add `normalizeQuery()` function for fuzzy matching
- Add `generateQueryVariants()` to create alternative search terms
- Implement multi-step search strategy with fallbacks
- Parse products response and group by color
- Return `StandardProduct` with colors array
- Fetch style metadata for better product info

**supabase/functions/sourcing-engine/index.ts** - CORS update:
- Expand `Access-Control-Allow-Headers` to include all Supabase client headers

### Type Definitions

**src/types/sourcing.ts** - Add color support:
```text
New interfaces:
- StandardColor { code, name, hexCode, swatchUrl, imageUrl, sizes[] }
  
Modified interfaces:
- StandardProduct.colors: StandardColor[] (replaces direct sizes)
- StandardProduct.sizes becomes optional (backward compat for distributors without color data)
```

### Frontend Components

**src/components/ColorSelector.tsx** - New component:
- Display clickable color swatches in a horizontal row
- Show color name on hover/focus
- Visual indicator for selected color
- Emit `onColorSelect(colorCode)` callback

**src/pages/Index.tsx** - Add color state management:
- Track `selectedColor` state (default to first color)
- Pass selected color to child components
- Handle "no results found" case with helpful message

**src/components/ProductHeader.tsx** - Update for colors:
- Display selected color image instead of generic style image
- Show color name badge
- Add swatch selector integration

**src/components/ComparisonTable.tsx** - Filter by color:
- Receive `selectedColor` prop
- Find matching color's sizes array
- Render price/inventory for that color only

**src/components/SearchBar.tsx** - Better placeholder:
- Update to: "Style or SKU (e.g., Gildan 5000, 3001, 00760)"

---

## Query Normalization Details

### Brand Detection Patterns

```text
Regex patterns to detect brand+number without space:

gildan\d+      → "gildan 5000" from "gildan5000"
bella\d+       → "bella 3001" from "bella3001"  
canvas\d+      → "canvas 3001"
port\d+        → "port 100"
hanes\d+       → "hanes 5180"
next\d+        → "next 6210"
champion\d+    → "champion t425"
jerzees\d+     → "jerzees 29mr"
fruit\d+       → "fruit 3930"

Generic pattern:
([a-z]+)(\d+)  → "\1 \2" (letter group + number group → add space)
```

### Query Variant Generation

```text
For input "Gildan5000":
1. Original: "Gildan5000"
2. Spaced: "Gildan 5000" (primary variant)
3. Number only: "5000" (fallback)

For input "5000":
1. Original: "5000"
2. Prefixed: "Gildan 5000" (try common brand)

For input "G 500":
1. Original: "G 500"
2. Collapsed: "G500"
```

---

## UI Flow

```text
1. User types "Gildan5000" and clicks Search
2. Provider normalizes → tries "Gildan5000", then "Gildan 5000"
3. API returns ~50 SKUs (different colors/sizes)
4. Provider groups by color → returns StandardProduct with colors[]
5. Frontend receives data:
   a. ProductHeader shows style image and name
   b. ColorSelector shows all available color swatches
   c. First color (e.g., "White") auto-selected
   d. ComparisonTable shows White's pricing/inventory
6. User clicks "Navy" swatch
7. Table updates to show Navy's pricing/inventory
8. ProductHeader updates to show Navy product image
```

---

## Testing Checklist

| Query | Expected Result |
|-------|-----------------|
| "5000" | Gildan 5000 with multiple colors |
| "Gildan5000" | Gildan 5000 (fuzzy match works) |
| "Gildan 5000" | Gildan 5000 (exact match) |
| "3001" | Bella+Canvas 3001 |
| "00760" | Gildan 2000 (part number lookup) |
| "bella3001" | Bella+Canvas 3001 (fuzzy match) |
| "zzzzzz" | "No results found" message |

---

## Error Handling

- **404 from S&S**: Return `product: null` (not an error)
- **Network timeout**: Return error status with message
- **Missing credentials**: Return error with "API not configured"
- **Invalid response shape**: Log details, return null gracefully

---

## Summary of Changes

| Component | Change Type | Description |
|-----------|-------------|-------------|
| provider-ss-activewear | Rewrite | Fuzzy matching, color grouping, correct API usage |
| sourcing-engine | Update | CORS headers expansion |
| src/types/sourcing.ts | Update | Add StandardColor, update StandardProduct |
| ColorSelector.tsx | New | Color swatch picker component |
| Index.tsx | Update | Color state, no-results message |
| ProductHeader.tsx | Update | Show selected color image |
| ComparisonTable.tsx | Update | Filter sizes by selected color |
| SearchBar.tsx | Update | Better placeholder examples |

