# AKT Garment Inventory (AGI) — Complete System Specification

---

## 1. Screen List and Navigation Graph

| Screen ID | Route | Component | Description |
|-----------|-------|-----------|-------------|
| `GATEKEEPER` | N/A (pre-route) | `Gatekeeper.tsx` | Password authentication wall displayed before any route access |
| `INDEX` | `/` | `Index.tsx` | Main search and comparison interface |
| `NOT_FOUND` | `*` | `NotFound.tsx` | 404 error page for invalid routes |

### Navigation Graph

```
[Initial Load]
     │
     ▼
┌──────────────────┐
│  Check Session   │ ◄── sessionStorage.getItem("akt-authenticated")
└────────┬─────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
[Authenticated]  [Not Authenticated]
    │                   │
    ▼                   ▼
┌──────────┐      ┌─────────────┐
│  INDEX   │      │  GATEKEEPER │
│   "/"    │      │  (modal)    │
└──────────┘      └──────┬──────┘
                         │ onSuccess(role)
                         ▼
                  ┌──────────┐
                  │  INDEX   │
                  │   "/"    │
                  └──────────┘

[Invalid Route] ──► NOT_FOUND ("*") ──► Link to "/"
```

---

## 2. Data Entities and Fields

### 2.1 Frontend Types (`src/types/`)

#### `sourcing.ts`

| Entity | Field | Type | Description |
|--------|-------|------|-------------|
| **StandardInventory** | `warehouseCode` | `string` | Warehouse identifier (e.g., "TX", "1") |
| | `warehouseName` | `string` | Human-readable name (e.g., "Texas (Dallas)") |
| | `quantity` | `number` | Stock quantity |
| | `isCapped` | `boolean?` | True when quantity equals 3000 (SanMar API cap) |
| **StandardSize** | `code` | `string` | Size code ("S", "M", "L", "2XL") |
| | `order` | `number` | Sort order |
| | `price` | `number` | Unit price |
| | `inventory` | `StandardInventory[]` | Per-warehouse stock |
| | `isProgramPrice` | `boolean?` | True when using benefit/contract pricing |
| **StandardColor** | `code` | `string` | Color code ("00", "01") |
| | `name` | `string` | Color name ("White", "Navy") |
| | `hexCode` | `string \| null` | Hex color value |
| | `swatchUrl` | `string \| null` | Swatch image URL |
| | `imageUrl` | `string \| null` | Product image URL for this color |
| | `sizes` | `StandardSize[]` | Size variants with pricing/inventory |
| **StandardProduct** | `styleNumber` | `string` | SKU/style number |
| | `name` | `string` | Product name |
| | `brand` | `string` | Brand name |
| | `category` | `string` | Product category |
| | `imageUrl` | `string?` | Default product image |
| | `colors` | `StandardColor[]?` | Color variants |
| | `sizes` | `StandardSize[]?` | Direct sizes (backward compat) |
| **DistributorStatus** | — | `'success' \| 'error' \| 'pending'` | API call result status |
| **DistributorResult** | `distributorId` | `string` | Unique distributor ID |
| | `distributorCode` | `string` | Short code ("sanmar", "ss-activewear") |
| | `distributorName` | `string` | Display name |
| | `status` | `DistributorStatus` | Connection status |
| | `product` | `StandardProduct \| null` | Returned product or null |
| | `lastSynced` | `string \| null` | ISO timestamp |
| | `errorMessage` | `string?` | Error details if status is "error" |
| **SourcingResponse** | `query` | `string` | Original search query |
| | `results` | `DistributorResult[]` | Array of distributor results |
| | `searchedAt` | `string` | ISO timestamp |
| **Distributor** | `id` | `string` | UUID |
| | `name` | `string` | Distributor name |
| | `code` | `string` | Short code |
| | `api_base_url` | `string \| null` | API endpoint |
| | `is_active` | `boolean` | Active status |
| | `created_at` | `string` | ISO timestamp |
| **Warehouse** | `id` | `string` | UUID |
| | `distributor_id` | `string` | FK to distributor |
| | `code` | `string` | Warehouse code |
| | `name` | `string` | Warehouse name |
| | `city` | `string \| null` | City |
| | `state` | `string \| null` | State |

#### `auth.ts`

