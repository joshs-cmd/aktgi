import { CatalogProduct } from "@/types/catalog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, Palette, Boxes, Store } from "lucide-react";
import { useSearchParams } from "react-router-dom";

interface ProductCardProps {
  product: CatalogProduct;
  onClick: () => void;
}

/**
 * Highlight the query SKU within the style number.
 * e.g. styleNumber="3001CVC", query="3001" → <span class="text-primary font-bold">3001</span>CVC
 */
function HighlightedSKU({ styleNumber, query }: { styleNumber: string; query: string }) {
  if (!query) return <>{styleNumber}</>;

  const querySKU = query.trim().split(/\s+/).pop()?.toUpperCase() || "";
  const upperStyle = styleNumber.toUpperCase();
  const idx = upperStyle.indexOf(querySKU);

  if (!querySKU || idx === -1) return <>{styleNumber}</>;

  const before = styleNumber.slice(0, idx);
  const match = styleNumber.slice(idx, idx + querySKU.length);
  const after = styleNumber.slice(idx + querySKU.length);

  return (
    <>
      {before}
      <span className="text-primary">{match}</span>
      {after}
    </>
  );
}

export function ProductCard({ product, onClick }: ProductCardProps) {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const formattedInventory = product.totalInventory.toLocaleString();
  const sources = product.distributorSources ?? [product.distributorName];

  return (
    <Card
      className="group cursor-pointer transition-all hover:shadow-md hover:border-primary/30 relative"
      onClick={onClick}
    >
      {/* AKT Program Badge */}
      {product.isProgramItem && (
        <div className="absolute top-3 right-3 z-10">
          <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5">
            AKT Program
          </Badge>
        </div>
      )}

      <CardContent className="p-4 flex gap-4">
        {/* Thumbnail */}
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-muted overflow-hidden">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-full w-full object-cover rounded-lg"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.parentElement!.querySelector(".fallback-icon")?.classList.remove("hidden");
              }}
            />
          ) : null}
          <Package
            className={`h-8 w-8 text-muted-foreground fallback-icon ${product.imageUrl ? "hidden" : ""}`}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Brand */}
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
            {product.brand}
          </p>

          {/* Style Number with highlight */}
          <h3 className="text-sm font-semibold leading-tight mt-0.5 truncate">
            <HighlightedSKU styleNumber={product.styleNumber} query={query} />
          </h3>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {product.name}
          </p>

          {/* Stats row */}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Palette className="h-3 w-3" />
              {product.colorCount} Colors
            </span>
            <span className="flex items-center gap-1">
              <Boxes className="h-3 w-3" />
              {formattedInventory} In Stock
            </span>
          </div>

          {/* Distributor Sources */}
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            <Store className="h-3 w-3 text-muted-foreground shrink-0" />
            {sources.map((src) => (
              <Badge
                key={src}
                variant="outline"
                className="text-[10px] px-1.5 py-0 font-normal"
              >
                {src}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
