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
        <span className="text-sm text-muted-foreground hidden lg:inline">
          {userEmail}
        </span>
      )}
      <Button variant="outline" size="icon" onClick={onSignOut} className="h-8 w-8 lg:h-9 lg:w-auto lg:px-3 lg:gap-2">
        <LogOut className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
        <span className="hidden lg:inline text-sm">Sign Out</span>
      </Button>
    </div>
  );
};
