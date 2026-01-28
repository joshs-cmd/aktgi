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
}

export function ComparisonTable({ results }: ComparisonTableProps) {
  // Collect all unique sizes from all products, sorted by order
  const allSizes = useMemo(() => {
    const sizeMap = new Map<string, number>();
    
    results.forEach((result) => {
      if (result.product) {
        result.product.sizes.forEach((size) => {
          if (!sizeMap.has(size.code) || sizeMap.get(size.code)! > size.order) {
            sizeMap.set(size.code, size.order);
          }
        });
      }
    });

    return Array.from(sizeMap.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([code]) => code);
  }, [results]);

  // Calculate lowest price for each size column
  const lowestPrices = useMemo(() => {
    const lowest: Record<string, number> = {};
    
    allSizes.forEach((sizeCode) => {
      let minPrice = Infinity;
      
      results.forEach((result) => {
        if (result.product && result.status === "success") {
          const size = result.product.sizes.find((s) => s.code === sizeCode);
          if (size && size.price < minPrice) {
            minPrice = size.price;
          }
        }
      });
      
      if (minPrice !== Infinity) {
        lowest[sizeCode] = minPrice;
      }
    });
    
    return lowest;
  }, [results, allSizes]);

  // Calculate total stock for each distributor
  const getTotalStock = (sizes: StandardSize[]) => {
    return sizes.reduce((total, size) => {
      return total + size.inventory.reduce((sum, inv) => sum + inv.quantity, 0);
    }, 0);
  };

  if (results.length === 0) {
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
          {results.map((result) => (
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
                const size = result.product?.sizes.find((s) => s.code === sizeCode);
                
                if (!size || result.status !== "success") {
                  return (
                    <TableCell key={sizeCode} className="text-center">
                      <span className="text-muted-foreground">--</span>
                    </TableCell>
                  );
                }

                const isLowest = lowestPrices[sizeCode] === size.price;

                return (
                  <TableCell key={sizeCode} className="text-center p-1">
                    <PriceCell
                      price={size.price}
                      inventory={size.inventory}
                      isLowest={isLowest}
                    />
                  </TableCell>
                );
              })}
              <TableCell className="text-right">
                {result.product && result.status === "success" ? (
                  <span className="font-semibold tabular-nums">
                    {getTotalStock(result.product.sizes).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
