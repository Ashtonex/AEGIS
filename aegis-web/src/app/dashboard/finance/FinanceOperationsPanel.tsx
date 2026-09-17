"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Banknote, Check, CheckCircle2, CreditCard, Loader2, LockOpen, Plus, RefreshCw, Upload, Users, X } from "lucide-react";
import {
  allocateFinanceReceipt,
  confirmBankStatementMatch,
  createCashbookEntryFromBankLine,
  createFinanceCashAccount,
  getBankStatementImports,
  getBankStatementLines,
  getFinanceCashAccounts,
  getFinanceCashbook,
  getFinanceProgressClaims,
  getFinanceSupplierPayments,
  getPayrollRuns,
  getProcurementInvoices,
  postFinanceCashbookTransaction,
  postFinanceSupplierPaymentBatch,
  rejectBankStatementMatch,
  reopenBankStatementMatch,
  runBankStatementMatching,
  uploadBankStatementImport,
} from "@/lib/api";

type RecordData = Record<string, any>;
type OpsTab = "cash-accounts" | "cashbook" | "supplier-payments" | "banking";

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";

export function FinanceOperationsPanel({ tab, projects, departmentId = "" }: { tab: OpsTab; projects: RecordData[]; departmentId?: string }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<RecordData[]>([]);
  const [cashbook, setCashbook] = useState<RecordData[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<RecordData[]>([]);
  const [supplierInvoices, setSupplierInvoices] = useState<RecordData[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<RecordData[]>([]);

  const [cashAccount, setCashAccount] = useState({ account_code: "", account_name: "", account_type: "bank", bank_name: "", account_number: "", currency: "USD", opening_balance: "0" });
  const [cashTx, setCashTx] = useState({ cash_account_id: "", transaction_date: today(), transaction_type: "receipt", project_id: "", counterparty_name: "", payment_method: "bank_transfer", reference: "", description: "", amount: "0", currency: "USD" });
  const [receipt, setReceipt] = useState({ cash_account_id: "", progress_claim_id: "", transaction_date: today(), amount: "0", reference: "", counterparty_name: "" });
  const [supplierBatch, setSupplierBatch] = useState({ cash_account_id: "", payment_date: today(), supplier_invoice_ids: [] as string[], payment_method: "bank_transfer", reference: "", notes: "" });
  const [claims, setClaims] = useState<RecordData[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [accountRes, cashbookRes, paymentsRes, invoicesRes, runRes, claimsRes] = await Promise.allSettled([
      getFinanceCashAccounts(),
      getFinanceCashbook({ department_id: departmentId || undefined }),
      getFinanceSupplierPayments({ department_id: departmentId || undefined }),
      getProcurementInvoices({ status: "approved", match_status: "all" }),
      getPayrollRuns({ department_id: departmentId || undefined }),
      getFinanceProgressClaims({ department_id: departmentId || undefined }),
    ]);
    if (accountRes.status === "fulfilled") setAccounts(accountRes.value.data || []);
    if (cashbookRes.status === "fulfilled") setCashbook(cashbookRes.value.data || []);
    if (paymentsRes.status === "fulfilled") setSupplierPayments(paymentsRes.value.data || []);
    if (invoicesRes.status === "fulfilled") setSupplierInvoices((invoicesRes.value.data || []).filter((i: RecordData) => i.status !== "paid"));
    if (runRes.status === "fulfilled") setPayrollRuns(runRes.value.data || []);
    if (claimsRes.status === "fulfilled") setClaims((claimsRes.value.data || []).filter((c: RecordData) => ["certified", "submitted"].includes(String(c.status || "").toLowerCase())));
    setLoading(false);
  }, [departmentId]);

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

  if (loading) {
    return <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-8 flex items-center gap-3 text-slate"><Loader2 className="h-4 w-4 animate-spin" />Loading finance operations...</div>;
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

      {tab === "banking" && <ReconciliationPanel accounts={accounts} />}

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

      <button onClick={() => void loadData()} className="inline-flex items-center gap-2 text-xs text-slate hover:text-paper"><RefreshCw className="h-3 w-3" />Refresh operations</button>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-4"><div className="flex items-center gap-2 text-slate text-xs font-mono uppercase"><Icon className="h-4 w-4" />{label}</div><div className="mt-2 text-xl font-semibold text-paper">{value}</div></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden"><div className="border-b border-ink-mid px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate">{title}</div><div className="p-4">{children}</div></div>;
}

function SelectAccount({ accounts, value, onChange }: { accounts: RecordData[]; value: string; onChange: (value: string) => void }) {
  return <select className={inputClass} value={value} onChange={e => onChange(e.target.value)} required><option value="">Cash account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.account_name} - {money(account.current_balance)}</option>)}</select>;
}

