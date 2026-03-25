import { SearchBar } from "@/components/SearchBar";
import aktLogo from "@/assets/aktlogo.png";
import { ProductCard } from "@/components/ProductCard";
import { TrendingGrid } from "@/components/TrendingGrid";
import { TrendingSection } from "@/components/TrendingSection";
import { useCatalogSearch } from "@/hooks/useCatalogSearch";
import { AlertCircle, Search, Loader2, ChevronDown, Calculator, Wrench, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState, useMemo } from "react";
import { UserRole } from "@/types/auth";
import { AdminBanner } from "@/components/AdminBanner";
import { UserMenu } from "@/components/UserMenu";
import { SalesViewBanner } from "@/components/SalesViewBanner";
import { supabase } from "@/integrations/supabase/client";

// ── Helpers ──────────────────────────────────────────────────────────────────

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&reg;/g, '®')
    .replace(/&trade;/g, '™')
    .replace(/&nbsp;/g, ' ')
    .replace(/\.\s+[A-Z0-9]+$/, '')
    .trim();
}

const PRIORITY_BRANDS = [
  'comfort colors', 'gildan', 'bella + canvas', 'bella+canvas',
  'next level apparel', 'next level', 'independent trading co.',
  'port & co', 'port & company', 'as colour', 'hanes',
  'awdis', 'just hoods', 'american apparel', 'bayside',
  'district', 'jerzees', 'champion', 'alternative apparel',
  'tultex', 'rabbit skins', 'colortone',
];

const BRAND_DISPLAY: Record<string, string> = {
  'BELLA + CANVAS': 'Bella + Canvas',
  'BELLA+CANVAS': 'Bella + Canvas',
  'NEXT LEVEL': 'Next Level Apparel',
  'PORT & CO': 'Port & Company',
  'JERZEES': 'Jerzees',
};

function normalizeBrand(brand: string): string {
  return BRAND_DISPLAY[brand.toUpperCase().trim()] ?? brand;
}

