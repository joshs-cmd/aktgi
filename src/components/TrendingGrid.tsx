import { Card, CardContent } from "@/components/ui/card";
import { Paperclip } from "lucide-react";

interface TrendingGridProps {
  onSearch: (query: string) => void;
}

const TRENDING_STYLES = [
  {
    sku: "1717",
    brand: "Comfort Colors",
    name: "Garment-Dyed Heavyweight Tee",
    query: "Comfort Colors 1717",
  },
  {
    sku: "5000",
    brand: "Gildan",
    name: "Heavy Cotton Tee",
    query: "Gildan 5000",
  },
  {
    sku: "3001",
    brand: "Bella + Canvas",
    name: "Unisex Jersey Tee",
    query: "Bella Canvas 3001",
  },
  {
    sku: "IND4000",
    brand: "Independent Trading Co.",
    name: "Heavyweight Hooded Sweatshirt",
    query: "IND4000",
  },
];

export function TrendingGrid({ onSearch }: TrendingGridProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Paperclip className="h-4 w-4 text-red-600" />
        <span>Staple Styles</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {TRENDING_STYLES.map((style) => (
          <Card
            key={style.sku}
            className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30 group"
            onClick={() => onSearch(style.query)}
          >
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {style.brand}
              </p>
              <h3 className="text-sm font-semibold mt-0.5 group-hover:text-primary transition-colors">
                {style.sku}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {style.name}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