| Entity | Field | Type | Description |
|--------|-------|------|-------------|
| **UserRole** | — | `'admin' \| 'viewer'` | Role type |
| **AuthState** | `isAuthenticated` | `boolean` | Login status |
| | `role` | `UserRole \| null` | Current role |
| **Session Keys** | `AUTH_SESSION_KEY` | `string` | `"akt-authenticated"` |
| | `ROLE_SESSION_KEY` | `string` | `"akt-role"` |

### 2.2 Database Tables (Supabase)

| Table | Column | Type | Nullable | Default | Notes |
|-------|--------|------|----------|---------|-------|
| **distributors** | `id` | `uuid` | No | `gen_random_uuid()` | PK |
| | `name` | `text` | No | — | Distributor name |
| | `code` | `text` | No | — | Short identifier |
| | `api_base_url` | `text` | Yes | — | API endpoint |
| | `is_active` | `boolean` | No | `false` | Active flag |
| | `created_at` | `timestamptz` | No | `now()` | Created timestamp |
| **warehouses** | `id` | `uuid` | No | `gen_random_uuid()` | PK |
| | `distributor_id` | `uuid` | No | — | FK → distributors.id |
| | `code` | `text` | No | — | Warehouse code |
| | `name` | `text` | No | — | Warehouse name |
| | `city` | `text` | Yes | — | City |
| | `state` | `text` | Yes | — | State |
| | `created_at` | `timestamptz` | No | `now()` | Created timestamp |
| **products** | `id` | `uuid` | No | `gen_random_uuid()` | PK |
| | `style_number` | `text` | No | — | SKU/style number |
| | `name` | `text` | No | — | Product name |
| | `brand` | `text` | Yes | — | Brand |
| | `category` | `text` | Yes | — | Category |
| | `image_url` | `text` | Yes | — | Product image URL |
| | `created_at` | `timestamptz` | No | `now()` | Created timestamp |
| | `updated_at` | `timestamptz` | No | `now()` | Updated timestamp |
| **product_sizes** | `id` | `uuid` | No | `gen_random_uuid()` | PK |
| | `product_id` | `uuid` | No | — | FK → products.id |
| | `size_code` | `text` | No | — | Size code |
| | `size_order` | `integer` | No | `0` | Sort order |
| | `created_at` | `timestamptz` | No | `now()` | Created timestamp |
| **prices** | `id` | `uuid` | No | `gen_random_uuid()` | PK |
| | `distributor_id` | `uuid` | No | — | FK → distributors.id |
| | `product_id` | `uuid` | No | — | FK → products.id |
| | `size_code` | `text` | No | — | Size code |
| | `price` | `numeric` | No | — | Price value |
| | `updated_at` | `timestamptz` | No | `now()` | Updated timestamp |
| **price_history** | `id` | `uuid` | No | `gen_random_uuid()` | PK |
| | `distributor_id` | `uuid` | No | — | FK → distributors.id |
| | `product_id` | `uuid` | No | — | FK → products.id |
| | `size_code` | `text` | No | — | Size code |
| | `price` | `numeric` | No | — | Price value |
| | `recorded_at` | `timestamptz` | No | `now()` | Recorded timestamp |
| **inventory** | `id` | `uuid` | No | `gen_random_uuid()` | PK |
| | `distributor_id` | `uuid` | No | — | FK → distributors.id |
| | `product_id` | `uuid` | No | — | FK → products.id |
| | `warehouse_id` | `uuid` | No | — | FK → warehouses.id |
| | `size_code` | `text` | No | — | Size code |
| | `quantity` | `integer` | No | `0` | Stock quantity |
| | `updated_at` | `timestamptz` | No | `now()` | Updated timestamp |
| **sync_logs** | `id` | `uuid` | No | `gen_random_uuid()` | PK |
| | `distributor_id` | `uuid` | No | — | FK → distributors.id |
| | `sync_type` | `text` | No | — | Type of sync operation |
| | `status` | `text` | No | `'pending'` | Sync status |
| | `started_at` | `timestamptz` | No | `now()` | Start timestamp |
| | `completed_at` | `timestamptz` | Yes | — | Completion timestamp |
| | `error_message` | `text` | Yes | — | Error details |

---

## 3. Backend Endpoints and Payloads

### 3.1 Edge Functions

| Function | Method | Auth | Description |
|----------|--------|------|-------------|
| `verify-shop-password` | POST | None (`verify_jwt = false`) | Password authentication |
| `sourcing-engine` | POST | None (anonymous) | Main search orchestrator |
| `provider-sanmar` | POST | None (internal) | SanMar API integration |
| `provider-ss-activewear` | POST | None (internal) | S&S Activewear API integration |

