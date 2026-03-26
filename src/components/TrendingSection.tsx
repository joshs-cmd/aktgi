import { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface TrendingSectionProps {
  onSearch: (query: string) => void;
}

interface TrendingItem {
  style_number: string;
  brand: string;
  clicks: number;
}

export function TrendingSection({ onSearch }: TrendingSectionProps) {
  const [items, setItems] = useState<TrendingItem[]>([]);

  useEffect(() => {
    supabase
      .from("product_clicks")
      .select("style_number, brand")
      .gt("clicked_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) return;

        // Aggregate click counts client-side
        const counts = new Map<string, TrendingItem>();
        for (const row of data) {
          const key = `${row.style_number}::${row.brand}`;
          const existing = counts.get(key);
          if (existing) {
            existing.clicks++;
          } else {
            counts.set(key, { style_number: row.style_number, brand: row.brand, clicks: 1 });
          }
        }

        const sorted = Array.from(counts.values())
          .sort((a, b) => b.clicks - a.clicks)
          .slice(0, 6);

        setItems(sorted);
      });
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <TrendingUp className="h-4 w-4" />
        <span>Trending</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <Card
            key={`${item.style_number}-${item.brand}`}
            className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30 group"
            onClick={() => onSearch(item.style_number)}
          >
            <CardContent className="p-4 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
                  {item.brand}
                </p>
                <h3 className="text-sm font-semibold mt-0.5 group-hover:text-primary transition-colors">
                  {item.style_number}
                </h3>
              </div>
              <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">
                {item.clicks} {item.clicks === 1 ? "view" : "views"}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
