import { StandardProduct } from "@/types/sourcing";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";
import { ColorSelector } from "./ColorSelector";
import { useMemo } from "react";

interface ProductHeaderProps {
  product: StandardProduct;
  selectedColor?: string | null;
  onColorSelect?: (colorName: string) => void;
  availableColors?: StandardProduct["colors"];
}

export function ProductHeader({
  product,
  selectedColor,
  onColorSelect,
}: ProductHeaderProps) {
  // Get the selected color's image, fallback to product image
  const displayImage = useMemo(() => {
    if (product.colors && selectedColor) {
      const color = product.colors.find((c) => c.name === selectedColor);
      if (color?.imageUrl) return color.imageUrl;
    }
    return product.imageUrl;
  }, [product, selectedColor]);

  const hasColors = product.colors && product.colors.length > 0;

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-lg bg-muted overflow-hidden shrink-0">
          {displayImage ? (
            <img
              src={displayImage}
              alt={product.name}
              className="h-full w-full rounded-lg object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.parentElement!.innerHTML =
                  '<div class="flex h-full w-full items-center justify-center"><svg class="h-8 w-8 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg></div>';
              }}
            />
          ) : (
            <Package className="h-8 w-8 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base sm:text-xl font-semibold">{product.name}</h2>
            <Badge variant="secondary">{product.styleNumber}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs sm:text-sm text-muted-foreground">
            <span>{product.brand}</span>
          </div>
        </div>
      </div>

      {/* Color Selector */}
      {hasColors && selectedColor && onColorSelect && (
        <div className="border-t pt-4">
          <ColorSelector
            colors={product.colors!}
            selectedColor={selectedColor}
            onColorSelect={onColorSelect}
          />
        </div>
      )}
    </div>
  );
}
