"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RotateCcw } from "lucide-react";
import {
  getFinanceTransfers,
  createFinanceTransfer,
  reverseFinanceTransfer,
  getFinanceTransferSummary,
} from "@/lib/api";
import { useLiveTable } from "@/lib/live/LiveDataProvider";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";

const TRANSFER_TYPES = [
  { value: "internal_plant_hire", label: "Internal Plant Hire" },
  { value: "internal_referral", label: "Internal Referral" },
  { value: "internal_service", label: "Internal Service" },
  { value: "manual_adjustment", label: "Manual Adjustment" },
];

export function DepartmentTransfersPanel({
  mode,
  departments,
  projects,
  departmentPnl,
}: {
  mode: "transfers" | "pnl";
  departments: RecordData[];
  projects: RecordData[];
  departmentPnl?: { departments: RecordData[]; consolidated: RecordData } | null;
}) {
  const [transfers, setTransfers] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [form, setForm] = useState({
    transfer_type: "manual_adjustment",
    transfer_date: today(),
    from_department_id: "",
    to_department_id: "",
    amount: "0",
    description: "",
    project_id: "",
  });

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getFinanceTransfers();
      setTransfers(res.data || []);
    } catch {
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "transfers") void loadTransfers();
  }, [mode, loadTransfers]);

  useLiveTable("finance.department_transfers", () => {
    if (mode === "transfers") void loadTransfers();
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createFinanceTransfer({
        ...form,
        from_department_id: form.from_department_id || null,
        to_department_id: form.to_department_id || null,
        project_id: form.project_id || null,
        amount: Number(form.amount),
      });
      setNotice("Internal transfer posted.");
      setShowNewModal(false);
      setForm({ transfer_type: "manual_adjustment", transfer_date: today(), from_department_id: "", to_department_id: "", amount: "0", description: "", project_id: "" });
      await loadTransfers();
    } catch (err) {
      setNotice("Failed to post internal transfer.");
    } finally {
      setBusy(false);
    }
  };

  const handleReverse = async (id: string) => {
    setBusy(true);
    try {
      await reverseFinanceTransfer(id);
      setNotice("Transfer reversed.");
      await loadTransfers();
    } catch {
      setNotice("Failed to reverse transfer.");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "pnl") {
    const rows = departmentPnl?.departments || [];
    const consolidated = departmentPnl?.consolidated;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((d) => (
            <div key={d.department_id ?? "unassigned"} className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-4 space-y-2">
              <p className="font-mono text-xs uppercase tracking-widest text-signal">{d.department_name}</p>
              <div className="text-sm text-slate-light">
                <div className="flex justify-between"><span>External Revenue</span><span className="text-paper">{money(d.external_revenue)}</span></div>
                <div className="flex justify-between"><span>Internal Revenue</span><span className="text-paper">{money(d.internal_revenue)}</span></div>
                <div className="flex justify-between"><span>Project Cost</span><span className="text-paper">{money(d.project_cost)}</span></div>
                <div className="flex justify-between"><span>Internal Cost</span><span className="text-paper">{money(d.internal_cost)}</span></div>
                <div className="flex justify-between"><span>Other Direct Cost</span><span className="text-paper">{money(d.direct_cost_non_project)}</span></div>
              </div>
              <div className={`flex justify-between pt-2 border-t border-ink-mid font-semibold ${Number(d.net) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                <span>Net</span><span>{money(d.net)}</span>
              </div>
            </div>
          ))}
        </div>
        {consolidated && (
          <div className="bg-ink-light border border-signal/30 rounded-sm p-4">
            <p className="font-mono text-xs uppercase tracking-widest text-signal mb-2">{consolidated.department_name}</p>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><p className="text-slate">Total Revenue</p><p className="text-paper text-lg font-semibold">{money(consolidated.total_revenue)}</p></div>
              <div><p className="text-slate">Total Cost</p><p className="text-paper text-lg font-semibold">{money(consolidated.total_cost)}</p></div>
              <div><p className="text-slate">Net</p><p className={`text-lg font-semibold ${Number(consolidated.net) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(consolidated.net)}</p></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
      <div className="px-4 py-3 border-b border-ink-mid bg-ink/30 flex justify-between items-center">
        <span className="font-mono text-xs tracking-wider uppercase text-slate">Internal Department Transfers</span>
        <button onClick={() => setShowNewModal(true)} className="flex items-center space-x-2 bg-signal text-ink font-medium px-3 py-1.5 rounded-sm text-xs hover:bg-signal/95">
          <Plus className="h-3.5 w-3.5" /><span>New Transfer</span>
        </button>
      </div>

      {notice && <div className="px-4 py-2 text-xs text-paper border-b border-ink-mid bg-signal/10">{notice}</div>}

      {loading ? (
        <div className="flex items-center justify-center p-8 text-slate"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                <th className="p-4">Transfer</th>
                <th className="p-4">Type</th>
                <th className="p-4">From</th>
                <th className="p-4">To</th>
                <th className="p-4 text-right">Amount</th>
                <th className="p-4">Status</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {transfers.length === 0 ? (
                <tr><td colSpan={7} className="p-4 text-center text-slate">No internal transfers recorded.</td></tr>
              ) : (
                transfers.map((t) => (
                  <tr key={t.id} className="hover:bg-ink-mid/10">
                    <td className="p-4 font-mono text-signal">{t.transfer_number}</td>
                    <td className="p-4 text-slate-light capitalize">{String(t.transfer_type || "").replace(/_/g, " ")}</td>
                    <td className="p-4 text-paper">{t.from_department_name || "Unassigned"}</td>
                    <td className="p-4 text-paper">{t.to_department_name || "Unassigned"}</td>
                    <td className="p-4 text-right text-paper">{money(t.amount)}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${t.status === "posted" ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300" : "border-slate-500/30 bg-slate-950/20 text-slate-300"}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      {t.status === "posted" && (
                        <button onClick={() => void handleReverse(t.id)} disabled={busy} className="text-slate hover:text-red-400 disabled:opacity-50" title="Reverse">
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 w-full max-w-md space-y-4">
            <h3 className="font-mono text-sm uppercase text-signal">New Internal Transfer</h3>
            <form onSubmit={handleCreate} className="space-y-3">
              <select className={inputClass} value={form.transfer_type} onChange={(e) => setForm({ ...form, transfer_type: e.target.value })}>
                {TRANSFER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <select className={inputClass} value={form.from_department_id} onChange={(e) => setForm({ ...form, from_department_id: e.target.value })}>
                  <option value="">From: Unassigned</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>From: {d.name}</option>)}
                </select>
                <select className={inputClass} value={form.to_department_id} onChange={(e) => setForm({ ...form, to_department_id: e.target.value })}>
                  <option value="">To: Unassigned</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>To: {d.name}</option>)}
                </select>
              </div>
              <input type="date" className={inputClass} value={form.transfer_date} onChange={(e) => setForm({ ...form, transfer_date: e.target.value })} required />
              <input type="number" step="0.01" min="0.01" placeholder="Amount" className={inputClass} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              <select className={inputClass} value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                <option value="">No linked project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name || p.project_code}</option>)}
              </select>
              <textarea placeholder="Description" className={inputClass} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNewModal(false)} className="px-3 py-2 text-slate-light hover:text-paper text-sm">Cancel</button>
                <button type="submit" disabled={busy} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Post Transfer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