### 3.2 Endpoint Details

#### `POST /functions/v1/verify-shop-password`

**Request Body:**
```json
{
  "password": "string"
}
```

**Response (Success - Admin):**
```json
{
  "valid": true,
  "role": "admin"
}
```

**Response (Success - Viewer):**
```json
{
  "valid": true,
  "role": "viewer"
}
```

**Response (Invalid):**
```json
{
  "valid": false
}
```

**Response (Error):**
```json
{
  "valid": false,
  "error": "string"
}
```

---

#### `POST /functions/v1/sourcing-engine`

**Request Body:**
```json
{
  "query": "string"
}
```

**Response:**
```json
{
  "query": "string",
  "results": [
    {
      "distributorId": "string",
      "distributorCode": "string",
      "distributorName": "string",
      "status": "success | error | pending",
      "product": { /* StandardProduct or null */ },
      "lastSynced": "ISO timestamp or null",
      "errorMessage": "string (optional)"
    }
  ],
  "searchedAt": "ISO timestamp"
}
```

---

#### `POST /functions/v1/provider-sanmar` (Internal)

**Request Body:**
```json
{
  "query": "string",
  "distributorId": "string"
}
```

**Response:**
```json
{
  "product": { /* StandardProduct or null */ }
}
```

**SOAP Services Used:**
- `getProductInfoByStyleColorSize` — Product info + pricing
- `getInventoryQtyForStyleColorSize` — Warehouse inventory

---

#### `POST /functions/v1/provider-ss-activewear` (Internal)

**Request Body:**
```json
{
  "query": "string",
  "distributorId": "string"
}
```

**Response:**
```json
{
  "product": { /* StandardProduct or null */ }
}
```

**REST Endpoints Used:**
- `GET /v2/products/?style={style}` — Direct product lookup
- `GET /v2/styles/?search={query}` — Fuzzy style search
- `GET /v2/products/?styleid={id}` — Products by style ID

---

## 4. Form Validations and Rules

### 4.1 Gatekeeper Login Form

| Field | Validation | Error Message |
|-------|------------|---------------|
| `password` | Required, non-empty after trim | "Please enter a password" |
| `password` | Must match ADMIN_PASSWORD or STANDARD_PASSWORD secret | "Incorrect password" |

### 4.2 Search Form

| Field | Validation | Error Message |
|-------|------------|---------------|
| `query` | Minimum 3 characters | "Please enter a specific SKU for comparison (at least 3 characters)." |
| `query` | Cannot be brand-only term | "Please enter a specific SKU for comparison (e.g., 'Gildan 5000' not just 'Gildan')." |

**Brand-Only Terms Blocked:**
```
gildan, bella, canvas, bella+canvas, bella canvas, next level, nextlevel,
port, port & company, port and company, hanes, fruit, fruit of the loom,
champion, american apparel, comfort colors, jerzees, anvil, alstyle,
district, sport-tek, bayside, sanmar, ss activewear, alphabroder
```

---

## 5. User Roles and Permissions

| Role | Can View Prices | Can View Inventory | Can View Markups | Can Access UI |
|------|-----------------|---------------------|------------------|---------------|
| `admin` | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| `viewer` | ❌ No (shown as "••••") | ✅ Yes | ❌ No | ✅ Yes |
| Unauthenticated | ❌ No | ❌ No | ❌ No | ❌ No (Gatekeeper blocks) |

### Role Assignment Logic

| Condition | Assigned Role |
|-----------|---------------|
| Password matches `ADMIN_PASSWORD` secret | `admin` |
| Password matches `STANDARD_PASSWORD` secret | `viewer` |
| Password matches `SHOP_PASSWORD` secret (legacy) | `admin` |

### Session Persistence

- **Storage:** `sessionStorage`
- **Keys:** `akt-authenticated` (boolean string), `akt-role` (role string)
- **Lifetime:** Until tab/window close
- **No logout mechanism implemented**

---

## 6. Business Logic Conditions

### 6.1 Sourcing Engine - Winner Selection Algorithm

