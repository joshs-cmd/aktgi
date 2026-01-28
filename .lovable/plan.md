

## Phase 1: Foundation & S&S Activewear Integration

### Overview
Build the complete foundation with a normalized data architecture, S&S Activewear edge function, and a DGI-style comparison UI. Starting with mock data to verify the look and feel before connecting live API.

---

### 1. Database Schema (Supabase Migrations)

**Tables to Create:**

- **distributors** - Vendor registry with toggle (id, name, code, api_base_url, is_active, created_at)
- **warehouses** - Location lookup per distributor (id, distributor_id, code, name, city, state)
- **products** - Unified catalog (id, style_number, name, brand, category, image_url)
- **product_sizes** - Available sizes per product (id, product_id, size_code, size_order)
- **inventory** - Stock by distributor + product + size + warehouse (id, distributor_id, product_id, size_code, warehouse_id, quantity, updated_at)
- **prices** - Per-size pricing (id, distributor_id, product_id, size_code, price, updated_at)
- **price_history** - Historical tracking (id, distributor_id, product_id, size_code, price, recorded_at)
- **sync_logs** - Sync timestamps (id, distributor_id, sync_type, status, started_at, completed_at)

**Seed Data:**
- Pre-populate distributors table with S&S (active), SanMar, AS Colour, ACC, Independent (inactive/pending)

---

### 2. TypeScript Interfaces (Data Normalization)

**Core Types:**

```typescript
interface StandardProduct {
  styleNumber: string;
  name: string;
  brand: string;
  category: string;
  imageUrl?: string;
  sizes: StandardSize[];
}

interface StandardSize {
  code: string;        // "S", "M", "L", "2XL"
  order: number;       // For sorting
  price: number;
  inventory: StandardInventory[];
}

interface StandardInventory {
  warehouseCode: string;
  warehouseName: string;
  quantity: number;
}

interface DistributorResult {
  distributorId: string;
  distributorName: string;
  status: 'success' | 'error' | 'pending';
  product: StandardProduct | null;
  lastSynced: string;
}
```

Every provider maps its raw API response to `StandardProduct` before returning.

---

### 3. Edge Functions (Provider Pattern)

**sourcing-engine** (Orchestrator):
- Receives SKU search query
- Fetches list of active distributors from database
- Fans out to each provider function in parallel
- Merges results into unified response
- Returns array of `DistributorResult`

**provider-ss-activewear**:
- Basic Auth using `SS_ACTIVEWEAR_USERNAME` and `SS_ACTIVEWEAR_PASSWORD` from Supabase secrets
- Calls `/v2/products/?style={sku}&fields=StyleID,StyleName,BrandName,ColorName`
- Calls `/v2/inventory/?style={sku}&fields=StyleID,SizeName,Qty,WarehouseAbbr`
- Calls `/v2/prices/?style={sku}&fields=StyleID,SizeName,CustomerPrice`
- Maps response to `StandardProduct` format
- Returns warehouse-level breakdown

**Placeholder providers** (SanMar, AS Colour, ACC, Independent):
- Return `{ status: 'pending', product: null }` until implemented

---

### 4. Frontend: DGI-Style Dashboard

**Layout Structure:**
- Clean header with app title
- Prominent search bar (centered, large input)
- "Search" button triggers manual sync
- Results grid below

**ComparisonTable Component:**

| Distributor | Status | S | M | L | XL | 2XL | 3XL | Total Stock |
|-------------|--------|---|---|---|----|----|-----|-------------|
| S&S Activewear | ● Connected | $4.50 | $4.50 | $4.50 | $4.50 | $5.00 | $5.50 | 1,247 |
| SanMar | ○ Pending | -- | -- | -- | -- | -- | -- | -- |
| AS Colour | ○ Pending | -- | -- | -- | -- | -- | -- | -- |

**Price Cell Behavior:**
- Display price in cell
- Green background for lowest price in that size column
- Hover/click shows tooltip with warehouse breakdown:
  ```
  TX (Dallas): 500
  NV (Reno): 400
  OH (Columbus): 347
  ```

**Dynamic Size Columns:**
- Columns generated based on product's available sizes
- Handles variable ranges (S-3XL, XS-5XL, OSFA, etc.)

---

### 5. Components to Build

- **SearchBar** - Large input with search button, loading state
- **ComparisonTable** - Main grid with dynamic size columns
- **PriceCell** - Individual price display with lowest-price highlighting
- **WarehouseTooltip** - Hover popup showing stock by location
- **DistributorStatusBadge** - Connected (green) / Pending (gray) / Error (red)
- **SyncIndicator** - Shows "Last synced: 2 min ago" timestamp

---

### 6. Mock Data (Initial UI Verification)

Before connecting live API, the UI will render with realistic mock data:
- S&S Activewear: Full pricing and inventory across 6 sizes, 3 warehouses
- Other distributors: Show as "Pending" with empty cells

This lets you verify the table layout, tooltip behavior, and price highlighting before we add real API calls.

---

### 7. Secrets Required

Before live API connection:
- `SS_ACTIVEWEAR_USERNAME` → 02990
- `SS_ACTIVEWEAR_PASSWORD` → (your API key)

I'll prompt you to add these securely when we're ready to go live.

---

### 8. File Structure

```
src/
├── types/
│   └── sourcing.ts          # StandardProduct, DistributorResult interfaces
├── components/
│   ├── SearchBar.tsx
│   ├── ComparisonTable.tsx
│   ├── PriceCell.tsx
│   ├── WarehouseTooltip.tsx
│   └── DistributorStatusBadge.tsx
├── hooks/
│   └── useSourcingEngine.ts  # React Query hook for search
├── lib/
│   └── mockData.ts           # Mock S&S response for UI testing
└── pages/
    └── Index.tsx             # Main dashboard

supabase/
├── functions/
│   ├── sourcing-engine/
│   └── provider-ss-activewear/
└── migrations/
    └── 001_initial_schema.sql
```

---

### Deliverables

| Component | Description |
|-----------|-------------|
| Database schema | All tables with distributor seed data |
| Type definitions | StandardProduct interface for normalization |
| Mock UI | Fully styled comparison table with fake S&S data |
| Edge functions | Sourcing engine + S&S provider (ready for secrets) |
| Search flow | Manual sync button to control API calls |

