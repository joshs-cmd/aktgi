import { SearchBar } from "@/components/SearchBar";
import aktLogo from "@/assets/aktlogo.png";
import { ProductCard } from "@/components/ProductCard";
import { TrendingGrid } from "@/components/TrendingGrid";
import { useCatalogSearch } from "@/hooks/useCatalogSearch";
import { AlertCircle, Search, Loader2, HardDrive, ChevronDown, Calculator } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useRef } from "react";
import { UserRole } from "@/types/auth";
import { AdminBanner } from "@/components/AdminBanner";
import { UserMenu } from "@/components/UserMenu";

interface SearchGalleryProps {
  userRole?: UserRole | null;
  userEmail?: string | null;
  onSignOut?: () => void;
}

const SearchGallery = ({ userRole, userEmail, onSignOut }: SearchGalleryProps) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = userRole ?? null;
  const { isLoading, response, error, search, clearResults } = useCatalogSearch();
  const lastQueryRef = useRef<string | null>(null);

  // Restore search from URL param (for back navigation)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && q !== lastQueryRef.current) {
      lastQueryRef.current = q;
      search(q);
    }
  }, [searchParams, search]);

  const handleSearch = (query: string) => {
    lastQueryRef.current = query;
    navigate(`/?q=${encodeURIComponent(query)}`, { replace: true });
    search(query);
  };

  const handleProductClick = (styleNumber: string, brand: string, distributorSkuMap?: Record<string, string>) => {
    const q = lastQueryRef.current || searchParams.get("q") || styleNumber;
    const skuMapParam = distributorSkuMap ? `&skuMap=${encodeURIComponent(JSON.stringify(distributorSkuMap))}` : "";
    navigate(
      `/product?style=${encodeURIComponent(styleNumber)}&brand=${encodeURIComponent(brand)}&q=${encodeURIComponent(q)}${skuMapParam}`
    );
  };

  const hasResults = response && response.products.length > 0;
  const showEmptyState = !response && !error && !isLoading;

  return (
    <div className="min-h-screen bg-background">
      <AdminBanner userRole={role} />
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 sm:py-6">
          <div className="flex items-center justify-between w-full gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div
                className="flex items-center gap-2 sm:gap-3 cursor-pointer min-w-0"
                onClick={() => {
                  lastQueryRef.current = null;
                  clearResults();
                  navigate("/", { replace: true });
                }}
              >
                <img src={aktLogo} alt="AKT" className="h-8 sm:h-11 md:h-14 w-auto shrink-0" />
                <h1 className="text-lg sm:text-2xl font-bold hover:text-primary transition-colors truncate">
                  Garment Inventory
                </h1>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center justify-center rounded-md p-1 hover:bg-accent transition-colors focus:outline-none shrink-0">
                    <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem asChild>
                    <a href="https://calculator.aktenterprises.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                      <Calculator className="h-4 w-4" />
                      Pricing Calculator
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {role === "admin" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/admin/data-management")}
                  className="gap-2 text-muted-foreground hover:text-foreground hidden lg:inline-flex"
                >
                  <HardDrive className="h-4 w-4" />
                  Data Management
                </Button>
              )}
              {role === "admin" && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate("/admin/data-management")}
                  className="text-muted-foreground hover:text-foreground lg:hidden"
                >
                  <HardDrive className="h-4 w-4" />
                </Button>
              )}
              {onSignOut && <UserMenu userEmail={userEmail} onSignOut={onSignOut} />}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center gap-8">
          {/* Search Bar */}
          <div className="w-full flex justify-center">
            <SearchBar onSearch={handleSearch} isLoading={isLoading} />
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="w-full max-w-3xl space-y-4">
              <div className="flex items-center justify-center gap-3 py-6">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-lg text-muted-foreground">
                  Searching catalogs...
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-28 w-full rounded-lg" />
                ))}
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

          {/* No Results */}
          {response && response.products.length === 0 && !error && !isLoading && (
            <Alert className="max-w-2xl">
              <Search className="h-4 w-4" />
              <AlertTitle>No Matching Products Found</AlertTitle>
              <AlertDescription>
                We couldn't find any products matching "{response.query}".
                <ul className="mt-3 list-disc list-inside text-sm space-y-1">
                  <li>Try a brand + style number: "Gildan 5000" or "Bella Canvas 3001"</li>
                  <li>Or just the style number: "5000", "3001", "PC61"</li>
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Results Gallery */}
          {hasResults && !isLoading && (
            <div className="w-full max-w-3xl space-y-4">
              <p className="text-sm text-muted-foreground">
                {response.products.length} result{response.products.length !== 1 ? "s" : ""} for "{response.query}"
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {response.products.map((product, idx) => (
                  <ProductCard
                    key={`${product.styleNumber}-${product.brand}-${idx}`}
                    product={product}
                    onClick={() =>
                      handleProductClick(product.styleNumber, product.brand, product.distributorSkuMap)
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty State — Trending Grid */}
          {showEmptyState && (
            <div className="w-full max-w-3xl space-y-6">
              <p className="text-center text-lg text-muted-foreground">
                {role === "admin"
                  ? "Enter a SKU or brand name to compare prices across distributors"
                  : "Enter a SKU or brand name to check inventory across distributors"}
              </p>
              <TrendingGrid onSearch={handleSearch} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default SearchGallery;
