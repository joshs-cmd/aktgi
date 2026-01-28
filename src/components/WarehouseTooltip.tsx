import { StandardInventory } from "@/types/sourcing";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Warehouse } from "lucide-react";

interface WarehouseTooltipProps {
  inventory: StandardInventory[];
  children: React.ReactNode;
}

export function WarehouseTooltip({ inventory, children }: WarehouseTooltipProps) {
  const totalStock = inventory.reduce((sum, inv) => sum + inv.quantity, 0);

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="w-64 p-0">
        <div className="p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Warehouse className="h-4 w-4" />
            Warehouse Breakdown
          </div>
          <div className="space-y-1.5">
            {inventory.map((inv) => (
              <div
                key={inv.warehouseCode}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">
                  {inv.warehouseCode} ({inv.warehouseName.split("(")[0].trim()})
                </span>
                <span className="font-medium tabular-nums">{inv.quantity.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
            <span className="font-medium">Total</span>
            <span className="font-semibold tabular-nums">{totalStock.toLocaleString()}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
