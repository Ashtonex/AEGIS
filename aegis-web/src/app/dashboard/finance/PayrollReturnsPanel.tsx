"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, Banknote, Copy, Download, FileSpreadsheet, History, Landmark, Plus, RefreshCw,
  Trash2, X,
} from "lucide-react";
import {
  createExportLayout,
  createPaymentAccount,
  deleteExportLayout,
  endPaymentAccount,
  exportPayrollReturn,
  getExportFields,
  getExportLayouts,
  getHREmployees,
  getPaymentAccounts,
  getPayrollExports,
  getPayrollRuns,
  previewBankFile,
  previewPayrollReturn,
  produceBankFile,
  updateExportLayout,
  type ExportColumn,
  type ExportFields,
  type ExportKind,
  type ExportLayout,
  type ProducedFile,
} from "@/lib/api";
import { SkeletonTableRows } from "@/components/ui/Skeleton";
import { EmptyState, Notice, Panel, buttonClass, ghostButtonClass, inputClass, labelClass, money } from "./payrollUi";

type RecordData = Record<string, any>;
type Tone = { text: string; tone: "ok" | "error" };

const KIND_LABEL: Record<ExportKind, string> = { bank: "Bank file", paye: "PAYE schedule", nssa: "NSSA schedule" };
const METHOD_LABEL: Record<string, string> = { bank: "Bank", mobile_money: "Mobile money", cash: "Cash" };

function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