function CashbookForm({ accounts, projects, cashTx, setCashTx, onSubmit, busy }: { accounts: RecordData[]; projects: RecordData[]; cashTx: RecordData; setCashTx: (value: any) => void; onSubmit: (event: React.FormEvent) => void; busy: boolean }) {
  return <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3"><SelectAccount accounts={accounts} value={cashTx.cash_account_id} onChange={v => setCashTx({ ...cashTx, cash_account_id: v })} /><input className={inputClass} type="date" value={cashTx.transaction_date} onChange={e => setCashTx({ ...cashTx, transaction_date: e.target.value })} /><select className={inputClass} value={cashTx.transaction_type} onChange={e => setCashTx({ ...cashTx, transaction_type: e.target.value })}><option value="receipt">Receipt</option><option value="payment">Payment</option><option value="transfer_in">Transfer in</option><option value="transfer_out">Transfer out</option><option value="bank_charge">Bank charge</option><option value="adjustment">Adjustment</option></select><select className={inputClass} value={cashTx.project_id} onChange={e => setCashTx({ ...cashTx, project_id: e.target.value })}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><input className={inputClass} placeholder="Counterparty" value={cashTx.counterparty_name} onChange={e => setCashTx({ ...cashTx, counterparty_name: e.target.value })} /><input className={inputClass} placeholder="Reference" value={cashTx.reference} onChange={e => setCashTx({ ...cashTx, reference: e.target.value })} /><input className={inputClass} placeholder="Amount" value={cashTx.amount} onChange={e => setCashTx({ ...cashTx, amount: e.target.value })} /><input className={inputClass} placeholder="Description" value={cashTx.description} onChange={e => setCashTx({ ...cashTx, description: e.target.value })} required /><button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" />Post Transaction</button></form>;
}

const MATCH_STATUS_CLASS: Record<string, string> = {
  unmatched: "border-slate-500/30 bg-slate-950/20 text-slate-300",
  suggested: "border-amber-500/30 bg-amber-950/20 text-amber-300",
  matched: "border-emerald-500/30 bg-emerald-950/20 text-emerald-300",
  duplicate: "border-red-500/30 bg-red-950/20 text-red-300",
  difference: "border-amber-500/30 bg-amber-950/20 text-amber-300",
};