```
1. Parse query → normalize to uppercase
2. Extract last part of query (e.g., "Gildan 5000" → "5000")
3. For each successful distributor result with product:
   a. Calculate TIER:
      - Tier 1: Exact SKU match (styleNumber === query OR styleNumber === lastPart)
      - Tier 2: Partial match (styleNumber contains lastPart OR vice versa)
      - Tier 3: Other
   b. Calculate BRAND PRIORITY (0-12, lower = better):
      - Gildan = 0
      - Port & Company = 1
      - Bella + Canvas = 2
      - Next Level = 3
      - Hanes = 4
      - Jerzees = 5
      - Fruit of the Loom = 6
      - Champion = 7
      - American Apparel = 8
      - Unknown = 999
   c. Calculate INVENTORY DEPTH (sum of all warehouse quantities)
4. Sort by: tier ASC → brandPriority ASC → inventory DESC
5. First result = WINNER
6. Return winner product, null out all non-matching products
7. Non-winning distributors still appear in table with null product
```

### 6.2 Hardcoded Distributor Roster

| ID | Code | Name | Active |
|----|------|------|--------|
| `sanmar-001` | `sanmar` | SanMar | ✅ Yes |
| `ss-activewear-001` | `ss-activewear` | S&S Activewear | ✅ Yes |
| `as-colour-001` | `as-colour` | AS Colour | ❌ No |
| `onestop-001` | `onestop` | OneStop | ❌ No |
| `mccreary-001` | `mccreary` | McCreary's | ❌ No |

### 6.3 Price Priority Logic

**SanMar:**
```
1. benefitPrice (if > 0) → isProgramPrice = true
2. contractPrice (if > 0) → isProgramPrice = true
3. piecePrice (if > 0)
4. customerPrice (if > 0)
5. listPrice (if > 0)
```

**S&S Activewear:**
```
1. customerPrice (minimum across all SKUs for size)
```

### 6.4 Inventory Capping Logic (SanMar)

```
if (quantity === 3000) {
  isCapped = true;
  display = "${quantity}+"
}
```

### 6.5 Lowest Price Highlighting

```
For each size column:
  1. Find minimum price > 0 across all successful distributors
  2. Mark cells matching minimum with "bg-success/15 text-success"
```

### 6.6 Program Price Badge Display

```
if (isProgramPrice === true && distributorCode === "sanmar") {
  show "Program" badge next to price
}
```

---

## 7. External Integrations

### 7.1 SanMar SOAP Web Services

| Service | Endpoint | Auth Method |
|---------|----------|-------------|
| Product Info | `https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort` | Body credentials |
| Inventory | `https://ws.sanmar.com:8080/SanMarWebService/SanMarWebServicePort` | Body credentials |

**Credentials (from secrets):**
- `SANMAR_CUSTOMER_NUMBER` (default: "144250")
- `SANMAR_USERNAME`
- `SANMAR_PASSWORD`

**Timeout:** 5000ms per request

### 7.2 S&S Activewear REST API

| Endpoint | Method | Auth |
|----------|--------|------|
| `https://api.ssactivewear.com/v2/products/` | GET | Basic Auth |
| `https://api.ssactivewear.com/v2/styles/` | GET | Basic Auth |

**Credentials (from secrets):**
- `SS_ACTIVEWEAR_USERNAME`
- `SS_ACTIVEWEAR_PASSWORD`

### 7.3 Supabase

| Service | Usage |
|---------|-------|
| Edge Functions | All backend logic |
| Secrets | Credential storage |
| Database | Schema exists but NOT used by current app logic |

---

## 8. State Flows

### 8.1 Authentication State Flow

```
┌─────────────┐
│   INITIAL   │
│ (checking)  │
└──────┬──────┘
       │ useEffect: getAuthState()
       │
  ┌────┴────┐
  │         │
  ▼         ▼
[Session    [No Session]
 Found]          │
  │              ▼
  │       ┌─────────────┐
  │       │ GATEKEEPER  │
  │       │  (login UI) │
  │       └──────┬──────┘
  │              │ submit password
  │              ▼
  │       ┌─────────────────────┐
  │       │ verify-shop-password│
  │       │ (edge function)     │
  │       └──────┬──────────────┘
  │              │
  │         ┌────┴────┐
  │         │         │
  │         ▼         ▼
  │      [Valid]   [Invalid]
  │         │         │
  │         │    [Show Error]
  │         │         │
  │         ▼         └──► [Stay on Gatekeeper]
  │    setAuthState(role)
  │         │
  └────────►│
            ▼
     ┌────────────┐
     │AUTHENTICATED│
     │  (role set) │
     └────────────┘
```

### 8.2 Search State Flow

