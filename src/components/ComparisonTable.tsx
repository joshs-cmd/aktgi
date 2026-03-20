import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
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
  // Safely get sizes for a result based on selected color — stable, memoized version.
  // Uses case-insensitive name matching so distributors that return ALL-CAPS color names
  // (e.g. ACC: "ANTIQUE CHERRY RED") still match a selectedColor set from another
  // distributor that uses title case (e.g. SanMar: "Antique Cherry Red").
  const getSizesForResult = useMemo(() => {
    const selectedLower = selectedColor?.toLowerCase() ?? null;
    return (result: DistributorResult): StandardSize[] => {
      if (!result?.product) return [];
      const product = result.product;
      if (Array.isArray(product.colors) && product.colors.length > 0) {
        if (selectedLower) {
          const color = product.colors.find((c) => c?.name?.toLowerCase() === selectedLower);
          if (color?.sizes) return color.sizes;
        }
        return product.colors[0]?.sizes || [];
      }
      return Array.isArray(product.sizes) ? product.sizes : [];
    };
  }, [selectedColor]);

  // Only use resolved rows for size/price calculations
  const successResults = useMemo(
    () => results.filter(r => r.status === "success"),
    [results]
  );

  const allSizes = useMemo(() => {
    const sizeMap = new Map<string, number>();
    successResults.forEach((result) => {
      getSizesForResult(result).forEach((size) => {
        if (!sizeMap.has(size.code) || sizeMap.get(size.code)! > size.order) {
          sizeMap.set(size.code, size.order);
        }
      });
    });
    return Array.from(sizeMap.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([code]) => code);
  }, [successResults, getSizesForResult]);

  const lowestPrices = useMemo(() => {
    const lowest: Record<string, number> = {};
    allSizes.forEach((sizeCode) => {
      let minPrice = Infinity;
      successResults.forEach((result) => {
        const sizes = getSizesForResult(result);
        const size = sizes.find((s) => s.code === sizeCode);
        if (size && size.price > 0 && size.price < minPrice) minPrice = size.price;
      });
      if (minPrice !== Infinity) lowest[sizeCode] = minPrice;
    });
    return lowest;
  }, [successResults, allSizes, getSizesForResult]);

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

  const formatTotalStock = (sizes: StandardSize[], distributorCode?: string) => {
    const { total, hasCapped } = getTotalStock(sizes);
    const formatted = total.toLocaleString();
    const isSS = distributorCode === "ss-activewear";
    if (isSS && sizes.some(s => s.inventory.reduce((sum, inv) => sum + inv.quantity, 0) === 500)) {
      return `${formatted}+`;
    }
    return hasCapped ? `${formatted}+` : formatted;
  };

  // Show all rows except pending
  const visibleResults = results.filter(r => r.status !== "pending");

  if (visibleResults.length === 0) return null;

  // How many size columns to show (use allSizes if resolved, else 6 placeholder columns)
  const skeletonSizeCols = allSizes.length > 0 ? allSizes : ["S", "M", "L", "XL", "2XL", "3XL"];

  return (
    <div className="rounded-lg border bg-card overflow-x-auto -mx-4 sm:mx-0">
      <Table className="min-w-[600px] table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[140px] sm:w-[200px] sticky left-0 bg-card z-10">Distributor</TableHead>
            <TableHead className="w-[80px] sm:w-[100px]">Status</TableHead>
            {skeletonSizeCols.map((size) => (
              <TableHead key={size} className="text-center w-[80px]">
                {size}
              </TableHead>
            ))}
            <TableHead className="text-right w-[100px] sm:w-[120px]">Total Stock</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleResults.map((result) => {
            const isLoading = result.status === "loading";
            const sizes = getSizesForResult(result);

            return (
              <TableRow
                key={result.distributorId}
                className={cn(isLoading && "animate-pulse")}
              >
                <TableCell className="font-medium sticky left-0 bg-card z-10">
                  <span className="text-xs sm:text-sm">{result.distributorName}</span>
                </TableCell>
                <TableCell>
                  <DistributorStatusBadge status={result.status} />
                </TableCell>

                {isLoading ? (
                  // Skeleton cells while API is in-flight
                  skeletonSizeCols.map((col) => (
                    <TableCell key={col} className="text-center p-2">
                      <div className="flex flex-col items-center gap-1">
                        {showPrices && <Skeleton className="h-4 w-12" />}
                        <Skeleton className="h-3 w-8" />
                      </div>
                    </TableCell>
                  ))
                ) : (
                  skeletonSizeCols.map((sizeCode) => {
                    const size = sizes.find((s) => s.code === sizeCode);

                    if (!size || result.status !== "success") {
                      return (
                        <TableCell key={sizeCode} className="text-center w-[80px]">
                          <span className="text-muted-foreground">--</span>
                        </TableCell>
                      );
                    }

                    const isLowest = size.price > 0 && lowestPrices[sizeCode] === size.price;

                    return (
                      <TableCell key={sizeCode} className="text-center w-[80px] p-1">
                        <PriceCell
                          price={size.price}
                          inventory={size.inventory}
                          isLowest={isLowest}
                          showPrice={showPrices}
                          isProgramPrice={size.isProgramPrice}
                          distributorCode={result.distributorCode}
                          distributorName={result.distributorName}
                          productUrl={result.product?.productUrl}
                        />
                      </TableCell>
                    );
                  })
                )}

                <TableCell className="text-right">
                  {isLoading ? (
                    <Skeleton className="h-4 w-14 ml-auto" />
                  ) : result.status === "success" && sizes.length > 0 ? (
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

          {/* Aggregate Total Row — only shown once all active distributors have resolved */}
          {successResults.length > 0 && results.filter(r => r.status === "loading").length === 0 && (
            <TableRow className="bg-muted/50 font-semibold border-t-2">
              <TableCell className="font-bold sticky left-0 bg-muted/50 z-10">Total</TableCell>
              <TableCell />
              {skeletonSizeCols.map((sizeCode) => {
                let total = 0;
                let hasSSCap = false;
                let hasSanMarCap = false;

                successResults.forEach((result) => {
                  const sizes = getSizesForResult(result);
                  const size = sizes.find((s) => s.code === sizeCode);
                  if (!size) return;
                  const sizeTotal = size.inventory.reduce((sum, inv) => sum + inv.quantity, 0);
                  total += sizeTotal;
                  if (result.distributorCode === "ss-activewear" && sizeTotal === 500) hasSSCap = true;
                  if (size.inventory.some(inv => inv.isCapped)) hasSanMarCap = true;
                });

                const hasCap = hasSSCap || hasSanMarCap;

                return (
                  <TableCell key={sizeCode} className="text-center w-[80px]">
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
                    successResults.forEach((result) => {
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
