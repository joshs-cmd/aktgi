import { DistributorResult, SourcingResponse } from "@/types/sourcing";

// Mock S&S Activewear data for UI verification
export const mockSSActivewearResult: DistributorResult = {
  distributorId: "ss-activewear-001",
  distributorCode: "ss-activewear",
  distributorName: "S&S Activewear",
  status: "success",
  lastSynced: new Date().toISOString(),
  product: {
    styleNumber: "G500",
    name: "Adult Heavy Cotton T-Shirt",
    brand: "Gildan",
    category: "T-Shirts",
    imageUrl: "https://www.ssactivewear.com/images/products/G500.jpg",
    sizes: [
      {
        code: "S",
        order: 1,
        price: 4.50,
        inventory: [
          { warehouseCode: "TX", warehouseName: "Texas (Dallas)", quantity: 1250 },
          { warehouseCode: "NV", warehouseName: "Nevada (Reno)", quantity: 890 },
          { warehouseCode: "OH", warehouseName: "Ohio (Columbus)", quantity: 654 },
        ],
      },
      {
        code: "M",
        order: 2,
        price: 4.50,
        inventory: [
          { warehouseCode: "TX", warehouseName: "Texas (Dallas)", quantity: 2100 },
          { warehouseCode: "NV", warehouseName: "Nevada (Reno)", quantity: 1540 },
          { warehouseCode: "OH", warehouseName: "Ohio (Columbus)", quantity: 980 },
        ],
      },
      {
        code: "L",
        order: 3,
        price: 4.50,
        inventory: [
          { warehouseCode: "TX", warehouseName: "Texas (Dallas)", quantity: 1890 },
          { warehouseCode: "NV", warehouseName: "Nevada (Reno)", quantity: 1320 },
          { warehouseCode: "OH", warehouseName: "Ohio (Columbus)", quantity: 845 },
        ],
      },
      {
        code: "XL",
        order: 4,
        price: 4.50,
        inventory: [
          { warehouseCode: "TX", warehouseName: "Texas (Dallas)", quantity: 1450 },
          { warehouseCode: "NV", warehouseName: "Nevada (Reno)", quantity: 1100 },
          { warehouseCode: "OH", warehouseName: "Ohio (Columbus)", quantity: 720 },
        ],
      },
      {
        code: "2XL",
        order: 5,
        price: 5.50,
        inventory: [
          { warehouseCode: "TX", warehouseName: "Texas (Dallas)", quantity: 890 },
          { warehouseCode: "NV", warehouseName: "Nevada (Reno)", quantity: 650 },
          { warehouseCode: "OH", warehouseName: "Ohio (Columbus)", quantity: 420 },
        ],
      },
      {
        code: "3XL",
        order: 6,
        price: 6.50,
        inventory: [
          { warehouseCode: "TX", warehouseName: "Texas (Dallas)", quantity: 340 },
          { warehouseCode: "NV", warehouseName: "Nevada (Reno)", quantity: 280 },
          { warehouseCode: "OH", warehouseName: "Ohio (Columbus)", quantity: 190 },
        ],
      },
    ],
  },
};

// Pending distributors (not yet connected)
export const mockSanMarResult: DistributorResult = {
  distributorId: "sanmar-001",
  distributorCode: "sanmar",
  distributorName: "SanMar",
  status: "pending",
  lastSynced: null,
  product: null,
};

export const mockASColourResult: DistributorResult = {
  distributorId: "as-colour-001",
  distributorCode: "as-colour",
  distributorName: "AS Colour",
  status: "pending",
  lastSynced: null,
  product: null,
};

export const mockAlphabroderResult: DistributorResult = {
  distributorId: "alphabroder-001",
  distributorCode: "alphabroder",
  distributorName: "Alphabroder",
  status: "pending",
  lastSynced: null,
  product: null,
};

export const mockIndependentResult: DistributorResult = {
  distributorId: "independent-001",
  distributorCode: "independent",
  distributorName: "Independent Trading Co.",
  status: "pending",
  lastSynced: null,
  product: null,
};

// Complete mock response
export const getMockSourcingResponse = (query: string): SourcingResponse => ({
  query,
  searchedAt: new Date().toISOString(),
  results: [
    mockSSActivewearResult,
    mockSanMarResult,
    mockASColourResult,
    mockAlphabroderResult,
    mockIndependentResult,
  ],
});

// Helper to check if using mock data
export const USE_MOCK_DATA = true;
