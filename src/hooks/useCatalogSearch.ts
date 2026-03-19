import { useState, useCallback, useRef } from "react";
import { CatalogSearchResponse } from "@/types/catalog";
import { supabase } from "@/integrations/supabase/client";

// 30-second micro-cache
interface CacheEntry {
  response: CatalogSearchResponse;
  timestamp: number;
}

const CACHE_TTL_MS = 30_000;

export function useCatalogSearch() {
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<CatalogSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());

  /** Evict a specific query (or all entries) from the micro-cache */
  const bustCache = useCallback((query?: string) => {
    if (query) {
      cacheRef.current.delete(query.trim().toLowerCase());
    } else {
      cacheRef.current.clear();
    }
  }, []);

  const search = useCallback(async (query: string, skipCache = false) => {
    const normalizedQuery = query.trim().toLowerCase();

    // Check micro-cache (unless caller requests a fresh fetch)
    if (!skipCache) {
      const cached = cacheRef.current.get(normalizedQuery);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        setResponse(cached.response);
        setError(null);
        return;
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "catalog-search",
        { body: { query } }
      );

      if (fnError) throw new Error(fnError.message);

      const catalogResponse = data as CatalogSearchResponse;
      setResponse(catalogResponse);

      // Overwrite any stale cache entry
      cacheRef.current.set(normalizedQuery, {
        response: catalogResponse,
        timestamp: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      setError(message);
      console.error("Catalog search error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResponse(null);
    setError(null);
  }, []);

  return { isLoading, response, error, search, clearResults, bustCache };
}
