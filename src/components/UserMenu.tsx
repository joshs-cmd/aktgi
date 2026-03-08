import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UserMenuProps {
  userEmail?: string | null;
  onSignOut: () => void;
}

export const UserMenu = ({ userEmail, onSignOut }: UserMenuProps) => {
  return (
    <div className="flex items-center gap-3">
      {userEmail && (
        <span className="text-sm text-muted-foreground hidden sm:inline">
          {userEmail}
        </span>
      )}
      <Button variant="outline" size="icon" onClick={onSignOut} className="h-8 w-8 md:h-9 md:w-auto md:px-3 md:gap-2">
        <LogOut className="h-3.5 w-3.5 md:h-4 md:w-4" />
        <span className="hidden md:inline text-sm">Sign Out</span>
      </Button>
    </div>
  );
};