function getCategory(name: string): string {
  const n = name.toLowerCase();
  if (/hoodie|hooded|full.zip hood|half.zip hood/.test(n)) return 'Hoodies';
  if (/zip|quarter.zip|full.zip/.test(n) && !/hoodie|hooded/.test(n)) return 'Zip-Ups';
  if (/sweatshirt|crewneck fleece|crew fleece|pullover fleece/.test(n)) return 'Sweatshirts';
  if (/crewneck|crew neck/.test(n) && !/fleece|sweatshirt/.test(n)) return 'Crew Neck';
  if (/polo/.test(n)) return 'Polos';
  if (/jacket|windbreaker|anorak|vest/.test(n)) return 'Outerwear';
  if (/raglan|baseball tee|3\/4/.test(n)) return 'Raglan';
  if (/long.sleeve|l\/s/.test(n)) return 'Long Sleeve';
  if (/tank|muscle|racerback/.test(n)) return 'Tanks';
  if (/hat|cap|beanie|visor|bucket/.test(n)) return 'Headwear';
  if (/tote|bag|duffel|backpack|sack/.test(n)) return 'Bags & Totes';
  if (/jogger|pant|\bshorts\b/.test(n)) return 'Bottoms';
  if (/tee|t-shirt|t shirt/.test(n)) return 'T-Shirts';
  return 'Other';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SearchGalleryProps {
  userRole?: UserRole | null;
  userEmail?: string | null;
  onSignOut?: () => void;
  salesViewMode?: boolean;
  setSalesViewMode?: (value: boolean) => void;
}

const SearchGallery = ({ userRole, userEmail, onSignOut, salesViewMode = false, setSalesViewMode = () => {} }: SearchGalleryProps) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = userRole ?? null;
  const { isLoading, response, error, search, clearResults, bustCache } = useCatalogSearch();
  const lastQueryRef = useRef<string | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [colorSearch, setColorSearch] = useState('');
  // Map of styleNumber -> color names from catalog cache
  const [colorCacheMap, setColorCacheMap] = useState<Map<string, string[]>>(new Map());

  // On mount: bust the cache for the current ?q= so we always fetch fresh results
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) bustCache(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore search from URL param (for back navigation)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && q !== lastQueryRef.current) {
      lastQueryRef.current = q;
      search(q);
    }
  }, [searchParams, search]);

  // Load color data from catalog cache when results arrive
  useEffect(() => {
    if (!response?.products?.length) { setColorCacheMap(new Map()); return; }
    const styleNumbers = response.products.map(p => p.styleNumber);
    supabase
      .from("product_catalog_cache")
      .select("style_number, colors")
      .in("style_number", styleNumbers.map(s => s.toUpperCase().replace(/[^A-Z0-9]/g, "")))
      .gt("expires_at", new Date().toISOString())
      .then(({ data }) => {
        if (!data) return;
        const map = new Map<string, string[]>();
        for (const row of data) {
          if (!Array.isArray(row.colors)) continue;
          const names: string[] = (row.colors as any[])
            .map((c: any) => c?.name)
            .filter(Boolean);
          if (names.length) map.set(row.style_number, names);
        }
        setColorCacheMap(map);
      });
  }, [response?.products]);

  const handleSearch = (query: string) => {
    lastQueryRef.current = query;
    navigate(`/?q=${encodeURIComponent(query)}`, { replace: true });
    setSelectedCategory('All');
    setSelectedBrands([]);
    setSelectedColors([]);
    search(query);
  };

  const handleProductClick = (styleNumber: string, brand: string, distributorSkuMap?: Record<string, string>) => {
    // Fire-and-forget click tracking
    supabase.from("product_clicks").insert({
      style_number: styleNumber,
      brand: brand,
      clicked_at: new Date().toISOString(),
    }).then(({ error }) => {
      if (error) console.error("[click-tracking] Insert failed:", error.message, error.code);
    });

    const q = lastQueryRef.current || searchParams.get("q") || styleNumber;
    const skuMapParam = distributorSkuMap ? `&skuMap=${encodeURIComponent(JSON.stringify(distributorSkuMap))}` : "";
    navigate(
      `/product?style=${encodeURIComponent(styleNumber)}&brand=${encodeURIComponent(brand)}&q=${encodeURIComponent(q)}${skuMapParam}`
    );
  };

  // ── Derived data ────────────────────────────────────────────────────────────

  const prioritizedProducts = useMemo(() => {
    return [...(response?.products ?? [])].sort((a, b) => {
      const aIsPriority = PRIORITY_BRANDS.includes(a.brand.toLowerCase());
      const bIsPriority = PRIORITY_BRANDS.includes(b.brand.toLowerCase());
      if (aIsPriority && !bIsPriority) return -1;
      if (!aIsPriority && bIsPriority) return 1;
      return b.score - a.score;
    });
  }, [response?.products]);

  const categories = useMemo(() => {
    const cats = new Set(prioritizedProducts.map(p => getCategory(decodeHtmlEntities(p.name))));
    return ['All', ...Array.from(cats).sort()];
  }, [prioritizedProducts]);

  const brands = useMemo(() => {
    const b = new Set(prioritizedProducts.map(p => normalizeBrand(p.brand)));
    return Array.from(b).sort();
  }, [prioritizedProducts]);

  // All unique color names from the cache for the current result set
  const availableColors = useMemo(() => {
    const colorSet = new Set<string>();
    for (const [, names] of colorCacheMap) {
      for (const n of names) colorSet.add(n);
    }
    return Array.from(colorSet).sort();
  }, [colorCacheMap]);

  const filteredColors = useMemo(() =>
    colorSearch.trim()
      ? availableColors.filter(c => c.toLowerCase().includes(colorSearch.toLowerCase()))
      : availableColors,
    [availableColors, colorSearch]);

  const filteredProducts = useMemo(() => {
    return prioritizedProducts.filter(p => {
      const categoryMatch = selectedCategory === 'All' ||
        getCategory(decodeHtmlEntities(p.name)) === selectedCategory;
      const brandMatch = selectedBrands.length === 0 ||
        selectedBrands.includes(normalizeBrand(p.brand));
      if (!categoryMatch || !brandMatch) return false;
      if (selectedColors.length === 0) return true;
      // Check if this product's style number has any of the selected colors in cache
      const cacheKey = p.styleNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const productColors = colorCacheMap.get(cacheKey) ?? [];
      return selectedColors.some(sc =>
        productColors.some(pc => pc.toLowerCase() === sc.toLowerCase())
      );
    });
  }, [prioritizedProducts, selectedCategory, selectedBrands, selectedColors, colorCacheMap]);

  const hasResults = response && response.products.length > 0;
  const showEmptyState = !response && !error && !isLoading;
  const filtersActive = selectedCategory !== 'All' || selectedBrands.length > 0 || selectedColors.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <SalesViewBanner salesViewMode={salesViewMode} setSalesViewMode={setSalesViewMode} />
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
                    <a href="https://calculator.aktenterprises.com" className="flex items-center gap-2">
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
                  onClick={() => navigate("/admin/tools")}
                  className="gap-2 text-muted-foreground hover:text-foreground hidden lg:inline-flex"
                >
                  <Wrench className="h-4 w-4" />
                  Admin Tools
                </Button>
              )}
              {role === "admin" && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate("/admin/tools")}
                  className="text-muted-foreground hover:text-foreground lg:hidden"
                >
                  <Wrench className="h-4 w-4" />
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
              {/* Filter Bar */}
              <div className="flex flex-col gap-3">
                {/* Category pills */}
                {categories.length > 2 && (
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {categories.map(cat => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          selectedCategory === cat
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                {/* Brand dropdown + results count + clear */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Brand multiselect */}
                  {brands.length > 1 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                          Brand
                          {selectedBrands.length > 0 && (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                              {selectedBrands.length}
                            </Badge>
                          )}
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-56 p-2">
                        <div className="space-y-1 max-h-60 overflow-y-auto">
                          {brands.map(brand => (
                            <label
                              key={brand}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent cursor-pointer text-sm"
                            >
                              <Checkbox
                                checked={selectedBrands.includes(brand)}
                                onCheckedChange={(checked) => {
                                  setSelectedBrands(prev =>
                                    checked
                                      ? [...prev, brand]
                                      : prev.filter(b => b !== brand)
                                  );
                                }}
                              />
                              {brand}
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}

                  {/* Color multiselect — only when cache has color data */}
                  {availableColors.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                          Color
                          {selectedColors.length > 0 && (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                              {selectedColors.length}
                            </Badge>
                          )}
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-60 p-2">
                        <Input
                          placeholder="Search colors…"
                          value={colorSearch}
                          onChange={e => setColorSearch(e.target.value)}
                          className="h-7 text-xs mb-2"
                        />
                        <div className="space-y-1 max-h-52 overflow-y-auto">
                          {filteredColors.map(color => (
                            <label
                              key={color}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent cursor-pointer text-sm"
                            >
                              <Checkbox
                                checked={selectedColors.includes(color)}
                                onCheckedChange={(checked) => {
                                  setSelectedColors(prev =>
                                    checked
                                      ? [...prev, color]
                                      : prev.filter(c => c !== color)
                                  );
                                }}
                              />
                              {color}
                            </label>
                          ))}
                          {filteredColors.length === 0 && (
                            <p className="text-xs text-muted-foreground px-2 py-1.5">No colors found</p>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}

                  {/* Results count */}
                  <p className="text-sm text-muted-foreground flex-1">
                    {filtersActive
                      ? `${filteredProducts.length} of ${prioritizedProducts.length} results for "${response.query}"`
                      : `${prioritizedProducts.length} result${prioritizedProducts.length !== 1 ? 's' : ''} for "${response.query}"`
                    }
                  </p>

                  {/* Clear filters */}
                  {filtersActive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSelectedCategory('All');
                        setSelectedBrands([]);
                        setSelectedColors([]);
                      }}
                    >
                      <X className="h-3 w-3" />
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              {/* Product Grid */}
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredProducts.map((product, idx) => (
                  <ProductCard
                    key={`${product.styleNumber}-${product.brand}-${idx}`}
                    product={{ ...product, name: decodeHtmlEntities(product.name) }}
                    onClick={() =>
                      handleProductClick(product.styleNumber, product.brand, product.distributorSkuMap)
                    }
                  />
                ))}
              </div>

              {/* No results after filtering */}
              {filteredProducts.length === 0 && filtersActive && (
                <p className="text-center text-sm text-muted-foreground py-6">
                  No products match the selected filters.{' '}
                  <button
                    className="underline hover:text-foreground"
                    onClick={() => { setSelectedCategory('All'); setSelectedBrands([]); setSelectedColors([]); }}
                  >
                    Clear filters
                  </button>
                </p>
              )}
            </div>
          )}

          {/* Empty State — Trending sections */}
          {showEmptyState && (
            <div className="w-full max-w-3xl space-y-6">
              <p className="text-center text-lg text-muted-foreground">
                {role === "admin"
                  ? "Enter a SKU or brand name to compare prices across distributors"
                  : "Enter a SKU or brand name to check inventory across distributors"}
              </p>
              <TrendingSection onSearch={handleSearch} />
              <TrendingGrid onSearch={handleSearch} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default SearchGallery;
