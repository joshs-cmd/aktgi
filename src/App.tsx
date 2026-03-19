import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import SearchGallery from "./pages/SearchGallery";
import ProductDetail from "./pages/ProductDetail";
import DataManagement from "./pages/DataManagement";
import AdminTools from "./pages/AdminTools";
import NotFound from "./pages/NotFound";
import { Gatekeeper } from "@/components/Gatekeeper";
import { UserRole } from "@/types/auth";
import { supabase } from "@/integrations/supabase/client";

const queryClient = new QueryClient();

const ALLOWED_DOMAINS = ["aktenterprises.com", "smartpunk.com"];

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [salesViewMode, setSalesViewMode] = useState(() =>
    sessionStorage.getItem("salesViewMode") === "true"
  );

  const handleSetSalesViewMode = (value: boolean) => {
    sessionStorage.setItem("salesViewMode", String(value));
    setSalesViewMode(value);
  };

  // When in sales view, present as a viewer role
  const effectiveRole: UserRole | null = salesViewMode ? "viewer" : userRole;



  const checkUserRole = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setIsAuthenticated(false);
      setUserRole(null);
      setIsChecking(false);
      return;
    }

    const email = session.user.email?.toLowerCase();
    if (!email) {
      await supabase.auth.signOut();
      setAuthError("Unable to verify your email address.");
      setIsChecking(false);
      return;
    }

    const domain = email.split("@")[1];
    if (!ALLOWED_DOMAINS.includes(domain)) {
      await supabase.auth.signOut();
      setAuthError("Access restricted to AKT Enterprises and SmartPunk accounts only.");
      setIsChecking(false);
      return;
    }

    // Call edge function to determine role
    try {
      const { data, error } = await supabase.functions.invoke("check-user-role");
      if (error || !data?.allowed) {
        await supabase.auth.signOut();
        setAuthError(data?.error || "Access denied.");
        setIsChecking(false);
        return;
      }

      setUserRole(data.role as UserRole);
      setUserEmail(session.user.email ?? null);
      setIsAuthenticated(true);
      setAuthError(null);
    } catch {
      await supabase.auth.signOut();
      setAuthError("Unable to verify access. Please try again.");
    }
    setIsChecking(false);
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event) => {
        if (event === "SIGNED_IN") {
          // Defer to avoid Supabase deadlock
          setTimeout(() => checkUserRole(), 0);
        } else if (event === "SIGNED_OUT") {
          setIsAuthenticated(false);
          setUserRole(null);
          handleSetSalesViewMode(false);
        }
      }
    );

    // THEN check existing session
    checkUserRole();

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setUserRole(null);
    setUserEmail(null);
    handleSetSalesViewMode(false);
  };

  if (isChecking) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <Gatekeeper
        onSuccess={() => checkUserRole()}
        error={authError}
      />
    );
  }

  const sharedProps = {
    userRole: effectiveRole,
    userEmail,
    onSignOut: handleSignOut,
    salesViewMode,
    setSalesViewMode: handleSetSalesViewMode,
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<SearchGallery {...sharedProps} />} />
            <Route path="/product" element={<ProductDetail {...sharedProps} />} />
            <Route path="/admin/data-management" element={<DataManagement userRole={effectiveRole} userEmail={userEmail} onSignOut={handleSignOut} />} />
            <Route path="/admin/tools" element={<AdminTools userRole={userRole} userEmail={userEmail} onSignOut={handleSignOut} salesViewMode={salesViewMode} setSalesViewMode={handleSetSalesViewMode} />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
