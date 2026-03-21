import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Download, FileText, RefreshCw, ArrowLeft, AlertCircle, Loader2,
  HardDrive, Database, Zap, List, BarChart2, Check, X, Edit2, Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { UserRole } from "@/types/auth";
import { AdminBanner } from "@/components/AdminBanner";
import { UserMenu } from "@/components/UserMenu";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArchiveFile {
  name: string;
  size: number;
  created_at: string;
  downloadUrl: string;
}

interface ArchivesResponse {
  archives: Record<string, ArchiveFile[]>;
}

interface CacheSetting {
  distributor: string;
  ttl_hours: number;
  pre_warm_enabled: boolean;
  notes: string | null;
}

interface PopularSku {
  id: string;
  style_number: string;
  brand: string | null;
  display_name: string | null;
  annual_units: number | null;
  active: boolean;
}

interface CacheStatusRow {
  distributor: string;
  fresh: number;
  expired: number;
  oldest: string | null;
  newest: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DISTRIBUTOR_LABELS: Record<string, { label: string; color: string }> = {
  sanmar: { label: "SanMar", color: "bg-blue-500/10 text-blue-700 border-blue-200" },
  "ss-activewear": { label: "S&S Activewear", color: "bg-green-500/10 text-green-700 border-green-200" },
  onestop: { label: "OneStop", color: "bg-orange-500/10 text-orange-700 border-orange-200" },
  acc: { label: "Atlantic Coast Cotton", color: "bg-purple-500/10 text-purple-700 border-purple-200" },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoStr: string | null): string {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function getFileType(name: string): string {
  if (name.endsWith(".csv")) return "CSV";
  if (name.endsWith(".json")) return "JSON";
  if (name.endsWith(".txt")) return "TXT";
  return "FILE";
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface DataManagementProps {
  userRole?: UserRole | null;
  userEmail?: string | null;
  onSignOut?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DataManagement({ userRole, userEmail, onSignOut }: DataManagementProps) {
  const navigate = useNavigate();
  const isAdmin = userRole === "admin";

  // Archives state
  const [archives, setArchives] = useState<Record<string, ArchiveFile[]> | null>(null);
  const [archivesLoading, setArchivesLoading] = useState(true);
  const [archivesError, setArchivesError] = useState<string | null>(null);
  const [archivesRefreshing, setArchivesRefreshing] = useState(false);

  // Cache settings state
  const [cacheSettings, setCacheSettings] = useState<CacheSetting[]>([]);
  const [cacheSettingsLoading, setCacheSettingsLoading] = useState(true);
  const [editingTtl, setEditingTtl] = useState<string | null>(null);
  const [editingTtlValue, setEditingTtlValue] = useState<string>("");

  // Pre-warm state
  const [preWarmRunning, setPreWarmRunning] = useState(false);
  const [preWarmResult, setPreWarmResult] = useState<string | null>(null);

  // Run Sync Now state
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);

  // Cache overview state
  const [cacheOverview, setCacheOverview] = useState<{
    total: number; expiringSoon: number;
  } | null>(null);

  // Cache status by distributor
  const [cacheStatus, setCacheStatus] = useState<CacheStatusRow[]>([]);
  const [cacheStatusLoading, setCacheStatusLoading] = useState(true);

  // Popular SKUs state
  const [popularSkus, setPopularSkus] = useState<PopularSku[]>([]);
  const [popularSkusLoading, setPopularSkusLoading] = useState(true);
  const [skuSearch, setSkuSearch] = useState("");

  // ── Data fetchers ──────────────────────────────────────────────────────────

  const fetchArchives = useCallback(async () => {
    try {
      setArchivesError(null);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/list-archives`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ArchivesResponse = await res.json();
      setArchives(data.archives);
    } catch (e) {
      setArchivesError(e instanceof Error ? e.message : "Failed to load archives");
    }
  }, []);

  const fetchCacheSettings = useCallback(async () => {
    const { data } = await supabase.from("cache_settings").select("*").order("distributor");
    if (data) setCacheSettings(data as CacheSetting[]);
    setCacheSettingsLoading(false);
  }, []);

  const fetchCacheOverview = useCallback(async () => {
    const now = new Date().toISOString();
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const [{ count: total }, { count: expiringSoon }] = await Promise.all([
      supabase.from("product_cache").select("*", { count: "exact", head: true }).gt("expires_at", now),
      supabase.from("product_cache").select("*", { count: "exact", head: true }).gt("expires_at", now).lt("expires_at", soon),
    ]);
    setCacheOverview({ total: total ?? 0, expiringSoon: expiringSoon ?? 0 });
  }, []);

  const fetchCacheStatus = useCallback(async () => {
    setCacheStatusLoading(true);
    const now = new Date().toISOString();
    const distributors = ["sanmar", "ss-activewear", "onestop", "acc"];
    const rows: CacheStatusRow[] = await Promise.all(
      distributors.map(async (dist) => {
        const [{ count: fresh }, { count: expired }, { data: oldestRow }, { data: newestRow }] = await Promise.all([
          supabase.from("product_cache").select("*", { count: "exact", head: true }).eq("distributor", dist).gt("expires_at", now),
          supabase.from("product_cache").select("*", { count: "exact", head: true }).eq("distributor", dist).lte("expires_at", now),
          supabase.from("product_cache").select("cached_at").eq("distributor", dist).order("cached_at", { ascending: true }).limit(1),
          supabase.from("product_cache").select("cached_at").eq("distributor", dist).order("cached_at", { ascending: false }).limit(1),
        ]);
        return {
          distributor: dist,
          fresh: fresh ?? 0,
          expired: expired ?? 0,
          oldest: (oldestRow?.[0] as any)?.cached_at ?? null,
          newest: (newestRow?.[0] as any)?.cached_at ?? null,
        };
      })
    );
    setCacheStatus(rows);
    setCacheStatusLoading(false);
  }, []);

  const fetchPopularSkus = useCallback(async () => {
    const { data } = await supabase.from("popular_skus").select("*").order("annual_units", { ascending: false });
    if (data) setPopularSkus(data as PopularSku[]);
    setPopularSkusLoading(false);
  }, []);

  // ── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchArchives().finally(() => setArchivesLoading(false));
    fetchCacheSettings();
    fetchCacheOverview();
    fetchCacheStatus();
    fetchPopularSkus();
  }, [fetchArchives, fetchCacheSettings, fetchCacheOverview, fetchCacheStatus, fetchPopularSkus]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleRunSync = async () => {
    setSyncRunning(true);
    setSyncResult(null);
    try {
      const results = await Promise.allSettled([
        supabase.functions.invoke("ingest-sanmar-catalog", { body: {} }),
        supabase.functions.invoke("ingest-ss-catalog", { body: {} }),
        supabase.functions.invoke("ingest-onestop-catalog", { body: {} }),
        supabase.functions.invoke("ingest-acc-catalog", { body: {} }),
      ]);
      const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && r.value.error));
      if (failed.length === 0) {
        setSyncResult({ success: true, message: "All 4 distributor syncs completed successfully." });
      } else {
        setSyncResult({ success: false, message: `${failed.length} of 4 syncs failed. Check logs for details.` });
      }
      await fetchArchives();
    } catch (e) {
      setSyncResult({ success: false, message: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setSyncRunning(false);
    }
  };

  const handleArchivesRefresh = async () => {
    setArchivesRefreshing(true);
    await fetchArchives();
    setArchivesRefreshing(false);
  };

  const handleRunPreWarm = async () => {
    setPreWarmRunning(true);
    setPreWarmResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("pre-warm-cache", { body: {} });
      if (error) throw error;
      const { total_skus, skus_skipped_fresh, skus_processed, skus_failed, elapsed_seconds } = data;
      setPreWarmResult(
        `Done in ${elapsed_seconds}s — ${skus_processed} processed, ${skus_skipped_fresh} already fresh, ${skus_failed} failed`
      );
      await Promise.all([fetchCacheOverview(), fetchCacheStatus()]);
    } catch (e) {
      setPreWarmResult(`Error: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setPreWarmRunning(false);
    }
  };

  const handleSaveTtl = async (distributor: string) => {
    const hours = parseInt(editingTtlValue, 10);
    if (isNaN(hours) || hours < 1 || hours > 168) return;
    await supabase.from("cache_settings").update({ ttl_hours: hours }).eq("distributor", distributor);
    setEditingTtl(null);
    fetchCacheSettings();
  };

  const handleToggleSkuActive = async (sku: PopularSku) => {
    await supabase.from("popular_skus").update({ active: !sku.active }).eq("id", sku.id);
    setPopularSkus((prev) => prev.map((s) => s.id === sku.id ? { ...s, active: !s.active } : s));
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const totalArchiveFiles = archives
    ? Object.values(archives).reduce((sum, files) => sum + files.length, 0)
    : 0;

  const filteredSkus = popularSkus.filter((s) => {
    const q = skuSearch.toLowerCase();
    return (
      s.style_number.toLowerCase().includes(q) ||
      (s.brand || "").toLowerCase().includes(q) ||
      (s.display_name || "").toLowerCase().includes(q)
    );
  });

  const activeSkuCount = popularSkus.filter((s) => s.active).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <AdminBanner userRole={userRole ?? null} />

      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between w-full">
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
              <div className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-primary" />
                <h1 className="text-2xl font-bold tracking-tight">Data Management</h1>
              </div>
              {!isAdmin && (
                <Badge variant="outline" className="text-muted-foreground">Read-only</Badge>
              )}
            </div>
            {onSignOut && <UserMenu userEmail={userEmail} onSignOut={onSignOut} />}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl space-y-10">

        {/* ── CACHE MANAGEMENT ──────────────────────────────────────── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Cache Management
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Pre-warmed nightly at 11pm for SanMar, S&S, and OneStop. ACC is on-demand only.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Card 1 — Overview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Cache Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {cacheOverview === null ? (
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-5 w-32" />
                  </div>
                ) : (
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Fresh entries</dt>
                      <dd className="font-medium">{cacheOverview.total.toLocaleString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Expiring in 2h</dt>
                      <dd className={`font-medium ${cacheOverview.expiringSoon > 0 ? "text-amber-600" : ""}`}>
                        {cacheOverview.expiringSoon.toLocaleString()}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Next pre-warm</dt>
                      <dd className="font-medium">Nightly at 11pm</dd>
                    </div>
                  </dl>
                )}
                {preWarmResult && (
                  <p className="text-xs text-muted-foreground border rounded p-2 bg-muted/30">
                    {preWarmResult}
                  </p>
                )}
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRunPreWarm}
                    disabled={preWarmRunning}
                    className="w-full gap-2 mt-1"
                  >
                    {preWarmRunning
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running…</>
                      : <><RefreshCw className="h-3.5 w-3.5" />Run Pre-Warm Now</>
                    }
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Card 4 — Status by Distributor */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-primary" />
                  Cache Status by Distributor
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {cacheStatusLoading ? (
                  <div className="px-6 pb-4 space-y-2">
                    {[1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
                  </div>
                ) : (
                  <div className="divide-y text-sm">
                    {cacheStatus.map((row) => {
                      const meta = DISTRIBUTOR_LABELS[row.distributor];
                      return (
                        <div key={row.distributor} className="px-6 py-2.5 flex flex-col gap-0.5">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{meta?.label ?? row.distributor}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-success font-medium">{row.fresh} fresh</span>
                              {row.expired > 0 && (
                                <span className="text-muted-foreground">{row.expired} expired</span>
                              )}
                            </div>
                          </div>
                          {row.newest && (
                            <p className="text-[11px] text-muted-foreground">
                              Last cached: {formatDate(row.newest)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

          </div>

          {/* Card 2 — Distributor Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Distributor Cache Settings</CardTitle>
              <CardDescription className="text-xs">TTL hours and pre-warm configuration per distributor.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {cacheSettingsLoading ? (
                <div className="px-6 pb-4 space-y-2">
                  {[1,2,3,4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : (
                <div className="divide-y text-sm">
                  {cacheSettings.map((row) => {
                    const meta = DISTRIBUTOR_LABELS[row.distributor];
                    const isEditing = editingTtl === row.distributor;
                    return (
                      <div key={row.distributor} className="px-6 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium">{meta?.label ?? row.distributor}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {row.pre_warm_enabled ? "Pre-warm on" : "On-demand"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {isEditing ? (
                              <>
                                <Input
                                  type="number"
                                  value={editingTtlValue}
                                  onChange={(e) => setEditingTtlValue(e.target.value)}
                                  className="h-7 w-16 text-xs"
                                  min={1}
                                  max={168}
                                />
                                <span className="text-muted-foreground text-xs">h</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => handleSaveTtl(row.distributor)}
                                >
                                  <Check className="h-3.5 w-3.5 text-success" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => setEditingTtl(null)}
                                >
                                  <X className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <span className="text-muted-foreground">{row.ttl_hours}h TTL</span>
                                {isAdmin && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0"
                                    onClick={() => {
                                      setEditingTtl(row.distributor);
                                      setEditingTtlValue(String(row.ttl_hours));
                                    }}
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {row.notes && (
                          <p className="text-[11px] text-muted-foreground mt-1">{row.notes}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 3 — Popular SKUs */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <List className="h-4 w-4 text-primary" />
                    Popular SKUs (Pre-Warm List)
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    {activeSkuCount} of {popularSkus.length} active · Pre-warmed nightly for SanMar, S&S, and OneStop.
                  </CardDescription>
                </div>
                <Input
                  placeholder="Search SKUs…"
                  value={skuSearch}
                  onChange={(e) => setSkuSearch(e.target.value)}
                  className="h-8 w-48 text-xs"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {popularSkusLoading ? (
                <div className="px-6 pb-4 space-y-2">
                  {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : (
                <div className="overflow-auto max-h-80">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground text-xs">Style</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground text-xs">Brand / Name</th>
                        <th className="px-4 py-2 text-center font-medium text-muted-foreground text-xs">Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSkus.map((sku) => (
                        <tr key={sku.id} className="border-b hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2 font-mono text-xs font-medium">{sku.style_number}</td>
                          <td className="px-4 py-2 text-xs">
                            <span className="font-medium">{sku.brand}</span>
                            {sku.display_name && <span className="text-muted-foreground"> — {sku.display_name}</span>}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {isAdmin ? (
                              <Switch
                                checked={sku.active}
                                onCheckedChange={() => handleToggleSkuActive(sku)}
                                className="scale-75"
                              />
                            ) : (
                              sku.active
                                ? <Check className="h-3.5 w-3.5 text-success mx-auto" />
                                : <X className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── DAILY SOURCE FILES ────────────────────────────────────── */}
        <section className="space-y-4">
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
              onClick={handleArchivesRefresh}
              disabled={archivesRefreshing || archivesLoading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${archivesRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {archivesError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{archivesError}</AlertDescription>
            </Alert>
          )}

          {archivesLoading && (
            <div className="space-y-4">
              {["SanMar", "S&S Activewear", "OneStop"].map((name) => (
                <Card key={name}>
                  <CardHeader className="pb-3">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48 mt-1" />
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!archivesLoading && archives && (
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
                      <CardDescription className="text-xs">Latest sync snapshot · 1-hour download link</CardDescription>
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
                                <Button variant="outline" size="sm" className="flex-shrink-0 gap-1.5 ml-4" asChild>
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

          {!archivesLoading && archives && totalArchiveFiles === 0 && !archivesError && (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <HardDrive className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No archives yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Archives are saved automatically when ingestion functions run.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
