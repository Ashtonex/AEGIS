"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, BadgeCheck, Check, Landmark, Loader2, Paperclip, Pencil, Plus, Trash2, Unlink, X } from "lucide-react";
import {
  approveMoneyEntry,
  createOfficeExpense,
  getOfficeExpenses,
  unmatchProjectEntry,
  updateProjectMoneyEntry,
  voidProjectMoneyEntry,
  type OfficeExpenseInput,
} from "@/lib/api";
import { useFinanceDepartments } from "@/hooks/useFinanceDepartments";
import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { categoryLabel } from "./BankStatementReviewPanel";
import { FindOnBank, StatusChip, SuggestionBlock } from "./ProjectMoneyEntries";

type RecordData = Record<string, any>;

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center justify-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";
const ghostClass = "inline-flex items-center justify-center gap-2 border border-ink-mid text-paper px-3 py-2 rounded-sm text-sm hover:border-signal/50 disabled:opacity-50";
const cardClass = "bg-ink-light border border-ink-mid rounded-lg";

// Same mapping as bank_books.money_out_account(category, has_project=False)
const ACCOUNT_FOR: Record<string, string> = {
  salaries_wages: "6000", rent: "6100", utilities: "6200", professional_fees: "6300", insurance: "6400",
  travel_accommodation: "6500", office_admin: "6600", marketing: "6700", bank_charges: "6800",
  tax_statutory: "6900", tithe_donation: "7800", other: "7900",
};

/** Category name without its bracketed examples, for tables. */
function shortLabel(category?: string | null) {
  return categoryLabel(category).replace(/\s*\(.*\)$/, "");
}

