import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ComparisonTable } from "@/components/ComparisonTable";
import { ProductHeader } from "@/components/ProductHeader";
import { useSourcingEngine } from "@/hooks/useSourcingEngine";
import { AlertCircle, Search, ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserRole, canViewPrices } from "@/types/auth";
import { AdminBanner } from "@/components/AdminBanner";
import { UserMenu } from "@/components/UserMenu";

interface ProductDetailProps {
  userRole: UserRole | null;
  userEmail?: string | null;
  onSignOut?: () => void;
}

const ProductDetail = ({ userRole, userEmail, onSignOut }: ProductDetailProps) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isLoading, response, error, search } = useSourcingEngine();
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const hasSearched = useRef(false);

  const styleParam = searchParams.get("style") || "";
  const queryParam = searchParams.get("q") || styleParam;
  const brandParam = searchParams.get("brand") || "";
  const skuMapParam = searchParams.get("skuMap");
  
  // Parse distributor SKU map from URL
  const distributorSkuMap = useMemo(() => {
    if (!skuMapParam) return undefined;
    try {
      return JSON.parse(skuMapParam) as Record<string, string>;
    } catch {
      return undefined;
    }
  }, [skuMapParam]);

  // Trigger full sourcing-engine on mount with distributor-specific SKUs
  useEffect(() => {
    if (styleParam && !hasSearched.current) {
      hasSearched.current = true;
      search(styleParam, { distributorSkuMap, brand: brandParam });
    }
  }, [styleParam, search, distributorSkuMap, brandParam]);

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

  // Still loading if any active row is in skeleton state
  const anyLoading = response?.results?.some((r) => r.status === "loading") ?? false;

  const allResultsEmpty =
    !response?.results ||
    (!anyLoading && response.results.every(
      (r) => r.status !== "success" || r.product === null
    ));

  const hasPartialResults =
    !anyLoading &&
    response?.results?.some((r) => r.status === "success" && r.product) &&
    response?.results?.some((r) => r.status === "error");

  const failedDistributors =
    response?.results?.filter((r) => r.status === "error") || [];

  return (
    <div className="min-h-screen bg-background">
      <AdminBanner userRole={userRole} />
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                AKT Garment Inventory
              </h1>
              <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                Beta
              </span>
            </div>
            {onSignOut && <UserMenu userEmail={userEmail} onSignOut={onSignOut} />}
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
          {/* Initial page-level skeleton — only shown before first skeleton rows appear */}
          {isLoading && !response && (
            <div className="w-full max-w-4xl space-y-6">
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

          {/* Results — show as soon as skeleton rows appear */}
          {response && !allResultsEmpty && (
            <div className="w-full space-y-8">
              {firstProduct ? (
                <ProductHeader
                  product={firstProduct}
                  query={response.query}
                  searchedAt={response.searchedAt}
                  selectedColor={selectedColor}
                  onColorSelect={setSelectedColor}
                />
              ) : anyLoading ? (
                // Skeleton header while first API result arrives
                <div className="space-y-3">
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-5 w-48" />
                  <div className="flex gap-2 mt-2">
                    {[...Array(6)].map((_, i) => (
                      <Skeleton key={i} className="h-7 w-7 rounded-full" />
                    ))}
                  </div>
                </div>
              ) : null}

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
                  <span>Not stocked / Pending connection</span>
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