function download(file: ProducedFile) {
  // Excel opens a UTF-8 CSV correctly only with a byte-order mark.
  const blob = new Blob(["﻿", file.content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.file_name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Warnings({ items, tone = "amber" }: { items: string[]; tone?: "amber" | "red" }) {
  if (!items.length) return null;
  const cls = tone === "red" ? "border-red-500/30 bg-red-950/20 text-red-300" : "border-amber-500/30 bg-amber-950/20 text-amber-200";
  return (
    <ul className={`border px-3 py-2 text-xs space-y-1 ${cls}`}>
      {items.map(w => (
        <li key={w} className="flex gap-2"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />{w}</li>
      ))}
    </ul>
  );
}

/** Where people are paid, bank files per run, monthly PAYE / NSSA schedules,
 * the layouts those files use and a log of every file produced. */
export function PayrollReturnsPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Tone | null>(null);
  const [employees, setEmployees] = useState<RecordData[]>([]);
  const [accounts, setAccounts] = useState<RecordData[]>([]);
  const [runs, setRuns] = useState<RecordData[]>([]);
  const [layouts, setLayouts] = useState<ExportLayout[]>([]);
  const [fields, setFields] = useState<ExportFields | null>(null);
  const [exportsLog, setExportsLog] = useState<RecordData[]>([]);

  const notify = (text: string, tone: Tone["tone"] = "ok") => setNotice({ text, tone });
  const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

  const load = useCallback(async () => {
    setLoading(true);
    const [emp, acc, rn, lay, fl, ex] = await Promise.allSettled([
      getHREmployees({ status: "active" }),
      getPaymentAccounts(),
      getPayrollRuns(),
      getExportLayouts(),
      getExportFields(),
      getPayrollExports(),
    ]);
    if (emp.status === "fulfilled") setEmployees(emp.value.data || []);
    if (acc.status === "fulfilled") setAccounts(acc.value.data || []);
    if (rn.status === "fulfilled") setRuns(rn.value.data || []);
    if (lay.status === "fulfilled") setLayouts(lay.value.data || []);
    if (fl.status === "fulfilled") setFields(fl.value.data ?? null);
    if (ex.status === "fulfilled") setExportsLog(ex.value.data || []);
    const failed = [acc, rn, lay, fl, ex].find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) notify(errorText(failed.reason, "Some payroll data could not load."), "error");
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Section reloads: refetch only what changed, so an open preview elsewhere
  // on the page is not wiped by a full reload.
  const refreshAfterFile = async () => {
    const [ex] = await Promise.allSettled([getPayrollExports()]);
    if (ex.status === "fulfilled") setExportsLog(ex.value.data || []);
  };
  const reloadAccounts = async () => {
    const [acc] = await Promise.allSettled([getPaymentAccounts()]);
    if (acc.status === "fulfilled") setAccounts(acc.value.data || []);
  };
  const reloadLayouts = async () => {
    const [lay] = await Promise.allSettled([getExportLayouts()]);
    if (lay.status === "fulfilled") setLayouts(lay.value.data || []);
  };

  if (loading) {
    return (
      <div className="bg-ink-light border border-ink-mid rounded-lg p-4">
        <SkeletonTableRows rows={5} columns={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <BankFileSection runs={runs} layouts={layouts.filter(l => l.kind === "bank")} busy={busy} setBusy={setBusy}
        notify={notify} onProduced={refreshAfterFile} />
      <ReturnsSection layouts={layouts} busy={busy} setBusy={setBusy} notify={notify} onProduced={refreshAfterFile} />
      <PaymentAccountsSection employees={employees} accounts={accounts} busy={busy} setBusy={setBusy} notify={notify}
        onChanged={reloadAccounts} />
      <LayoutsSection layouts={layouts} fields={fields} busy={busy} setBusy={setBusy} notify={notify} onChanged={reloadLayouts} />
      <ExportLogSection rows={exportsLog} onRefresh={refreshAfterFile} />
    </div>
  );
}

type SectionProps = {
  busy: boolean;
  setBusy: (v: boolean) => void;
  notify: (text: string, tone?: Tone["tone"]) => void;
};

// ---------------------------------------------------------------------------
// Bank file
// ---------------------------------------------------------------------------

function BankFileSection({ runs, layouts, busy, setBusy, notify, onProduced }: SectionProps & {
  runs: RecordData[]; layouts: ExportLayout[]; onProduced: () => void;
}) {
  const payable = useMemo(() => runs.filter(r => r.status === "approved" || r.status === "posted"), [runs]);
  const [runId, setRunId] = useState("");
  const [currency, setCurrency] = useState("");
  const [layoutId, setLayoutId] = useState("builtin:bank");
  const [preview, setPreview] = useState<RecordData | null>(null);
  const [confirmRecent, setConfirmRecent] = useState(false);
  const [confirmRepeat, setConfirmRepeat] = useState(false);

  const run = payable.find(r => r.id === runId);
  const currencies = run ? [run.base_currency || "USD", ...(run.secondary_currency ? [run.secondary_currency] : [])] : [];

  const loadPreview = async (id = runId, cur = currency) => {
    if (!id || !cur) return;
    setBusy(true);
    setPreview(null);
    setConfirmRecent(false);
    setConfirmRepeat(false);
    try {
      const res = await previewBankFile(id, cur);
      setPreview(res.data ?? null);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Bank file preview failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const produce = async () => {
    setBusy(true);
    try {
      const res = await produceBankFile(runId, {
        currency, layout_id: layoutId, confirm_recent_changes: confirmRecent, confirm_repeat: confirmRepeat,
      });
      if (res.data) {
        download(res.data);
        notify(`${res.data.file_name}: ${res.data.rows} payments, ${money(res.data.total, currency, 2)}.`);
      }
      onProduced();
      await loadPreview();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Bank file could not be produced.", "error");
    } finally {
      setBusy(false);
    }
  };

  const recent: RecordData[] = preview?.recent_changes || [];
  const previous: RecordData[] = preview?.previous_exports || [];
  const blocked = !preview || preview.problems?.length > 0 || !preview.rows?.length
    || (recent.length > 0 && !confirmRecent) || (previous.length > 0 && !confirmRepeat);

  return (
    <Panel title="Bank file for a run" action={<Landmark className="h-4 w-4 text-slate" />}>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <label className="block md:col-span-2">
          <span className={labelClass}>Approved or posted run</span>
          <select className={inputClass} value={runId} onChange={e => {
            const id = e.target.value;
            const r = payable.find(x => x.id === id);
            const cur = r?.base_currency || "USD";
            setRunId(id);
            setCurrency(cur);
            void loadPreview(id, cur);
          }}>
            <option value="">Choose a run…</option>
            {payable.map(r => (
              <option key={r.id} value={r.id}>{r.run_number} · paid {r.payment_date} · {r.status}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Currency</span>
          <select className={inputClass} value={currency} disabled={!run} onChange={e => { setCurrency(e.target.value); void loadPreview(runId, e.target.value); }}>
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Layout</span>
          <select className={inputClass} value={layoutId} onChange={e => setLayoutId(e.target.value)}>
            {layouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </div>

      {!payable.length && (
        <EmptyState icon={Banknote} title="No run ready to pay" subtitle="Approve a payroll run on the Staff payroll tab first." compact />
      )}

      {preview && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {([["In this file", preview.totals.bank], ["Cash", preview.totals.cash], ["Mobile money", preview.totals.mobile_money], ["Run pays", preview.totals.run]] as const).map(([label, value]) => (
              <div key={label} className="border border-ink-mid px-3 py-2">
                <div className={labelClass}>{label}</div>
                <div className="text-paper tabular-nums">{money(value, preview.currency, 2)}</div>
              </div>
            ))}
          </div>
          <Warnings items={preview.problems || []} tone="red" />
          {recent.length > 0 && (
            <div className="border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 space-y-1">
              <p className="font-semibold">Payment accounts added or changed in the last 30 days. Check each with the employee before paying:</p>
              <ul className="list-disc pl-5">
                {recent.map(c => <li key={c.employee_name}>{c.employee_name}: {c.account_number} (since {c.changed_on})</li>)}
              </ul>
              <label className="flex items-center gap-2 pt-1 text-paper">
                <input type="checkbox" checked={confirmRecent} onChange={e => setConfirmRecent(e.target.checked)} />
                I have confirmed these accounts
              </label>
            </div>
          )}
          {previous.length > 0 && (
            <div className="border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 space-y-1">
              <p className="font-semibold">A {preview.currency} file for this run was already produced:</p>
              <ul className="list-disc pl-5">
                {previous.map(p => <li key={p.generated_at}>{new Date(p.generated_at).toLocaleString()} by {p.generated_by_name || "someone"} ({p.file_name})</li>)}
              </ul>
              <label className="flex items-center gap-2 pt-1 text-paper">
                <input type="checkbox" checked={confirmRepeat} onChange={e => setConfirmRepeat(e.target.checked)} />
                Produce it again (the earlier file was not sent to the bank, or was rejected)
              </label>
            </div>
          )}
          {preview.rows?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] font-mono uppercase text-slate border-b border-ink-mid">
                  <tr><th className="p-2">Employee</th><th className="p-2">Bank</th><th className="p-2">Account</th><th className="p-2 text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {preview.rows.map((r: RecordData) => (
                    <tr key={r.employee_id} className="border-b border-ink-mid/50">
                      <td className="p-2 text-paper">{r.employee_name}</td>
                      <td className="p-2 text-slate-light">{r.bank_name}{r.branch_code ? ` · ${r.branch_code}` : ""}</td>
                      <td className="p-2 font-mono text-slate-light">{r.account_number}</td>
                      <td className="p-2 text-right tabular-nums text-paper">{money(r.amount, preview.currency, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(preview.cash?.length > 0 || preview.mobile_money?.length > 0) && (
            <p className="text-xs text-slate">
              Not in the file —{" "}
              {[...(preview.cash || []).map((r: RecordData) => `${r.employee_name} (cash ${money(r.amount, preview.currency, 2)})`),
                ...(preview.mobile_money || []).map((r: RecordData) => `${r.employee_name} (mobile money ${r.mobile_number}, ${money(r.amount, preview.currency, 2)})`)].join("; ")}
            </p>
          )}
          <div className="flex justify-end">
            <button className={buttonClass} disabled={busy || blocked} onClick={produce}>
              <Download className="h-4 w-4" /> Download bank file
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Monthly PAYE / NSSA schedules
// ---------------------------------------------------------------------------

function ReturnsSection({ layouts, busy, setBusy, notify, onProduced }: SectionProps & {
  layouts: ExportLayout[]; onProduced: () => void;
}) {
  const [kind, setKind] = useState<"paye" | "nssa">("paye");
  const [month, setMonth] = useState(thisMonth());
  const [currency, setCurrency] = useState("USD");
  const [layoutId, setLayoutId] = useState("builtin:paye");
  const [data, setData] = useState<RecordData | null>(null);
  const kindLayouts = layouts.filter(l => l.kind === kind);

  const loadPreview = async () => {
    setBusy(true);
    setData(null);
    try {
      const res = await previewPayrollReturn(kind, month, currency);
      setData(res.data ?? null);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Schedule preview failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const produce = async () => {
    setBusy(true);
    try {
      const res = await exportPayrollReturn(kind, { month, currency, layout_id: layoutId });
      if (res.data) {
        download(res.data);
        notify(`${res.data.file_name}: ${res.data.rows} employees.`);
      }
      onProduced();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Schedule could not be produced.", "error");
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<[string, string]> = kind === "paye"
    ? [["gross_earnings", "Gross"], ["taxable_income", "Taxable"], ["tax_credits", "Credits"], ["paye", "PAYE"], ["aids_levy", "AIDS levy"]]
    : [["insurable_earnings", "Insurable"], ["insurable_capped", "Capped"], ["nssa_employee", "Employee"], ["nssa_employer", "Employer"], ["nssa_total", "Total"]];

  return (
    <Panel title="Monthly PAYE & NSSA schedules" action={<FileSpreadsheet className="h-4 w-4 text-slate" />}>
      <p className="text-xs text-slate mb-3">
        From posted runs paid in the month, checked against the PAYE, AIDS levy and NSSA owed. File the return on TaRMS or
        the NSSA portal, then record the filing reference under Statutory.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <label className="block">
          <span className={labelClass}>Schedule</span>
          <select className={inputClass} value={kind} onChange={e => { const k = e.target.value as "paye" | "nssa"; setKind(k); setLayoutId(`builtin:${k}`); setData(null); }}>
            <option value="paye">PAYE</option>
            <option value="nssa">NSSA</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Month paid</span>
          <input type="month" className={inputClass} value={month} onChange={e => { setMonth(e.target.value); setData(null); }} />
        </label>
        <label className="block">
          <span className={labelClass}>Currency</span>
          <select className={inputClass} value={currency} onChange={e => { setCurrency(e.target.value); setData(null); }}>
            <option value="USD">USD</option>
            <option value="ZWG">ZWG</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Layout</span>
          <select className={inputClass} value={layoutId} onChange={e => setLayoutId(e.target.value)}>
            {kindLayouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <button className={ghostButtonClass} disabled={busy || !month} onClick={loadPreview}>
          <RefreshCw className="h-4 w-4" /> Preview
        </button>
      </div>

      {data && (
        <div className="mt-4 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="font-mono uppercase text-slate border-b border-ink-mid">
                <tr><th className="p-2">Owed</th><th className="p-2 text-right">Schedule</th><th className="p-2 text-right">Accrued</th><th className="p-2 text-right">Difference</th><th className="p-2">Status</th><th className="p-2">Due</th><th className="p-2">Filing ref.</th></tr>
              </thead>
              <tbody>
                {data.reconciliation.map((r: RecordData) => (
                  <tr key={r.liability_type} className="border-b border-ink-mid/50">
                    <td className="p-2 text-paper">{r.liability_type.replace("_", " ").toUpperCase()}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.schedule_total, data.currency, 2)}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.liability_accrued, data.currency, 2)}</td>
                    <td className={`p-2 text-right tabular-nums ${Number(r.difference) !== 0 ? "text-red-300" : "text-slate-light"}`}>{money(r.difference, data.currency, 2)}</td>
                    <td className="p-2 text-slate-light">{r.status || "—"}</td>
                    <td className="p-2 text-slate-light">{r.due_date || "—"}</td>
                    <td className="p-2 text-slate-light">{r.filing_reference || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Warnings items={data.warnings || []} />
          {data.nssa_ceiling != null && <p className="text-xs text-slate">NSSA ceiling from the rate table: {money(data.nssa_ceiling, data.currency, 2)} a month.</p>}
          {data.rows.length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title="Nothing for this month" subtitle={`No posted ${data.currency} payroll paid in ${data.month}.`} compact />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] font-mono uppercase text-slate border-b border-ink-mid">
                  <tr>
                    <th className="p-2">Employee</th>
                    <th className="p-2">{kind === "paye" ? "TIN" : "SSN"}</th>
                    {columns.map(([, label]) => <th key={label} className="p-2 text-right">{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: RecordData) => (
                    <tr key={r.employee_id} className="border-b border-ink-mid/50">
                      <td className="p-2 text-paper">{r.employee_name}</td>
                      <td className="p-2 font-mono text-slate-light">{(kind === "paye" ? r.tax_number : r.nssa_number) || <span className="text-amber-300">missing</span>}</td>
                      {columns.map(([key]) => <td key={key} className="p-2 text-right tabular-nums">{money(r[key], data.currency, 2)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end">
            <button className={buttonClass} disabled={busy || !data.rows.length} onClick={produce}>
              <Download className="h-4 w-4" /> Download {kind.toUpperCase()} schedule
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Where people are paid
// ---------------------------------------------------------------------------

function emptyAccountForm() {
  return { employee_id: "", currency: "USD", method: "bank", bank_name: "", branch_code: "", branch_name: "", account_number: "", account_name: "", mobile_number: "" };
}

function PaymentAccountsSection({ employees, accounts, busy, setBusy, notify, onChanged }: SectionProps & {
  employees: RecordData[]; accounts: RecordData[]; onChanged: () => void;
}) {
  const [form, setForm] = useState(emptyAccountForm());
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("");
  const [ending, setEnding] = useState<{ id: string; reason: string } | null>(null);

  const withAccount = new Set(accounts.map(a => a.employee_id));
  const missing = employees.filter(e => !withAccount.has(e.id));
  const shown = accounts.filter(a => !filter || (a.employee_name || "").toLowerCase().includes(filter.toLowerCase()));

  const save = async () => {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { employee_id: form.employee_id, currency: form.currency, method: form.method };
      if (form.method === "bank") {
        Object.assign(payload, {
          bank_name: form.bank_name, branch_code: form.branch_code || null, branch_name: form.branch_name || null,
          account_number: form.account_number, account_name: form.account_name || null,
        });
      }
      if (form.method === "mobile_money") payload.mobile_number = form.mobile_number;
      const res = await createPaymentAccount(payload);
      notify(res.message || "Payment details saved.");
      setForm(emptyAccountForm());
      setShowForm(false);
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Payment details could not be saved.", "error");
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    if (!ending) return;
    setBusy(true);
    try {
      await endPaymentAccount(ending.id, ending.reason);
      notify("Payment account ended.");
      setEnding(null);
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not end the account.", "error");
    } finally {
      setBusy(false);
    }
  };

  const valid = form.employee_id && form.currency.length === 3 && (
    form.method === "cash" || (form.method === "bank" && form.bank_name && form.account_number) || (form.method === "mobile_money" && form.mobile_number)
  );

  return (
    <Panel title="Where people are paid" action={
      <button className={ghostButtonClass} onClick={() => setShowForm(v => !v)}>
        {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {showForm ? "Close" : "Add or change"}
      </button>
    }>
      <p className="text-xs text-slate mb-3">
        One account per currency. A change never overwrites: the old account is ended and kept. Only finance managers and
        executives can change these, and recent changes are flagged on the next bank file.
      </p>
      {showForm && (
        <div className="border border-ink-mid p-3 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="block md:col-span-2">
            <span className={labelClass}>Employee</span>
            <select className={inputClass} value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })}>
              <option value="">Choose…</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.employee_name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Currency</span>
            <select className={inputClass} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
              <option value="USD">USD</option>
              <option value="ZWG">ZWG</option>
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Paid by</span>
            <select className={inputClass} value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {form.method === "bank" && (
            <>
              <label className="block"><span className={labelClass}>Bank</span><input className={inputClass} value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} /></label>
              <label className="block"><span className={labelClass}>Branch code</span><input className={inputClass} value={form.branch_code} onChange={e => setForm({ ...form, branch_code: e.target.value })} /></label>
              <label className="block"><span className={labelClass}>Account number</span><input className={inputClass} value={form.account_number} onChange={e => setForm({ ...form, account_number: e.target.value })} /></label>
              <label className="block"><span className={labelClass}>Account name</span><input className={inputClass} placeholder="As the bank has it" value={form.account_name} onChange={e => setForm({ ...form, account_name: e.target.value })} /></label>
            </>
          )}
          {form.method === "mobile_money" && (
            <label className="block md:col-span-2"><span className={labelClass}>Wallet number</span><input className={inputClass} value={form.mobile_number} onChange={e => setForm({ ...form, mobile_number: e.target.value })} /></label>
          )}
          <div className="md:col-span-4 flex justify-end">
            <button className={buttonClass} disabled={busy || !valid} onClick={save}>Save payment details</button>
          </div>
        </div>
      )}

      {missing.length > 0 && (
        <Warnings items={[`No payment account yet: ${missing.slice(0, 12).map(e => e.employee_name).join(", ")}${missing.length > 12 ? ` and ${missing.length - 12} more` : ""}.`]} />
      )}

      <div className="flex justify-end my-3">
        <input className={`${inputClass} md:max-w-xs`} placeholder="Filter by name" value={filter} onChange={e => setFilter(e.target.value)} />
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={Landmark} title="No payment accounts" subtitle="Add where each employee is paid before producing a bank file." compact />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] font-mono uppercase text-slate border-b border-ink-mid">
              <tr><th className="p-2">Employee</th><th className="p-2">Currency</th><th className="p-2">Paid by</th><th className="p-2">Bank / wallet</th><th className="p-2">Account</th><th className="p-2">Since</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {shown.map(a => (
                <tr key={a.id} className="border-b border-ink-mid/50">
                  <td className="p-2 text-paper">{a.employee_name}</td>
                  <td className="p-2 text-slate-light">{a.currency}</td>
                  <td className="p-2 text-slate-light">{METHOD_LABEL[a.method] || a.method}</td>
                  <td className="p-2 text-slate-light">{a.method === "bank" ? `${a.bank_name}${a.branch_code ? ` · ${a.branch_code}` : ""}` : a.method === "mobile_money" ? a.mobile_number : "—"}</td>
                  <td className="p-2 font-mono text-slate-light">{a.account_number || "—"}</td>
                  <td className="p-2 text-slate-light">{a.effective_from}{a.created_by_name ? ` · ${a.created_by_name}` : ""}</td>
                  <td className="p-2 text-right">
                    {ending && ending.id === a.id ? (
                      <span className="inline-flex gap-2 items-center">
                        <input className={`${inputClass} w-48`} placeholder="Reason" value={ending.reason} onChange={e => setEnding({ id: a.id, reason: e.target.value })} />
                        <button className={ghostButtonClass} disabled={busy || ending.reason.trim().length < 5} onClick={end}>End</button>
                        <button className="text-slate hover:text-paper" onClick={() => setEnding(null)} aria-label="Cancel"><X className="h-4 w-4" /></button>
                      </span>
                    ) : (
                      <button className="text-xs text-slate hover:text-paper" onClick={() => setEnding({ id: a.id, reason: "" })}>End</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

type LayoutDraft = { id?: string; kind: ExportKind; name: string; delimiter: string; include_header: boolean; date_format: string; columns: ExportColumn[] };

function LayoutsSection({ layouts, fields, busy, setBusy, notify, onChanged }: SectionProps & {
  layouts: ExportLayout[]; fields: ExportFields | null; onChanged: () => void;
}) {
  const [draft, setDraft] = useState<LayoutDraft | null>(null);

  const startFrom = (layout: ExportLayout, copy: boolean) => setDraft({
    id: copy ? undefined : layout.id,
    kind: layout.kind,
    name: copy ? `${layout.name} (copy)` : layout.name,
    delimiter: layout.delimiter,
    include_header: layout.include_header,
    date_format: layout.date_format,
    columns: layout.columns.map(c => ({ ...c })),
  });

  const move = (i: number, d: -1 | 1) => {
    if (!draft) return;
    const cols = [...draft.columns];
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    setDraft({ ...draft, columns: cols });
  };
  const setCol = (i: number, patch: Partial<ExportColumn>) => {
    if (!draft) return;
    setDraft({ ...draft, columns: draft.columns.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const body = { name: draft.name, delimiter: draft.delimiter, include_header: draft.include_header, date_format: draft.date_format, columns: draft.columns };
      if (draft.id) await updateExportLayout(draft.id, body);
      else await createExportLayout({ ...body, kind: draft.kind });
      notify(`Layout "${draft.name}" saved.`);
      setDraft(null);
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Layout could not be saved.", "error");
    } finally {
      setBusy(false);
    }
  };

  const retire = async (layout: ExportLayout) => {
    setBusy(true);
    try {
      await deleteExportLayout(layout.id);
      notify(`Layout "${layout.name}" retired.`);
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Layout could not be retired.", "error");
    } finally {
      setBusy(false);
    }
  };

  const kindFields = draft && fields ? fields.fields[draft.kind] : [];

  return (
    <Panel title="File layouts" action={<FileSpreadsheet className="h-4 w-4 text-slate" />}>
      <p className="text-xs text-slate mb-3">
        ZIMRA, NSSA and each bank set their own upload templates. Copy a built-in layout and match its columns, headers,
        separator and date format to the template you were given.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] font-mono uppercase text-slate border-b border-ink-mid">
            <tr><th className="p-2">Layout</th><th className="p-2">For</th><th className="p-2">Columns</th><th className="p-2">Format</th><th className="p-2" /></tr>
          </thead>
          <tbody>
            {layouts.map(l => (
              <tr key={l.id} className="border-b border-ink-mid/50">
                <td className="p-2 text-paper">{l.name}{l.is_builtin && <span className="ml-2 text-[10px] font-mono uppercase text-slate">built-in</span>}</td>
                <td className="p-2 text-slate-light">{KIND_LABEL[l.kind]}</td>
                <td className="p-2 text-slate-light">{l.columns.length}</td>
                <td className="p-2 text-slate-light">{l.delimiter === "tab" ? "tab" : `"${l.delimiter}"`} · {l.date_format}{l.include_header ? "" : " · no header"}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  <button className="text-xs text-slate hover:text-paper mr-3 inline-flex items-center gap-1" onClick={() => startFrom(l, true)}><Copy className="h-3.5 w-3.5" />Copy</button>
                  {!l.is_builtin && (
                    <>
                      <button className="text-xs text-slate hover:text-paper mr-3" onClick={() => startFrom(l, false)}>Edit</button>
                      <button className="text-xs text-slate hover:text-red-300 inline-flex items-center gap-1" disabled={busy} onClick={() => retire(l)}><Trash2 className="h-3.5 w-3.5" />Retire</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="border border-ink-mid p-3 mt-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="block md:col-span-2"><span className={labelClass}>Name ({KIND_LABEL[draft.kind]})</span><input className={inputClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="block">
              <span className={labelClass}>Separator</span>
              <select className={inputClass} value={draft.delimiter} onChange={e => setDraft({ ...draft, delimiter: e.target.value })}>
                {(fields?.delimiters || [",", ";", "|", "tab"]).map(d => <option key={d} value={d}>{d === "tab" ? "Tab" : d}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Dates</span>
              <select className={inputClass} value={draft.date_format} onChange={e => setDraft({ ...draft, date_format: e.target.value })}>
                {(fields?.date_formats || []).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-paper">
            <input type="checkbox" checked={draft.include_header} onChange={e => setDraft({ ...draft, include_header: e.target.checked })} />
            First row is column headings
          </label>
          <div className="space-y-2">
            {draft.columns.map((c, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <span className="col-span-1 text-xs text-slate tabular-nums">{i + 1}</span>
                <select className={`${inputClass} col-span-4`} value={c.field} onChange={e => setCol(i, { field: e.target.value })}>
                  <option value="constant">Fixed text…</option>
                  {kindFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                {c.field === "constant" ? (
                  <input className={`${inputClass} col-span-2`} placeholder="Text" value={c.value || ""} onChange={e => setCol(i, { value: e.target.value })} />
                ) : <span className="col-span-2" />}
                <input className={`${inputClass} col-span-3`} placeholder="Column heading" value={c.header || ""} onChange={e => setCol(i, { header: e.target.value })} />
                <span className="col-span-2 flex gap-2 justify-end">
                  <button className="text-slate hover:text-paper" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
                  <button className="text-slate hover:text-paper" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
                  <button className="text-slate hover:text-red-300" onClick={() => setDraft({ ...draft, columns: draft.columns.filter((_, k) => k !== i) })} aria-label="Remove"><X className="h-4 w-4" /></button>
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-between">
            <button className={ghostButtonClass} onClick={() => setDraft({ ...draft, columns: [...draft.columns, { field: kindFields[0]?.key || "constant", header: "" }] })}>
              <Plus className="h-4 w-4" /> Add column
            </button>
            <span className="flex gap-2">
              <button className={ghostButtonClass} onClick={() => setDraft(null)}>Cancel</button>
              <button className={buttonClass} disabled={busy || !draft.name.trim() || !draft.columns.length} onClick={save}>Save layout</button>
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Export log
// ---------------------------------------------------------------------------

function ExportLogSection({ rows, onRefresh }: { rows: RecordData[]; onRefresh: () => void }) {
  return (
    <Panel title="Files produced" action={
      <button className="text-slate hover:text-paper" onClick={onRefresh} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></button>
    }>
      {rows.length === 0 ? (
        <EmptyState icon={History} title="No files yet" subtitle="Every bank file and schedule produced is logged here." compact />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] font-mono uppercase text-slate border-b border-ink-mid">
              <tr><th className="p-2">When</th><th className="p-2">File</th><th className="p-2">For</th><th className="p-2 text-right">Rows</th><th className="p-2 text-right">Total</th><th className="p-2">By</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-ink-mid/50">
                  <td className="p-2 text-slate-light whitespace-nowrap">{new Date(r.generated_at).toLocaleString()}</td>
                  <td className="p-2 text-paper">{r.file_name}<div className="text-[11px] text-slate">{r.layout_name}</div></td>
                  <td className="p-2 text-slate-light">{KIND_LABEL[r.kind as ExportKind]} · {r.run_number || (r.period_month || "").slice(0, 7)}</td>
                  <td className="p-2 text-right tabular-nums">{r.row_count}</td>
                  <td className="p-2 text-right tabular-nums">{money(r.total_amount, r.currency, 2)}</td>
                  <td className="p-2 text-slate-light">{r.generated_by_name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
