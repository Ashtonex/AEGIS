"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Ban, Building2, CheckCircle2, CircleDollarSign, Clock, FileQuestion, FolderKanban,
  History, Loader2, Mail, RefreshCw, Search, ShieldAlert, Wallet, X,
} from "lucide-react";
import {
  getFinanceCashAccounts,
  getFinancePayables,
  getFinanceSupplierPayments,
  payFinancePayables,
  rejectFinancePayable,
  requestFinancePayableInvoice,
} from "@/lib/api";

type RecordData = Record<string, any>;
type Bucket = "current" | "1_30" | "31_60" | "61_90" | "90_plus";

const BUCKETS: { key: Bucket; label: string; bar: string; text: string }[] = [
  { key: "current", label: "Not yet due", bar: "bg-emerald-400", text: "text-emerald-300" },
  { key: "1_30", label: "1-30 days late", bar: "bg-amber-400", text: "text-amber-300" },
  { key: "31_60", label: "31-60 days late", bar: "bg-orange-400", text: "text-orange-300" },
  { key: "61_90", label: "61-90 days late", bar: "bg-red-400", text: "text-red-300" },
  { key: "90_plus", label: "90+ days late", bar: "bg-red-600", text: "text-red-400" },
];
const BUCKET_BY_KEY = Object.fromEntries(BUCKETS.map((b) => [b.key, b])) as Record<Bucket, (typeof BUCKETS)[number]>;

const ACTION_LABEL: Record<string, string> = {
  paid: "Paid",
  rejected: "Rejected",
  invoice_requested: "Invoice requested",
  match_override: "Paid without match",
};

