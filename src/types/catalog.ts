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
  score: number;
}

export interface CatalogSearchResponse {
  query: string;
  products: CatalogProduct[];
  searchedAt: string;
}
