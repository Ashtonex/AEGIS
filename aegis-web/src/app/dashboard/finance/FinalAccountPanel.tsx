"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Lock, RefreshCw } from "lucide-react";
import {
  getInternalProjects,
  prepareFinalAccount,
  getFinalAccount,
  agreeFinalAccount,
  closeFinalAccount,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import { matchesRole } from "@/lib/rbacMatch";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number.isFinite(num) ? num : 0);
}

function percent(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? `${num.toFixed(1)}%` : "—";
}

function statusClass(s: string) {
  if (s === "closed") return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  if (s === "agreed") return "border-signal/30 bg-signal/10 text-signal";
  if (s === "under_negotiation") return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  return "border-ink-mid text-slate-light";
}

const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";

const CLOSE_ROLES = ["Executive (Admin)", "Finance Manager"];

export function FinalAccountPanel() {
  const { role } = useAuth();
  const canClose = matchesRole(role || "", CLOSE_ROLES);

  const [projects, setProjects] = useState<RecordData[]>([]);
  const [projectId, setProjectId] = useState("");
  const [current, setCurrent] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);

  const loadProjects = useCallback(async () => {
    const res = await getInternalProjects();
    const list = res.data ?? [];
    setProjects(list);
    if (!projectId && list.length > 0) setProjectId(list[0].id);
  }, [projectId]);

  const loadAccount = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await getFinalAccount(id);
      setCurrent(res.data?.current ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { if (projectId) void loadAccount(projectId); }, [projectId, loadAccount]);

  const handlePrepare = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await prepareFinalAccount(projectId);
      setBlockers(res.data?.blockers ?? []);
      setNotice(res.data?.blockers?.length ? "Draft prepared with unresolved items - see below." : "Final account draft prepared from live project financials.");
      await loadAccount(projectId);
    } catch {
      setNotice("Failed to prepare final account.");
    } finally {
      setBusy(false);
    }
  };

  const handleAgree = async () => {
    if (!current) return;
    setBusy(true);
    setNotice(null);
    try {
      await agreeFinalAccount(current.id);
      setNotice("Final account marked as client-agreed.");
      setBlockers([]);
      await loadAccount(projectId);
    } catch (err: any) {
      setNotice(err?.message || "Failed to mark final account as agreed - unresolved variations or claims likely remain.");
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    if (!current) return;
    if (!window.confirm(`Permanently close the final account for this project? This releases ${money(current.retention_held)} in retention and locks the project's commercial position.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      await closeFinalAccount(current.id);
      setNotice("Final account closed. Retention released and the project's commercial position is locked.");
      await loadAccount(projectId);
    } catch {
      setNotice("Failed to close final account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setBlockers([]); }} className="w-full max-w-sm bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50">
          <option value="">Select project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name || p.project_code}</option>)}
        </select>
        <button onClick={() => void loadAccount(projectId)} disabled={loading || !projectId} className="inline-flex items-center gap-2 border border-ink-mid px-3 py-2 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {notice && <div className="border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-paper rounded-sm">{notice}</div>}

      {blockers.length > 0 && (
        <div className="border border-red-500/30 bg-red-950/10 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-red-300 font-mono text-xs uppercase tracking-wider">
            <AlertTriangle className="h-4 w-4" />Unresolved before agreement
          </div>
          <ul className="text-sm text-slate-light list-disc list-inside space-y-1">
            {blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}

      {!projectId ? (
        <div className="bg-ink-light border border-ink-mid rounded-lg p-8 text-center text-slate">Select a project to prepare its final account.</div>
      ) : loading ? (
        <div className="bg-ink-light border border-ink-mid rounded-lg p-8 flex items-center justify-center text-slate"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !current ? (
        <div className="bg-ink-light border border-ink-mid rounded-lg p-8 flex flex-col items-center gap-3 text-center">
          <FileText className="h-8 w-8 text-slate" />
          <p className="text-paper font-medium">No final account prepared yet</p>
          <p className="text-sm text-slate max-w-md">Snapshot this project&apos;s live contract value, variations, claims, costs and retention into a draft final account.</p>
          <button onClick={() => void handlePrepare()} disabled={busy} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}Prepare Final Account</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className={`px-2 py-1 rounded-sm text-xs uppercase tracking-wider font-mono border ${statusClass(current.status)}`}>{String(current.status).replace(/_/g, " ")}</span>
            <div className="flex items-center gap-2">
              {(current.status === "draft" || current.status === "under_negotiation") && (
                <button onClick={() => void handlePrepare()} disabled={busy} className="inline-flex items-center gap-2 border border-ink-mid px-3 py-2 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
                  <RefreshCw className="h-4 w-4" />Refresh from Live Figures
                </button>
              )}
              {(current.status === "draft" || current.status === "under_negotiation") && (
                <button onClick={() => void handleAgree()} disabled={busy} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Mark Agreed</button>
              )}
              {current.status === "agreed" && canClose && (
                <button onClick={() => void handleClose()} disabled={busy} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}Close Project</button>
              )}
              {current.status === "agreed" && !canClose && (
                <span className="text-xs text-slate">Only Executive/Finance Manager can close.</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Final Contract Value</p>
              <p className="text-lg font-semibold tracking-tight mt-1 text-paper">{money(current.final_contract_value)}</p>
              <p className="text-[10px] text-slate mt-1">incl. {money(current.total_approved_variations)} approved variations</p>
            </div>
            <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Total Actual Cost</p>
              <p className="text-lg font-semibold tracking-tight mt-1 text-paper">{money(current.total_actual_cost)}</p>
              <p className="text-[10px] text-slate mt-1">{money(current.total_committed_outstanding)} still committed/outstanding</p>
            </div>
            <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Final Profit / Loss</p>
              <p className={`text-lg font-semibold tracking-tight mt-1 ${Number(current.final_profit_loss) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(current.final_profit_loss)}</p>
              <p className="text-[10px] text-slate mt-1">{percent(current.final_margin_pct)} margin</p>
            </div>
            <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Certified Claims</p>
              <p className="text-lg font-semibold tracking-tight mt-1 text-paper">{money(current.total_certified_claims)}</p>
            </div>
            <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Retention Held</p>
              <p className="text-lg font-semibold tracking-tight mt-1 text-paper">{money(current.retention_held)}</p>
            </div>
            <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Retention Released</p>
              <p className="text-lg font-semibold tracking-tight mt-1 text-paper">{money(current.retention_released)}</p>
            </div>
          </div>

          {current.status === "closed" && (
            <div className="border border-emerald-500/30 bg-emerald-950/10 rounded-lg p-4 flex items-center gap-2 text-emerald-300 text-sm">
              <Lock className="h-4 w-4" />
              Closed {current.closed_at ? new Date(current.closed_at).toLocaleDateString() : ""} — project's commercial position is locked.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
