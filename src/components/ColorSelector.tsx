import { StandardColor } from "@/types/sourcing";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ColorSelectorProps {
  colors: StandardColor[];
  selectedColor: string;
  onColorSelect: (colorName: string) => void;
}

export function ColorSelector({
  colors,
  selectedColor,
  onColorSelect,
}: ColorSelectorProps) {
  if (!colors || colors.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground mr-1">
        Color:
      </span>
      <TooltipProvider delayDuration={200}>
        <div className="flex flex-wrap gap-1.5">
          {colors.map((color) => {
            const isSelected = color.name === selectedColor;
            const hasSwatchImage = !!color.swatchUrl;
            const hasHexCode = !!color.hexCode;

            return (
              <Tooltip key={color.code + color.name}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onColorSelect(color.name)}
                    className={cn(
                      "h-8 w-8 rounded-full border-2 transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                      isSelected
                        ? "border-primary ring-2 ring-primary ring-offset-1"
                        : "border-border hover:border-primary/50"
                    )}
                    style={{
                      backgroundColor: hasHexCode ? color.hexCode! : undefined,
                    }}
                    aria-label={`Select ${color.name}`}
                    aria-pressed={isSelected}
                  >
                    {hasSwatchImage && (
                      <img
                        src={color.swatchUrl!}
                        alt={color.name}
                        className="h-full w-full rounded-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                    {!hasSwatchImage && !hasHexCode && (
                      <span className="flex h-full w-full items-center justify-center text-[10px] font-medium text-muted-foreground">
                        {color.name.substring(0, 2).toUpperCase()}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-popover text-popover-foreground">
                  <p className="font-medium">{color.name}</p>
                  {color.sizes.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {color.sizes.length} sizes available
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
      <span className="ml-2 text-sm font-medium">{selectedColor}</span>
    </div>
  );
}
