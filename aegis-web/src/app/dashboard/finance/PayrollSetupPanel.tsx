"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, Lock, LockOpen, Plus, RefreshCw, Save, Settings2, Tags, UserCog, X } from "lucide-react";
import {
  assignEmployeePayElement,
  closePayrollPeriod,
  createPayElement,
  getEmployeePayElements,
  getHREmployees,
  getPayElements,
  getPayrollPeriods,
  getPayrollSettings,
  getPayrollYtd,
  reopenPayrollPeriod,
  updateEmployeePayElement,
  updatePayElement,
  updatePayrollSettings,
  type PayrollSettings,
} from "@/lib/api";
import { SkeletonTableRows } from "@/components/ui/Skeleton";
import { EmptyState, Flag, Notice, Panel, buttonClass, ghostButtonClass, inputClass, labelClass, money } from "./payrollUi";

type RecordData = Record<string, any>;

const TYPE_LABEL: Record<string, string> = {
  earning: "Earning",
  deduction: "Deduction",
  tax_credit: "Tax credit",
  employer_contribution: "Employer cost",
};
const METHOD_LABEL: Record<string, string> = {
  fixed: "Fixed amount",
  pct_of_basic: "% of basic",
  per_hour: "Per hour",
  per_day: "Per day",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyCodeForm() {
  return {
    code: "", name: "", element_type: "earning", calc_method: "fixed",
    is_taxable: true, is_nssa_insurable: true, is_bonus: false,
    reduces_taxable: false, tax_credit_pct: "0", is_loan: false,
  };
}

function emptyAssignForm() {
  return { employee_id: "", pay_element_id: "", amount: "", loan_balance: "", effective_from: today(), reference: "" };
}

/** Pay codes, what each employee gets every run, payroll settings, month
 * locks and year-to-date totals. */
export function PayrollSetupPanel() {
  const year = new Date().getFullYear();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [elements, setElements] = useState<RecordData[]>([]);
  const [assignments, setAssignments] = useState<RecordData[]>([]);
  const [employees, setEmployees] = useState<RecordData[]>([]);
  const [periods, setPeriods] = useState<RecordData[]>([]);
  const [ytd, setYtd] = useState<RecordData[]>([]);
  const [periodYear, setPeriodYear] = useState(year);

  const [showCodeForm, setShowCodeForm] = useState(false);
  const [codeForm, setCodeForm] = useState(emptyCodeForm());
  const [assignForm, setAssignForm] = useState(emptyAssignForm());
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [reopening, setReopening] = useState<{ month: string; reason: string } | null>(null);

  const notify = (text: string, tone: "ok" | "error" = "ok") => setNotice({ text, tone });

  const load = useCallback(async () => {
    setLoading(true);
    const [s, el, asg, emp, per, y] = await Promise.allSettled([
      getPayrollSettings(),
      getPayElements(true),
      getEmployeePayElements(),
      getHREmployees({ status: "active" }),
      getPayrollPeriods(periodYear),
      getPayrollYtd(periodYear),
    ]);
    if (s.status === "fulfilled") setSettings(s.value.data ?? null);
    if (el.status === "fulfilled") setElements(el.value.data || []);
    if (asg.status === "fulfilled") setAssignments(asg.value.data || []);
    if (emp.status === "fulfilled") setEmployees(emp.value.data || []);
    if (per.status === "fulfilled") setPeriods(per.value.data || []);
    if (y.status === "fulfilled") setYtd(y.value.data || []);
    const failed = [s, el, asg, per, y].find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) notify(failed.reason instanceof Error ? failed.reason.message : "Some payroll setup data could not load.", "error");
    setLoading(false);
  }, [periodYear]);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      notify(success);
      await load();
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Payroll setup change failed.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const assignable = useMemo(
    () => elements.filter(e => e.is_active && !e.is_system && e.element_type !== "employer_contribution"),
    [elements],
  );
  const selectedElement = useMemo(() => elements.find(e => e.id === assignForm.pay_element_id), [elements, assignForm.pay_element_id]);
  const visibleAssignments = useMemo(
    () => (employeeFilter ? assignments.filter(a => a.employee_id === employeeFilter) : assignments),
    [assignments, employeeFilter],
  );
  const base = settings?.base_currency || "USD";

  const saveCode = (event: React.FormEvent) => {
    event.preventDefault();
    const isEarning = codeForm.element_type === "earning";
    const isDeduction = codeForm.element_type === "deduction";
    void act(() => createPayElement({
      code: codeForm.code.trim().toUpperCase(),
      name: codeForm.name.trim(),
      element_type: codeForm.element_type,
      calc_method: codeForm.calc_method,
      is_taxable: isEarning ? codeForm.is_taxable : false,
      is_nssa_insurable: isEarning ? codeForm.is_nssa_insurable : false,
      is_bonus: isEarning ? codeForm.is_bonus : false,
      reduces_taxable: isDeduction ? codeForm.reduces_taxable : false,
      tax_credit_pct: isDeduction ? Number(codeForm.tax_credit_pct) || 0 : 0,
      is_loan: isDeduction ? codeForm.is_loan : false,
    }), `Pay code ${codeForm.code.toUpperCase()} added.`).then(ok => {
      if (ok) { setShowCodeForm(false); setCodeForm(emptyCodeForm()); }
    });
  };

  const saveAssignment = (event: React.FormEvent) => {
    event.preventDefault();
    void act(() => assignEmployeePayElement({
      employee_id: assignForm.employee_id,
      pay_element_id: assignForm.pay_element_id,
      amount: Number(assignForm.amount) || 0,
      loan_balance: selectedElement?.is_loan ? Number(assignForm.loan_balance) || 0 : null,
      effective_from: assignForm.effective_from,
      reference: assignForm.reference || null,
    }), "Pay code assigned.").then(ok => {
      if (ok) setAssignForm({ ...emptyAssignForm(), employee_id: assignForm.employee_id });
    });
  };

  const amountLabel = (method?: string, isLoan?: boolean) => {
    if (isLoan) return `Instalment per run (${base})`;
    if (method === "pct_of_basic") return "% of basic pay";
    if (method === "per_hour") return `Rate per hour (${base})`;
    if (method === "per_day") return `Rate per day (${base})`;
    return `Amount per run (${base})`;
  };

  if (loading && !settings) {
    return (
      <div className="bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
        <SkeletonTableRows rows={6} columns={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <Panel title="Tax settings" action={<Settings2 className="h-4 w-4 text-slate" />}>
        {settings && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className={labelClass}>Base currency</label>
              <p className="text-sm text-paper py-2">{settings.base_currency}<span className="text-slate"> · pay profiles and payslips</span></p>
            </div>
            <div>
              <label className={labelClass}>Split-salary tax method</label>
              <select
                className={inputClass}
                value={settings.split_tax_method}
                onChange={e => setSettings({ ...settings, split_tax_method: e.target.value as PayrollSettings["split_tax_method"] })}
              >
                <option value="base_tables">Whole salary on {settings.base_currency} tables, split by share</option>
                <option value="separate_tables">Each currency portion on its own tables</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-paper py-2">
              <input
                type="checkbox"
                className="accent-signal"
                checked={settings.nssa_reduces_taxable}
                onChange={e => setSettings({ ...settings, nssa_reduces_taxable: e.target.checked })}
              />
              Employee NSSA reduces taxable income
            </label>
            <p className="md:col-span-2 text-xs text-slate">
              ZIMRA&apos;s PAYE guide says salaries with both local and USD parts use the USD tables (the first option).
              Rates themselves are set under Finance → Statutory → Rate tables. The tax-free bonus amount is a
              &quot;bonus_exemption&quot; table (annual, single band, upper bound = tax-free amount).
            </p>
            <div className="flex justify-end">
              <button
                disabled={busy}
                className={buttonClass}
                onClick={() => void act(() => updatePayrollSettings({
                  split_tax_method: settings.split_tax_method,
                  nssa_reduces_taxable: settings.nssa_reduces_taxable,
                }), "Payroll settings saved.")}
              >
                <Save className="h-4 w-4" />Save settings
              </button>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Pay codes"
        action={
          <button onClick={() => setShowCodeForm(v => !v)} className={ghostButtonClass}>
            {showCodeForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showCodeForm ? "Cancel" : "Add code"}
          </button>
        }
      >
        {showCodeForm && (
          <form onSubmit={saveCode} className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5 p-4 bg-ink/40 border border-ink-mid rounded">
            <div>
              <label className={labelClass}>Code</label>
              <input className={inputClass} required maxLength={20} pattern="[A-Za-z0-9_]+" placeholder="e.g. FUEL"
                value={codeForm.code} onChange={e => setCodeForm({ ...codeForm, code: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Name</label>
              <input className={inputClass} required maxLength={120} placeholder="Fuel allowance"
                value={codeForm.name} onChange={e => setCodeForm({ ...codeForm, name: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Type</label>
              <select className={inputClass} value={codeForm.element_type} onChange={e => setCodeForm({ ...codeForm, element_type: e.target.value })}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Calculated as</label>
              <select className={inputClass} value={codeForm.calc_method} onChange={e => setCodeForm({ ...codeForm, calc_method: e.target.value })}>
                {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {codeForm.element_type === "earning" && (
              <div className="md:col-span-4 flex flex-wrap gap-5 text-sm text-paper">
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-signal" checked={codeForm.is_taxable} onChange={e => setCodeForm({ ...codeForm, is_taxable: e.target.checked })} />Taxable</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-signal" checked={codeForm.is_nssa_insurable} onChange={e => setCodeForm({ ...codeForm, is_nssa_insurable: e.target.checked })} />Counts for NSSA</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-signal" checked={codeForm.is_bonus} onChange={e => setCodeForm({ ...codeForm, is_bonus: e.target.checked })} />Bonus (tax-free up to the yearly limit)</label>
              </div>
            )}
            {codeForm.element_type === "deduction" && (
              <div className="md:col-span-4 flex flex-wrap items-center gap-5 text-sm text-paper">
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-signal" checked={codeForm.reduces_taxable} onChange={e => setCodeForm({ ...codeForm, reduces_taxable: e.target.checked })} />Pre-tax (reduces taxable income)</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-signal" checked={codeForm.is_loan} onChange={e => setCodeForm({ ...codeForm, is_loan: e.target.checked })} />Loan (stops when the balance is paid)</label>
                <label className="flex items-center gap-2">Tax credit
                  <input className={`${inputClass} w-20 py-1`} value={codeForm.tax_credit_pct} onChange={e => setCodeForm({ ...codeForm, tax_credit_pct: e.target.value })} />%
                </label>
              </div>
            )}
            <div className="md:col-span-4 flex justify-end">
              <button disabled={busy} className={buttonClass}><Tags className="h-4 w-4" />Save code</button>
            </div>
          </form>
        )}

        {elements.length === 0 ? (
          <EmptyState icon={Tags} title="No pay codes" subtitle="Add codes for allowances, deductions and credits." compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[11px]">
                  <th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Type</th>
                  <th className="p-2">Calculated as</th><th className="p-2">Treatment</th>
                  <th className="p-2 text-right">Assigned</th><th className="p-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {elements.map(el => (
                  <tr key={el.id} className={el.is_active ? "" : "opacity-50"}>
                    <td className="p-2 font-mono text-paper">{el.code}</td>
                    <td className="p-2 text-paper">{el.name}</td>
                    <td className="p-2 text-slate-light">{TYPE_LABEL[el.element_type] || el.element_type}</td>
                    <td className="p-2 text-slate-light">
                      {el.code === "BASIC" || el.code === "OT" ? "From pay profile" : el.is_system ? "Entered on the run" : METHOD_LABEL[el.calc_method] || el.calc_method}
                    </td>
                    <td className="p-2">
                      <Flag on={el.is_taxable} label="Taxable" />
                      <Flag on={el.element_type === "earning" && !el.is_taxable} label="Tax-free" />
                      <Flag on={el.is_nssa_insurable} label="NSSA" />
                      <Flag on={el.is_bonus} label="Bonus" />
                      <Flag on={el.reduces_taxable} label="Pre-tax" />
                      <Flag on={Number(el.tax_credit_pct) > 0} label={`${Number(el.tax_credit_pct)}% credit`} />
                      <Flag on={el.is_loan} label="Loan" />
                      <Flag on={el.is_system} label="System" />
                    </td>
                    <td className="p-2 text-right text-slate-light tabular-nums">{el.assigned_count ?? 0}</td>
                    <td className="p-2 text-right">
                      {!el.is_system && (
                        <button
                          disabled={busy}
                          className="text-xs text-signal hover:underline"
                          onClick={() => void act(() => updatePayElement(el.id, { is_active: !el.is_active }), el.is_active ? `${el.code} switched off.` : `${el.code} switched on.`)}
                        >
                          {el.is_active ? "Switch off" : "Switch on"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Recurring pay per employee" action={<UserCog className="h-4 w-4 text-slate" />}>
        <form onSubmit={saveAssignment} className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-5 items-end">
          <div className="md:col-span-2">
            <label className={labelClass}>Employee</label>
            <select className={inputClass} required value={assignForm.employee_id} onChange={e => { setAssignForm({ ...assignForm, employee_id: e.target.value }); setEmployeeFilter(e.target.value); }}>
              <option value="">Select employee</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.employee_name || e.full_name || e.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Pay code</label>
            <select className={inputClass} required value={assignForm.pay_element_id} onChange={e => setAssignForm({ ...assignForm, pay_element_id: e.target.value })}>
              <option value="">Code</option>
              {assignable.map(el => <option key={el.id} value={el.id}>{el.code} · {el.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>{amountLabel(selectedElement?.calc_method, selectedElement?.is_loan)}</label>
            <input className={inputClass} required inputMode="decimal" value={assignForm.amount} onChange={e => setAssignForm({ ...assignForm, amount: e.target.value })} />
          </div>
          {selectedElement?.is_loan ? (
            <div>
              <label className={labelClass}>Loan balance ({base})</label>
              <input className={inputClass} required inputMode="decimal" value={assignForm.loan_balance} onChange={e => setAssignForm({ ...assignForm, loan_balance: e.target.value })} />
            </div>
          ) : (
            <div>
              <label className={labelClass}>Reference</label>
              <input className={inputClass} value={assignForm.reference} onChange={e => setAssignForm({ ...assignForm, reference: e.target.value })} />
            </div>
          )}
          <div>
            <label className={labelClass}>From</label>
            <input className={inputClass} type="date" required value={assignForm.effective_from} onChange={e => setAssignForm({ ...assignForm, effective_from: e.target.value })} />
          </div>
          <div className="md:col-span-6 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-slate">
              Showing
              <select className={`${inputClass} py-1 w-56`} value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}>
                <option value="">All employees</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.employee_name || e.full_name || e.name}</option>)}
              </select>
            </label>
            <button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" />Assign</button>
          </div>
        </form>

        {visibleAssignments.length === 0 ? (
          <EmptyState icon={UserCog} title="Nothing recurring yet" subtitle="Allowances, deductions, loans and credits assigned here are added to every payroll run automatically." compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[11px]">
                  <th className="p-2">Employee</th><th className="p-2">Code</th><th className="p-2 text-right">Amount</th>
                  <th className="p-2 text-right">Loan balance</th><th className="p-2">From</th><th className="p-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {visibleAssignments.map(a => (
                  <tr key={a.id}>
                    <td className="p-2 text-paper">{a.employee_name}</td>
                    <td className="p-2"><span className="font-mono text-paper">{a.code}</span> <span className="text-slate">{a.element_name}</span></td>
                    <td className="p-2 text-right tabular-nums text-paper">
                      {a.calc_method === "pct_of_basic" ? `${Number(a.amount)}%` : money(a.amount, base, 2)}
                      {a.calc_method === "per_hour" ? " /h" : a.calc_method === "per_day" ? " /day" : ""}
                    </td>
                    <td className="p-2 text-right tabular-nums text-slate-light">{a.is_loan ? money(a.loan_balance, base, 2) : "—"}</td>
                    <td className="p-2 text-slate-light">{a.effective_from}</td>
                    <td className="p-2 text-right">
                      <button
                        disabled={busy}
                        className="text-xs text-red-300 hover:underline"
                        onClick={() => void act(() => updateEmployeePayElement(a.id, { effective_to: today(), is_active: false }), `${a.code} ended for ${a.employee_name}.`)}
                      >
                        End
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Payroll months"
        action={
          <select className={`${inputClass} py-1 w-28`} value={periodYear} onChange={e => setPeriodYear(Number(e.target.value))}>
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        }
      >
        <p className="text-xs text-slate mb-3">A closed month is locked: no run paid in it can be created, approved, posted or cancelled until it is reopened.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {periods.map(p => {
            const month = String(p.period_month).slice(0, 7);
            const label = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
            const closed = p.status === "closed";
            return (
              <div key={month} className={`border rounded px-3 py-2 text-sm ${closed ? "border-emerald-500/30 bg-emerald-950/10" : "border-ink-mid"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-paper font-medium">{label}</span>
                  {closed ? <Lock className="h-3.5 w-3.5 text-emerald-300" /> : <LockOpen className="h-3.5 w-3.5 text-slate" />}
                </div>
                <p className="text-[11px] text-slate mt-0.5">
                  {Number(p.runs_total)} run{Number(p.runs_total) === 1 ? "" : "s"}{Number(p.runs_open) > 0 ? ` · ${p.runs_open} open` : ""}
                </p>
                {closed ? (
                  <button disabled={busy} className="text-xs text-amber-300 hover:underline mt-1" onClick={() => setReopening({ month, reason: "" })}>Reopen</button>
                ) : (
                  <button
                    disabled={busy || Number(p.runs_open) > 0}
                    title={Number(p.runs_open) > 0 ? "Post or cancel open runs first" : undefined}
                    className="text-xs text-signal hover:underline mt-1 disabled:text-slate disabled:no-underline"
                    onClick={() => void act(() => closePayrollPeriod(month), `${label} closed.`)}
                  >
                    Close month
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {reopening && (
          <div className="mt-4 p-3 border border-amber-500/30 bg-amber-950/10 rounded flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <label className={labelClass}>Why reopen {reopening.month}?</label>
              <input className={inputClass} value={reopening.reason} onChange={e => setReopening({ ...reopening, reason: e.target.value })} placeholder="Recorded on the month" />
            </div>
            <button
              disabled={busy || reopening.reason.trim().length < 5}
              className={buttonClass}
              onClick={() => void act(() => reopenPayrollPeriod(reopening.month, reopening.reason.trim()), `${reopening.month} reopened.`).then(ok => ok && setReopening(null))}
            >
              <LockOpen className="h-4 w-4" />Reopen
            </button>
            <button className={ghostButtonClass} onClick={() => setReopening(null)}>Cancel</button>
          </div>
        )}
      </Panel>

      <Panel title={`Year to date ${periodYear} (posted runs)`} action={<CalendarCheck className="h-4 w-4 text-slate" />}>
        {ytd.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Nothing posted this year" subtitle="Totals appear here once a payroll run is posted." compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[11px]">
                  <th className="p-2">Employee</th><th className="p-2 text-right">Runs</th><th className="p-2 text-right">Earnings</th>
                  <th className="p-2 text-right">Taxable</th><th className="p-2 text-right">PAYE</th><th className="p-2 text-right">AIDS levy</th>
                  <th className="p-2 text-right">NSSA</th><th className="p-2 text-right">Tax-free bonus</th><th className="p-2 text-right">Net</th>
                  <th className="p-2 text-right">Net (2nd currency)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {ytd.map(r => (
                  <tr key={`${r.employee_id}-${r.base_currency}`}>
                    <td className="p-2 text-paper">{r.employee_name}</td>
                    <td className="p-2 text-right tabular-nums text-slate-light">{r.runs_count}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.total_earnings, r.base_currency, 2)}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.taxable_income, r.base_currency, 2)}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.paye_amount, r.base_currency, 2)}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.aids_levy_amount, r.base_currency, 2)}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.nssa_employee_amount, r.base_currency, 2)}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.bonus_exempt_amount, r.base_currency, 2)}</td>
                    <td className="p-2 text-right tabular-nums text-paper">{money(r.net_pay, r.base_currency, 2)}</td>
                    <td className="p-2 text-right tabular-nums text-slate-light">{Number(r.net_pay_secondary) > 0 ? Number(r.net_pay_secondary).toLocaleString("en-ZW", { minimumFractionDigits: 2 }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <button onClick={() => void load()} className="inline-flex items-center gap-2 text-xs text-slate hover:text-paper"><RefreshCw className="h-3 w-3" />Refresh setup</button>
    </div>
  );
}
