"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Banknote, CheckCircle2, CreditCard, Loader2, Plus, RefreshCw, Users } from "lucide-react";
import {
  allocateFinanceReceipt,
  createFinanceCashAccount,
  createFinancePayrollRun,
  decideFinancePayrollRun,
  getFinanceCashAccounts,
  getFinanceCashbook,
  getFinancePayrollProfiles,
  getFinancePayrollRuns,
  getFinanceProgressClaims,
  getFinanceSupplierPayments,
  getHREmployees,
  getProcurementInvoices,
  postFinanceCashbookTransaction,
  postFinancePayrollRun,
  postFinanceSupplierPaymentBatch,
  upsertFinancePayrollProfile,
} from "@/lib/api";

type RecordData = Record<string, any>;
type OpsTab = "cash-accounts" | "cashbook" | "supplier-payments" | "payroll" | "banking";

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";

export function FinanceOperationsPanel({ tab, projects }: { tab: OpsTab; projects: RecordData[] }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<RecordData[]>([]);
  const [cashbook, setCashbook] = useState<RecordData[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<RecordData[]>([]);
  const [supplierInvoices, setSupplierInvoices] = useState<RecordData[]>([]);
  const [employees, setEmployees] = useState<RecordData[]>([]);
  const [payProfiles, setPayProfiles] = useState<RecordData[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<RecordData[]>([]);

  const [cashAccount, setCashAccount] = useState({ account_code: "", account_name: "", account_type: "bank", bank_name: "", account_number: "", currency: "USD", opening_balance: "0" });
  const [cashTx, setCashTx] = useState({ cash_account_id: "", transaction_date: today(), transaction_type: "receipt", project_id: "", counterparty_name: "", payment_method: "bank_transfer", reference: "", description: "", amount: "0", currency: "USD" });
  const [receipt, setReceipt] = useState({ cash_account_id: "", progress_claim_id: "", transaction_date: today(), amount: "0", reference: "", counterparty_name: "" });
  const [supplierBatch, setSupplierBatch] = useState({ cash_account_id: "", payment_date: today(), supplier_invoice_ids: [] as string[], payment_method: "bank_transfer", reference: "", notes: "" });
  const [payProfile, setPayProfile] = useState({ employee_id: "", pay_type: "monthly_salary", base_rate: "0", overtime_rate: "0", currency: "USD", bank_name: "", bank_account_number: "", tax_number: "", nssa_number: "" });
  const [payrollRun, setPayrollRun] = useState({ period_start: today(), period_end: today(), payment_date: today(), cash_account_id: "", project_id: "" });
  const [claims, setClaims] = useState<RecordData[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [accountRes, cashbookRes, paymentsRes, invoicesRes, employeeRes, profileRes, runRes, claimsRes] = await Promise.allSettled([
      getFinanceCashAccounts(),
      getFinanceCashbook(),
      getFinanceSupplierPayments(),
      getProcurementInvoices({ status: "approved", match_status: "all" }),
      getHREmployees({ status: "active" }),
      getFinancePayrollProfiles(),
      getFinancePayrollRuns(),
      getFinanceProgressClaims(),
    ]);
    if (accountRes.status === "fulfilled") setAccounts(accountRes.value.data || []);
    if (cashbookRes.status === "fulfilled") setCashbook(cashbookRes.value.data || []);
    if (paymentsRes.status === "fulfilled") setSupplierPayments(paymentsRes.value.data || []);
    if (invoicesRes.status === "fulfilled") setSupplierInvoices((invoicesRes.value.data || []).filter((i: RecordData) => i.status !== "paid"));
    if (employeeRes.status === "fulfilled") setEmployees(employeeRes.value.data || []);
    if (profileRes.status === "fulfilled") setPayProfiles(profileRes.value.data || []);
    if (runRes.status === "fulfilled") setPayrollRuns(runRes.value.data || []);
    if (claimsRes.status === "fulfilled") setClaims((claimsRes.value.data || []).filter((c: RecordData) => ["certified", "submitted"].includes(String(c.status || "").toLowerCase())));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totalCash = useMemo(() => accounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0), [accounts]);
  const payableTotal = useMemo(() => supplierInvoices.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0), [supplierInvoices]);
  const payrollDraftTotal = useMemo(() => payrollRuns.filter(run => run.status !== "posted").reduce((sum, run) => sum + Number(run.net_pay || 0), 0), [payrollRuns]);

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await loadData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Finance operation failed.");
    } finally {
      setBusy(false);
    }
  };

  const createAccount = (event: React.FormEvent) => {
    event.preventDefault();
    void runAction(() => createFinanceCashAccount({ ...cashAccount, opening_balance: Number(cashAccount.opening_balance) }), "Cash account created.");
  };

  const postCashbook = (event: React.FormEvent) => {
    event.preventDefault();
    void runAction(() => postFinanceCashbookTransaction({ ...cashTx, project_id: cashTx.project_id || null, amount: Number(cashTx.amount) }), "Cashbook transaction posted.");
  };

  const allocateReceipt = (event: React.FormEvent) => {
    event.preventDefault();
    void runAction(() => allocateFinanceReceipt({ ...receipt, amount: Number(receipt.amount) }), "Receipt allocated to claim.");
  };

  const paySuppliers = (event: React.FormEvent) => {
    event.preventDefault();
    void runAction(() => postFinanceSupplierPaymentBatch(supplierBatch), "Supplier payment batch posted.");
  };

  const savePayProfile = (event: React.FormEvent) => {
    event.preventDefault();
    void runAction(() => upsertFinancePayrollProfile({ ...payProfile, base_rate: Number(payProfile.base_rate), overtime_rate: Number(payProfile.overtime_rate) }), "Payroll profile saved.");
  };

  const createRun = (event: React.FormEvent) => {
    event.preventDefault();
    void runAction(() => createFinancePayrollRun({ ...payrollRun, cash_account_id: payrollRun.cash_account_id || null, project_id: payrollRun.project_id || null }), "Payroll run created.");
  };

  if (loading) {
    return <div className="bg-ink-light border border-ink-mid rounded-sm p-8 flex items-center gap-3 text-slate"><Loader2 className="h-4 w-4 animate-spin" />Loading finance operations...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Metric icon={Banknote} label="Cash on hand" value={money(totalCash)} />
        <Metric icon={CreditCard} label="Approved payables" value={money(payableTotal)} />
        <Metric icon={Users} label="Open payroll" value={money(payrollDraftTotal)} />
      </div>

      {notice && <div className="border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-paper">{notice}</div>}

      {(tab === "cash-accounts" || tab === "banking") && (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Panel title="Cash Accounts">
            <form onSubmit={createAccount} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <input className={inputClass} placeholder="Code" value={cashAccount.account_code} onChange={e => setCashAccount({ ...cashAccount, account_code: e.target.value })} required />
              <input className={inputClass} placeholder="Account name" value={cashAccount.account_name} onChange={e => setCashAccount({ ...cashAccount, account_name: e.target.value })} required />
              <select className={inputClass} value={cashAccount.account_type} onChange={e => setCashAccount({ ...cashAccount, account_type: e.target.value })}><option value="bank">Bank</option><option value="cash">Cash</option><option value="mobile_money">Mobile money</option></select>
              <input className={inputClass} placeholder="Opening balance" value={cashAccount.opening_balance} onChange={e => setCashAccount({ ...cashAccount, opening_balance: e.target.value })} />
              <input className={inputClass} placeholder="Bank" value={cashAccount.bank_name} onChange={e => setCashAccount({ ...cashAccount, bank_name: e.target.value })} />
              <input className={inputClass} placeholder="Account number" value={cashAccount.account_number} onChange={e => setCashAccount({ ...cashAccount, account_number: e.target.value })} />
              <button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" />Create Account</button>
            </form>
            <SimpleTable rows={accounts} columns={["account_code", "account_name", "account_type", "current_balance"]} />
          </Panel>
          <Panel title="Cashbook Posting">
            <CashbookForm accounts={accounts} projects={projects} cashTx={cashTx} setCashTx={setCashTx} onSubmit={postCashbook} busy={busy} />
          </Panel>
        </section>
      )}

      {tab === "cashbook" && (
        <section className="space-y-6">
          <Panel title="Allocate Client Receipt">
            <form onSubmit={allocateReceipt} className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <SelectAccount accounts={accounts} value={receipt.cash_account_id} onChange={v => setReceipt({ ...receipt, cash_account_id: v })} />
              <select className={inputClass} value={receipt.progress_claim_id} onChange={e => setReceipt({ ...receipt, progress_claim_id: e.target.value })} required><option value="">Claim</option>{claims.map(c => <option key={c.id} value={c.id}>{c.claim_number || c.project_name} - {money(c.this_claim_amount)}</option>)}</select>
              <input className={inputClass} type="date" value={receipt.transaction_date} onChange={e => setReceipt({ ...receipt, transaction_date: e.target.value })} />
              <input className={inputClass} placeholder="Amount" value={receipt.amount} onChange={e => setReceipt({ ...receipt, amount: e.target.value })} />
              <input className={inputClass} placeholder="Reference" value={receipt.reference} onChange={e => setReceipt({ ...receipt, reference: e.target.value })} />
              <input className={inputClass} placeholder="Client" value={receipt.counterparty_name} onChange={e => setReceipt({ ...receipt, counterparty_name: e.target.value })} />
              <button disabled={busy} className={buttonClass}><BadgeCheck className="h-4 w-4" />Allocate Receipt</button>
            </form>
          </Panel>
          <Panel title="Cashbook Ledger"><SimpleTable rows={cashbook} columns={["transaction_date", "transaction_number", "transaction_type", "counterparty_name", "amount", "current_balance"]} /></Panel>
        </section>
      )}

      {tab === "supplier-payments" && (
        <Panel title="Supplier Payment Run">
          <form onSubmit={paySuppliers} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <SelectAccount accounts={accounts} value={supplierBatch.cash_account_id} onChange={v => setSupplierBatch({ ...supplierBatch, cash_account_id: v })} />
            <input className={inputClass} type="date" value={supplierBatch.payment_date} onChange={e => setSupplierBatch({ ...supplierBatch, payment_date: e.target.value })} />
            <input className={inputClass} placeholder="Reference" value={supplierBatch.reference} onChange={e => setSupplierBatch({ ...supplierBatch, reference: e.target.value })} />
            <select multiple className={`${inputClass} md:col-span-2 h-36`} value={supplierBatch.supplier_invoice_ids} onChange={e => setSupplierBatch({ ...supplierBatch, supplier_invoice_ids: Array.from(e.target.selectedOptions).map(o => o.value) })} required>{supplierInvoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} - {i.supplier_name} - {money(i.total_amount)}</option>)}</select>
            <button disabled={busy || supplierBatch.supplier_invoice_ids.length === 0} className={buttonClass}><CheckCircle2 className="h-4 w-4" />Post Supplier Payments</button>
          </form>
          <SimpleTable rows={supplierPayments} columns={["batch_number", "payment_date", "account_name", "total_amount", "invoice_count", "status"]} />
        </Panel>
      )}

      {tab === "payroll" && (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Panel title="Payroll Profiles">
            <form onSubmit={savePayProfile} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <select className={inputClass} value={payProfile.employee_id} onChange={e => setPayProfile({ ...payProfile, employee_id: e.target.value })} required><option value="">Employee</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name || e.name}</option>)}</select>
              <select className={inputClass} value={payProfile.pay_type} onChange={e => setPayProfile({ ...payProfile, pay_type: e.target.value })}><option value="monthly_salary">Monthly</option><option value="hourly">Hourly</option><option value="daily">Daily</option></select>
              <input className={inputClass} placeholder="Base rate" value={payProfile.base_rate} onChange={e => setPayProfile({ ...payProfile, base_rate: e.target.value })} />
              <input className={inputClass} placeholder="Overtime rate" value={payProfile.overtime_rate} onChange={e => setPayProfile({ ...payProfile, overtime_rate: e.target.value })} />
              <input className={inputClass} placeholder="Bank" value={payProfile.bank_name} onChange={e => setPayProfile({ ...payProfile, bank_name: e.target.value })} />
              <input className={inputClass} placeholder="Bank account" value={payProfile.bank_account_number} onChange={e => setPayProfile({ ...payProfile, bank_account_number: e.target.value })} />
              <button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" />Save Profile</button>
            </form>
            <SimpleTable rows={payProfiles} columns={["employee_number", "full_name", "pay_type", "base_rate", "bank_name"]} />
          </Panel>
          <Panel title="Payroll Runs">
            <form onSubmit={createRun} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <input className={inputClass} type="date" value={payrollRun.period_start} onChange={e => setPayrollRun({ ...payrollRun, period_start: e.target.value })} />
              <input className={inputClass} type="date" value={payrollRun.period_end} onChange={e => setPayrollRun({ ...payrollRun, period_end: e.target.value })} />
              <input className={inputClass} type="date" value={payrollRun.payment_date} onChange={e => setPayrollRun({ ...payrollRun, payment_date: e.target.value })} />
              <SelectAccount accounts={accounts} value={payrollRun.cash_account_id} onChange={v => setPayrollRun({ ...payrollRun, cash_account_id: v })} />
              <select className={inputClass} value={payrollRun.project_id} onChange={e => setPayrollRun({ ...payrollRun, project_id: e.target.value })}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" />Create Run</button>
            </form>
            <div className="space-y-2">
              {payrollRuns.map(run => <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 border border-ink-mid bg-ink/30 px-3 py-2 text-sm"><span className="text-paper">{run.run_number} {money(run.net_pay)} <span className="text-slate">{run.status}</span></span><div className="flex gap-2">{run.status === "draft" && <button className="text-xs text-signal" onClick={() => void runAction(() => decideFinancePayrollRun(run.id, "approved"), "Payroll run approved.")}>Approve</button>}{run.status === "approved" && <button className="text-xs text-signal" onClick={() => void runAction(() => postFinancePayrollRun(run.id), "Payroll posted.")}>Post</button>}</div></div>)}
            </div>
          </Panel>
        </section>
      )}

      <button onClick={() => void loadData()} className="inline-flex items-center gap-2 text-xs text-slate hover:text-paper"><RefreshCw className="h-3 w-3" />Refresh operations</button>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return <div className="bg-ink-light border border-ink-mid rounded-sm p-4"><div className="flex items-center gap-2 text-slate text-xs font-mono uppercase"><Icon className="h-4 w-4" />{label}</div><div className="mt-2 text-xl font-semibold text-paper">{value}</div></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden"><div className="border-b border-ink-mid px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate">{title}</div><div className="p-4">{children}</div></div>;
}

