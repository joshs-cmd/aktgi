import { StandardInventory } from "@/types/sourcing";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Warehouse, ExternalLink } from "lucide-react";
import { getWarehouseInfo } from "@/lib/warehouseInfo";

interface WarehouseTooltipProps {
  inventory: StandardInventory[];
  children: React.ReactNode;
  distributorName?: string;
  productUrl?: string;
}

/**
 * Format quantity with + suffix if capped (3,000+ rule)
 */
function formatQuantity(quantity: number, isCapped?: boolean): string {
  const formatted = quantity.toLocaleString();
  return isCapped ? `${formatted}+` : formatted;
}

function formatDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

export function WarehouseTooltip({ inventory, children, distributorName, productUrl }: WarehouseTooltipProps) {
  const totalStock = inventory.reduce((sum, inv) => sum + inv.quantity, 0);
  const hasCapped = inventory.some(inv => inv.isCapped);

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="w-72 p-0">
        <div className="p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Warehouse className="h-4 w-4" />
            Warehouse Breakdown
          </div>
          <div className="space-y-2.5">
            {inventory.map((inv) => {
              const info = getWarehouseInfo(inv.warehouseCode);
              const locationLabel = info
                ? `${info.city}${info.state ? `, ${info.state}` : ""}`
                : inv.warehouseName.split("(")[0].trim();

              return (
                <div key={inv.warehouseCode} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground font-medium">
                      {inv.warehouseCode} — {locationLabel}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatQuantity(inv.quantity, inv.isCapped)}
                    </span>
                  </div>
                  {info ? (
                    info.isDropship ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400 leading-snug">
                        Dropship — Ships from mill in ~14 days. Case quantities only.
                      </p>
                    ) : (
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <span>Orlando: {formatDays(info.etaOrlando)}</span>
                        <span>Las Vegas: {formatDays(info.etaLasVegas)}</span>
                      </div>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
            <span className="font-medium">Total</span>
            <span className="font-semibold tabular-nums">
              {formatQuantity(totalStock, hasCapped)}
            </span>
          </div>
          {hasCapped && (
            <div className="mt-2 text-xs text-muted-foreground italic">
              + indicates warehouse cap of 3,000 units
            </div>
          )}
          {productUrl && distributorName && (
            <div className="mt-2 border-t pt-2">
              <a
                href={productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                View on {distributorName}
              </a>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
