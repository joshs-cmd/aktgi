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
      <Button variant="outline" size="icon" onClick={onSignOut} className="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 sm:gap-2">
        <LogOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        <span className="hidden sm:inline text-sm">Sign Out</span>
      </Button>
    </div>
  );
};
