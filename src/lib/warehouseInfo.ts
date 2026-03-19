export interface WarehouseInfo {
  city: string;
  state: string;
  etaOrlando: number;  // UPS Ground days to 32810
  etaLasVegas: number; // UPS Ground days to 89115
  isDropship?: boolean;
}

export const WAREHOUSE_INFO: Record<string, WarehouseInfo> = {
  // S&S Activewear
  "IL": { city: "Lockport",     state: "IL", etaOrlando: 3, etaLasVegas: 3 },
  "MA": { city: "Middleboro",   state: "MA", etaOrlando: 3, etaLasVegas: 5 },
  "CN": { city: "Fresno",       state: "CA", etaOrlando: 5, etaLasVegas: 2 },
  "FO": { city: "Orlando",      state: "FL", etaOrlando: 1, etaLasVegas: 5 },
  "GA": { city: "Atlanta",      state: "GA", etaOrlando: 2, etaLasVegas: 4 },
  "TX": { city: "Dallas",       state: "TX", etaOrlando: 3, etaLasVegas: 3 },
  "OH": { city: "Columbus",     state: "OH", etaOrlando: 2, etaLasVegas: 4 },
  "NV": { city: "Reno",         state: "NV", etaOrlando: 5, etaLasVegas: 1 },
  "PA": { city: "Harrisburg",   state: "PA", etaOrlando: 3, etaLasVegas: 5 },
  "KS": { city: "Olathe",       state: "KS", etaOrlando: 3, etaLasVegas: 3 },
  "DS": { city: "Dropship",     state: "",   etaOrlando: 14, etaLasVegas: 14, isDropship: true },
  // ACC
  "SC": { city: "Cayce",        state: "SC", etaOrlando: 2, etaLasVegas: 5 },
  "V":  { city: "Richmond",     state: "VA", etaOrlando: 2, etaLasVegas: 5 },
  // SanMar (numeric codes)
  "6":  { city: "Jacksonville", state: "FL", etaOrlando: 1, etaLasVegas: 5 },
  "3":  { city: "Dallas",       state: "TX", etaOrlando: 3, etaLasVegas: 3 },
  "2":  { city: "Cincinnati",   state: "OH", etaOrlando: 2, etaLasVegas: 4 },
  "12": { city: "Phoenix",      state: "AZ", etaOrlando: 5, etaLasVegas: 2 },
  "5":  { city: "Robbinsville", state: "NJ", etaOrlando: 3, etaLasVegas: 5 },
  "31": { city: "Richmond",     state: "VA", etaOrlando: 2, etaLasVegas: 5 },
  "7":  { city: "Minneapolis",  state: "MN", etaOrlando: 4, etaLasVegas: 3 },
  "1":  { city: "Seattle",      state: "WA", etaOrlando: 5, etaLasVegas: 2 },
  "4":  { city: "Reno",         state: "NV", etaOrlando: 5, etaLasVegas: 1 },
  // OneStop
  "Grand Rapids": { city: "Grand Rapids", state: "MI", etaOrlando: 3, etaLasVegas: 4 },
};

export function getWarehouseInfo(code: string): WarehouseInfo | null {
  return WAREHOUSE_INFO[code] ?? null;
}
