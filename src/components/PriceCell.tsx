import { cn } from "@/lib/utils";
import { StandardInventory } from "@/types/sourcing";
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

function formatInventoryTotal(inventory: StandardInventory[], distributorCode?: string): string {
  const totalStock = inventory.reduce((sum, inv) => sum + inv.quantity, 0);
  const hasCapped = inventory.some(inv => inv.isCapped);
  const isSS = distributorCode === "ss-activewear";
  if (isSS && inventory.some(inv => inv.quantity >= 500)) {
    return `${totalStock.toLocaleString()}+`;
  }
  if (hasCapped) {
    return `${totalStock.toLocaleString()}+`;
  }
  return totalStock.toLocaleString();
}

export function PriceCell({ price, inventory, isLowest, showPrice = true, isProgramPrice = false, distributorCode }: PriceCellProps) {
  const stockDisplay = formatInventoryTotal(inventory, distributorCode);
  const isSanMar = distributorCode === "sanmar";
  return (
    <div className={cn(
      "flex flex-col items-center justify-center rounded-md px-3 py-2 text-center",
      isLowest && showPrice && "bg-success/15 text-success"
    )}>
      {showPrice && (
        price > 0 ? (
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold tabular-nums">${price.toFixed(2)}</span>
            {isProgramPrice && isSanMar && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-primary/10 text-primary">Program</Badge>
            )}
          </div>
        ) : (
          <span className="text-sm font-medium text-muted-foreground">—</span>
        )
      )}
      <span className="text-xs text-muted-foreground tabular-nums">{stockDisplay}</span>
    </div>
  );
}
