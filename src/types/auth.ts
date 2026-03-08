// Authentication types for tiered access control
export type UserRole = "admin" | "viewer";

export interface AuthState {
  isAuthenticated: boolean;
  role: UserRole | null;
}

// Check if user can view prices
export function canViewPrices(role: UserRole | null): boolean {
  return role === "admin";
}