function money(value: unknown) {
  const n = Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function errorText(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Office (head-office) spending, one voucher per cost. A voucher is in the
 * ledger the moment it is saved: cash ones come out of HQ Cash, bank ones
 * wait in "Recorded, awaiting bank statement" until the statement line is
 * matched. Receipts are attached to each voucher; approval is recorded on it.
 */
export function OfficeExpensesPanel() {
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState("");
  const [category, setCategory] = useState("");
  const [data, setData] = useState<{ entries: RecordData[]; summary: RecordData; categories: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<RecordData | "new" | null>(null);
  const [findFor, setFindFor] = useState<RecordData | null>(null);
  const [receiptsFor, setReceiptsFor] = useState<RecordData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getOfficeExpenses({ date_from: dateFrom, date_to: dateTo, category });
      setData(res.data);
    } catch (e) {
      setError(errorText(e, "Office expenses did not load."));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, category]);

  useEffect(() => { void load(); }, [load]);

  const changed = useCallback(async (msg?: string) => {
    if (msg) setNotice(msg);
    await load();
  }, [load]);

  const entries = data?.entries ?? [];
  const summary = data?.summary ?? {};
  const categories = data?.categories ?? Object.keys(ACCOUNT_FOR);
  const decide = entries.filter((e) => e.match_status === "suggested" && (e.suggestions || []).length > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-lg font-semibold text-paper">Office expenses</h2>
          <p className="text-sm text-slate mt-1">
            Record each office cost once - rent, power, airtime, internet, stationery, software, fees. It goes into the
            ledger straight away under its own expense account. Cash vouchers bring down the cash withdrawn from the bank;
            bank vouchers are matched to the statement line when the statement is uploaded, so nothing is counted twice.
          </p>
        </div>
        {formFor === null && (
          <button className={buttonClass} onClick={() => { setNotice(null); setFormFor("new"); }}>
            <Plus className="h-4 w-4" />Record office expense
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label="Recorded in period" value={money(summary.total)} hint={`${entries.length} voucher${entries.length === 1 ? "" : "s"}`} />
        <Tile label="Paid in cash" value={money(summary.cash)} hint="out of HQ Cash" />
        <Tile label="Paid by bank / card" value={money(summary.bank)}
          hint={summary.awaiting_bank ? `${summary.awaiting_bank} not yet on a statement` : "all matched"} />
        <Tile label="Missing receipt / approval" value={`${summary.without_receipt ?? 0} / ${summary.without_approval ?? 0}`}
          hint="vouchers to complete" warn={Boolean(summary.without_receipt || summary.without_approval)} />
        <Tile label="HQ Cash per the books" value={money(summary.cash_not_yet_vouchered)}
          hint="withdrawn, no voucher yet - or still on hand" warn={Number(summary.cash_not_yet_vouchered) > 0} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate space-y-1">
          <span>From</span>
          <input className={inputClass} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="text-xs text-slate space-y-1">
          <span>To</span>
          <input className={inputClass} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <label className="text-xs text-slate space-y-1 min-w-[220px]">
          <span>Category</span>
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
          </select>
        </label>
        <button className={ghostClass} onClick={() => { setDateFrom(""); setDateTo(""); setCategory(""); }}>All time</button>
      </div>

      {notice && <p className="text-sm text-emerald-300">{notice}</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      {formFor !== null && (
        <VoucherForm
          entry={formFor === "new" ? null : formFor}
          categories={categories}
          onCancel={() => setFormFor(null)}
          onSaved={async (msg) => { setFormFor(null); await changed(msg); }}
        />
      )}

      {decide.length > 0 && (
        <div className="border border-amber-500/30 bg-amber-950/20 text-amber-100 px-4 py-3 text-sm space-y-3">
          <p className="font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Which bank line is this? The bank statement has more than one possibility.</p>
          {decide.map((e) => <SuggestionBlock key={e.id} entry={e} onChanged={changed} onFind={() => setFindFor(e)} />)}
        </div>
      )}

      {(summary.by_category ?? []).length > 0 && (
        <div className={`${cardClass} p-4`}>
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate mb-3">Where it went (ledger account)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
            {(summary.by_category as RecordData[]).map((c) => (
              <div key={c.category} className="flex justify-between gap-3 text-sm">
                <span className="text-slate-light"><span className="font-mono text-slate mr-2">{c.account_code}</span>{shortLabel(c.category)}</span>
                <span className="font-mono text-paper">{money(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && !data ? (
        <p className="text-sm text-slate"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading office expenses...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate">No office expenses recorded in this period.</p>
      ) : (
        <div className={`${cardClass} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px] tracking-wider">
                  <th className="p-2">Date</th><th className="p-2">Paid to</th><th className="p-2 min-w-[220px]">What for</th>
                  <th className="p-2">Category</th><th className="p-2">Paid / bank</th><th className="p-2">Receipt</th>
                  <th className="p-2">Approved</th><th className="p-2 text-right">Amount</th><th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {entries.map((e) => (
                  <VoucherRow key={e.id} entry={e} onEdit={() => setFormFor(e)} onFind={() => setFindFor(e)}
                    onReceipts={() => setReceiptsFor(e)} onChanged={changed} />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink-mid">
                  <td colSpan={7} className="p-2 text-right text-slate font-mono uppercase text-[10px]">{entries.length} vouchers</td>
                  <td className="p-2 text-right font-mono text-red-300">{money(summary.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Portalled: an ancestor's transform would otherwise trap position:fixed inside the panel */}
      {findFor && createPortal(
        <FindOnBank entry={findFor} onClose={() => setFindFor(null)} onMatched={async (msg) => { setFindFor(null); await changed(msg); }} />,
        document.body,
      )}

      {receiptsFor && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3" role="dialog" aria-modal="true">
          <div className="bg-ink-light border border-ink-mid rounded-lg w-full max-w-2xl max-h-[88vh] flex flex-col">
            <div className="px-5 py-4 border-b border-ink-mid flex justify-between gap-4">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-widest text-slate">Receipts for this voucher</p>
                <p className="text-paper font-semibold mt-1">
                  {money(receiptsFor.amount)} · {receiptsFor.entry_date}{receiptsFor.counterparty_name ? ` · ${receiptsFor.counterparty_name}` : ""}
                </p>
                <p className="text-xs text-slate mt-1">Attach the till slip or tax invoice (photo or PDF). Keep the original for tax.</p>
              </div>
              <button onClick={() => { setReceiptsFor(null); void load(); }} className="text-slate hover:text-paper self-start" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <EntityDocumentsPanel entityType="money_entry" entityId={receiptsFor.id} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function Tile({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className={`${cardClass} p-3`}>
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate">{label}</p>
      <p className={`text-lg font-semibold font-mono mt-1 ${warn ? "text-amber-300" : "text-paper"}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate mt-0.5">{hint}</p>}
    </div>
  );
}

function VoucherRow({ entry, onEdit, onFind, onReceipts, onChanged }: {
  entry: RecordData; onEdit: () => void; onFind: () => void; onReceipts: () => void; onChanged: (msg?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ message?: string } | unknown>, fallback: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = (await fn()) as { message?: string };
      await onChanged(res?.message || fallback);
    } catch (e) {
      setErr(errorText(e, "Could not do that."));
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    const note = entry.match_status === "matched" ? " The bank line will go back to carrying its own tag." : "";
    if (window.confirm(`Remove this ${money(entry.amount)} voucher? Its ledger posting is reversed.${note}`)) {
      void run(() => voidProjectMoneyEntry(entry.id), "Voucher removed.");
    }
  };
  const receipts = Number(entry.receipt_count || 0);
  return (
    <tr className="align-top hover:bg-ink-mid/20">
      <td className="p-2 font-mono text-slate-light whitespace-nowrap">{entry.entry_date}</td>
      <td className="p-2 text-paper">{entry.counterparty_name || <span className="text-slate">-</span>}</td>
      <td className="p-2 text-paper">
        <div className="line-clamp-2">{entry.description || <span className="text-slate">-</span>}</div>
        <div className="text-[10px] text-slate mt-0.5">
          {entry.reference && <span className="font-mono mr-2">{entry.reference}</span>}
          {entry.spent_by && <span className="mr-2">spent by {entry.spent_by}</span>}
          {entry.department_name && <span>{entry.department_name}</span>}
        </div>
        {err && <div className="text-[11px] text-red-300 mt-1">{err}</div>}
      </td>
      <td className="p-2 text-slate-light">
        {shortLabel(entry.category)}
        <div className="text-[10px] font-mono text-slate">{ACCOUNT_FOR[entry.category] ?? ""}</div>
      </td>
      <td className="p-2 whitespace-nowrap"><StatusChip entry={entry} /></td>
      <td className="p-2 whitespace-nowrap">
        <button onClick={onReceipts} className={`inline-flex items-center gap-1 hover:underline ${receipts ? "text-emerald-300" : "text-amber-300"}`}>
          <Paperclip className="h-3.5 w-3.5" />{receipts ? `${receipts} attached` : "Attach"}
        </button>
      </td>
      <td className="p-2 whitespace-nowrap">
        {entry.approved_by ? (
          <button className="inline-flex items-center gap-1 text-emerald-300" title="Click to remove the approval"
            onClick={() => void run(() => approveMoneyEntry(entry.id, false), "Approval removed.")} disabled={busy}>
            <BadgeCheck className="h-3.5 w-3.5" />{entry.approved_by_name || "Approved"}
          </button>
        ) : (
          <button className="text-signal hover:underline" disabled={busy}
            onClick={() => void run(() => approveMoneyEntry(entry.id, true), "Approved.")}>Approve</button>
        )}
      </td>
      <td className="p-2 text-right font-mono whitespace-nowrap text-red-300">{money(entry.amount)}</td>
      <td className="p-2 text-right whitespace-nowrap">
        {busy ? <Loader2 className="h-4 w-4 animate-spin inline text-slate" /> : (
          <span className="inline-flex gap-3">
            {entry.paid_via === "bank" && entry.match_status !== "matched" && (
              <button onClick={onFind} className="text-signal hover:underline inline-flex items-center gap-1" title="Find it on the bank statement"><Landmark className="h-3.5 w-3.5" />Find</button>
            )}
            {entry.match_status === "matched" && (
              <button onClick={() => void run(() => unmatchProjectEntry(entry.id), "Unmatched.")} className="text-slate hover:text-signal inline-flex items-center gap-1" title="That bank line isn't this voucher"><Unlink className="h-3.5 w-3.5" />Unmatch</button>
            )}
            <button onClick={onEdit} className="text-slate hover:text-signal" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={remove} className="text-slate hover:text-red-300" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
          </span>
        )}
      </td>
    </tr>
  );
}

function VoucherForm({ entry, categories, onCancel, onSaved }: {
  entry: RecordData | null;
  categories: string[];
  onCancel: () => void;
  onSaved: (msg: string) => Promise<void>;
}) {
  const { departments } = useFinanceDepartments();
  const [form, setForm] = useState({
    entry_date: entry?.entry_date || today(),
    amount: entry ? String(entry.amount) : "",
    paid_via: (entry?.paid_via || "cash") as "bank" | "cash",
    category: entry?.category || "",
    counterparty_name: entry?.counterparty_name || "",
    reference: entry?.reference || "",
    description: entry?.description || "",
    spent_by: entry?.spent_by || "",
    department_id: entry?.department_id || "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const account = useMemo(() => ACCOUNT_FOR[form.category], [form.category]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!(Number(form.amount) > 0)) { setErr("Enter an amount above zero."); return; }
    if (!form.category) { setErr("Pick what the expense was for."); return; }
    setBusy(true);
    setErr(null);
    const body: OfficeExpenseInput = {
      paid_via: form.paid_via, entry_date: form.entry_date, amount: Number(form.amount), category: form.category,
      counterparty_name: form.counterparty_name || null, reference: form.reference || null,
      description: form.description || null, spent_by: form.spent_by || null, department_id: form.department_id || null,
    };
    try {
      const res = entry ? await updateProjectMoneyEntry(entry.id, body) : await createOfficeExpense(body);
      await onSaved(res.message || "Saved.");
    } catch (e) {
      setErr(errorText(e, "Could not save."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className={`${cardClass} p-4 space-y-3`}>
      <p className="text-xs font-mono uppercase tracking-wider text-slate">{entry ? "Edit voucher" : "Record an office expense"}</p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="text-xs text-slate space-y-1">
          <span>Date</span>
          <input className={inputClass} type="date" value={form.entry_date} onChange={(e) => set({ entry_date: e.target.value })} required />
        </label>
        <label className="text-xs text-slate space-y-1">
          <span>Amount (USD)</span>
          <input className={inputClass} type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set({ amount: e.target.value })} required autoFocus />
        </label>
        <label className="text-xs text-slate space-y-1">
          <span>Paid from</span>
          <select className={inputClass} value={form.paid_via} onChange={(e) => set({ paid_via: e.target.value as "bank" | "cash" })}>
            <option value="cash">Cash (HQ Cash)</option>
            <option value="bank">Bank / card (match when statement arrives)</option>
          </select>
        </label>
        <label className="text-xs text-slate space-y-1">
          <span>What it was for</span>
          <select className={inputClass} value={form.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">Choose...</option>
            {categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate space-y-1">
          <span>Paid to (shop / supplier)</span>
          <input className={inputClass} value={form.counterparty_name} onChange={(e) => set({ counterparty_name: e.target.value })} />
        </label>
        <label className="text-xs text-slate space-y-1">
          <span>Receipt / invoice no.</span>
          <input className={inputClass} value={form.reference} onChange={(e) => set({ reference: e.target.value })} />
        </label>
        <label className="text-xs text-slate space-y-1 md:col-span-2">
          <span>Details</span>
          <input className={inputClass} placeholder="e.g. printer toner, October internet" value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <label className="text-xs text-slate space-y-1">
          <span>Spent by</span>
          <input className={inputClass} placeholder="Who paid / collected the cash" value={form.spent_by} onChange={(e) => set({ spent_by: e.target.value })} />
        </label>
        <label className="text-xs text-slate space-y-1">
          <span>Department (optional)</span>
          <select className={inputClass} value={form.department_id} onChange={(e) => set({ department_id: e.target.value })}>
            <option value="">Head office (none)</option>
            {departments.map((d: RecordData) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>
      <p className="text-[11px] text-slate">
        {account ? `Posts to ledger account ${account} ${categoryLabel(form.category)}. ` : ""}
        {form.paid_via === "cash"
          ? "Comes out of HQ Cash, bringing down the cash still to be accounted for."
          : "Sits in “Recorded, awaiting bank statement” until the statement line is matched."}
        {" "}Attach the receipt and approve it from the list once saved.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={buttonClass} type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{entry ? "Save changes" : "Record"}
        </button>
        <button className={ghostClass} type="button" onClick={onCancel}>Cancel</button>
        {err && <span className="text-sm text-red-300">{err}</span>}
      </div>
    </form>
  );
}
