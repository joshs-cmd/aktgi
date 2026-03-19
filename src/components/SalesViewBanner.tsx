import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SalesViewBannerProps {
  salesViewMode: boolean;
  setSalesViewMode: (value: boolean) => void;
}

export function SalesViewBanner({ salesViewMode, setSalesViewMode }: SalesViewBannerProps) {
  if (!salesViewMode) return null;

  return (
    <div className="w-full bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between gap-2 text-sm font-medium z-50">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4 shrink-0" />
        <span>Sales View Mode — You are previewing the sales representative experience</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-amber-950 hover:bg-amber-600 hover:text-amber-950 gap-1.5 h-7 px-2"
        onClick={() => setSalesViewMode(false)}
      >
        <X className="h-3.5 w-3.5" />
        Exit Sales View
      </Button>
    </div>
  );
}
