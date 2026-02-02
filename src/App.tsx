import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { Gatekeeper } from "@/components/Gatekeeper";
import { UserRole, getAuthState, AUTH_SESSION_KEY, ROLE_SESSION_KEY } from "@/types/auth";

const queryClient = new QueryClient();

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Check if already authenticated in this session
    const authState = getAuthState();
    setIsAuthenticated(authState.isAuthenticated);
    setUserRole(authState.role);
    setIsChecking(false);
  }, []);

  const handleGatekeeperSuccess = (role: UserRole) => {
    setIsAuthenticated(true);
    setUserRole(role);
  };

  // Show nothing while checking session
  if (isChecking) {
    return null;
  }

  // Show gatekeeper if not authenticated
  if (!isAuthenticated) {
    return <Gatekeeper onSuccess={handleGatekeeperSuccess} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index userRole={userRole} />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
