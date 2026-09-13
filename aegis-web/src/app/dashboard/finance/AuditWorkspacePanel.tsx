"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, FileSearch, Loader2, RefreshCw } from "lucide-react";
import { getJournals, getJournalDrillDown } from "@/lib/api";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";

const STATUS_CLASSES: Record<string, string> = {
  draft: "border-slate/40 text-slate-light",
  posted: "border-emerald-500/40 text-emerald-300",
};

function JournalDrillDown({ journalId, onBack }: { journalId: string; onBack: () => void }) {
  const [data, setData] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getJournalDrillDown(journalId)
      .then((res) => { if (!cancelled) setData(res.data ?? null); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || "Failed to load drill-down."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [journalId]);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-slate-light hover:text-paper">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to journal list
      </button>

      {error && (
        <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center rounded-sm border border-ink-mid bg-ink-light">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
            <p className="mb-2 font-mono text-xs uppercase tracking-wider text-slate">Journal</p>
            <p className="text-sm text-paper">{data.journal?.journal_number} - {data.journal?.description}</p>
            <p className="mt-1 text-xs text-slate-light">Status: {data.journal?.status} · Debit {money(data.journal?.total_debit)} · Credit {money(data.journal?.total_credit)}</p>
            {Array.isArray(data.journal?.lines) && (
              <table className="mt-3 w-full text-left text-xs">
                <thead><tr className="text-slate-light"><th className="pb-1">Account</th><th className="pb-1 text-right">Debit</th><th className="pb-1 text-right">Credit</th></tr></thead>
                <tbody className="divide-y divide-ink-mid/50">
                  {data.journal.lines.map((l: RecordData) => (
                    <tr key={l.id}><td className="py-1 text-paper">{l.description || l.account_id}</td><td className="py-1 text-right text-paper">{money(l.debit_amount)}</td><td className="py-1 text-right text-paper">{money(l.credit_amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
            <p className="mb-2 font-mono text-xs uppercase tracking-wider text-slate">Source Evidence</p>
            <p className="text-sm text-paper">{data.source?.summary}</p>
            {data.source?.amount != null && <p className="mt-1 text-xs text-slate-light">Amount: {money(data.source.amount)}</p>}
          </div>

          <div className="rounded-sm border border-ink-mid bg-ink-light p-4 lg:col-span-2">
            <p className="mb-2 font-mono text-xs uppercase tracking-wider text-slate">Audit History ({data.audit_history?.length ?? 0})</p>
            {(data.audit_history || []).map((h: RecordData) => (
              <div key={h.id} className="border-b border-ink-mid/50 py-1.5 text-xs last:border-0">
                <span className="text-paper">{h.action}</span>
                <span className="ml-2 text-slate-light">{new Date(h.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AuditWorkspacePanel() {
  const [journals, setJournals] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getJournals({ status: statusFilter || undefined, pageSize: 100 });
      setJournals(res.data ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to load journals.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  if (selectedJournalId) {
    return <JournalDrillDown journalId={selectedJournalId} onBack={() => setSelectedJournalId(null)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Business reporting</p>
          <h2 className="mt-1 text-xl font-semibold text-paper">Audit Workspace</h2>
          <p className="mt-1 text-sm text-slate-light">Read-only. Click a journal to drill down: line detail, source evidence, and full change history.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-sm border border-ink-mid px-3 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-ink-mid bg-ink-light p-4">
        <div>
          <label className="mb-1 block text-xs font-mono uppercase text-slate">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputClass}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="posted">Posted</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center rounded-sm border border-ink-mid bg-ink-light">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
        </div>
      ) : journals.length === 0 ? (
        <p className="text-sm text-slate-light">No journal entries found.</p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-ink-mid bg-ink-light">
          <table className="w-full min-w-[600px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">
                <th className="p-4">Journal #</th>
                <th className="p-4">Description</th>
                <th className="p-4">Status</th>
                <th className="p-4">Debit / Credit</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {journals.map((j) => (
                <tr key={j.id} className="cursor-pointer hover:bg-ink-mid/10" onClick={() => setSelectedJournalId(j.id)}>
                  <td className="p-4 text-paper">{j.journal_number}</td>
                  <td className="p-4 text-paper">{j.description}</td>
                  <td className="p-4">
                    <span className={`font-mono text-[10px] uppercase px-2 py-0.5 border rounded-sm ${STATUS_CLASSES[j.status] || ""}`}>{j.status}</span>
                  </td>
                  <td className="p-4 text-paper">{money(j.total_debit)}</td>
                  <td className="p-4 text-slate-light"><FileSearch className="h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
