import { cn } from "@/lib/utils";
import { StandardInventory } from "@/types/sourcing";
import { WarehouseTooltip } from "./WarehouseTooltip";
import { Badge } from "@/components/ui/badge";

interface PriceCellProps {
  price: number;
  inventory: StandardInventory[];
  isLowest: boolean;
  showPrice?: boolean;
  isProgramPrice?: boolean;
  distributorCode?: string;
  distributorName?: string;
  productUrl?: string;
}

/**
 * Format inventory total with 3,000+ notation for capped values
 */
function formatInventoryTotal(inventory: StandardInventory[], distributorCode?: string): string {
  const totalStock = inventory.reduce((sum, inv) => sum + inv.quantity, 0);
  const hasCapped = inventory.some(inv => inv.isCapped);
  const isSS = distributorCode === "ss-activewear";
  
  // S&S caps at 500 per warehouse, SanMar caps at 3000
  if (isSS && inventory.some(inv => inv.quantity >= 500)) {
    return `${totalStock.toLocaleString()}+`;
  }
  if (hasCapped) {
    return `${totalStock.toLocaleString()}+`;
  }
  return totalStock.toLocaleString();
}

export function PriceCell({ 
  price, 
  inventory, 
  isLowest, 
  showPrice = true,
  isProgramPrice = false,
  distributorCode,
  distributorName,
  productUrl
}: PriceCellProps) {
  const stockDisplay = formatInventoryTotal(inventory, distributorCode);
  const isSanMar = distributorCode === "sanmar";

  return (
    <WarehouseTooltip inventory={inventory} distributorName={distributorName} productUrl={productUrl}>
      <button
        className={cn(
          "flex flex-col items-center justify-center rounded-md px-3 py-2 text-center transition-colors",
          "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
          isLowest && showPrice && "bg-success/15 text-success"
        )}
      >
        {showPrice && (
          price > 0 ? (
            <div className="flex items-center gap-1">
              <span className="text-sm font-semibold tabular-nums">
                ${price.toFixed(2)}
              </span>
              {isProgramPrice && isSanMar && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-primary/10 text-primary">
                  Program
                </Badge>
              )}
            </div>
          ) : (
            <span className="text-sm font-medium text-muted-foreground">—</span>
          )
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {stockDisplay}
        </span>
      </button>
    </WarehouseTooltip>
  );
}
