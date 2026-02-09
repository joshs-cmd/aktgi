// Types for Stage 1 catalog search (lightweight, no full inventory matrix)

export interface CatalogProduct {
  styleNumber: string;
  name: string;
  brand: string;
  category: string;
  imageUrl?: string;
  colorCount: number;
  totalInventory: number;
  isProgramItem: boolean; // true if any size uses benefitPrice/contractPrice
  distributorCode: string; // which distributor returned this
  distributorName: string;
  score: number; // weighted ranking score
}

export interface CatalogSearchResponse {
  query: string;
  products: CatalogProduct[];
  searchedAt: string;
}