function ReconciliationPanel({ accounts }: { accounts: RecordData[] }) {
  const [imports, setImports] = useState<RecordData[]>([]);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [lines, setLines] = useState<RecordData[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadForm, setUploadForm] = useState({ cash_account_id: "", date: "Date", description: "Description", amount: "Amount" });
  const [file, setFile] = useState<File | null>(null);

  const loadImports = useCallback(async () => {
    try {
      const res = await getBankStatementImports();
      setImports(res.data || []);
    } catch {
      setImports([]);
    }
  }, []);

  const loadLines = useCallback(async (importId: string) => {
    try {
      const res = await getBankStatementLines(importId);
      setLines(res.data || []);
    } catch {
      setLines([]);
    }
  }, []);

  useEffect(() => { void loadImports(); }, [loadImports]);
  useEffect(() => { if (selectedImportId) void loadLines(selectedImportId); }, [selectedImportId, loadLines]);

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !uploadForm.cash_account_id) {
      setNotice("Select a cash account and a CSV file.");
      return;
    }
    setBusy(true);
    try {
      const res = await uploadBankStatementImport({
        cashAccountId: uploadForm.cash_account_id,
        file,
        columnMapping: { date: uploadForm.date, description: uploadForm.description, amount: uploadForm.amount },
      });
      setNotice(`Imported ${res.data.total_lines} lines.`);
      setFile(null);
      await loadImports();
      setSelectedImportId(res.data.import_id);
    } catch (err: any) {
      setNotice(err?.message || "Failed to upload bank statement.");
    } finally {
      setBusy(false);
    }
  };

  const handleRunMatching = async (importId: string) => {
    setBusy(true);
    try {
      const res = await runBankStatementMatching(importId);
      setNotice(`Matching complete: ${res.data.matched} matched, ${res.data.suggested} suggested, ${res.data.unmatched} unmatched, ${res.data.duplicate} duplicate.`);
      await loadImports();
      await loadLines(importId);
    } catch (err: any) {
      setNotice(err?.message || "Failed to run matching.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (line: RecordData) => {
    if (!line.matched_cashbook_transaction_id) return;
    setBusy(true);
    try {
      await confirmBankStatementMatch(line.id, line.matched_cashbook_transaction_id);
      setNotice("Match confirmed.");
      if (selectedImportId) await loadLines(selectedImportId);
    } catch (err: any) {
      setNotice(err?.message || "Failed to confirm match.");
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (line: RecordData) => {
    setBusy(true);
    try {
      await rejectBankStatementMatch(line.id);
      setNotice("Match rejected - back to unmatched.");
      if (selectedImportId) await loadLines(selectedImportId);
    } catch (err: any) {
      setNotice(err?.message || "Failed to reject match.");
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async (line: RecordData) => {
    const reason = window.prompt("Reason for reopening this confirmed match (required):");
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      await reopenBankStatementMatch(line.id, reason);
      setNotice("Match reopened.");
      if (selectedImportId) await loadLines(selectedImportId);
    } catch (err: any) {
      setNotice(err?.message || "Failed to reopen match.");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateEntry = async (line: RecordData) => {
    const transactionType = Number(line.amount) > 0 ? "receipt" : "payment";
    setBusy(true);
    try {
      await createCashbookEntryFromBankLine(line.id, { transaction_type: transactionType, description: line.description });
      setNotice("Cashbook entry created from bank statement line.");
      if (selectedImportId) await loadLines(selectedImportId);
    } catch (err: any) {
      setNotice(err?.message || "Failed to create cashbook entry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-6">
      {notice && (
        <div className="border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-paper flex justify-between items-center">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper">&times;</button>
        </div>
      )}

      <Panel title="Upload Bank Statement (CSV)">
        <form onSubmit={handleUpload} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SelectAccount accounts={accounts} value={uploadForm.cash_account_id} onChange={v => setUploadForm({ ...uploadForm, cash_account_id: v })} />
          <input type="file" accept=".csv" className={inputClass} onChange={e => setFile(e.target.files?.[0] || null)} required />
          <button disabled={busy} className={buttonClass}><Upload className="h-4 w-4" />Upload &amp; Parse</button>
          <input className={inputClass} placeholder="Date column header" value={uploadForm.date} onChange={e => setUploadForm({ ...uploadForm, date: e.target.value })} />
          <input className={inputClass} placeholder="Description column header" value={uploadForm.description} onChange={e => setUploadForm({ ...uploadForm, description: e.target.value })} />
          <input className={inputClass} placeholder="Amount column header" value={uploadForm.amount} onChange={e => setUploadForm({ ...uploadForm, amount: e.target.value })} />
        </form>
        <p className="text-xs text-slate mt-2">Column headers must match your CSV exactly. A single signed amount column (positive = money in, negative = money out) is expected.</p>
      </Panel>

      <Panel title="Bank Statement Imports">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-ink-mid text-slate uppercase font-mono">
                <th className="p-2">Account</th><th className="p-2">File</th><th className="p-2">Uploaded</th>
                <th className="p-2">Status</th><th className="p-2 text-right">Matched</th><th className="p-2 text-right">Suggested</th>
                <th className="p-2 text-right">Unmatched</th><th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {imports.length === 0 ? (
                <tr><td colSpan={8} className="p-3 text-slate">No bank statements imported yet.</td></tr>
              ) : (
                imports.map(imp => (
                  <tr key={imp.id} className={selectedImportId === imp.id ? "bg-ink-mid/20" : ""}>
                    <td className="p-2 text-paper">{imp.account_code}</td>
                    <td className="p-2 text-slate-light">{imp.file_name}</td>
                    <td className="p-2 text-slate-light">{String(imp.uploaded_at).slice(0, 10)}</td>
                    <td className="p-2 text-slate-light capitalize">{imp.status}</td>
                    <td className="p-2 text-right text-emerald-300">{imp.matched_count}</td>
                    <td className="p-2 text-right text-amber-300">{imp.suggested_count}</td>
                    <td className="p-2 text-right text-slate-300">{imp.unmatched_count}</td>
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => void handleRunMatching(imp.id)} disabled={busy} className="text-signal hover:underline disabled:opacity-50">Run matching</button>
                        <button onClick={() => setSelectedImportId(imp.id)} className="text-slate hover:text-paper">View</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {selectedImportId && (
        <Panel title="Statement Lines">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ink-mid text-slate uppercase font-mono">
                  <th className="p-2">Date</th><th className="p-2">Description</th><th className="p-2 text-right">Amount</th>
                  <th className="p-2">Status</th><th className="p-2">Matched Cashbook Entry</th><th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {lines.length === 0 ? (
                  <tr><td colSpan={6} className="p-3 text-slate">No lines - run matching first.</td></tr>
                ) : (
                  lines.map(line => (
                    <tr key={line.id}>
                      <td className="p-2 text-slate-light">{line.transaction_date}</td>
                      <td className="p-2 text-paper max-w-xs truncate">{line.description}</td>
                      <td className="p-2 text-right text-paper">{money(line.amount)}</td>
                      <td className="p-2">
                        <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${MATCH_STATUS_CLASS[line.match_status] || ""}`}>{line.match_status}</span>
                      </td>
                      <td className="p-2 text-slate-light">{line.matched_transaction_number || "—"}</td>
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-2">
                          {line.match_status === "suggested" && (
                            <>
                              <button onClick={() => void handleConfirm(line)} disabled={busy} className="text-slate hover:text-emerald-400 disabled:opacity-50" title="Confirm match"><Check className="h-3.5 w-3.5" /></button>
                              <button onClick={() => void handleReject(line)} disabled={busy} className="text-slate hover:text-red-400 disabled:opacity-50" title="Reject match"><X className="h-3.5 w-3.5" /></button>
                            </>
                          )}
                          {line.match_status === "duplicate" && (
                            <button onClick={() => void handleReject(line)} disabled={busy} className="text-slate hover:text-red-400 disabled:opacity-50" title="Reject as not-duplicate"><X className="h-3.5 w-3.5" /></button>
                          )}
                          {line.match_status === "matched" && (
                            <button onClick={() => void handleReopen(line)} disabled={busy} className="text-slate hover:text-amber-400 disabled:opacity-50" title="Reopen"><LockOpen className="h-3.5 w-3.5" /></button>
                          )}
                          {line.match_status === "unmatched" && (
                            <button onClick={() => void handleCreateEntry(line)} disabled={busy} className="text-xs text-signal hover:underline">Create cashbook entry</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </section>
  );
}

function SimpleTable({ rows, columns }: { rows: RecordData[]; columns: string[] }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-ink-mid text-slate uppercase font-mono">{columns.map(col => <th key={col} className="p-2">{col.replaceAll("_", " ")}</th>)}</tr></thead><tbody className="divide-y divide-ink-mid">{rows.length === 0 ? <tr><td className="p-3 text-slate" colSpan={columns.length}>No records.</td></tr> : rows.slice(0, 20).map((row, index) => <tr key={row.id || index}>{columns.map(col => <td key={col} className="p-2 text-paper">{col.includes("amount") || col.includes("balance") || col.includes("rate") || col === "net_pay" ? money(row[col]) : String(row[col] ?? "-")}</td>)}</tr>)}</tbody></table></div>;
}




