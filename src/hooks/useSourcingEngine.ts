import { useState, useCallback } from "react";
import { SourcingResponse } from "@/types/sourcing";
import { getMockSourcingResponse, USE_MOCK_DATA } from "@/lib/mockData";
import { supabase } from "@/integrations/supabase/client";

export function useSourcingEngine() {
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<SourcingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    setIsLoading(true);
    setError(null);

    try {
      if (USE_MOCK_DATA) {
        // Simulate network delay for realistic UX
        await new Promise((resolve) => setTimeout(resolve, 800));
        const mockResponse = getMockSourcingResponse(query);
        setResponse(mockResponse);
      } else {
        // Call the sourcing-engine edge function
        const { data, error: fnError } = await supabase.functions.invoke(
          "sourcing-engine",
          {
            body: { query },
          }
        );

        if (fnError) {
          throw new Error(fnError.message);
        }

        setResponse(data as SourcingResponse);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      setError(message);
      console.error("Sourcing engine error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResponse(null);
    setError(null);
  }, []);

  return {
    isLoading,
    response,
    error,
    search,
    clearResults,
  };
}
