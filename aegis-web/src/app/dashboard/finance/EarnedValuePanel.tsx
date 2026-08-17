"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, RefreshCw, XCircle } from "lucide-react";
import {
  getInternalProjects,
  getBoqLineItems,
  getBoqMeasurements,
  getBoqProgressSummary,
  recordBoqMeasurement,
  approveBoqMeasurement,
  rejectBoqMeasurement,
} from "@/lib/api";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number.isFinite(num) ? num : 0);
}

function percent(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return `${Number.isFinite(num) ? num.toFixed(1) : "0.0"}%`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";

export function EarnedValuePanel() {
  const [projects, setProjects] = useState<RecordData[]>([]);
  const [projectId, setProjectId] = useState("");
  const [lineItems, setLineItems] = useState<RecordData[]>([]);
  const [pending, setPending] = useState<RecordData[]>([]);
  const [summary, setSummary] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [measureLine, setMeasureLine] = useState<RecordData | null>(null);
  const [measureForm, setMeasureForm] = useState({ measurement_date: today(), qty_this_period: "", notes: "" });

  const loadProjects = useCallback(async () => {
    const res = await getInternalProjects();
    const list = res.data ?? [];
    setProjects(list);
    if (!projectId && list.length > 0) setProjectId(list[0].id);
  }, [projectId]);

  const loadProjectData = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    const [itemsRes, pendingRes, summaryRes] = await Promise.allSettled([
      getBoqLineItems(id),
      getBoqMeasurements(id, "submitted"),
      getBoqProgressSummary(id),
    ]);
    setLineItems(itemsRes.status === "fulfilled" ? (itemsRes.value.data ?? []) : []);
    setPending(pendingRes.status === "fulfilled" ? (pendingRes.value.data ?? []) : []);
    setSummary(summaryRes.status === "fulfilled" ? summaryRes.value.data : null);
    setLoading(false);
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { if (projectId) void loadProjectData(projectId); }, [projectId, loadProjectData]);

  const handleSubmitMeasurement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!measureLine) return;
    setBusy(true);
    try {
      await recordBoqMeasurement(measureLine.id, {
        measurement_date: measureForm.measurement_date,
        qty_this_period: Number(measureForm.qty_this_period),
        notes: measureForm.notes || undefined,
      });
      setNotice("Measurement submitted for approval.");
      setMeasureLine(null);
      setMeasureForm({ measurement_date: today(), qty_this_period: "", notes: "" });
      await loadProjectData(projectId);
    } catch {
      setNotice("Failed to submit measurement.");
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (entryId: string) => {
    setBusy(true);
    try {
      await approveBoqMeasurement(entryId);
      setNotice("Measurement approved.");
      await loadProjectData(projectId);
    } catch {
      setNotice("Failed to approve measurement - you may not have approval rights.");
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (entryId: string) => {
    const reason = window.prompt("Reason for rejecting this measurement:");
    if (!reason) return;
    setBusy(true);
    try {
      await rejectBoqMeasurement(entryId, reason);
      setNotice("Measurement rejected.");
      await loadProjectData(projectId);
    } catch {
      setNotice("Failed to reject measurement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${inputClass} max-w-sm`}>
          <option value="">Select project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name || p.project_code}</option>)}
        </select>
        <button onClick={() => void loadProjectData(projectId)} disabled={loading || !projectId} className="inline-flex items-center gap-2 border border-ink-mid px-3 py-2 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {notice && <div className="border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-paper rounded-sm">{notice}</div>}

      {!projectId ? (
        <div className="bg-ink-light border border-ink-mid rounded-lg p-8 text-center text-slate">Select a project to view its measured BOQ progress.</div>
      ) : loading ? (
        <div className="bg-ink-light border border-ink-mid rounded-lg p-8 flex items-center justify-center text-slate"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
                <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Contract Value (BOQ)</p>
                <p className="text-lg font-semibold tracking-tight mt-1 text-paper">{money(summary.total_contract_value)}</p>
              </div>
              <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
                <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Earned Value To Date</p>
                <p className="text-lg font-semibold tracking-tight mt-1 text-paper">{money(summary.total_earned_value)}</p>
              </div>
              <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
                <p className="text-[10px] uppercase font-mono tracking-widest text-slate">% Complete (Value-Weighted)</p>
                <p className="text-lg font-semibold tracking-tight mt-1 text-signal">{percent(summary.pct_complete_value_weighted)}</p>
              </div>
              <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
                <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Claimable Now</p>
                <p className="text-lg font-semibold tracking-tight mt-1 text-emerald-400">{money(summary.claimable_amount)}</p>
              </div>
            </div>
          )}

          {pending.length > 0 && (
            <div className="bg-ink-light border border-amber-500/30 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-mid bg-amber-950/10">
                <span className="font-mono text-xs tracking-wider uppercase text-amber-300">Pending Approval ({pending.length})</span>
              </div>
              <div className="divide-y divide-ink-mid">
                {pending.map((m) => (
                  <div key={m.id} className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-paper text-sm">{m.line_description}</p>
                      <p className="text-xs text-slate">{m.qty_this_period} {m.line_unit} measured on {m.measurement_date}{m.notes ? ` — ${m.notes}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button disabled={busy} onClick={() => void handleApprove(m.id)} className="flex items-center gap-1 text-xs text-emerald-400 hover:underline"><CheckCircle2 className="h-3.5 w-3.5" />Approve</button>
                      <button disabled={busy} onClick={() => void handleReject(m.id)} className="flex items-center gap-1 text-xs text-red-400 hover:underline"><XCircle className="h-3.5 w-3.5" />Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
              <span className="font-mono text-xs tracking-wider uppercase text-slate">BOQ Line Items</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                    <th className="p-4">Description</th>
                    <th className="p-4">Unit</th>
                    <th className="p-4 text-right">Contract Qty</th>
                    <th className="p-4 text-right">Rate</th>
                    <th className="p-4 text-right">Contract Amount</th>
                    <th className="p-4 text-right">Qty To Date</th>
                    <th className="p-4 text-right">% Complete</th>
                    <th className="p-4 text-right">Earned Value</th>
                    <th className="p-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {lineItems.length === 0 ? (
                    <tr><td colSpan={9} className="p-4 text-center text-slate">No BOQ line items yet - line items are seeded automatically when a quotation for this project is won.</td></tr>
                  ) : (
                    lineItems.map((li) => (
                      <tr key={li.id} className="hover:bg-ink-mid/10">
                        <td className="p-4 text-paper">{li.description}</td>
                        <td className="p-4 text-slate-light">{li.unit}</td>
                        <td className="p-4 text-right text-slate-light">{Number(li.contract_qty).toLocaleString()}</td>
                        <td className="p-4 text-right text-slate-light">{money(li.rate)}</td>
                        <td className="p-4 text-right text-paper">{money(li.contract_amount)}</td>
                        <td className="p-4 text-right text-paper">{Number(li.qty_measured_to_date).toLocaleString()}</td>
                        <td className="p-4 text-right">
                          <span className={li.pct_complete >= 100 ? "text-emerald-400" : li.pct_complete > 0 ? "text-amber-400" : "text-slate"}>{percent(li.pct_complete)}</span>
                        </td>
                        <td className="p-4 text-right text-paper">{money(li.earned_value_amount)}</td>
                        <td className="p-4 text-right">
                          <button onClick={() => setMeasureLine(li)} className="text-xs text-signal hover:underline">Record</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {measureLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 w-full max-w-sm space-y-4">
            <h3 className="font-mono text-sm uppercase text-signal">Record Measurement</h3>
            <p className="text-xs text-slate">{measureLine.description} — contract qty {Number(measureLine.contract_qty).toLocaleString()} {measureLine.unit}, {Number(measureLine.qty_measured_to_date).toLocaleString()} measured so far.</p>
            <form onSubmit={handleSubmitMeasurement} className="space-y-3">
              <input type="date" className={inputClass} value={measureForm.measurement_date} onChange={(e) => setMeasureForm({ ...measureForm, measurement_date: e.target.value })} required />
              <input type="number" step="0.001" min="0.001" placeholder={`Qty measured this period (${measureLine.unit})`} className={inputClass} value={measureForm.qty_this_period} onChange={(e) => setMeasureForm({ ...measureForm, qty_this_period: e.target.value })} required />
              <textarea placeholder="Notes (optional)" className={inputClass} rows={2} value={measureForm.notes} onChange={(e) => setMeasureForm({ ...measureForm, notes: e.target.value })} />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setMeasureLine(null)} className="px-3 py-2 text-slate-light hover:text-paper text-sm">Cancel</button>
                <button type="submit" disabled={busy} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Submit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
