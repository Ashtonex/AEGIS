"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Lock, Plus, RefreshCw, Undo2 } from "lucide-react";
import {
  getManagementAccountsPacks, createManagementAccountsPack, recomputeManagementAccountsPack,
  submitManagementAccountsPackForReview, approveManagementAccountsPack, lockManagementAccountsPack,
  reopenManagementAccountsPack, exportManagementAccountsPackPdf,
} from "@/lib/api";

type RecordData = Record<string, any>;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

const STATUS_CLASSES: Record<string, string> = {
  draft: "border-slate/40 text-slate-light",
  reviewed: "border-amber-500/40 text-amber-300",
  approved: "border-emerald-500/40 text-emerald-300",
  locked: "border-signal/40 text-signal",
};

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";

export function ManagementAccountsPanel() {
  const [packs, setPacks] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState(firstOfMonth());
  const [periodEnd, setPeriodEnd] = useState(today());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getManagementAccountsPacks();
      setPacks(res.data ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to load management accounts packs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function runAction(packId: string, action: () => Promise<any>) {
    setBusy(packId);
    setError(null);
    try {
      await action();
      await load();
    } catch (err: any) {
      setError(err?.message || "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    setBusy("new");
    setError(null);
    try {
      await createManagementAccountsPack(periodStart, periodEnd);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to create pack.");
    } finally {
      setBusy(null);
    }
  }

  async function handleExportPdf(packId: string) {
    setBusy(packId);
    try {
      const blob = await exportManagementAccountsPackPdf(packId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `management-accounts-${packId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Failed to export PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function handleReopen(packId: string) {
    const reason = window.prompt("Reason for reopening this pack (required):");
    if (!reason || !reason.trim()) return;
    await runAction(packId, () => reopenManagementAccountsPack(packId, reason));
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Business reporting</p>
        <h2 className="mt-1 text-xl font-semibold text-paper">Management Accounts</h2>
        <p className="mt-1 text-sm text-slate-light">
          Monthly packs freeze the GL-sourced financial statements at a point in time - Draft → Reviewed → Approved → Locked.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-ink-mid bg-ink-light p-4">
        <div>
          <label className="mb-1 block text-xs font-mono uppercase text-slate">Period start</label>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-mono uppercase text-slate">Period end</label>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={inputClass} />
        </div>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={busy === "new"}
          className="inline-flex h-9 items-center gap-2 rounded-sm border border-signal/40 px-3 font-mono text-xs uppercase tracking-widest text-signal hover:bg-signal/10 disabled:opacity-60"
        >
          {busy === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} New Pack
        </button>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center rounded-sm border border-ink-mid bg-ink-light">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
        </div>
      ) : packs.length === 0 ? (
        <p className="text-sm text-slate-light">No management accounts packs yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-ink-mid bg-ink-light">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">
                <th className="p-4">Period</th>
                <th className="p-4">Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {packs.map((p) => {
                const isBusy = busy === p.id;
                return (
                  <tr key={p.id}>
                    <td className="p-4 text-paper">{p.period_start} to {p.period_end}</td>
                    <td className="p-4">
                      <span className={`font-mono text-[10px] uppercase px-2 py-0.5 border rounded-sm ${STATUS_CLASSES[p.status] || ""}`}>{p.status}</span>
                      {p.reopen_reason && <p className="mt-1 text-[10px] text-slate-light">Reopened: {p.reopen_reason}</p>}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {p.status === "draft" && (
                          <>
                            <button disabled={isBusy} onClick={() => void runAction(p.id, () => recomputeManagementAccountsPack(p.id))} className="inline-flex items-center gap-1 text-xs text-slate-light hover:text-paper disabled:opacity-50">
                              <RefreshCw className="h-3.5 w-3.5" /> Recompute
                            </button>
                            <button disabled={isBusy} onClick={() => void runAction(p.id, () => submitManagementAccountsPackForReview(p.id))} className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200 disabled:opacity-50">
                              Submit for review
                            </button>
                          </>
                        )}
                        {p.status === "reviewed" && (
                          <button disabled={isBusy} onClick={() => void runAction(p.id, () => approveManagementAccountsPack(p.id))} className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-50">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                          </button>
                        )}
                        {p.status === "approved" && (
                          <button disabled={isBusy} onClick={() => void runAction(p.id, () => lockManagementAccountsPack(p.id))} className="inline-flex items-center gap-1 text-xs text-signal hover:text-signal/80 disabled:opacity-50">
                            <Lock className="h-3.5 w-3.5" /> Lock
                          </button>
                        )}
                        {(p.status === "approved" || p.status === "locked") && (
                          <button disabled={isBusy} onClick={() => void handleReopen(p.id)} className="inline-flex items-center gap-1 text-xs text-slate-light hover:text-paper disabled:opacity-50">
                            <Undo2 className="h-3.5 w-3.5" /> Reopen
                          </button>
                        )}
                        <button disabled={isBusy} onClick={() => void handleExportPdf(p.id)} className="inline-flex items-center gap-1 text-xs text-slate-light hover:text-paper disabled:opacity-50">
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
