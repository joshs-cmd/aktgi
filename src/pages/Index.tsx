import { SearchBar } from "@/components/SearchBar";
import { ComparisonTable } from "@/components/ComparisonTable";
import { ProductHeader } from "@/components/ProductHeader";
import { useSourcingEngine } from "@/hooks/useSourcingEngine";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const Index = () => {
  const { isLoading, response, error, search } = useSourcingEngine();

  // Get the first successful product for the header
  const firstProduct = response?.results.find(
    (r) => r.status === "success" && r.product
  )?.product;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold tracking-tight">
            Price & Inventory Aggregator
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare prices and stock across distributors
          </p>
        </div>
      </header>

      {/* Search Section */}
      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center gap-8">
          {/* Search Bar */}
          <div className="w-full flex justify-center">
            <SearchBar onSearch={search} isLoading={isLoading} />
          </div>

          {/* Error State */}
          {error && (
            <Alert variant="destructive" className="max-w-2xl">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Search Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Results */}
          {response && (
            <div className="w-full space-y-6">
              {/* Product Info */}
              {firstProduct && (
                <ProductHeader
                  product={firstProduct}
                  query={response.query}
                  searchedAt={response.searchedAt}
                />
              )}

              {/* Comparison Table */}
              <ComparisonTable results={response.results} />

              {/* Legend */}
              <div className="flex items-center gap-6 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-8 rounded bg-emerald-500/15" />
                  <span>Lowest price in column</span>
                </div>
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
