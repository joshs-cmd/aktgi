import { useNavigate } from "react-router-dom";
import { HardDrive, Eye } from "lucide-react";
import { UserRole } from "@/types/auth";
import { AdminBanner } from "@/components/AdminBanner";
import { UserMenu } from "@/components/UserMenu";
import { SalesViewBanner } from "@/components/SalesViewBanner";
import aktLogo from "@/assets/aktlogo.png";

interface AdminToolsProps {
  userRole: UserRole | null;
  userEmail?: string | null;
  onSignOut?: () => void;
  salesViewMode: boolean;
  setSalesViewMode: (value: boolean) => void;
}

export default function AdminTools({
  userRole,
  userEmail,
  onSignOut,
  salesViewMode,
  setSalesViewMode,
}: AdminToolsProps) {
  const navigate = useNavigate();

  // Only admins (real role) may access this page
  if (userRole !== "admin") {
    navigate("/");
    return null;
  }

  const tools = [
    {
      icon: Eye,
      title: "Sales View",
      description:
        "Preview the experience as a sales representative. Prices are hidden and the interface matches what a viewer sees.",
      action: () => {
        setSalesViewMode(true);
        navigate("/");
      },
      color: "text-amber-600",
      bg: "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30",
    },
    {
      icon: HardDrive,
      title: "Data Management",
      description:
        "View and download raw distributor catalog archive files. Manage catalog ingestion and sync logs.",
      action: () => navigate("/admin/data-management"),
      color: "text-primary",
      bg: "bg-primary/10 hover:bg-primary/20 border-primary/30",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SalesViewBanner salesViewMode={salesViewMode} setSalesViewMode={setSalesViewMode} />
      <AdminBanner userRole={userRole} />

      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 sm:py-6">
          <div className="flex items-center justify-between w-full gap-2">
            <div
              className="flex items-center gap-2 sm:gap-3 cursor-pointer"
              onClick={() => navigate("/")}
            >
              <img src={aktLogo} alt="AKT" className="h-8 sm:h-11 md:h-14 w-auto shrink-0" />
              <h1 className="text-lg sm:text-2xl font-bold hover:text-primary transition-colors">
                Admin Tools
              </h1>
            </div>
            {onSignOut && <UserMenu userEmail={userEmail} onSignOut={onSignOut} />}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10">
        <div className="max-w-2xl mx-auto space-y-6">
          <p className="text-muted-foreground text-sm">
            Select a tool to continue.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {tools.map((tool) => (
              <button
                key={tool.title}
                onClick={tool.action}
                className={`flex flex-col gap-4 rounded-xl border p-6 text-left transition-colors ${tool.bg}`}
              >
                <div className={`rounded-lg p-3 w-fit ${tool.bg}`}>
                  <tool.icon className={`h-7 w-7 ${tool.color}`} />
                </div>
                <div>
                  <h2 className="text-base font-semibold">{tool.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    {tool.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
