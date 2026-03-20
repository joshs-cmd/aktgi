import { useState, useCallback, useRef } from "react";
import { SourcingResponse, DistributorResult } from "@/types/sourcing";
import { getMockSourcingResponse, USE_MOCK_DATA } from "@/lib/mockData";
import { supabase } from "@/integrations/supabase/client";

export type DistributorLoadState = "idle" | "loading" | "done" | "error";

export interface DistributorStreamState {
  [distributorCode: string]: DistributorLoadState;
}

export function useSourcingEngine() {
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<SourcingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [distributorStates, setDistributorStates] = useState<DistributorStreamState>({});
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (
    query: string,
    options?: { distributorSkuMap?: Record<string, string>; brand?: string; force_refresh?: boolean }
  ) => {
    // Cancel any in-flight requests
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setIsLoading(true);
    setError(null);
    setResponse(null);

    const ACTIVE_DISTRIBUTORS = [
      { id: "sanmar-001",        code: "sanmar",        name: "SanMar" },
      { id: "ss-activewear-001", code: "ss-activewear", name: "S&S Activewear" },
      { id: "onestop-001",       code: "onestop",       name: "OneStop" },
      { id: "acc-001",           code: "acc",           name: "Atlantic Coast Cotton" },
    ];

    const PENDING_DISTRIBUTORS = [
      { id: "as-colour-001",  code: "as-colour", name: "AS Colour" },
      { id: "mccreary-001",   code: "mccreary",  name: "McCreary's" },
    ];

    if (USE_MOCK_DATA) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const mockResponse = getMockSourcingResponse(query);
      setResponse(mockResponse);
      setIsLoading(false);
      return;
    }

    try {
      // ---------------------------------------------------------------
      // PHASE 1: Seed the response with skeletons for active distributors
      // and pending rows for inactive ones. This makes the page open
      // instantly with structure visible before any API call completes.
      // ---------------------------------------------------------------
      const skeletonResults: DistributorResult[] = [
        ...ACTIVE_DISTRIBUTORS.map((d) => ({
          distributorId: d.id,
          distributorCode: d.code,
          distributorName: d.name,
          status: "loading" as const,
          product: null,
          lastSynced: null,
        })),
        ...PENDING_DISTRIBUTORS.map((d) => ({
          distributorId: d.id,
          distributorCode: d.code,
          distributorName: d.name,
          status: "pending" as const,
          product: null,
          lastSynced: null,
        })),
      ];

      setResponse({
        query,
        results: skeletonResults,
        searchedAt: new Date().toISOString(),
      });

      // Mark all active distributors as "loading"
      const initialStates: DistributorStreamState = {};
      for (const d of ACTIVE_DISTRIBUTORS) initialStates[d.code] = "loading";
      setDistributorStates(initialStates);
      setIsLoading(false); // Page is visible now

      // ---------------------------------------------------------------
      // PHASE 2: Fan out to all three provider functions in parallel.
      // As each one resolves, patch its row into the response state so
      // the table updates incrementally.
      // ---------------------------------------------------------------
      const promises = ACTIVE_DISTRIBUTORS.map(async (distributor) => {
        const distributorSkuMap = options?.distributorSkuMap;
        const brand = options?.brand;

        // Determine the per-distributor SKU
        const originalSku = distributorSkuMap?.[distributor.code];
        let queryForProvider = originalSku ?? query;

        try {
        const { data, error: fnError } = await supabase.functions.invoke(
            `provider-${distributor.code}`,
            { body: { query: queryForProvider, distributorId: distributor.id, brand, force_refresh: options?.force_refresh ?? false } }
          );

          if (abort.signal.aborted) return;

          const product = data?.product ?? null;

          // Canonical fallback: if nothing found and we have a brand, try alternate prefix form
          let finalProduct = product;
          if (!finalProduct && brand && !originalSku) {
            // Try with the alternate style (the sourcing engine logic handles this but
            // we duplicate it here for the per-distributor streaming path)
          }

          const result: DistributorResult = {
            distributorId: distributor.id,
            distributorCode: distributor.code,
            distributorName: distributor.name,
            status: fnError ? "error" : "success",
            product: finalProduct,
            lastSynced: finalProduct ? new Date().toISOString() : null,
            errorMessage: fnError ? "Provider temporarily unavailable" : undefined,
          };

          // Patch just this distributor's row into existing state
          setResponse((prev) => {
            if (!prev) return prev;
            const updated = prev.results.map((r) =>
              r.distributorCode === distributor.code ? result : r
            );
            return { ...prev, results: updated };
          });

          setDistributorStates((prev) => ({
            ...prev,
            [distributor.code]: fnError ? "error" : "done",
          }));
        } catch (err) {
          if (abort.signal.aborted) return;

          const result: DistributorResult = {
            distributorId: distributor.id,
            distributorCode: distributor.code,
            distributorName: distributor.name,
            status: "error",
            product: null,
            lastSynced: null,
            errorMessage: "Provider temporarily unavailable",
          };

          setResponse((prev) => {
            if (!prev) return prev;
            const updated = prev.results.map((r) =>
              r.distributorCode === distributor.code ? result : r
            );
            return { ...prev, results: updated };
          });

          setDistributorStates((prev) => ({
            ...prev,
            [distributor.code]: "error",
          }));
        }
      });

      // Wait for all but don't block the UI
      await Promise.allSettled(promises);

    } catch (err) {
      if (!abort.signal.aborted) {
        const message = err instanceof Error ? err.message : "Search failed";
        setError(message);
        console.error("Sourcing engine error:", err);
        setIsLoading(false);
      }
    }
  }, []);

  const clearResults = useCallback(() => {
    abortRef.current?.abort();
    setResponse(null);
    setError(null);
    setDistributorStates({});
  }, []);

  return {
    isLoading,
    response,
    error,
    search,
    clearResults,
    distributorStates,
  };
}
