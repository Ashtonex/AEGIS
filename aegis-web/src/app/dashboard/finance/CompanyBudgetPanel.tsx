"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Send, CheckCircle2, XCircle, Lock, LockOpen, GitBranch, ChevronDown, ChevronRight } from "lucide-react";
import {
  getCompanyBudgets, createCompanyBudget, getCompanyBudget, replaceCompanyBudgetLines,
  submitCompanyBudget, startCompanyBudgetReview, approveCompanyBudget, rejectCompanyBudget,
  cancelCompanyBudget, freezeCompanyBudget, reopenCompanyBudget, createCompanyBudgetRevision,
  getCompanyBudgetVariance, getDepartmentBudgetVariance,
} from "@/lib/api";
import { useFinanceDepartments } from "@/hooks/useFinanceDepartments";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function thisYear() {
  return new Date().getFullYear();
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";

const STATUS_CLASS: Record<string, string> = {
  draft: "border-slate-500/30 bg-slate-950/20 text-slate-300",
  submitted: "border-sky-500/30 bg-sky-950/20 text-sky-300",
  under_review: "border-amber-500/30 bg-amber-950/20 text-amber-300",
  approved_baseline: "border-emerald-500/30 bg-emerald-950/20 text-emerald-300",
  revision: "border-amber-500/30 bg-amber-950/20 text-amber-300",
  superseded: "border-slate-500/30 bg-slate-950/20 text-slate-300",
  frozen: "border-red-500/30 bg-red-950/20 text-red-300",
  cancelled: "border-slate-500/30 bg-slate-950/20 text-slate-300",
};

const COST_CATEGORIES = ["labour", "equipment", "materials", "subcontract", "overhead", "other"];
const REVENUE_CATEGORIES = ["contract_revenue", "other_income"];

function emptyLine() {
  return { department_id: "", line_type: "cost", category: "labour", period_month: `${thisYear()}-01-01`, amount: "" };
}

export function CompanyBudgetPanel() {
  const [fiscalYear, setFiscalYear] = useState(thisYear());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<RecordData[]>([]);
  const { departments } = useFinanceDepartments();
  const [selectedBudget, setSelectedBudget] = useState<RecordData | null>(null);
  const [companyVariance, setCompanyVariance] = useState<RecordData | null>(null);
  const [departmentVariance, setDepartmentVariance] = useState<RecordData | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [showNewBudget, setShowNewBudget] = useState(false);
  const [newBudgetLabel, setNewBudgetLabel] = useState("");
  const [lines, setLines] = useState<RecordData[]>([emptyLine()]);
  const [expandedLines, setExpandedLines] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const budgetRes = await getCompanyBudgets(fiscalYear);
      setBudgets(budgetRes.data || []);
    } catch {
      setNotice("Failed to load company budgets.");
    } finally {
      setLoading(false);
    }
  }, [fiscalYear]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const loadVariance = useCallback(async () => {
    try {
      const res = await getCompanyBudgetVariance(fiscalYear);
      setCompanyVariance(res.data);
    } catch {
      setCompanyVariance(null);
    }
  }, [fiscalYear]);

  useEffect(() => { void loadVariance(); }, [loadVariance]);

  useEffect(() => {
    if (!selectedDepartmentId) { setDepartmentVariance(null); return; }
    void (async () => {
      try {
        const res = await getDepartmentBudgetVariance(selectedDepartmentId, fiscalYear);
        setDepartmentVariance(res.data);
      } catch {
        setDepartmentVariance(null);
      }
    })();
  }, [selectedDepartmentId, fiscalYear]);

  const currentBaseline = useMemo(() => budgets.find((b) => b.status === "approved_baseline"), [budgets]);

  const openBudget = async (budgetId: string) => {
    try {
      const res = await getCompanyBudget(budgetId);
      setSelectedBudget(res.data);
      setLines((res.data.lines || []).map((l: RecordData) => ({ ...l, amount: String(l.amount) })));
    } catch {
      setNotice("Failed to load budget detail.");
    }
  };

  const handleCreateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await createCompanyBudget({ fiscal_year: fiscalYear, label: newBudgetLabel });
      setNotice("Draft company budget created.");
      setShowNewBudget(false);
      setNewBudgetLabel("");
      await loadAll();
      await openBudget(res.data.id);
    } catch (err: any) {
      setNotice(err?.message || "Failed to create budget.");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveLines = async () => {
    if (!selectedBudget) return;
    setBusy(true);
    try {
      const payload = lines
        .filter((l) => l.amount && Number(l.amount) >= 0)
        .map((l) => ({ department_id: l.department_id || null, line_type: l.line_type, category: l.category, period_month: l.period_month, amount: Number(l.amount) }));
      const res = await replaceCompanyBudgetLines(selectedBudget.id, payload);
      setSelectedBudget(res.data);
      setNotice("Budget lines saved.");
    } catch (err: any) {
      setNotice(err?.message || "Failed to save lines.");
    } finally {
      setBusy(false);
    }
  };

  const runWorkflowAction = async (action: (id: string) => Promise<any>, successMsg: string, extra?: () => any) => {
    if (!selectedBudget) return;
    setBusy(true);
    try {
      const res = await action(selectedBudget.id);
      setSelectedBudget(res.data);
      setNotice(successMsg);
      await loadAll();
      await loadVariance();
    } catch (err: any) {
      setNotice(err?.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    const reason = window.prompt("Reason for rejecting this budget (required):");
    if (!reason || !reason.trim()) return;
    await runWorkflowAction((id) => rejectCompanyBudget(id, reason), "Budget rejected back to draft.");
  };

  const handleFreeze = async () => {
    const reason = window.prompt("Freeze reason (optional):") || undefined;
    await runWorkflowAction((id) => freezeCompanyBudget(id, reason), "Budget frozen.");
  };

  const handleReopen = async () => {
    const reason = window.prompt("Reason for reopening this frozen budget (required):");
    if (!reason || !reason.trim()) return;
    await runWorkflowAction((id) => reopenCompanyBudget(id, reason), "Budget reopened.");
  };

  const handleRevise = async () => {
    if (!selectedBudget) return;
    setBusy(true);
    try {
      const res = await createCompanyBudgetRevision(selectedBudget.id);
      setNotice("Revision created from this baseline.");
      await loadAll();
      await openBudget(res.data.id);
    } catch (err: any) {
      setNotice(err?.message || "Failed to create revision.");
    } finally {
      setBusy(false);
    }
  };

  const linesEditable = selectedBudget && (selectedBudget.status === "draft" || selectedBudget.status === "revision");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-mono text-xs uppercase tracking-widest text-signal">Company &amp; Department Budget</h3>
          <input type="number" className={`${inputClass} w-28`} value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} />
        </div>
        <button onClick={() => setShowNewBudget(true)} className="flex items-center gap-1.5 text-xs text-slate hover:text-paper">
          <Plus className="h-3.5 w-3.5" />New budget
        </button>
      </div>

      {notice && (
        <div className="px-4 py-2 text-xs text-paper border border-ink-mid rounded-sm bg-signal/10 flex justify-between items-center">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper">&times;</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-8 text-slate"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          <div className="bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-mid bg-ink/30 flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-wider text-slate">Budgets for FY{fiscalYear}</span>
              {currentBaseline && <span className="text-[10px] font-mono text-emerald-300">Baseline: {currentBaseline.label}</span>}
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider">
                  <th className="p-3">Label</th><th className="p-3">Status</th><th className="p-3">Created</th><th className="p-3 text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {budgets.length === 0 ? (
                  <tr><td colSpan={4} className="p-4 text-center text-slate">No budgets for this fiscal year.</td></tr>
                ) : (
                  budgets.map((b) => (
                    <tr key={b.id} className="hover:bg-ink-mid/10">
                      <td className="p-3 text-paper">{b.label}</td>
                      <td className="p-3"><span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${STATUS_CLASS[b.status] || ""}`}>{b.status.replace(/_/g, " ")}</span></td>
                      <td className="p-3 text-slate-light">{String(b.created_at).slice(0, 10)}</td>
                      <td className="p-3 text-right"><button onClick={() => void openBudget(b.id)} className="text-signal hover:underline text-xs">Open</button></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {selectedBudget && (
            <div className="bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-mid bg-ink/30 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="text-paper font-medium">{selectedBudget.label}</span>
                  <span className={`ml-3 px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${STATUS_CLASS[selectedBudget.status] || ""}`}>{selectedBudget.status.replace(/_/g, " ")}</span>
                </div>
                <div className="flex gap-2">
                  {selectedBudget.status === "draft" || selectedBudget.status === "revision" ? (
                    <button onClick={() => void runWorkflowAction((id) => submitCompanyBudget(id), "Submitted for review.")} disabled={busy} className="text-xs text-signal hover:underline flex items-center gap-1"><Send className="h-3 w-3" />Submit</button>
                  ) : null}
                  {selectedBudget.status === "submitted" && (
                    <button onClick={() => void runWorkflowAction((id) => startCompanyBudgetReview(id), "Opened for review.")} disabled={busy} className="text-xs text-amber-400 hover:underline">Start review</button>
                  )}
                  {selectedBudget.status === "under_review" && (
                    <>
                      <button onClick={() => void runWorkflowAction((id) => approveCompanyBudget(id), "Approved as baseline.")} disabled={busy} className="text-xs text-emerald-400 hover:underline flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Approve</button>
                      <button onClick={() => void handleReject()} disabled={busy} className="text-xs text-red-400 hover:underline flex items-center gap-1"><XCircle className="h-3 w-3" />Reject</button>
                    </>
                  )}
                  {selectedBudget.status === "approved_baseline" && (
                    <>
                      <button onClick={() => void handleRevise()} disabled={busy} className="text-xs text-signal hover:underline flex items-center gap-1"><GitBranch className="h-3 w-3" />Create revision</button>
                      <button onClick={() => void handleFreeze()} disabled={busy} className="text-xs text-red-400 hover:underline flex items-center gap-1"><Lock className="h-3 w-3" />Freeze</button>
                    </>
                  )}
                  {selectedBudget.status === "frozen" && (
                    <button onClick={() => void handleReopen()} disabled={busy} className="text-xs text-amber-400 hover:underline flex items-center gap-1"><LockOpen className="h-3 w-3" />Reopen</button>
                  )}
                  {["draft", "submitted", "under_review", "revision"].includes(selectedBudget.status) && (
                    <button onClick={() => void runWorkflowAction((id) => cancelCompanyBudget(id), "Budget cancelled.")} disabled={busy} className="text-xs text-slate hover:text-paper">Cancel</button>
                  )}
                </div>
              </div>

              <div className="p-4">
                <button onClick={() => setExpandedLines(!expandedLines)} className="flex items-center gap-1.5 text-xs text-slate hover:text-paper mb-2">
                  {expandedLines ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Department / month lines ({lines.filter((l) => l.amount).length})
                </button>
                {expandedLines && (
                  <div className="space-y-2">
                    <div className="border border-ink-mid rounded-sm divide-y divide-ink-mid">
                      {lines.map((line, idx) => (
                        <div key={idx} className="p-2 grid grid-cols-12 gap-2 items-center">
                          <select className={`${inputClass} col-span-3`} value={line.department_id} onChange={(e) => { const next = [...lines]; next[idx] = { ...line, department_id: e.target.value }; setLines(next); }} disabled={!linesEditable}>
                            <option value="">Company-wide</option>
                            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                          <select className={`${inputClass} col-span-2`} value={line.line_type} onChange={(e) => { const next = [...lines]; next[idx] = { ...line, line_type: e.target.value, category: e.target.value === "cost" ? COST_CATEGORIES[0] : REVENUE_CATEGORIES[0] }; setLines(next); }} disabled={!linesEditable}>
                            <option value="cost">Cost</option>
                            <option value="revenue">Revenue</option>
                          </select>
                          <select className={`${inputClass} col-span-2`} value={line.category} onChange={(e) => { const next = [...lines]; next[idx] = { ...line, category: e.target.value }; setLines(next); }} disabled={!linesEditable}>
                            {(line.line_type === "cost" ? COST_CATEGORIES : REVENUE_CATEGORIES).map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                          </select>
                          <input type="month" className={`${inputClass} col-span-2`} value={String(line.period_month).slice(0, 7)} onChange={(e) => { const next = [...lines]; next[idx] = { ...line, period_month: `${e.target.value}-01` }; setLines(next); }} disabled={!linesEditable} />
                          <input type="number" step="0.01" placeholder="Amount" className={`${inputClass} col-span-2`} value={line.amount} onChange={(e) => { const next = [...lines]; next[idx] = { ...line, amount: e.target.value }; setLines(next); }} disabled={!linesEditable} />
                          {linesEditable && (
                            <button onClick={() => setLines(lines.filter((_, i) => i !== idx))} className="col-span-1 text-slate hover:text-red-400">&times;</button>
                          )}
                        </div>
                      ))}
                    </div>
                    {linesEditable && (
                      <div className="flex gap-3">
                        <button onClick={() => setLines([...lines, emptyLine()])} className="text-xs text-slate hover:text-paper flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Add line</button>
                        <button onClick={() => void handleSaveLines()} disabled={busy} className={buttonClass}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Save lines</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
              <span className="font-mono text-xs uppercase tracking-wider text-slate">Company Variance - FY{fiscalYear}</span>
            </div>
            <VarianceTable variance={companyVariance} />
          </div>

          <div className="bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-mid bg-ink/30 flex items-center gap-3">
              <span className="font-mono text-xs uppercase tracking-wider text-slate">Department Variance</span>
              <select className={`${inputClass} w-56`} value={selectedDepartmentId} onChange={(e) => setSelectedDepartmentId(e.target.value)}>
                <option value="">Select a department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            {selectedDepartmentId ? <VarianceTable variance={departmentVariance} /> : <p className="p-4 text-xs text-slate">Select a department to view its variance.</p>}
          </div>
        </>
      )}

      {showNewBudget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-ink border border-ink-mid rounded-lg p-6 w-full max-w-sm space-y-4">
            <h3 className="font-mono text-sm uppercase text-signal">New Company Budget - FY{fiscalYear}</h3>
            <form onSubmit={handleCreateBudget} className="space-y-3">
              <input className={inputClass} placeholder="Label (e.g. FY2027 Annual Budget)" value={newBudgetLabel} onChange={(e) => setNewBudgetLabel(e.target.value)} required />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNewBudget(false)} className="px-3 py-2 text-slate-light hover:text-paper text-sm">Cancel</button>
                <button type="submit" disabled={busy} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create Draft</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function VarianceTable({ variance }: { variance: RecordData | null }) {
  if (!variance) return <p className="p-4 text-xs text-slate">No variance data available.</p>;
  if (variance.no_baseline_budget) {
    return (
      <div className="p-4">
        <p className="text-xs text-amber-300 mb-3">No approved baseline budget exists for this fiscal year - showing actuals only.</p>
        <VarianceRows months={variance.months} />
      </div>
    );
  }
  return (
    <div className="p-4">
      <p className="text-xs text-slate mb-3">Baseline: <span className="text-paper">{variance.budget_label}</span></p>
      <VarianceRows months={variance.months} />
    </div>
  );
}

function VarianceRows({ months }: { months: RecordData[] }) {
  if (!months || months.length === 0) return <p className="text-xs text-slate">No data for this fiscal year yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-ink-mid text-slate uppercase font-mono">
            <th className="p-2">Month</th>
            <th className="p-2 text-right">Budget Rev</th><th className="p-2 text-right">Actual Rev</th><th className="p-2 text-right">Rev Variance</th>
            <th className="p-2 text-right">Budget Cost</th><th className="p-2 text-right">Actual Cost</th><th className="p-2 text-right">Cost Variance</th>
            <th className="p-2 text-right">Net Variance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {months.map((m) => (
            <tr key={m.month}>
              <td className="p-2 text-paper">{m.month}</td>
              <td className="p-2 text-right text-slate-light">{m.budget_revenue == null ? "—" : money(m.budget_revenue)}</td>
              <td className="p-2 text-right text-paper">{money(m.actual_revenue)}</td>
              <td className={`p-2 text-right ${m.revenue_variance == null ? "text-slate" : m.revenue_variance >= 0 ? "text-emerald-300" : "text-red-300"}`}>{m.revenue_variance == null ? "—" : money(m.revenue_variance)}</td>
              <td className="p-2 text-right text-slate-light">{m.budget_cost == null ? "—" : money(m.budget_cost)}</td>
              <td className="p-2 text-right text-paper">{money(m.actual_cost)}</td>
              <td className={`p-2 text-right ${m.cost_variance == null ? "text-slate" : m.cost_variance <= 0 ? "text-emerald-300" : "text-red-300"}`}>{m.cost_variance == null ? "—" : money(m.cost_variance)}</td>
              <td className={`p-2 text-right font-semibold ${m.net_variance == null ? "text-slate" : m.net_variance >= 0 ? "text-emerald-300" : "text-red-300"}`}>{m.net_variance == null ? "—" : money(m.net_variance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
