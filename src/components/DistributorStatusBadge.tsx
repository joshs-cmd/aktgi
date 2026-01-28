import { cn } from "@/lib/utils";
import { DistributorStatus } from "@/types/sourcing";

interface DistributorStatusBadgeProps {
  status: DistributorStatus;
}

const statusConfig: Record<DistributorStatus, { label: string; className: string }> = {
  success: {
    label: "Connected",
    className: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
  pending: {
    label: "Pending",
    className: "bg-muted text-muted-foreground border-border",
  },
  error: {
    label: "Error",
    className: "bg-destructive/20 text-destructive border-destructive/30",
  },
};

export function DistributorStatusBadge({ status }: DistributorStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.className
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "success" && "bg-emerald-500",
          status === "pending" && "bg-muted-foreground",
          status === "error" && "bg-destructive"
        )}
      />
      {config.label}
    </span>
  );
}
