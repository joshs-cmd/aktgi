import { useState } from "react";
import { StandardColor } from "@/types/sourcing";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Check, ChevronDown } from "lucide-react";

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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  if (!colors || colors.length === 0) return null;

  const filtered = colors.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedColorObj = colors.find((c) => c.name === selectedColor);

  return (
    <div className="space-y-3">
      {/* Swatch buttons row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground mr-1">Color:</span>
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

      {/* Searchable color dropdown */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 w-56"
            aria-label="Open color search"
          >
            {/* Swatch preview */}
            <span
              className="h-4 w-4 rounded-full border border-border shrink-0"
              style={{
                backgroundColor: selectedColorObj?.hexCode ?? undefined,
              }}
            >
              {!selectedColorObj?.hexCode && selectedColorObj?.swatchUrl && (
                <img
                  src={selectedColorObj.swatchUrl}
                  alt=""
                  className="h-full w-full rounded-full object-cover"
                />
              )}
            </span>
            <span className="flex-1 truncate text-left">
              {selectedColor || "Search colors..."}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <Input
            placeholder="Search colors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 mb-2"
            autoFocus
          />
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {filtered.length === 0 && (
              <p className="py-2 text-center text-sm text-muted-foreground">No colors found</p>
            )}
            {filtered.map((color) => {
              const isSelected = color.name === selectedColor;
              const hasSwatchImage = !!color.swatchUrl;
              const hasHexCode = !!color.hexCode;

              return (
                <button
                  key={color.code + color.name}
                  onClick={() => {
                    onColorSelect(color.name);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                    isSelected && "bg-accent"
                  )}
                >
                  {/* Swatch circle */}
                  <span
                    className="h-5 w-5 rounded-full border border-border shrink-0 overflow-hidden flex items-center justify-center"
                    style={{ backgroundColor: hasHexCode ? color.hexCode! : undefined }}
                  >
                    {hasSwatchImage && (
                      <img
                        src={color.swatchUrl!}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    )}
                    {!hasSwatchImage && !hasHexCode && (
                      <span className="text-[9px] font-medium text-muted-foreground">
                        {color.name.substring(0, 2).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="flex-1 truncate text-left">{color.name}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
