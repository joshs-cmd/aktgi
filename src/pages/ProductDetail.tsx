import { useState, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { SearchBar } from "@/components/SearchBar";
import { ComparisonTable } from "@/components/ComparisonTable";
import { ProductHeader } from "@/components/ProductHeader";
import { useSourcingEngine } from "@/hooks/useSourcingEngine";
import { AlertCircle, Search, Loader2, ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserRole, canViewPrices } from "@/types/auth";
import { useEffect, useRef } from "react";

interface ProductDetailProps {
  userRole: UserRole | null;
}

const ProductDetail = ({ userRole }: ProductDetailProps) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isLoading, response, error, search } = useSourcingEngine();
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const hasSearched = useRef(false);

  const styleParam = searchParams.get("style") || "";
  const queryParam = searchParams.get("q") || styleParam;

  // Trigger full sourcing-engine on mount
  useEffect(() => {
    if (styleParam && !hasSearched.current) {
      hasSearched.current = true;
      search(styleParam);
    }
  }, [styleParam, search]);

  const handleBackToResults = () => {
    navigate(`/?q=${encodeURIComponent(queryParam)}`);
  };

  // Get the first successful product
  const firstProduct = useMemo(() => {
    if (!response?.results) return null;
    return (
      response.results.find((r) => r.status === "success" && r.product)
        ?.product ?? null
    );
  }, [response?.results]);

  // Available colors
  const availableColors = useMemo(() => {
    if (!firstProduct?.colors || firstProduct.colors.length === 0) return [];
    return firstProduct.colors;
  }, [firstProduct]);

  // Auto-select first color
  useMemo(() => {
    if (availableColors.length > 0 && !selectedColor) {
      setSelectedColor(availableColors[0].name);
    }
  }, [availableColors, selectedColor]);

  const allResultsEmpty =
    !response?.results ||
    response.results.every(
      (r) => r.status !== "success" || r.product === null
    );

  const hasPartialResults =
    response?.results?.some((r) => r.status === "success" && r.product) &&
    response?.results?.some((r) => r.status === "error");

  const failedDistributors =
    response?.results?.filter((r) => r.status === "error") || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              AKT Garment Inventory
            </h1>
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
              Beta
            </span>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-8">
          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            className="self-start -ml-2"
            onClick={handleBackToResults}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Results
          </Button>

          {/* Loading State */}
          {isLoading && (
            <div className="w-full max-w-4xl space-y-6">
              <div className="flex items-center justify-center gap-3 py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-lg text-muted-foreground">
                  Loading full pricing & inventory...
                </span>
              </div>
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          )}

          {/* Error */}
          {error && !isLoading && (
            <Alert variant="destructive" className="max-w-2xl">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Search Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Partial Results Warning */}
          {hasPartialResults && !isLoading && (
            <Alert className="max-w-2xl border-warning/50 bg-warning/10">
              <AlertCircle className="h-4 w-4 text-warning" />
              <AlertTitle>Partial Results</AlertTitle>
              <AlertDescription>
                Some distributors are unavailable:{" "}
                {failedDistributors.map((d) => d.distributorName).join(", ")}.
                Showing available results below.
              </AlertDescription>
            </Alert>
          )}

          {/* No Results */}
          {response && allResultsEmpty && !error && !isLoading && (
            <Alert className="max-w-2xl">
              <Search className="h-4 w-4" />
              <AlertTitle>No Matching Products Found</AlertTitle>
              <AlertDescription>
                We couldn't find detailed data for "{styleParam}".
              </AlertDescription>
            </Alert>
          )}

          {/* Results */}
          {response && !allResultsEmpty && !isLoading && (
            <div className="w-full space-y-8">
              {firstProduct && (
                <ProductHeader
                  product={firstProduct}
                  query={response.query}
                  searchedAt={response.searchedAt}
                  selectedColor={selectedColor}
                  onColorSelect={setSelectedColor}
                />
              )}

              <ComparisonTable
                results={response.results}
                selectedColor={selectedColor}
                showPrices={canViewPrices(userRole)}
              />

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
                {canViewPrices(userRole) && (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-8 rounded bg-success/15" />
                      <span>Lowest price in column</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1 py-0.5 text-[10px] rounded bg-primary/10 text-primary">
                        Program
                      </span>
                      <span>AKT contract pricing</span>
                    </div>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">--</span>
                  <span>Not available / Pending connection</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ProductDetail;
