import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FileText, RefreshCw, ArrowLeft, AlertCircle, Loader2, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthState } from "@/types/auth";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface ArchiveFile {
  name: string;
  size: number;
  created_at: string;
  downloadUrl: string;
}

interface ArchivesResponse {
  archives: Record<string, ArchiveFile[]>;
}

const DISTRIBUTOR_LABELS: Record<string, { label: string; color: string }> = {
  sanmar: { label: "SanMar", color: "bg-blue-500/10 text-blue-700 border-blue-200" },
  "ss-activewear": { label: "S&S Activewear", color: "bg-green-500/10 text-green-700 border-green-200" },
  onestop: { label: "OneStop", color: "bg-orange-500/10 text-orange-700 border-orange-200" },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoStr: string): string {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFileType(name: string): string {
  if (name.endsWith(".csv")) return "CSV";
  if (name.endsWith(".json")) return "JSON";
  if (name.endsWith(".txt")) return "TXT";
  return "FILE";
}

export default function DataManagement() {
  const navigate = useNavigate();
  const [archives, setArchives] = useState<Record<string, ArchiveFile[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { role } = getAuthState();
  const isAdmin = role === "admin";

  const fetchArchives = async () => {
    try {
      setError(null);
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/list-archives`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );
      if (!res.ok) throw new Error(`Failed to load archives (HTTP ${res.status})`);
      const data: ArchivesResponse = await res.json();
      setArchives(data.archives);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load archives");
    }
  };

  useEffect(() => {
    fetchArchives().finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchArchives();
    setRefreshing(false);
  };

  const totalFiles = archives
    ? Object.values(archives).reduce((sum, files) => sum + files.length, 0)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-primary" />
                <h1 className="text-2xl font-bold tracking-tight">Data Management</h1>
              </div>
              {!isAdmin && (
                <Badge variant="outline" className="text-muted-foreground">
                  Read-only
                </Badge>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
        {/* Section header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">Daily Source Files</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Raw data files saved during each distributor sync — download to verify accuracy in Excel.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-4">
            {["SanMar", "S&S Activewear", "OneStop"].map((name) => (
              <Card key={name}>
                <CardHeader className="pb-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-48 mt-1" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Archive cards */}
        {!loading && archives && (
          <div className="space-y-6">
            {Object.entries(DISTRIBUTOR_LABELS).map(([key, meta]) => {
              const files = archives[key] ?? [];
              return (
                <Card key={key} className="overflow-hidden">
                  <CardHeader className="pb-3 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{meta.label}</CardTitle>
                        <Badge variant="outline" className={`text-xs ${meta.color}`}>
                          {files.length} file{files.length !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                    </div>
                    <CardDescription className="text-xs">
                      Last 7 sync snapshots · 1-hour download links
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    {files.length === 0 ? (
                      <div className="flex items-center gap-2 px-6 py-8 text-muted-foreground text-sm">
                        <FileText className="h-4 w-4" />
                        No archive files yet — run a sync to generate the first snapshot.
                      </div>
                    ) : (
                      <div className="divide-y">
                        {files.map((file) => (
                          <div
                            key={file.name}
                            className="flex items-center justify-between px-6 py-3 hover:bg-muted/20 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex-shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono font-semibold text-muted-foreground">
                                {getFileType(file.name)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDate(file.created_at)} · {formatBytes(file.size)}
                                </p>
                              </div>
                            </div>
                            {file.downloadUrl ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-shrink-0 gap-1.5 ml-4"
                                asChild
                              >
                                <a href={file.downloadUrl} download={file.name} target="_blank" rel="noreferrer">
                                  <Download className="h-3.5 w-3.5" />
                                  Download
                                </a>
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground ml-4">Link expired</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {!loading && archives && totalFiles === 0 && !error && (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <HardDrive className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No archives yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Archives are saved automatically when ingestion functions run.
              Trigger a sync from Lovable Cloud to generate the first snapshot.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
