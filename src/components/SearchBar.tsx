import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchBarProps {
  onSearch: (query: string) => void;
  isLoading: boolean;
  placeholder?: string;
}

export function SearchBar({ onSearch, isLoading, placeholder = "Enter SKU / Style Number (e.g., G500)" }: SearchBarProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-2xl gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="h-12 pl-10 text-lg"
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
  );
}
