import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchBarProps {
  onSearch: (query: string) => void;
  isLoading: boolean;
  placeholder?: string;
}

export interface SearchValidation {
  isValid: boolean;
  error: string | null;
}

export function validateSearch(query: string): SearchValidation {
  const trimmed = query.trim();
  
  if (trimmed.length < 3) {
    return { 
      isValid: false, 
      error: "Please enter at least 3 characters to search." 
    };
  }
  
  return { isValid: true, error: null };
}

export function SearchBar({ onSearch, isLoading, placeholder = "Search by SKU or Brand (e.g. Gildan 5000 or Next Level)" }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateSearch(query);
    
    if (!validation.isValid) {
      setValidationError(validation.error);
      return;
    }
    
    setValidationError(null);
    onSearch(query.trim());
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    // Clear validation error when user starts typing
    if (validationError) {
      setValidationError(null);
    }
  };

  return (
    <div className="w-full max-w-2xl">
      <form onSubmit={handleSubmit} className="flex w-full gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={query}
            onChange={handleChange}
            placeholder={placeholder}
            className={`h-12 pl-10 text-lg ${validationError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
            disabled={isLoading}
          />
        </div>
        <Button type="submit" size="lg" className="h-12 px-8" disabled={isLoading || !query.trim()}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Searching...
            </>
          ) : (
            "Search"
          )}
        </Button>
      </form>
      {validationError && (
        <p className="mt-2 text-sm text-destructive">{validationError}</p>
      )}
    </div>
  );
}