```
┌─────────────┐
│   IDLE      │
│ (no query)  │
└──────┬──────┘
       │ user submits query
       ▼
┌─────────────────┐
│ VALIDATE QUERY  │
└───────┬─────────┘
        │
   ┌────┴────┐
   │         │
   ▼         ▼
[Invalid]  [Valid]
   │          │
   ▼          ▼
[Show      ┌────────┐
 Error]    │LOADING │
   │       │(spinner)│
   │       └────┬───┘
   │            │ sourcing-engine returns
   │            ▼
   │    ┌───────────────────┐
   │    │ PROCESS RESPONSE  │
   │    └────────┬──────────┘
   │             │
   │    ┌────────┼────────────┐
   │    │        │            │
   │    ▼        ▼            ▼
   │ [Error]  [No Match]  [Results]
   │    │        │            │
   │    ▼        ▼            ▼
   │ [Error   [No Match    [Show
   │  Alert]   Alert]       Table]
   │
   └──────────────────────────────►[IDLE]
```

### 8.3 Color Selection State

```
┌────────────────────┐
│ Results Loaded     │
│ (selectedColor=null)│
└─────────┬──────────┘
          │ useMemo auto-select
          ▼
┌────────────────────┐
│ First Color        │
│ Auto-Selected      │
└─────────┬──────────┘
          │ user clicks swatch
          ▼
┌────────────────────┐
│ Update Selection   │
│ Re-filter table    │
└────────────────────┘
```

---

## 9. Edge and Failure States

### 9.1 API Error Handling

| Scenario | Behavior |
|----------|----------|
| All distributors fail | Show error alert with message |
| Some distributors fail | Show "Partial Results" warning, display successful results |
| Single distributor times out (5s) | Mark as "error", continue with others |
| No products match query | Show "No Matching Products Found" alert |
| Product found but no inventory | Show table with 0 stock values |
| SOAP fault from SanMar | Skip variant, try next |
| HTTP non-200 from any API | Mark distributor as error |

### 9.2 Frontend Error States

| Component | Error State | Display |
|-----------|-------------|---------|
| Gatekeeper | Invalid password | Red error text: "Incorrect password" |
| Gatekeeper | Function error | Red error text: "Unable to verify password. Please try again." |
| Gatekeeper | Network error | Red error text: "An error occurred. Please try again." |
| SearchBar | Validation fail | Red border + error text below input |
| Index | Search error | Red destructive Alert component |
| Index | Partial results | Amber warning Alert component |
| ComparisonTable | No sizes for color | Empty table cells ("--") |
| PriceCell | No inventory | Display "0 in stock" |

### 9.3 Image Error Handling

| Component | Fallback |
|-----------|----------|
| ProductHeader | Replace `<img>` with Package icon SVG |
| ColorSelector | Hide broken swatch, show 2-letter abbreviation |

### 9.4 Data Edge Cases

| Case | Handling |
|------|----------|
| Product with no colors | Use direct `sizes` array (backward compat) |
| Product with empty colors array | Return empty sizes list |
| Color with no sizes | Exclude from table |
| Size with 0 price | Display $0.00, not highlighted as lowest |
| Size code not in SIZE_ORDER map | Use order = 99 |
| Duplicate warehouse entries | Sum quantities |

---

## 10. Missing or Inferred Behavior

### 10.1 Not Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| Logout functionality | ❌ Missing | No button or mechanism to clear session |
| Role display in UI | ❌ Missing | User cannot see their current role |
| Password change | ❌ Missing | No UI for updating passwords |
| Database persistence | ❌ Unused | DB schema exists but app uses real-time API calls |
| AS Colour integration | ❌ Stub only | Marked as inactive, no provider function |
| OneStop integration | ❌ Stub only | Marked as inactive, no provider function |
| McCreary's integration | ❌ Stub only | Marked as inactive, no provider function |
| Dark mode toggle | ❌ Missing | CSS tokens defined but no toggle |
| Mobile responsiveness | ⚠️ Partial | Container class used, not fully tested |
| Error retry | ❌ Missing | No "try again" for failed searches |
| Search history | ❌ Missing | No persistence of previous searches |
| Favorite products | ❌ Missing | No save/bookmark functionality |

### 10.2 Inferred Behavior

