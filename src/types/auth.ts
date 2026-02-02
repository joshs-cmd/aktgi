// Authentication types for tiered access control
export type UserRole = "admin" | "viewer";

export interface AuthState {
  isAuthenticated: boolean;
  role: UserRole | null;
}

// Session storage keys
export const AUTH_SESSION_KEY = "akt-authenticated";
export const ROLE_SESSION_KEY = "akt-role";

// Helper to get current auth state from session
export function getAuthState(): AuthState {
  const isAuthenticated = sessionStorage.getItem(AUTH_SESSION_KEY) === "true";
  const role = sessionStorage.getItem(ROLE_SESSION_KEY) as UserRole | null;
  
  return {
    isAuthenticated,
    role: isAuthenticated ? role : null,
  };
}

// Helper to set auth state in session
export function setAuthState(role: UserRole): void {
  sessionStorage.setItem(AUTH_SESSION_KEY, "true");
  sessionStorage.setItem(ROLE_SESSION_KEY, role);
}

// Helper to clear auth state
export function clearAuthState(): void {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  sessionStorage.removeItem(ROLE_SESSION_KEY);
}

// Check if user can view prices
export function canViewPrices(role: UserRole | null): boolean {
  return role === "admin";
}
