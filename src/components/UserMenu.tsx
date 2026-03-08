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
      <Button variant="outline" size="sm" onClick={onSignOut} className="gap-2">
        <LogOut className="h-4 w-4" />
        Sign Out
      </Button>
    </div>
  );
};