| Behavior | Inference |
|----------|-----------|
| Session scope | Tab-only (sessionStorage), not cross-tab |
| Password comparison | Case-sensitive exact match |
| Size sorting | Alpha-numeric aware via SIZE_ORDER map |
| Color sorting | Alphabetical by color name |
| Warehouse sorting | Descending by quantity |
| Mock data toggle | `USE_MOCK_DATA = false` (production mode) |
| Timeout handling | 5 second hard timeout, then skip distributor |
| CORS policy | Allows all origins (`*`) |

### 10.3 Security Considerations

| Issue | Status |
|-------|--------|
| Password stored in sessionStorage | ⚠️ Only flag and role stored, not password |
| Role checked client-side | ⚠️ Price visibility is client-side only |
| No rate limiting | ❌ Edge functions have no rate limiting |
| No CSRF protection | N/A for API-only calls |
| Credentials in secrets | ✅ Properly stored in Supabase Secrets |
| RLS on database tables | ✅ SELECT allowed for public, INSERT/UPDATE for service role |

### 10.4 Database vs Runtime Data

| Data Source | Used By |
|-------------|---------|
| Supabase DB tables | ❌ Not actively used by current app |
| Real-time API calls (SanMar, S&S) | ✅ Primary data source |
| Hardcoded distributor list | ✅ In sourcing-engine, not from DB |

---

## Component Hierarchy

```
App
├── Gatekeeper (conditional - before auth)
├── TooltipProvider
├── Toaster (shadcn)
├── Sonner (toast notifications)
└── BrowserRouter
    └── Routes
        ├── Route "/" → Index
        │   ├── SearchBar
        │   ├── ProductHeader
        │   │   └── ColorSelector
        │   ├── ComparisonTable
        │   │   ├── DistributorStatusBadge
        │   │   └── PriceCell
        │   │       └── WarehouseTooltip
        │   └── Alert (conditional states)
        └── Route "*" → NotFound
```

---

## Secrets Configuration

| Secret Name | Purpose | Required By |
|-------------|---------|-------------|
| `ADMIN_PASSWORD` | Admin role authentication | verify-shop-password |
| `STANDARD_PASSWORD` | Viewer role authentication | verify-shop-password |
| `SHOP_PASSWORD` | Legacy fallback (admin) | verify-shop-password |
| `SANMAR_CUSTOMER_NUMBER` | SanMar account ID | provider-sanmar |
| `SANMAR_USERNAME` | SanMar API auth | provider-sanmar |
| `SANMAR_PASSWORD` | SanMar API auth | provider-sanmar |
| `SS_ACTIVEWEAR_USERNAME` | S&S API auth | provider-ss-activewear |
| `SS_ACTIVEWEAR_PASSWORD` | S&S API auth | provider-ss-activewear |
| `SUPABASE_URL` | Supabase client | Edge functions |
| `SUPABASE_ANON_KEY` | Supabase client | Edge functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin access | sourcing-engine |
| `LOVABLE_API_KEY` | Lovable AI gateway | (unused currently) |

---

## File Structure Summary

```
src/
├── App.tsx                          # Root component with auth gate
├── pages/
│   ├── Index.tsx                    # Main search/comparison page
│   └── NotFound.tsx                 # 404 page
├── components/
│   ├── Gatekeeper.tsx               # Password login form
│   ├── SearchBar.tsx                # Search input with validation
│   ├── ProductHeader.tsx            # Product info display
│   ├── ColorSelector.tsx            # Color swatch selector
│   ├── ComparisonTable.tsx          # Main comparison grid
│   ├── PriceCell.tsx                # Price + inventory cell
│   ├── DistributorStatusBadge.tsx   # Status indicator
│   ├── WarehouseTooltip.tsx         # Inventory breakdown popup
│   └── ui/                          # shadcn components
├── types/
│   ├── sourcing.ts                  # Data interfaces
│   └── auth.ts                      # Auth types/helpers
├── hooks/
│   └── useSourcingEngine.ts         # API call hook
├── lib/
│   ├── mockData.ts                  # Test data (disabled)
│   └── utils.ts                     # Utility functions
└── integrations/supabase/
    ├── client.ts                    # Supabase client instance
    └── types.ts                     # Generated DB types

supabase/
├── config.toml                      # Edge function config
└── functions/
    ├── sourcing-engine/index.ts     # Main orchestrator
    ├── provider-sanmar/index.ts     # SanMar SOAP integration
    ├── provider-ss-activewear/index.ts # S&S REST integration
    └── verify-shop-password/index.ts   # Password verification
```

---

*Generated: February 5, 2026 at 2:52 PM EST*
