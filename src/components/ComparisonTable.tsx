import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DistributorResult, StandardSize } from "@/types/sourcing";
import { DistributorStatusBadge } from "./DistributorStatusBadge";
import { PriceCell } from "./PriceCell";
import { cn } from "@/lib/utils";

interface ComparisonTableProps {
  results: DistributorResult[];
  selectedColor?: string | null;
  showPrices?: boolean;
}

export function ComparisonTable({ results, selectedColor, showPrices = true }: ComparisonTableProps) {
  // Safely get sizes for a result based on selected color
  // Uses optional chaining throughout to prevent crashes
  const getSizesForResult = (result: DistributorResult): StandardSize[] => {
    if (!result?.product) return [];
    
    const product = result.product;
    
    // If product has colors, use selected color's sizes
    if (Array.isArray(product.colors) && product.colors.length > 0) {
      if (selectedColor) {
        const color = product.colors.find((c) => c?.name === selectedColor);
        if (color?.sizes) return color.sizes;
      }
      // Default to first color if no selection
      return product.colors[0]?.sizes || [];
    }
    
    // Fall back to direct sizes (backward compat)
    return Array.isArray(product.sizes) ? product.sizes : [];
  };

  // Collect all unique sizes from all products, sorted by order
  // Exclude pending distributors from all calculations
  const visibleResultsForCalc = results.filter(r => r.status !== "pending");

  const allSizes = useMemo(() => {
    const sizeMap = new Map<string, number>();
    
    visibleResultsForCalc.forEach((result) => {
      const sizes = getSizesForResult(result);
      sizes.forEach((size) => {
        if (!sizeMap.has(size.code) || sizeMap.get(size.code)! > size.order) {
          sizeMap.set(size.code, size.order);
        }
      });
    });

    return Array.from(sizeMap.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([code]) => code);
  }, [results, selectedColor]);

  // Calculate lowest price for each size column
  const lowestPrices = useMemo(() => {
    const lowest: Record<string, number> = {};
    
    allSizes.forEach((sizeCode) => {
      let minPrice = Infinity;
      
      visibleResultsForCalc.forEach((result) => {
        if (result.status === "success") {
          const sizes = getSizesForResult(result);
          const size = sizes.find((s) => s.code === sizeCode);
          if (size && size.price > 0 && size.price < minPrice) {
            minPrice = size.price;
          }
        }
      });
      
      if (minPrice !== Infinity) {
        lowest[sizeCode] = minPrice;
      }
    });
    
    return lowest;
  }, [results, allSizes, selectedColor]);

  // Calculate total stock for each distributor (with 3,000+ notation for capped)
  const getTotalStock = (sizes: StandardSize[]) => {
    let total = 0;
    let hasCapped = false;
    
    for (const size of sizes) {
      for (const inv of size.inventory) {
        total += inv.quantity;
        if (inv.isCapped) hasCapped = true;
      }
    }
    
    return { total, hasCapped };
  };

  // Format total stock with + if any warehouse was capped
  const formatTotalStock = (sizes: StandardSize[], distributorCode?: string) => {
    const { total, hasCapped } = getTotalStock(sizes);
    const formatted = total.toLocaleString();
    const isSS = distributorCode === "ss-activewear";
    // S&S caps each size at 500
    if (isSS && sizes.some(s => s.inventory.reduce((sum, inv) => sum + inv.quantity, 0) === 500)) {
      return `${formatted}+`;
    }
    return hasCapped ? `${formatted}+` : formatted;
  };

  // Hide distributors that are not yet connected (pending = not active)
  const visibleResults = results.filter(r => r.status !== "pending");

  if (visibleResults.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[200px]">Distributor</TableHead>
            <TableHead className="w-[100px]">Status</TableHead>
            {allSizes.map((size) => (
              <TableHead key={size} className="text-center w-[100px]">
                {size}
              </TableHead>
            ))}
            <TableHead className="text-right w-[120px]">Total Stock</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleResults.map((result) => {
            const sizes = getSizesForResult(result);
            
            return (
              <TableRow
                key={result.distributorId}
                className={cn(
                  result.status === "pending" && "opacity-60"
                )}
              >
                <TableCell className="font-medium">
                  {result.distributorName}
                </TableCell>
                <TableCell>
                  <DistributorStatusBadge status={result.status} />
                </TableCell>
                {allSizes.map((sizeCode) => {
                  const size = sizes.find((s) => s.code === sizeCode);
                  
                  if (!size || result.status !== "success") {
                    return (
                      <TableCell key={sizeCode} className="text-center">
                        <span className="text-muted-foreground">--</span>
                      </TableCell>
                    );
                  }

                  const isLowest = size.price > 0 && lowestPrices[sizeCode] === size.price;

                  return (
                    <TableCell key={sizeCode} className="text-center p-1">
                      <PriceCell
                        price={size.price}
                        inventory={size.inventory}
                        isLowest={isLowest}
                        showPrice={showPrices}
                        isProgramPrice={size.isProgramPrice}
                        distributorCode={result.distributorCode}
                      />
                    </TableCell>
                  );
                })}
                <TableCell className="text-right">
                  {result.status === "success" && sizes.length > 0 ? (
                    <span className="font-semibold tabular-nums">
                      {formatTotalStock(sizes, result.distributorCode)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}

          {/* Aggregate Total Row */}
          {visibleResults.some(r => r.status === "success") && (
            <TableRow className="bg-muted/50 font-semibold border-t-2">
              <TableCell className="font-bold">Total</TableCell>
              <TableCell />
              {allSizes.map((sizeCode) => {
                let total = 0;
                let hasSSCap = false;
                let hasSanMarCap = false;

                visibleResults.forEach((result) => {
                  if (result.status !== "success") return;
                  const sizes = getSizesForResult(result);
                  const size = sizes.find((s) => s.code === sizeCode);
                  if (!size) return;

                  const sizeTotal = size.inventory.reduce((sum, inv) => sum + inv.quantity, 0);
                  total += sizeTotal;

                  if (result.distributorCode === "ss-activewear" && sizeTotal === 500) {
                    hasSSCap = true;
                  }
                  if (size.inventory.some(inv => inv.isCapped)) {
                    hasSanMarCap = true;
                  }
                });

                const hasCap = hasSSCap || hasSanMarCap;

                return (
                  <TableCell key={sizeCode} className="text-center">
                    {total > 0 ? (
                      <span className="tabular-nums font-semibold">
                        {total.toLocaleString()}{hasCap ? "+" : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </TableCell>
                );
              })}
              <TableCell className="text-right">
                <span className="font-bold tabular-nums">
                  {(() => {
                    let grandTotal = 0;
                    let hasCap = false;
                    visibleResults.forEach((result) => {
                      if (result.status !== "success") return;
                      const sizes = getSizesForResult(result);
                      const { total, hasCapped } = getTotalStock(sizes);
                      grandTotal += total;
                      if (hasCapped) hasCap = true;
                      if (result.distributorCode === "ss-activewear") {
                        const ssTotal = sizes.reduce((sum, s) => sum + s.inventory.reduce((a, i) => a + i.quantity, 0), 0);
                        if (ssTotal === 500 * sizes.length) hasCap = true;
                      }
                    });
                    return `${grandTotal.toLocaleString()}${hasCap ? "+" : ""}`;
                  })()}
                </span>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
