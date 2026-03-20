import { useState, useMemo } from "react";
import { SearchBar } from "@/components/SearchBar";
import { ComparisonTable } from "@/components/ComparisonTable";
import { ProductHeader } from "@/components/ProductHeader";
import { useSourcingEngine } from "@/hooks/useSourcingEngine";
import { AlertCircle, Search, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { UserRole, canViewPrices } from "@/types/auth";

interface IndexProps {
  userRole: UserRole | null;
}

const Index = ({ userRole }: IndexProps) => {
  const { isLoading, response, error, search } = useSourcingEngine();
  const [selectedColor, setSelectedColor] = useState<string | null>(null);

  // Get the first successful product (the "winner" from sourcing-engine)
  const firstProduct = useMemo(() => {
    if (!response?.results) return null;
    return response.results.find(r => r.status === "success" && r.product)?.product ?? null;
  }, [response?.results]);

  // Get available colors from first product
  const availableColors = useMemo(() => {
    if (!firstProduct?.colors || firstProduct.colors.length === 0) return [];
    return firstProduct.colors;
  }, [firstProduct]);

  // Auto-select first color when results change
  useMemo(() => {
    if (availableColors.length > 0 && !selectedColor) {
      setSelectedColor(availableColors[0].name);
    }
  }, [availableColors, selectedColor]);

  // Reset color selection when new search happens
  const handleSearch = (query: string) => {
    setSelectedColor(null);
    search(query);
  };

  // Check if all results returned null products or all errored
  const allResultsEmpty = !response?.results || 
    response.results.every(r => r.status !== "success" || r.product === null);
  
  // Check if we have partial results (some succeeded, some failed)
  const hasPartialResults = response?.results?.some(r => r.status === "success" && r.product) &&
    response?.results?.some(r => r.status === "error");
  
  // Get failed distributors for warning message
  const failedDistributors = response?.results?.filter(r => r.status === "error") || [];

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

      {/* Search Section */}
      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center gap-8">
          {/* Search Bar */}
          <div className="w-full flex justify-center">
            <SearchBar onSearch={handleSearch} isLoading={isLoading} />
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="w-full max-w-4xl space-y-6">
              <div className="flex items-center justify-center gap-3 py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-lg text-muted-foreground">Searching distributors...</span>
              </div>
              {/* Loading skeleton for table */}
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          )}

          {/* Error State - Total failure */}
          {error && !isLoading && (
            <Alert variant="destructive" className="max-w-2xl">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Search Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Partial Results Warning - Some APIs failed but others succeeded */}
          {hasPartialResults && !isLoading && (
            <Alert className="max-w-2xl border-warning/50 bg-warning/10">
              <AlertCircle className="h-4 w-4 text-warning" />
              <AlertTitle>Partial Results</AlertTitle>
              <AlertDescription>
                Some distributors are unavailable: {failedDistributors.map(d => d.distributorName).join(', ')}. 
                Showing available results below.
              </AlertDescription>
            </Alert>
          )}

          {/* No Results Found State */}
          {response && allResultsEmpty && !error && !isLoading && (
            <Alert className="max-w-2xl">
              <Search className="h-4 w-4" />
              <AlertTitle>No Matching Products Found</AlertTitle>
              <AlertDescription>
                We couldn't find any products matching "{response.query}". Please check your SKU and try again.
                <ul className="mt-3 list-disc list-inside text-sm space-y-1">
                  <li>Try a brand + style number: "Gildan 5000" or "Bella Canvas 3001"</li>
                  <li>Or just the style number: "5000", "3001", "PC61"</li>
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Results - Single Unified Comparison Table */}
          {response && !allResultsEmpty && !isLoading && (
            <div className="w-full space-y-8">
              {/* Product Header - show for the winner product */}
              {firstProduct && (
                <ProductHeader
                  product={firstProduct}
                  selectedColor={selectedColor}
                  onColorSelect={setSelectedColor}
                />
              )}

              {/* Single Master Comparison Table with ALL distributors */}
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
                      <span className="px-1 py-0.5 text-[10px] rounded bg-primary/10 text-primary">Program</span>
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

          {/* Empty State */}
          {!response && !error && !isLoading && (
            <div className="py-12 text-center">
              <p className="text-lg text-muted-foreground">
                Enter a SKU or style number to compare prices across distributors
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;
