import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { Gatekeeper } from "@/components/Gatekeeper";

const queryClient = new QueryClient();

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Check if already authenticated in this session
    const authenticated = sessionStorage.getItem("akt-authenticated") === "true";
    setIsAuthenticated(authenticated);
    setIsChecking(false);
  }, []);

  const handleGatekeeperSuccess = () => {
    setIsAuthenticated(true);
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
            <Route path="/" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
