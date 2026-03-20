import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { UserRole } from "@/types/auth";
import { AdminBanner } from "@/components/AdminBanner";
import { UserMenu } from "@/components/UserMenu";
import { SalesViewBanner } from "@/components/SalesViewBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, ArrowLeft } from "lucide-react";
import aktLogo from "@/assets/aktlogo.png";

interface AliasRow {
  id: string;
  query: string;
  internal_code: string;
  notes: string | null;
  created_at: string;
}

interface AliasManagerProps {
  userRole: UserRole | null;
  userEmail?: string | null;
  onSignOut?: () => void;
  salesViewMode: boolean;
  setSalesViewMode: (value: boolean) => void;
}

export default function AliasManager({
  userRole,
  userEmail,
  onSignOut,
  salesViewMode,
  setSalesViewMode,
}: AliasManagerProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<AliasRow | null>(null);
  const [formQuery, setFormQuery] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [redirected, setRedirected] = useState(false);

  const fetchAliases = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("onestop_aliases")
      .select("*")
      .order("query");
    if (error) {
      toast({ title: "Error loading aliases", description: error.message, variant: "destructive" });
    } else {
      setAliases(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (userRole === "admin") fetchAliases();
  }, [userRole]);

  if (userRole !== "admin" && !redirected) {
    setRedirected(true);
    navigate("/");
    return null;
  }
  if (userRole !== "admin") return null;

  const openAdd = () => {
    setEditingAlias(null);
    setFormQuery("");
    setFormCode("");
    setFormNotes("");
    setDialogOpen(true);
  };

  const openEdit = (alias: AliasRow) => {
    setEditingAlias(alias);
    setFormQuery(alias.query);
    setFormCode(alias.internal_code);
    setFormNotes(alias.notes ?? "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formQuery.trim() || !formCode.trim()) return;
    setSaving(true);
    const payload = {
      query: formQuery.trim().toUpperCase(),
      internal_code: formCode.trim(),
      notes: formNotes.trim() || null,
    };

    if (editingAlias) {
      const { error } = await supabase
        .from("onestop_aliases")
        .update(payload)
        .eq("id", editingAlias.id);
      if (error) {
        toast({ title: "Error updating alias", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Alias updated" });
        setDialogOpen(false);
        fetchAliases();
      }
    } else {
      const { error } = await supabase
        .from("onestop_aliases")
        .insert(payload);
      if (error) {
        toast({ title: "Error adding alias", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Alias added" });
        setDialogOpen(false);
        fetchAliases();
      }
    }
    setSaving(false);
  };

  const handleDelete = async (alias: AliasRow) => {
    if (!confirm(`Delete alias "${alias.query}" → "${alias.internal_code}"?`)) return;
    const { error } = await supabase
      .from("onestop_aliases")
      .delete()
      .eq("id", alias.id);
    if (error) {
      toast({ title: "Error deleting alias", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Alias deleted" });
      fetchAliases();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SalesViewBanner salesViewMode={salesViewMode} setSalesViewMode={setSalesViewMode} />
      <AdminBanner userRole={userRole} />

      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 sm:py-6">
          <div className="flex items-center justify-between w-full gap-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <img
                src={aktLogo}
                alt="AKT"
                className="h-8 sm:h-11 md:h-14 w-auto shrink-0 cursor-pointer"
                onClick={() => navigate("/")}
              />
              <div>
                <h1 className="text-lg sm:text-2xl font-bold">OneStop Aliases</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Manage style number mappings for OneStop lookups
                </p>
              </div>
            </div>
            {onSignOut && <UserMenu userEmail={userEmail} onSignOut={onSignOut} />}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/tools")} className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Admin Tools
          </Button>
          <Button onClick={openAdd} size="sm" className="gap-1">
            <Plus className="h-4 w-4" />
            Add Alias
          </Button>
        </div>

        <div className="rounded-lg border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[160px]">Query</TableHead>
                <TableHead className="w-[160px]">Internal Code</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-[120px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    Loading aliases…
                  </TableCell>
                </TableRow>
              ) : aliases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No aliases defined.
                  </TableCell>
                </TableRow>
              ) : (
                aliases.map((alias) => (
                  <TableRow key={alias.id}>
                    <TableCell className="font-mono text-sm">{alias.query}</TableCell>
                    <TableCell className="font-mono text-sm">{alias.internal_code}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{alias.notes ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(alias)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(alias)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAlias ? "Edit Alias" : "Add Alias"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="query">Query (style number we search)</Label>
              <Input
                id="query"
                placeholder="e.g. NL3633"
                value={formQuery}
                onChange={(e) => setFormQuery(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="code">Internal Code (OneStop's code)</Label>
              <Input
                id="code"
                placeholder="e.g. NL250"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                placeholder="e.g. Next Level 3633 tank"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !formQuery.trim() || !formCode.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
