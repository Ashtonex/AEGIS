"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import {
  getFinanceStatutorySummary,
  getFinanceStatutoryLiabilities,
  fileFinanceStatutoryLiability,
  settleFinanceStatutoryLiability,
  recomputeFinanceStatutory,
  getFinanceRateTables,
  createFinanceRateTable,
  deactivateFinanceRateTable,
} from "@/lib/api";
import { useLiveTable } from "@/lib/live/LiveDataProvider";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number.isFinite(num) ? num : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";

const TAX_TYPES = [
  { value: "paye", label: "PAYE" },
  { value: "nssa_employee", label: "NSSA (Employee)" },
  { value: "nssa_employer", label: "NSSA (Employer)" },
  { value: "vat_output", label: "VAT (Output)" },
  { value: "vat_input", label: "VAT (Input)" },
  { value: "aids_levy", label: "AIDS Levy" },
];

export function StatutoryPanel() {
  const [view, setView] = useState<"liabilities" | "rate-tables">("liabilities");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<RecordData[]>([]);
  const [liabilities, setLiabilities] = useState<RecordData[]>([]);
  const [rateTables, setRateTables] = useState<RecordData[]>([]);
  const [showRecompute, setShowRecompute] = useState(false);
  const [recomputeForm, setRecomputeForm] = useState({ period_start: monthStart(), period_end: today() });
  const [showNewRateTable, setShowNewRateTable] = useState(false);
  const [rateForm, setRateForm] = useState({
    tax_type: "paye", currency: "USD", period_basis: "monthly", effective_from: today(), name: "", source_reference: "",
  });
  const [bands, setBands] = useState<RecordData[]>([{ band_order: 1, lower_bound: "0", upper_bound: "", rate_pct: "0", fixed_deduction: "0", band_cap_amount: "" }]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [summaryRes, liabilitiesRes, rateTablesRes] = await Promise.allSettled([
      getFinanceStatutorySummary(),
      getFinanceStatutoryLiabilities(),
      getFinanceRateTables(),
    ]);
    if (summaryRes.status === "fulfilled") setSummary(summaryRes.value.data || []);
    if (liabilitiesRes.status === "fulfilled") setLiabilities(liabilitiesRes.value.data || []);
    if (rateTablesRes.status === "fulfilled") setRateTables(rateTablesRes.value.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  useLiveTable("finance.statutory_liabilities", () => void loadData());

  const handleFile = async (id: string) => {
    setBusy(true);
    try {
      await fileFinanceStatutoryLiability(id);
      setNotice("Liability marked filed.");
      await loadData();
    } catch {
      setNotice("Failed to mark liability filed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSettle = async (id: string, outstanding: number) => {
    const amountStr = window.prompt(`Amount to settle (outstanding ${money(outstanding)}):`, String(outstanding));
    if (!amountStr) return;
    const amount = Number(amountStr);
    if (!amount || amount <= 0) return;
    setBusy(true);
    try {
      await settleFinanceStatutoryLiability(id, { payment_date: today(), amount });
      setNotice("Settlement recorded.");
      await loadData();
    } catch {
      setNotice("Failed to record settlement.");
    } finally {
      setBusy(false);
    }
  };

  const handleRecompute = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await recomputeFinanceStatutory(recomputeForm);
      setNotice(`Recomputed ${res.data?.lines_accrued ?? 0} statutory lines.`);
      setShowRecompute(false);
      await loadData();
    } catch {
      setNotice("Recompute failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createFinanceRateTable({
        ...rateForm,
        bands: bands.map((b, i) => ({
          band_order: i + 1,
          lower_bound: Number(b.lower_bound) || 0,
          upper_bound: b.upper_bound === "" ? null : Number(b.upper_bound),
          rate_pct: Number(b.rate_pct) || 0,
          fixed_deduction: Number(b.fixed_deduction) || 0,
          band_cap_amount: b.band_cap_amount === "" ? null : Number(b.band_cap_amount),
        })),
      });
      setNotice("Rate table created.");
      setShowNewRateTable(false);
      setBands([{ band_order: 1, lower_bound: "0", upper_bound: "", rate_pct: "0", fixed_deduction: "0", band_cap_amount: "" }]);
      await loadData();
    } catch {
      setNotice("Failed to create rate table - check band values.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    setBusy(true);
    try {
      await deactivateFinanceRateTable(id);
      setNotice("Rate table deactivated.");
      await loadData();
    } catch {
      setNotice("Failed to deactivate rate table.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-8 flex items-center justify-center text-slate"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {notice && <div className="border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-paper rounded-sm">{notice}</div>}

      {/* Due-now KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {["vat", "paye", "nssa_employee"].map((type) => {
          const rows = summary.filter((s) => s.liability_type === type);
          const outstanding = rows.reduce((sum, r) => sum + Number(r.outstanding_amount || 0), 0);
          const nextDue = rows.map((r) => r.next_due_date).filter(Boolean).sort()[0];
          return (
            <div key={type} className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-4">
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate">{type === "vat" ? "VAT Outstanding" : type === "paye" ? "PAYE Outstanding" : "NSSA (Employee) Outstanding"}</p>
              <p className={`text-lg font-semibold tracking-tight mt-1 ${outstanding > 0 ? "text-amber-400" : "text-paper"}`}>{money(outstanding)}</p>
              {nextDue && <p className="text-[10px] text-slate mt-1">Next due: {nextDue}</p>}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-b border-ink-mid">
        <button onClick={() => setView("liabilities")} className={`px-4 py-2 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px ${view === "liabilities" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}>Liabilities</button>
        <button onClick={() => setView("rate-tables")} className={`px-4 py-2 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px ${view === "rate-tables" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}>Rate Tables</button>
        <div className="flex-1" />
        {view === "liabilities" && (
          <button onClick={() => setShowRecompute(true)} className="flex items-center gap-1.5 text-xs text-slate hover:text-paper mb-2">
            <RefreshCw className="h-3.5 w-3.5" />Recompute period
          </button>
        )}
      </div>

      {view === "liabilities" && (
        <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                  <th className="p-4">Authority</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Period</th>
                  <th className="p-4 text-right">Accrued</th>
                  <th className="p-4 text-right">Offset</th>
                  <th className="p-4 text-right">Settled</th>
                  <th className="p-4 text-right">Outstanding</th>
                  <th className="p-4">Status</th>
                  <th className="p-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {liabilities.length === 0 ? (
                  <tr><td colSpan={9} className="p-4 text-center text-slate">No statutory liabilities accrued yet.</td></tr>
                ) : (
                  liabilities.map((l) => (
                    <tr key={l.id} className="hover:bg-ink-mid/10">
                      <td className="p-4 uppercase text-paper text-xs font-mono">{l.authority}</td>
                      <td className="p-4 text-slate-light capitalize">{String(l.liability_type).replace(/_/g, " ")}</td>
                      <td className="p-4 text-slate-light text-xs">{l.period_start} → {l.period_end}</td>
                      <td className="p-4 text-right text-paper">{money(l.gross_accrued)}</td>
                      <td className="p-4 text-right text-slate-light">{money(l.offset_amount)}</td>
                      <td className="p-4 text-right text-emerald-400">{money(l.settled_amount)}</td>
                      <td className="p-4 text-right font-semibold text-amber-400">{money(l.outstanding_amount)}</td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border border-ink-mid text-slate-light">{l.status}</span>
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        {l.status === "accruing" && <button disabled={busy} onClick={() => void handleFile(l.id)} className="text-xs text-signal hover:underline mr-2">File</button>}
                        {Number(l.outstanding_amount) > 0 && <button disabled={busy} onClick={() => void handleSettle(l.id, Number(l.outstanding_amount))} className="text-xs text-signal hover:underline">Settle</button>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "rate-tables" && (
        <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-mid bg-ink/30 flex justify-between items-center">
            <span className="font-mono text-xs tracking-wider uppercase text-slate">Statutory Rate Tables</span>
            <button onClick={() => setShowNewRateTable(true)} className="flex items-center gap-1.5 bg-signal text-ink font-medium px-3 py-1.5 rounded-sm text-xs hover:bg-signal/95">
              <Plus className="h-3.5 w-3.5" />New Rate Table
            </button>
          </div>
          {rateTables.length === 0 ? (
            <div className="p-8 flex flex-col items-center gap-2 text-center">
              <ShieldAlert className="h-8 w-8 text-amber-400" />
              <p className="text-paper font-medium">No rate tables configured</p>
              <p className="text-sm text-slate max-w-md">
                Payroll cannot compute PAYE/NSSA and VAT will not accrue until real ZIMRA/NSSA rate tables are entered here.
                This is deliberate - a missing rate never silently computes as $0.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                    <th className="p-4">Type</th>
                    <th className="p-4">Currency</th>
                    <th className="p-4">Effective From</th>
                    <th className="p-4">Effective To</th>
                    <th className="p-4">Name / Source</th>
                    <th className="p-4">Active</th>
                    <th className="p-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {rateTables.map((t) => (
                    <tr key={t.id} className="hover:bg-ink-mid/10">
                      <td className="p-4 uppercase text-paper text-xs font-mono">{t.tax_type}</td>
                      <td className="p-4 text-slate-light">{t.currency}</td>
                      <td className="p-4 text-slate-light">{t.effective_from}</td>
                      <td className="p-4 text-slate-light">{t.effective_to || "—"}</td>
                      <td className="p-4 text-slate-light text-xs">{t.name || t.source_reference || "—"}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono border ${t.is_active ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300" : "border-slate-500/30 bg-slate-950/20 text-slate-300"}`}>
                          {t.is_active ? "active" : "inactive"}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        {t.is_active && <button disabled={busy} onClick={() => void handleDeactivate(t.id)} className="text-xs text-red-400 hover:underline">Deactivate</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showRecompute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 w-full max-w-sm space-y-4">
            <h3 className="font-mono text-sm uppercase text-signal">Recompute Statutory Period</h3>
            <p className="text-xs text-slate">Re-derives liability lines from source records for this period. Safe to re-run.</p>
            <form onSubmit={handleRecompute} className="space-y-3">
              <input type="date" className={inputClass} value={recomputeForm.period_start} onChange={(e) => setRecomputeForm({ ...recomputeForm, period_start: e.target.value })} required />
              <input type="date" className={inputClass} value={recomputeForm.period_end} onChange={(e) => setRecomputeForm({ ...recomputeForm, period_end: e.target.value })} required />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowRecompute(false)} className="px-3 py-2 text-slate-light hover:text-paper text-sm">Cancel</button>
                <button type="submit" disabled={busy} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Recompute</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewRateTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
          <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 w-full max-w-xl space-y-4 my-8">
            <h3 className="font-mono text-sm uppercase text-signal">New Rate Table</h3>
            <form onSubmit={handleCreateRateTable} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <select className={inputClass} value={rateForm.tax_type} onChange={(e) => setRateForm({ ...rateForm, tax_type: e.target.value })}>
                  {TAX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <input className={inputClass} placeholder="Currency" value={rateForm.currency} onChange={(e) => setRateForm({ ...rateForm, currency: e.target.value.toUpperCase() })} maxLength={3} required />
                <select className={inputClass} value={rateForm.period_basis} onChange={(e) => setRateForm({ ...rateForm, period_basis: e.target.value })}>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                  <option value="per_transaction">Per Transaction</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input type="date" className={inputClass} value={rateForm.effective_from} onChange={(e) => setRateForm({ ...rateForm, effective_from: e.target.value })} required />
                <input className={inputClass} placeholder="Name (optional)" value={rateForm.name} onChange={(e) => setRateForm({ ...rateForm, name: e.target.value })} />
              </div>
              <input className={inputClass} placeholder="Source reference (e.g. ZIMRA PAYE Tables, effective Jan 2026)" value={rateForm.source_reference} onChange={(e) => setRateForm({ ...rateForm, source_reference: e.target.value })} />

              <div className="border border-ink-mid rounded p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-mono uppercase text-slate">Bands</span>
                  <button type="button" onClick={() => setBands([...bands, { band_order: bands.length + 1, lower_bound: "0", upper_bound: "", rate_pct: "0", fixed_deduction: "0", band_cap_amount: "" }])} className="text-xs text-signal hover:underline">+ Add band</button>
                </div>
                {bands.map((b, i) => (
                  <div key={i} className="grid grid-cols-5 gap-1.5">
                    <input className={`${inputClass} py-1`} placeholder="Lower" value={b.lower_bound} onChange={(e) => setBands(bands.map((x, j) => j === i ? { ...x, lower_bound: e.target.value } : x))} />
                    <input className={`${inputClass} py-1`} placeholder="Upper (blank=∞)" value={b.upper_bound} onChange={(e) => setBands(bands.map((x, j) => j === i ? { ...x, upper_bound: e.target.value } : x))} />
                    <input className={`${inputClass} py-1`} placeholder="Rate %" value={b.rate_pct} onChange={(e) => setBands(bands.map((x, j) => j === i ? { ...x, rate_pct: e.target.value } : x))} />
                    <input className={`${inputClass} py-1`} placeholder="Deduct $" value={b.fixed_deduction} onChange={(e) => setBands(bands.map((x, j) => j === i ? { ...x, fixed_deduction: e.target.value } : x))} />
                    <input className={`${inputClass} py-1`} placeholder="Cap $ (blank=none)" value={b.band_cap_amount} onChange={(e) => setBands(bands.map((x, j) => j === i ? { ...x, band_cap_amount: e.target.value } : x))} />
                  </div>
                ))}
                <p className="text-[10px] text-slate">
                  A flat rate (VAT, NSSA): one band, lower 0, upper blank, deduct 0, cap = contribution cap if any.
                  A bracket table (PAYE): one band per bracket, using each bracket&apos;s published rate and &quot;deduct $&quot; figure.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNewRateTable(false)} className="px-3 py-2 text-slate-light hover:text-paper text-sm">Cancel</button>
                <button type="submit" disabled={busy} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create Rate Table</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
