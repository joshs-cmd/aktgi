// Types for Stage 1 catalog search (lightweight, no full inventory matrix)

export interface CatalogProduct {
  styleNumber: string;
  normalizedSKU: string;
  name: string;
  brand: string;
  category: string;
  imageUrl?: string;
  colorCount: number;
  totalInventory: number;
  isProgramItem: boolean;
  distributorCode: string;
  distributorName: string;
  distributorSources: string[]; // e.g. ["SanMar", "S&S Activewear"]
  distributorSkuMap?: Record<string, string>; // e.g. { sanmar: "NL3600", "ss-activewear": "3600" }
  score: number;
}

export interface CatalogSearchResponse {
  query: string;
  products: CatalogProduct[];
  searchedAt: string;
}
