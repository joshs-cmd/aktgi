import { useMemo, useState } from "react";
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
import { getWarehouseInfo } from "@/lib/warehouseInfo";

interface ComparisonTableProps {
  results: DistributorResult[];
  selectedColor?: string | null;
  showPrices?: boolean;
}

function normalizeColorName(name: string): string {
  let n = name.toLowerCase();
  n = n.replace(/\bheahter\b/g, "heather");
  n = n.replace(/\bhthr\b/g, "heather");
  n = n.replace(/\bwht\b/g, "white");
  n = n.replace(/whte/g, "white");
  n = n.replace(/\bblk\b/g, "black");
  n = n.replace(/\bnvy\b/g, "navy");
  n = n.replace(/\bvtg\b/g, "vintage");
  n = n.replace(/(?<=[a-z])(heather|white|black|vintage|navy|pink|purple|royal|red|blue|green|grey|gray)/g, " $1");
  n = n.replace(/\bvint\b/g, "vintage");
  n = n.replace(/\bheath\b/g, "heather");
  n = n.replace(/\bprem\b/g, "");
  n = n.replace(/\bsleeves?\b/g, "");
  n = n.replace(/\bbody\b/g, "");
  n = n.replace(/\bpremium\b/g, "");
  n = n.replace(/[\/\-]/g, " ");
  n = n.replace(/\s+/g, " ");
  return n.trim();
}

const GENERIC_COLOR_WORDS = new Set(['heather', 'white', 'black', 'vintage', 'navy', 'grey', 'gray']);

function colorMatchScore(a: string, b: string): number {
  const normA = normalizeColorName(a);
  const normB = normalizeColorName(b);
  if (normA === normB) return 3;
  const wordsA = normA.split(" ");
  const wordsB = normB.split(" ");
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const specificA = new Set([...setA].filter(w => !GENERIC_COLOR_WORDS.has(w)));
  const specificB = new Set([...setB].filter(w => !GENERIC_COLOR_WORDS.has(w)));
  const sharedSpecific = [...specificA].filter(w => specificB.has(w));
  const primaryA = wordsA[0] ?? "";
  const primaryB = wordsB[0] ?? "";
  if (primaryA === primaryB && !GENERIC_COLOR_WORDS.has(primaryA) && primaryA.length > 3) return 2;
  const prefixA = wordsA.slice(0, 2).join(" ");
  const prefixB = wordsB.slice(0, 2).join(" ");
  if (prefixA === prefixB && prefixA.length > 6 && sharedSpecific.length >= 1) return 2;
  if (sharedSpecific.length >= 2) return 1;
  if (sharedSpecific.length === 1 && wordsA.length <= 2 && wordsB.length <= 2) return 1;
  return 0;
}

function getWarehousesFromSizes(sizes: StandardSize[]): { code: string; name: string }[] {
  const warehouseMap = new Map<string, string>();
  for (const size of sizes) {
    for (const inv of size.inventory) {
      if (!warehouseMap.has(inv.warehouseCode)) {
        warehouseMap.set(inv.warehouseCode, inv.warehouseName);
      }
    }
  }
  return Array.from(warehouseMap.entries())
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => {
      const infoA = getWarehouseInfo(a.code);
      const infoB = getWarehouseInfo(b.code);
      return (infoA?.etaOrlando ?? 99) - (infoB?.etaOrlando ?? 99);
    });
}

export function ComparisonTable({ results, selectedColor, showPrices = true }: ComparisonTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleExpanded = (distributorId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(distributorId)) next.delete(distributorId);
      else next.add(distributorId);
      return next;
    });
  };

  const getSizesForResult = useMemo(() => {
    return (result: DistributorResult): StandardSize[] => {
      if (!result?.product) return [];
      const product = result.product;
      if (Array.isArray(product.colors) && product.colors.length > 0) {
        if (selectedColor) {
          const color = product.colors
            .map(c => ({ c, score: colorMatchScore(c?.name ?? "", selectedColor) }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)[0]?.c;
          if (color?.sizes) return color.sizes;
          return [];
        }
        return product.colors[0]?.sizes || [];
      }
      return Array.isArray(product.sizes) ? product.sizes : [];
    };
  }, [selectedColor]);

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

  const visibleResults = results.filter(r => r.status !== "pending");

  if (visibleResults.length === 0) return null;

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
            const warehouses = result.status === "success" && sizes.length > 0 ? getWarehousesFromSizes(sizes) : [];
            const isExpanded = expandedRows.has(result.distributorId);

            return (
              <>
                <TableRow
                  key={result.distributorId}
                  className={cn(isLoading && "animate-pulse")}
                >
                  <TableCell className="font-medium sticky left-0 bg-card z-10">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs sm:text-sm">{result.distributorName}</span>
                      {result.status === "success" && sizes.length > 0 && warehouses.length > 1 && (
                        <button
                          onClick={() => toggleExpanded(result.distributorId)}
                          className="shrink-0 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold border border-muted-foreground/30 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                        >
                          {isExpanded ? "−" : "+"}
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DistributorStatusBadge status={result.status} />
                  </TableCell>

                  {isLoading ? (
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

                {/* Expanded warehouse rows */}
                {isExpanded && result.status === "success" && warehouses.map(warehouse => {
                  const info = getWarehouseInfo(warehouse.code);
                  const locationLabel = info
                    ? `${info.city}${info.state ? `, ${info.state}` : ""}`
                    : warehouse.name.split("(")[0].trim();
                  return (
                    <TableRow key={`${result.distributorId}-${warehouse.code}`} className="bg-muted/20 border-t-0">
                      <TableCell className="sticky left-0 bg-muted/20 z-10 py-1.5">
                        <div className="pl-4 flex flex-col">
                          <span className="text-xs text-muted-foreground">↳ {locationLabel}</span>
                          {info && !info.isDropship && (
                            <span className="text-[10px] text-muted-foreground/60">
                              ORL {info.etaOrlando}d · LAS {info.etaLasVegas}d
                            </span>
                          )}
                          {info?.isDropship && (
                            <span className="text-[10px] text-muted-foreground/60">
                              Dropship ~14 days
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell />
                      {skeletonSizeCols.map(sizeCode => {
                        const size = sizes.find(s => s.code === sizeCode);
                        const inv = size?.inventory.find(i => i.warehouseCode === warehouse.code);
                        const qty = inv?.quantity ?? 0;
                        const capped = inv?.isCapped ?? false;
                        return (
                          <TableCell key={sizeCode} className="text-center w-[80px] py-1.5">
                            {qty > 0 ? (
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {qty.toLocaleString()}{capped ? "+" : ""}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">--</span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right py-1.5">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {sizes.reduce((sum, s) => {
                            const inv = s.inventory.find(i => i.warehouseCode === warehouse.code);
                            return sum + (inv?.quantity ?? 0);
                          }, 0).toLocaleString()}
                          {sizes.some(s => s.inventory.find(i => i.warehouseCode === warehouse.code)?.isCapped) ? "+" : ""}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </>
            );
          })}

          {/* Aggregate Total Row */}
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