function money(value: unknown, digits = 0) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number.isFinite(num) ? num : 0);
}
function fmtDate(value: unknown) {
  if (!value) return "-";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

const card = "bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]";
const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const labelClass = "block text-[10px] font-mono uppercase tracking-wider text-slate mb-1";

/**
 * Supplier Payments: what we owe, how late it is, and the three things
 * Finance does with each invoice - pay it, ask the supplier for a proper
 * invoice first, or reject it. Invoices are listed one per row (not a
 * multi-select box) so each carries its own age, approval state and
 * history; tick several to pay them in one batch.
 */
export function SupplierPaymentsPanel() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RecordData | null>(null);
  const [accounts, setAccounts] = useState<RecordData[]>([]);
  const [batches, setBatches] = useState<RecordData[]>([]);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [bucketFilter, setBucketFilter] = useState<Bucket | "all">("all");
  const [approvalFilter, setApprovalFilter] = useState<"all" | "payable" | "awaiting">("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const [payForm, setPayForm] = useState({ cash_account_id: "", payment_date: today(), payment_method: "bank_transfer", reference: "", override_reason: "" });
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<{ id: string; mode: "pay" | "reject" | "request" } | null>(null);
  const [rowAmount, setRowAmount] = useState("");
  const [rowText, setRowText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [payablesRes, accountsRes, batchesRes] = await Promise.allSettled([getFinancePayables(), getFinanceCashAccounts(), getFinanceSupplierPayments()]);
    if (payablesRes.status === "fulfilled") setData(payablesRes.value.data || null);
    else setNotice({ text: payablesRes.reason instanceof Error ? payablesRes.reason.message : "Could not load payables.", tone: "error" });
    if (accountsRes.status === "fulfilled") setAccounts(accountsRes.value.data || []);
    if (batchesRes.status === "fulfilled") setBatches(batchesRes.value.data || []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const invoices: RecordData[] = useMemo(() => data?.invoices || [], [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((i) =>
      (bucketFilter === "all" || i.bucket === bucketFilter) &&
      (approvalFilter === "all" || (approvalFilter === "payable" ? i.payable_now : !i.payable_now)) &&
      (!supplierFilter || String(i.supplier_id) === supplierFilter) &&
      (!q || `${i.invoice_number} ${i.supplier_invoice_ref || ""} ${i.supplier_name} ${i.project_name || ""}`.toLowerCase().includes(q))
    );
  }, [invoices, bucketFilter, approvalFilter, supplierFilter, search]);

  const selectedInvoices = invoices.filter((i) => selected[i.id]);
  const selectedTotal = selectedInvoices.reduce((s, i) => s + Number(i.outstanding || 0), 0);
  const selectionNeedsOverride = selectedInvoices.some((i) => !i.payable_now);
  const summary = data?.summary || {};
  const aging = data?.aging || {};
  const agingTotal = BUCKETS.reduce((s, b) => s + Number(aging[b.key]?.amount || 0), 0) || 1;
  const account = accounts.find((a) => a.id === payForm.cash_account_id);

  const run = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fn();
      setNotice({ text: res?.message || "Done.", tone: "ok" });
      setExpanded(null);
      await load();
      return true;
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "Action failed.", tone: "error" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const requireAccount = () => {
    if (!payForm.cash_account_id) {
      setNotice({ text: "Choose the cash account the payment comes out of (top of the list).", tone: "error" });
      return false;
    }
    return true;
  };

  const paySelected = async () => {
    if (!requireAccount() || selectedInvoices.length === 0) return;
    if (selectionNeedsOverride && !payForm.override_reason.trim()) {
      setNotice({ text: "Some selected invoices aren't approved for payment yet. Give an override reason to pay them anyway.", tone: "error" });
      return;
    }
    if (!window.confirm(`Pay ${selectedInvoices.length} invoice${selectedInvoices.length === 1 ? "" : "s"} totalling ${money(selectedTotal, 2)} from ${account?.account_name}?`)) return;
    const okDone = await run("batch", () => payFinancePayables({
      cash_account_id: payForm.cash_account_id,
      payment_date: payForm.payment_date,
      payment_method: payForm.payment_method,
      reference: payForm.reference || undefined,
      override_reason: payForm.override_reason || undefined,
      items: selectedInvoices.map((i) => ({ invoice_id: i.id })),
    }));
    if (okDone) setSelected({});
  };

  const openRow = (inv: RecordData, mode: "pay" | "reject" | "request") => {
    if (expanded && expanded.id === inv.id && expanded.mode === mode) {
      setExpanded(null);
      return;
    }
    setExpanded({ id: inv.id, mode });
    setRowAmount(String(Number(inv.outstanding || 0).toFixed(2)));
    setRowText("");
  };

  const payOne = async (inv: RecordData) => {
    if (!requireAccount()) return;
    const amount = Number(rowAmount);
    if (!(amount > 0)) { setNotice({ text: "Enter the amount to pay.", tone: "error" }); return; }
    if (!inv.payable_now && !rowText.trim()) { setNotice({ text: "This invoice isn't approved for payment yet. Give an override reason.", tone: "error" }); return; }
    await run(`pay-${inv.id}`, () => payFinancePayables({
      cash_account_id: payForm.cash_account_id,
      payment_date: payForm.payment_date,
      payment_method: payForm.payment_method,
      reference: payForm.reference || undefined,
      override_reason: inv.payable_now ? undefined : rowText.trim(),
      items: [{ invoice_id: inv.id, amount }],
    }));
  };

  if (loading && !data) {
    return <div className={`${card} p-8 flex items-center gap-3 text-slate`}><Loader2 className="h-4 w-4 animate-spin" />Loading what we owe…</div>;
  }

  return (
    <div className="space-y-5">
      {/* Headline */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Stat icon={CircleDollarSign} label="Total owed to suppliers" value={money(summary.total_outstanding)} sub={`${summary.count || 0} unpaid invoices`} />
        <Stat icon={AlertTriangle} label="Overdue" value={money(summary.overdue)} tone={Number(summary.overdue) > 0 ? "text-red-400" : "text-paper"} sub={`${invoices.filter((i) => i.days_overdue > 0).length} invoices past due`} />
        <Stat icon={CheckCircle2} label="Approved, ready to pay" value={money(summary.payable_now)} tone="text-emerald-400" sub={`${invoices.filter((i) => i.payable_now).length} invoices`} />
        <Stat icon={ShieldAlert} label="Awaiting approval" value={money(summary.awaiting_approval)} tone="text-amber-400" sub="PO / GRN / invoice match incomplete" />
        <Stat icon={Clock} label="Avg. days outstanding" value={`${summary.weighted_days_outstanding ?? 0} days`} sub={`Due date assumed ${summary.assumed_terms_days || 30} days where none is set`} />
      </div>

      {/* Ageing */}
      <section className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-slate">Aged payables</h3>
          {bucketFilter !== "all" && <button onClick={() => setBucketFilter("all")} className="text-[11px] text-signal hover:underline">Clear age filter</button>}
        </div>
        <div className="flex h-3 rounded-full overflow-hidden bg-ink mb-3">
          {BUCKETS.map((b) => <div key={b.key} className={b.bar} style={{ width: `${(Number(aging[b.key]?.amount || 0) / agingTotal) * 100}%` }} title={`${b.label}: ${money(aging[b.key]?.amount)}`} />)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {BUCKETS.map((b) => (
            <button
              key={b.key}
              onClick={() => setBucketFilter(bucketFilter === b.key ? "all" : b.key)}
              className={`text-left rounded border px-3 py-2 transition-colors ${bucketFilter === b.key ? "border-signal/60 bg-signal/10" : "border-ink-mid hover:border-signal/30"}`}
            >
              <span className="flex items-center gap-1.5 text-[11px] text-slate-light"><span className={`h-2 w-2 rounded-full ${b.bar}`} />{b.label}</span>
              <span className={`block text-base font-semibold tabular-nums ${b.text}`}>{money(aging[b.key]?.amount)}</span>
              <span className="text-[10px] text-slate">{aging[b.key]?.count || 0} invoices</span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className={`${card} p-4`}>
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-slate mb-3 flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />Who we owe most</h3>
          <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {(data?.by_supplier || []).map((s: RecordData) => {
              const pct = (Number(s.outstanding) / Math.max(Number(summary.total_outstanding) || 1, 1)) * 100;
              return (
                <li key={s.supplier_id}>
                  <button onClick={() => setSupplierFilter(supplierFilter === s.supplier_id ? "" : s.supplier_id)} className={`w-full text-left rounded px-2 py-1.5 ${supplierFilter === s.supplier_id ? "bg-signal/10" : "hover:bg-ink-mid/20"}`}>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-paper flex-1 truncate">{s.supplier_name}</span>
                      <span className="text-slate">{s.count} inv · oldest {s.oldest_days}d</span>
                      {s.overdue > 0 && <span className="text-red-300 tabular-nums">{money(s.overdue)} late</span>}
                      <span className="text-paper tabular-nums w-20 text-right">{money(s.outstanding)}</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-ink overflow-hidden"><div className="h-full bg-signal" style={{ width: `${pct}%` }} /></div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <section className={`${card} p-4`}>
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-slate mb-3 flex items-center gap-1.5"><FolderKanban className="h-3.5 w-3.5" />Owed by project</h3>
          <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {(data?.by_project || []).map((p: RecordData) => (
              <li key={String(p.project_id || "none")} className="flex items-center gap-2 text-xs px-2 py-1.5">
                <span className="text-paper flex-1 truncate">{p.project_name}</span>
                <span className="text-slate">{p.count} invoices</span>
                <span className="text-paper tabular-nums w-20 text-right">{money(p.outstanding)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {notice && (
        <div className={`border px-4 py-2.5 text-sm rounded flex justify-between gap-3 ${notice.tone === "error" ? "border-red-500/30 bg-red-950/20 text-red-200" : "border-signal/30 bg-signal/10 text-paper"}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Invoice list */}
      <section className={card}>
        <div className="px-4 py-3 border-b border-ink-mid bg-ink/30 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <label className={labelClass}>Pay from</label>
              <select className={inputClass} value={payForm.cash_account_id} onChange={(e) => setPayForm({ ...payForm, cash_account_id: e.target.value })}>
                <option value="">Choose cash account</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name} · {money(a.current_balance)}</option>)}
              </select>
            </div>
            <div className="w-40">
              <label className={labelClass}>Payment date</label>
              <input type="date" className={inputClass} value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
            </div>
            <div className="w-40">
              <label className={labelClass}>Method</label>
              <select className={inputClass} value={payForm.payment_method} onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div className="w-44">
              <label className={labelClass}>Reference</label>
              <input className={inputClass} placeholder="Bank / POP reference" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
            </div>
            {account && selectedTotal > Number(account.current_balance || 0) && (
              <span className="text-[11px] text-amber-300 flex items-center gap-1 pb-2"><AlertTriangle className="h-3 w-3" />Selection exceeds the account balance</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate" />
              <input className={`${inputClass} py-1.5 pl-7`} placeholder="Search invoice, supplier, project…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {(["all", "payable", "awaiting"] as const).map((f) => (
              <button key={f} onClick={() => setApprovalFilter(f)} className={`px-2.5 py-1 rounded-sm text-[11px] font-mono uppercase tracking-wider border ${approvalFilter === f ? "border-signal bg-signal text-ink font-semibold" : "border-ink-mid text-slate hover:text-paper"}`}>
                {f === "all" ? "All" : f === "payable" ? "Ready to pay" : "Awaiting approval"}
              </button>
            ))}
            {supplierFilter && (
              <button onClick={() => setSupplierFilter("")} className="inline-flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] border border-signal/40 text-signal">
                {(data?.by_supplier || []).find((s: RecordData) => s.supplier_id === supplierFilter)?.supplier_name}<X className="h-3 w-3" />
              </button>
            )}
            <span className="ml-auto text-xs text-slate-light">{filtered.length} of {invoices.length} invoices</span>
            <button onClick={() => void load()} className="text-slate hover:text-paper" title="Refresh"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-light">{invoices.length === 0 ? "Nothing owed. Every supplier invoice is settled." : "No invoices match these filters."}</p>
        ) : (
          <div className="divide-y divide-ink-mid">
            <div className="hidden lg:grid grid-cols-[28px_minmax(0,2.2fr)_minmax(0,1.4fr)_110px_110px_120px_minmax(0,260px)] gap-3 px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-slate">
              <input
                type="checkbox"
                className="accent-signal"
                checked={filtered.length > 0 && filtered.every((i) => selected[i.id])}
                onChange={(e) => setSelected((prev) => ({ ...prev, ...Object.fromEntries(filtered.map((i) => [i.id, e.target.checked])) }))}
                title="Select all shown"
              />
              <span>Invoice / supplier</span><span>Project</span><span>Due</span><span>Age</span><span className="text-right">Outstanding</span><span className="text-right">Action</span>
            </div>
            {filtered.map((inv) => {
              const b = BUCKET_BY_KEY[inv.bucket as Bucket];
              const isOpen = expanded?.id === inv.id;
              return (
                <div key={inv.id} className={`${selected[inv.id] ? "bg-signal/5" : ""}`}>
                  <div className="grid grid-cols-1 lg:grid-cols-[28px_minmax(0,2.2fr)_minmax(0,1.4fr)_110px_110px_120px_minmax(0,260px)] gap-x-3 gap-y-1 px-4 py-3 items-center">
                    <input type="checkbox" className="accent-signal" checked={!!selected[inv.id]} onChange={() => setSelected((p) => ({ ...p, [inv.id]: !p[inv.id] }))} />
                    <div className="min-w-0">
                      <p className="text-paper font-medium truncate">{inv.supplier_name}</p>
                      <p className="text-[11px] text-slate-light truncate">
                        <span className="font-mono">{inv.invoice_number}</span>
                        {inv.supplier_invoice_ref && <> · ref {inv.supplier_invoice_ref}</>} · {fmtDate(inv.invoice_date)}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {inv.payable_now
                          ? <Badge tone="emerald">Approved to pay</Badge>
                          : <Badge tone="amber">Awaiting approval · {inv.match_status?.replace("_", " ")}</Badge>}
                        {!inv.po_id && <Badge tone="slate">No PO</Badge>}
                        {!inv.grn_id && <Badge tone="slate">No GRN</Badge>}
                        {inv.paid_to_date > 0 && <Badge tone="sky">Part-paid {money(inv.paid_to_date)}</Badge>}
                        {inv.invoice_requests > 0 && <Badge tone="violet">Invoice requested ×{inv.invoice_requests}</Badge>}
                      </div>
                    </div>
                    <span className="text-xs text-slate-light truncate">{inv.project_name || <span className="text-slate">No project</span>}</span>
                    <span className="text-xs text-slate-light">{fmtDate(inv.effective_due_date)}{inv.due_date_assumed && <span className="text-slate" title="No due date on the invoice: assumed 30 days after the invoice date"> *</span>}</span>
                    <span className={`text-xs font-medium ${b?.text || "text-slate"}`}>{inv.days_overdue > 0 ? `${inv.days_overdue}d late` : `${inv.days_outstanding}d old`}</span>
                    <span className="text-right text-paper font-semibold tabular-nums">{money(inv.outstanding, 2)}</span>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <RowButton active={isOpen && expanded?.mode === "pay"} tone="signal" onClick={() => openRow(inv, "pay")}><Wallet className="h-3 w-3" />Post payment</RowButton>
                      <RowButton active={isOpen && expanded?.mode === "request"} tone="sky" onClick={() => openRow(inv, "request")}><FileQuestion className="h-3 w-3" />Request invoice</RowButton>
                      <RowButton active={isOpen && expanded?.mode === "reject"} tone="red" onClick={() => openRow(inv, "reject")} disabled={inv.paid_to_date > 0}><Ban className="h-3 w-3" />Reject</RowButton>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mx-4 mb-3 rounded border border-ink-mid bg-ink/40 p-3">
                      {expanded!.mode === "pay" && (
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="w-40">
                            <label className={labelClass}>Amount (outstanding {money(inv.outstanding, 2)})</label>
                            <input className={inputClass} type="number" min="0.01" step="0.01" max={inv.outstanding} value={rowAmount} onChange={(e) => setRowAmount(e.target.value)} />
                          </div>
                          {!inv.payable_now && (
                            <div className="flex-1 min-w-[260px]">
                              <label className={`${labelClass} text-amber-300`}>Override reason (not yet approved for payment)</label>
                              <input className={inputClass} placeholder="e.g. Cash supplier, goods received on site, MD approved" value={rowText} onChange={(e) => setRowText(e.target.value)} />
                            </div>
                          )}
                          <div className="text-[11px] text-slate-light pb-2">
                            From <span className="text-paper">{account?.account_name || "-"}</span> on {fmtDate(payForm.payment_date)}
                          </div>
                          <button disabled={busy !== null} onClick={() => void payOne(inv)} className="ml-auto inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm disabled:opacity-50">
                            {busy === `pay-${inv.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {Number(rowAmount) < Number(inv.outstanding) ? "Post part payment" : "Post payment"}
                          </button>
                        </div>
                      )}
                      {expanded!.mode === "request" && (
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="flex-1 min-w-[260px]">
                            <label className={labelClass}>Message to supplier (optional)</label>
                            <input className={inputClass} placeholder="Please send a valid fiscal tax invoice so we can release payment." value={rowText} onChange={(e) => setRowText(e.target.value)} />
                          </div>
                          <p className="text-[11px] text-slate-light pb-2 flex items-center gap-1">
                            <Mail className="h-3 w-3" />{inv.supplier_email ? `Emails ${inv.supplier_email}` : "No supplier email on file; the request is logged only"}
                          </p>
                          <button disabled={busy !== null} onClick={() => void run(`req-${inv.id}`, () => requestFinancePayableInvoice(inv.id, rowText.trim() || undefined))} className="inline-flex items-center gap-2 border border-sky-500/40 text-sky-200 px-3 py-2 rounded-sm text-sm hover:bg-sky-950/30 disabled:opacity-50">
                            {busy === `req-${inv.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileQuestion className="h-4 w-4" />}Send request
                          </button>
                        </div>
                      )}
                      {expanded!.mode === "reject" && (
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="flex-1 min-w-[260px]">
                            <label className={`${labelClass} text-red-300`}>Reason for rejecting (required)</label>
                            <input className={inputClass} placeholder="e.g. Duplicate of INV-..., goods not received, wrong price" value={rowText} onChange={(e) => setRowText(e.target.value)} />
                          </div>
                          <button
                            disabled={busy !== null || rowText.trim().length < 3}
                            onClick={() => void run(`rej-${inv.id}`, () => rejectFinancePayable(inv.id, rowText.trim()))}
                            className="inline-flex items-center gap-2 border border-red-500/40 text-red-200 px-3 py-2 rounded-sm text-sm hover:bg-red-950/30 disabled:opacity-50"
                          >
                            {busy === `rej-${inv.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}Reject payment
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {selectedInvoices.length > 0 && (
          <div className="sticky bottom-0 border-t border-signal/30 bg-ink-light/95 backdrop-blur px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="text-sm text-paper">{selectedInvoices.length} selected · <span className="font-semibold tabular-nums">{money(selectedTotal, 2)}</span></span>
            {selectionNeedsOverride && (
              <input className={`${inputClass} flex-1 min-w-[240px] py-1.5`} placeholder="Override reason: some selected invoices aren't approved yet" value={payForm.override_reason} onChange={(e) => setPayForm({ ...payForm, override_reason: e.target.value })} />
            )}
            <button onClick={() => setSelected({})} className="text-xs text-slate hover:text-paper">Clear</button>
            <button disabled={busy !== null} onClick={() => void paySelected()} className="ml-auto inline-flex items-center gap-2 bg-signal text-ink font-semibold px-4 py-2 rounded-sm text-sm disabled:opacity-50">
              {busy === "batch" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Pay selected
            </button>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className={card}>
          <div className="px-4 py-3 border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate flex items-center gap-1.5"><History className="h-3.5 w-3.5" />Recent actions</div>
          {(data?.recent_actions || []).length === 0 ? <p className="p-4 text-sm text-slate-light">No payment actions yet.</p> : (
            <ul className="divide-y divide-ink-mid max-h-72 overflow-y-auto">
              {(data?.recent_actions || []).map((a: RecordData) => (
                <li key={a.id} className="px-4 py-2 text-xs flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className={`font-medium ${a.action === "rejected" ? "text-red-300" : a.action === "paid" ? "text-emerald-300" : a.action === "match_override" ? "text-amber-300" : "text-sky-300"}`}>{ACTION_LABEL[a.action] || a.action}</span>
                  <span className="text-paper">{a.supplier_name} · <span className="font-mono">{a.invoice_number}</span></span>
                  {a.amount != null && <span className="tabular-nums text-paper">{money(a.amount, 2)}</span>}
                  {a.action === "invoice_requested" && <span className="text-slate">{a.email_sent ? "emailed" : "logged"}</span>}
                  <span className="text-slate ml-auto">{a.actor || "-"} · {fmtDate(a.created_at)}</span>
                  {a.reason && <span className="w-full text-slate-light">{a.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={card}>
          <div className="px-4 py-3 border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">Payment batches</div>
          {batches.length === 0 ? <p className="p-4 text-sm text-slate-light">No supplier payments posted yet.</p> : (
            <div className="overflow-x-auto max-h-72">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px]"><th className="p-2">Batch</th><th className="p-2">Date</th><th className="p-2">Method</th><th className="p-2">Reference</th><th className="p-2 text-right">Total</th></tr></thead>
                <tbody className="divide-y divide-ink-mid">
                  {batches.slice(0, 40).map((b) => (
                    <tr key={b.id}><td className="p-2 font-mono text-paper">{b.batch_number}</td><td className="p-2 text-slate-light">{fmtDate(b.payment_date)}</td><td className="p-2 text-slate-light">{String(b.payment_method || "").replace("_", " ")}</td><td className="p-2 text-slate-light">{b.reference || "-"}</td><td className="p-2 text-right tabular-nums text-paper">{money(b.total_amount, 2)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, tone = "text-paper" }: { icon: any; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`${card} p-3.5`}>
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-slate"><Icon className="h-3.5 w-3.5" />{label}</div>
      <p className={`mt-1.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-light">{sub}</p>}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  emerald: "border-emerald-500/30 bg-emerald-950/20 text-emerald-300",
  amber: "border-amber-500/30 bg-amber-950/20 text-amber-300",
  slate: "border-slate-500/30 bg-slate-950/20 text-slate-300",
  sky: "border-sky-500/30 bg-sky-950/20 text-sky-300",
  violet: "border-violet-500/30 bg-violet-950/20 text-violet-300",
};
function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: React.ReactNode }) {
  return <span className={`px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-wider font-mono border ${BADGE_TONES[tone]}`}>{children}</span>;
}

const ROW_TONES: Record<string, { idle: string; active: string }> = {
  signal: { idle: "border-signal/40 text-signal hover:bg-signal/10", active: "border-signal bg-signal text-ink" },
  sky: { idle: "border-sky-500/40 text-sky-300 hover:bg-sky-950/30", active: "border-sky-400 bg-sky-500/20 text-sky-100" },
  red: { idle: "border-red-500/40 text-red-300 hover:bg-red-950/30", active: "border-red-400 bg-red-500/20 text-red-100" },
};
function RowButton({ tone, active, onClick, disabled, children }: { tone: "signal" | "sky" | "red"; active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1 border px-2 py-1 rounded-sm text-[11px] whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${active ? ROW_TONES[tone].active : ROW_TONES[tone].idle}`}>
      {children}
    </button>
  );
}
