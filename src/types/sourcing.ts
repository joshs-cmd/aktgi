// Standard interfaces for normalized distributor data
// Every provider maps its unique API response to these formats

export interface StandardInventory {
  warehouseCode: string;
  warehouseName: string;
  quantity: number;
  isCapped?: boolean; // True when quantity equals 3000 (SanMar API cap)
}

export interface StandardSize {
  code: string;        // "S", "M", "L", "2XL"
  order: number;       // For sorting
  price: number;
  inventory: StandardInventory[];
  isProgramPrice?: boolean; // True when using benefit/contract pricing (SanMar)
}

export interface StandardColor {
  code: string;           // "00", "01", etc.
  name: string;           // "White", "Navy", etc.
  hexCode: string | null; // "#FFFFFF" or null
  swatchUrl: string | null;
  imageUrl: string | null;
  sizes: StandardSize[];
}

export interface StandardProduct {
  styleNumber: string;
  name: string;
  brand: string;
  category: string;
  imageUrl?: string;
  description?: string;          // Debug/informational field
  colors?: StandardColor[];      // Color-specific pricing/inventory
  sizes?: StandardSize[];        // Backward compat for non-color distributors
}

export type DistributorStatus = 'success' | 'error' | 'pending';

export interface DistributorResult {
  distributorId: string;
  distributorCode: string;
  distributorName: string;
  status: DistributorStatus;
  product: StandardProduct | null;
  lastSynced: string | null;
  errorMessage?: string;
}

export interface SourcingResponse {
  query: string;
  results: DistributorResult[];
  searchedAt: string;
}

// Database types (matching Supabase schema)
export interface Distributor {
  id: string;
  name: string;
  code: string;
  api_base_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Warehouse {
  id: string;
  distributor_id: string;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
}
