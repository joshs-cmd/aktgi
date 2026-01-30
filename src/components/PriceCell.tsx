import { cn } from "@/lib/utils";
import { StandardInventory } from "@/types/sourcing";
import { WarehouseTooltip } from "./WarehouseTooltip";

interface PriceCellProps {
  price: number;
  inventory: StandardInventory[];
  isLowest: boolean;
}

/**
 * Format inventory total with 3,000+ notation for capped values
 */
function formatInventoryTotal(inventory: StandardInventory[]): string {
  const totalStock = inventory.reduce((sum, inv) => sum + inv.quantity, 0);
  const hasCapped = inventory.some(inv => inv.isCapped);
  
  if (hasCapped) {
    return `${totalStock.toLocaleString()}+`;
  }
  return totalStock.toLocaleString();
}

export function PriceCell({ price, inventory, isLowest }: PriceCellProps) {
  const stockDisplay = formatInventoryTotal(inventory);

  return (
    <WarehouseTooltip inventory={inventory}>
      <button
        className={cn(
          "flex flex-col items-center justify-center rounded-md px-3 py-2 text-center transition-colors",
          "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
          isLowest && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
        )}
      >
        <span className="text-sm font-semibold tabular-nums">
          ${price.toFixed(2)}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {stockDisplay} in stock
        </span>
      </button>
    </WarehouseTooltip>
  );
}