function SelectAccount({ accounts, value, onChange }: { accounts: RecordData[]; value: string; onChange: (value: string) => void }) {
  return <select className={inputClass} value={value} onChange={e => onChange(e.target.value)} required><option value="">Cash account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.account_name} - {money(account.current_balance)}</option>)}</select>;
}

function CashbookForm({ accounts, projects, cashTx, setCashTx, onSubmit, busy }: { accounts: RecordData[]; projects: RecordData[]; cashTx: RecordData; setCashTx: (value: any) => void; onSubmit: (event: React.FormEvent) => void; busy: boolean }) {
  return <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3"><SelectAccount accounts={accounts} value={cashTx.cash_account_id} onChange={v => setCashTx({ ...cashTx, cash_account_id: v })} /><input className={inputClass} type="date" value={cashTx.transaction_date} onChange={e => setCashTx({ ...cashTx, transaction_date: e.target.value })} /><select className={inputClass} value={cashTx.transaction_type} onChange={e => setCashTx({ ...cashTx, transaction_type: e.target.value })}><option value="receipt">Receipt</option><option value="payment">Payment</option><option value="transfer_in">Transfer in</option><option value="transfer_out">Transfer out</option><option value="bank_charge">Bank charge</option><option value="adjustment">Adjustment</option></select><select className={inputClass} value={cashTx.project_id} onChange={e => setCashTx({ ...cashTx, project_id: e.target.value })}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><input className={inputClass} placeholder="Counterparty" value={cashTx.counterparty_name} onChange={e => setCashTx({ ...cashTx, counterparty_name: e.target.value })} /><input className={inputClass} placeholder="Reference" value={cashTx.reference} onChange={e => setCashTx({ ...cashTx, reference: e.target.value })} /><input className={inputClass} placeholder="Amount" value={cashTx.amount} onChange={e => setCashTx({ ...cashTx, amount: e.target.value })} /><input className={inputClass} placeholder="Description" value={cashTx.description} onChange={e => setCashTx({ ...cashTx, description: e.target.value })} required /><button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" />Post Transaction</button></form>;
}

function SimpleTable({ rows, columns }: { rows: RecordData[]; columns: string[] }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-ink-mid text-slate uppercase font-mono">{columns.map(col => <th key={col} className="p-2">{col.replaceAll("_", " ")}</th>)}</tr></thead><tbody className="divide-y divide-ink-mid">{rows.length === 0 ? <tr><td className="p-3 text-slate" colSpan={columns.length}>No records.</td></tr> : rows.slice(0, 20).map((row, index) => <tr key={row.id || index}>{columns.map(col => <td key={col} className="p-2 text-paper">{col.includes("amount") || col.includes("balance") || col.includes("rate") || col === "net_pay" ? money(row[col]) : String(row[col] ?? "-")}</td>)}</tr>)}</tbody></table></div>;
}




