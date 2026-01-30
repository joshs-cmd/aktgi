import { DistributorResult, SourcingResponse, StandardColor } from "@/types/sourcing";

// Mock S&S Activewear data for UI verification (with colors)
const mockWhiteColor: StandardColor = {
  code: "00",
  name: "White",
  hexCode: "#FFFFFF",
  swatchUrl: null,
  imageUrl: null,
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
};

const mockNavyColor: StandardColor = {
  code: "32",
  name: "Navy",
  hexCode: "#1F2937",
  swatchUrl: null,
  imageUrl: null,
  sizes: [
    {
      code: "S",
      order: 1,
      price: 4.50,
      inventory: [
        { warehouseCode: "TX", warehouseName: "Texas (Dallas)", quantity: 980 },
        { warehouseCode: "NV", warehouseName: "Nevada (Reno)", quantity: 650 },
      ],
    },
    {
      code: "M",
      order: 2,
      price: 4.50,
      inventory: [
        { warehouseCode: "TX", warehouseName: "Texas (Dallas)", quantity: 1500 },
        { warehouseCode: "NV", warehouseName: "Nevada (Reno)", quantity: 1200 },
      ],
    },
    {
      code: "L",
      order: 3,
      price: 4.50,
      inventory: [
        { warehouseCode: "TX", warehouseName: "Texas (Dallas)", quantity: 1320 },
        { warehouseCode: "NV", warehouseName: "Nevada (Reno)", quantity: 980 },
      ],
    },
    {
      code: "XL",
      order: 4,
      price: 4.50,
      inventory: [
        { warehouseCode: "TX", warehouseName: "Texas (Dallas)", quantity: 1100 },
        { warehouseCode: "NV", warehouseName: "Nevada (Reno)", quantity: 820 },
      ],
    },
  ],
};

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
    colors: [mockWhiteColor, mockNavyColor],
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

export const mockOneStopResult: DistributorResult = {
  distributorId: "onestop-001",
  distributorCode: "onestop",
  distributorName: "OneStop",
  status: "pending",
  lastSynced: null,
  product: null,
};

export const mockMcCrearysResult: DistributorResult = {
  distributorId: "mccreary-001",
  distributorCode: "mccreary",
  distributorName: "McCreary's",
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
    mockOneStopResult,
    mockMcCrearysResult,
  ],
});

// Helper to check if using mock data
export const USE_MOCK_DATA = false;
