"use client";

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Clock, Landmark, Loader2, Pencil, Plus, Search, Trash2, Unlink, Wallet, X } from "lucide-react";
import {
  createProjectMoneyEntry,
  dismissProjectEntrySuggestion,
  getProjectEntryCandidates,
  matchProjectEntry,
  unmatchProjectEntry,
  updateProjectMoneyEntry,
  voidProjectMoneyEntry,
  type ProjectMoneyEntryInput,
} from "@/lib/api";
import { CATEGORIES, categoryLabel } from "./BankStatementReviewPanel";

type RecordData = Record<string, any>;
type Direction = "in" | "out";

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center justify-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";
const ghostClass = "inline-flex items-center justify-center gap-2 border border-ink-mid text-paper px-3 py-2 rounded-sm text-sm hover:border-signal/50 disabled:opacity-50";
const cardClass = "bg-ink-light border border-ink-mid rounded-lg";

const IN_CATEGORIES = CATEGORIES.filter((c) => ["client_receipt", "refund", "other"].includes(c.value));
const OUT_CATEGORIES = CATEGORIES.filter((c) => !["client_receipt", "capital_injection", "internal_transfer", "cash_withdrawal", "reversal", "site_petty_cash", "refund"].includes(c.value));

function money(value: unknown) {
  const n = Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function errorText(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

// ---------------------------------------------------------------------------

/**
 * Money recorded straight onto the project. Each entry is in the books the
 * moment it is saved (claim or cost, petty cash, ledger); bank entries are
 * paired with their statement line when the statement is uploaded, and
 * anything the matcher isn't sure about is asked here.
 */
export function RecordedEntries({ direction, entries, payableClaims, projectId, autoOpen, onAutoOpened, onChanged }: {
  direction: Direction;
  entries: RecordData[];
  payableClaims: RecordData[];
  projectId: string;
  autoOpen?: boolean;
  onAutoOpened?: () => void;
  onChanged: (msg?: string) => Promise<void>;
}) {
  const [formFor, setFormFor] = useState<RecordData | "new" | null>(autoOpen ? "new" : null);
  const [findFor, setFindFor] = useState<RecordData | null>(null);
  const rows = entries.filter((e) => e.direction === direction);
  const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
  const decide = rows.filter((e) => e.match_status === "suggested" && (e.suggestions || []).length > 0);

  useEffect(() => {
    if (autoOpen) { setFormFor("new"); onAutoOpened?.(); }
  }, [autoOpen, onAutoOpened]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-paper">Recorded on this project</h3>
          <p className="text-xs text-slate">
            {direction === "in"
              ? "Receipts you record here count as collected at once. When the bank statement is uploaded they are matched to the bank line."
              : "Costs you record here count against the project at once. When the bank statement is uploaded they are matched to the payment."}
          </p>
        </div>
        {formFor === null && (
          <button className={buttonClass} onClick={() => setFormFor("new")}>
            <Plus className="h-4 w-4" />{direction === "in" ? "Record money in" : "Record a cost"}
          </button>
        )}
      </div>

      {formFor !== null && (
        <EntryForm
          direction={direction}
          projectId={projectId}
          entry={formFor === "new" ? null : formFor}
          payableClaims={payableClaims}
          onCancel={() => setFormFor(null)}
          onSaved={async (msg) => { setFormFor(null); await onChanged(msg); }}
        />
      )}

      {decide.length > 0 && (
        <div className="border border-amber-500/30 bg-amber-950/20 text-amber-100 px-4 py-3 text-sm space-y-3">
          <p className="font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Which bank line is this? The bank statement has more than one possibility.</p>
          {decide.map((e) => <SuggestionBlock key={e.id} entry={e} onChanged={onChanged} onFind={() => setFindFor(e)} />)}
        </div>
      )}

      {rows.length === 0 ? (
        formFor === null && <p className="text-sm text-slate">Nothing recorded here yet.</p>
      ) : (
        <div className={`${cardClass} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px] tracking-wider">
                  <th className="p-2">Date</th><th className="p-2">{direction === "in" ? "From" : "Paid to"}</th>
                  <th className="p-2 min-w-[200px]">What for</th><th className="p-2">Category</th>
                  <th className="p-2">Bank statement</th><th className="p-2 text-right">Amount</th><th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {rows.map((e) => (
                  <EntryRow key={e.id} entry={e} direction={direction} onEdit={() => setFormFor(e)} onFind={() => setFindFor(e)} onChanged={onChanged} />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink-mid">
                  <td colSpan={5} className="p-2 text-right text-slate font-mono uppercase text-[10px]">{rows.length} recorded</td>
                  <td className={`p-2 text-right font-mono ${direction === "in" ? "text-emerald-300" : "text-red-300"}`}>{money(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {findFor && (
        <FindOnBank entry={findFor} onClose={() => setFindFor(null)} onMatched={async (msg) => { setFindFor(null); await onChanged(msg); }} />
      )}
    </section>
  );
}

function StatusChip({ entry }: { entry: RecordData }) {
  if (entry.paid_via === "cash") {
    return <span className="inline-flex items-center gap-1 text-slate-light"><Wallet className="h-3.5 w-3.5" />Cash (HQ Petty Cash)</span>;
  }
  if (entry.match_status === "matched") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-300" title={entry.bank_description || ""}>
        <CheckCircle2 className="h-3.5 w-3.5" />{entry.bank_date}{entry.bank_reference ? ` · ${entry.bank_reference}` : ""}
      </span>
    );
  }
  if (entry.match_status === "suggested" && (entry.suggestions || []).length > 0) {
    return <span className="inline-flex items-center gap-1 text-amber-300"><AlertTriangle className="h-3.5 w-3.5" />Needs you to confirm</span>;
  }
  return <span className="inline-flex items-center gap-1 text-slate"><Clock className="h-3.5 w-3.5" />Awaiting statement</span>;
}

function EntryRow({ entry, direction, onEdit, onFind, onChanged }: {
  entry: RecordData; direction: Direction; onEdit: () => void; onFind: () => void; onChanged: (msg?: string) => Promise<void>;
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
    const note = entry.match_status === "matched" ? " The bank line will keep this project and carry the books itself." : "";
    if (window.confirm(`Remove this ${money(entry.amount)} entry? Its claim/cost and ledger posting are reversed.${note}`)) {
      void run(() => voidProjectMoneyEntry(entry.id), "Entry removed.");
    }
  };
  return (
    <tr className="align-top hover:bg-ink-mid/20">
      <td className="p-2 font-mono text-slate-light whitespace-nowrap">{entry.entry_date}</td>
      <td className="p-2 text-paper">{entry.counterparty_name || <span className="text-slate">-</span>}</td>
      <td className="p-2 text-paper">
        <div className="line-clamp-2">{entry.description || <span className="text-slate">-</span>}</div>
        <div className="text-[10px] text-slate font-mono mt-0.5">
          {entry.reference}
          {entry.pays_claim_number && <span className="ml-2 font-sans text-signal">pays claim {entry.pays_claim_number}</span>}
        </div>
        {err && <div className="text-[11px] text-red-300 mt-1">{err}</div>}
      </td>
      <td className="p-2 text-slate-light">{categoryLabel(entry.category) || (direction === "in" ? "Client receipt" : <span className="text-amber-300">Not set</span>)}</td>
      <td className="p-2 whitespace-nowrap"><StatusChip entry={entry} /></td>
      <td className={`p-2 text-right font-mono whitespace-nowrap ${direction === "in" ? "text-emerald-300" : "text-red-300"}`}>{money(entry.amount)}</td>
      <td className="p-2 text-right whitespace-nowrap">
        {busy ? <Loader2 className="h-4 w-4 animate-spin inline text-slate" /> : (
          <span className="inline-flex gap-3">
            {entry.paid_via === "bank" && entry.match_status !== "matched" && (
              <button onClick={onFind} className="text-signal hover:underline inline-flex items-center gap-1" title="Find it on the bank statement"><Landmark className="h-3.5 w-3.5" />Find</button>
            )}
            {entry.match_status === "matched" && (
              <button onClick={() => void run(() => unmatchProjectEntry(entry.id), "Unmatched.")} className="text-slate hover:text-signal inline-flex items-center gap-1" title="That bank line isn't this entry"><Unlink className="h-3.5 w-3.5" />Unmatch</button>
            )}
            <button onClick={onEdit} className="text-slate hover:text-signal" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={remove} className="text-slate hover:text-red-300" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
          </span>
        )}
      </td>
    </tr>
  );
}

function SuggestionBlock({ entry, onChanged, onFind }: { entry: RecordData; onChanged: (msg?: string) => Promise<void>; onFind: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (lineId: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(lineId);
    setErr(null);
    try {
      await fn();
      await onChanged(msg);
    } catch (e) {
      setErr(errorText(e, "Could not do that."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="bg-ink/40 border border-amber-500/20 rounded p-3">
      <p className="text-paper text-xs mb-2">
        You recorded <span className="font-mono">{money(entry.amount)}</span> on {entry.entry_date}
        {entry.counterparty_name ? ` · ${entry.counterparty_name}` : ""}{entry.description ? ` · ${entry.description}` : ""}
      </p>
      <div className="space-y-1">
        {(entry.suggestions as RecordData[]).map((s) => (
          <div key={s.id} className="grid grid-cols-[90px_1fr_auto] gap-3 items-center text-xs">
            <span className="font-mono text-slate-light">{s.transaction_date}</span>
            <span className="text-paper line-clamp-1">{s.description} <span className="text-slate font-mono">{s.reference}</span></span>
            <span className="whitespace-nowrap space-x-3">
              {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : (
                <>
                  <button className="text-signal hover:underline" onClick={() => void act(s.id, () => matchProjectEntry(entry.id, s.id), "Matched to the bank statement.")}>This is it</button>
                  <button className="text-slate hover:text-paper" onClick={() => void act(s.id, () => dismissProjectEntrySuggestion(entry.id, s.id), "Suggestion dismissed.")}>Not this</button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
      <button className="text-[11px] text-slate hover:text-signal mt-2" onClick={onFind}>None of these - search the statement</button>
      {err && <p className="text-xs text-red-300 mt-1">{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function EntryForm({ direction, projectId, entry, payableClaims, onCancel, onSaved }: {
  direction: Direction;
  projectId: string;
  entry: RecordData | null;
  payableClaims: RecordData[];
  onCancel: () => void;
  onSaved: (msg: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    entry_date: entry?.entry_date || today(),
    amount: entry ? String(entry.amount) : "",
    paid_via: (entry?.paid_via || "bank") as "bank" | "cash",
    category: entry?.category || (direction === "in" ? "client_receipt" : ""),
    counterparty_name: entry?.counterparty_name || "",
    reference: entry?.reference || "",
    description: entry?.description || "",
    pays_claim_id: entry?.pays_claim_id || "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const claims = entry?.pays_claim_id && !payableClaims.some((c) => c.id === entry.pays_claim_id)
    ? [{ id: entry.pays_claim_id, claim_number: entry.pays_claim_number, status: "paid", net_claim_amount: entry.amount }, ...payableClaims]
    : payableClaims;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!(Number(form.amount) > 0)) { setErr("Enter an amount above zero."); return; }
    if (direction === "out" && !form.category) { setErr("Pick what kind of cost this is."); return; }
    setBusy(true);
    setErr(null);
    const body: ProjectMoneyEntryInput = {
      direction, paid_via: form.paid_via, entry_date: form.entry_date, amount: Number(form.amount),
      category: form.category || null, counterparty_name: form.counterparty_name || null,
      reference: form.reference || null, description: form.description || null,
      pays_claim_id: direction === "in" ? (form.pays_claim_id || null) : null,
    };
    try {
      const res = entry ? await updateProjectMoneyEntry(entry.id, body) : await createProjectMoneyEntry(projectId, body);
      await onSaved(res.message || "Saved.");
    } catch (e) {
      setErr(errorText(e, "Could not save."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className={`${cardClass} p-4 space-y-3`}>
      <p className="text-xs font-mono uppercase tracking-wider text-slate">
        {entry ? "Edit entry" : direction === "in" ? "Record money received" : "Record a cost"}
      </p>
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
          <span>{direction === "in" ? "Received into" : "Paid from"}</span>
          <select className={inputClass} value={form.paid_via} onChange={(e) => set({ paid_via: e.target.value as "bank" | "cash" })}>
            <option value="bank">Bank (match when statement arrives)</option>
            <option value="cash">Cash (HQ Petty Cash)</option>
          </select>
        </label>
        <label className="text-xs text-slate space-y-1">
          <span>{direction === "in" ? "Type" : "Cost type"}</span>
          <select className={inputClass} value={form.category} onChange={(e) => set({ category: e.target.value })}>
            {direction === "out" && <option value="">Choose...</option>}
            {(direction === "in" ? IN_CATEGORIES : OUT_CATEGORIES).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate space-y-1">
          <span>{direction === "in" ? "From (client)" : "Paid to (supplier / person)"}</span>
          <input className={inputClass} value={form.counterparty_name} onChange={(e) => set({ counterparty_name: e.target.value })} />
        </label>
        <label className="text-xs text-slate space-y-1">
          <span>Reference</span>
          <input className={inputClass} placeholder="Invoice, POP or RTGS ref" value={form.reference} onChange={(e) => set({ reference: e.target.value })} />
        </label>
        <label className="text-xs text-slate space-y-1 md:col-span-2">
          <span>What for</span>
          <input className={inputClass} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        {direction === "in" && (
          <label className="text-xs text-slate space-y-1 md:col-span-2">
            <span>Pays a claim already raised?</span>
            <select
              className={inputClass}
              value={form.pays_claim_id}
              onChange={(e) => {
                const claim = claims.find((c) => c.id === e.target.value);
                set({ pays_claim_id: e.target.value, ...(claim && !form.amount ? { amount: String(claim.net_claim_amount ?? claim.certified_amount ?? "") } : {}) });
              }}
            >
              <option value="">No - record it as a new payment received</option>
              {claims.map((c) => (
                <option key={c.id} value={c.id}>{c.claim_number} · {String(c.status).toUpperCase()} · {money(c.net_claim_amount ?? c.certified_amount)}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="text-[11px] text-slate">
        {form.paid_via === "cash"
          ? `Goes through HQ Petty Cash${direction === "out" ? " (reduces the cash still to be accounted for)" : ""}; no bank match needed.`
          : direction === "in"
            ? form.pays_claim_id ? "Marks that claim paid. The receipt clears the claim's receivable in the ledger." : "Adds a paid claim to this project and posts the revenue now."
            : "Adds the cost to this project and posts it to the ledger now."}
        {form.paid_via === "bank" && " Until the bank statement shows it, it sits in “Recorded, awaiting bank statement”."}
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

// ---------------------------------------------------------------------------

function FindOnBank({ entry, onClose, onMatched }: { entry: RecordData; onClose: () => void; onMatched: (msg: string) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const search = useCallback(async (term?: string) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await getProjectEntryCandidates(entry.id, term);
      setRows(res.data || []);
    } catch (e) {
      setErr(errorText(e, "Could not search the statement."));
    } finally {
      setLoading(false);
    }
  }, [entry.id]);

  useEffect(() => { void search(); }, [search]);

  const pick = async (line: RecordData) => {
    const bankAmount = Math.abs(Number(line.amount));
    const differs = Math.abs(bankAmount - Number(entry.amount)) > 0.004;
    if (differs && !window.confirm(`The bank shows ${money(bankAmount)} but you recorded ${money(entry.amount)}. Change the entry to the bank amount and match?`)) return;
    setBusy(line.id);
    setErr(null);
    try {
      if (differs) await updateProjectMoneyEntry(entry.id, { amount: bankAmount });
      await matchProjectEntry(entry.id, line.id);
      await onMatched(differs ? `Amount changed to ${money(bankAmount)} and matched.` : "Matched to the bank statement.");
    } catch (e) {
      setErr(errorText(e, "Could not match."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-3" role="dialog" aria-modal="true">
      <div className="bg-ink-light border border-ink-mid rounded-lg w-full max-w-4xl max-h-[88vh] flex flex-col">
        <div className="px-5 py-4 border-b border-ink-mid flex justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate">Find this on the bank statement</p>
            <p className="text-paper font-semibold mt-1">{money(entry.amount)} · {entry.entry_date}{entry.counterparty_name ? ` · ${entry.counterparty_name}` : ""}</p>
            <p className="text-xs text-slate mt-1">Showing {entry.direction === "in" ? "money in" : "money out"} lines with the same amount within 45 days. Search to see others (e.g. if bank charges were deducted).</p>
          </div>
          <button onClick={onClose} className="text-slate hover:text-paper self-start" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <form className="px-5 pt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(q); }}>
          <div className="relative flex-1">
            <Search className="h-4 w-4 text-slate absolute left-3 top-1/2 -translate-y-1/2" />
            <input className={`${inputClass} pl-9`} placeholder="Description, reference, name or amount" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className={buttonClass} type="submit">Search</button>
        </form>
        <div className="flex-1 overflow-y-auto p-5">
          {err && <p className="text-sm text-red-300 mb-2">{err}</p>}
          {loading ? <p className="text-sm text-slate"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Searching...</p>
            : rows.length === 0 ? <p className="text-sm text-slate">No unmatched bank line fits. If the statement covering this date hasn&apos;t been uploaded yet, it will be matched when it is.</p>
              : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px] tracking-wider">
                      <th className="p-2">Date</th><th className="p-2">Bank line</th><th className="p-2">Tagged</th><th className="p-2 text-right">Amount</th><th className="p-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {rows.map((r) => (
                      <tr key={r.id} className="align-top hover:bg-ink-mid/20">
                        <td className="p-2 font-mono text-slate-light whitespace-nowrap">{r.transaction_date}<div className="text-[10px] text-slate">{r.days_apart} days off</div></td>
                        <td className="p-2 text-paper"><div className="line-clamp-2">{r.description}</div><div className="text-[10px] text-slate font-mono">{r.reference}{r.counterparty_name ? <span className="font-sans"> · {r.counterparty_name}</span> : null}</div></td>
                        <td className="p-2 text-slate-light">{r.project_name || "-"}{r.category ? <div className="text-[10px]">{categoryLabel(r.category)}</div> : null}</td>
                        <td className={`p-2 text-right font-mono whitespace-nowrap ${r.same_amount ? "text-paper" : "text-amber-300"}`}>{money(Math.abs(Number(r.amount)))}</td>
                        <td className="p-2 text-right whitespace-nowrap">
                          <button disabled={busy !== null} onClick={() => void pick(r)} className="text-signal hover:underline disabled:opacity-50">
                            {busy === r.id ? "Matching..." : "This is it"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
        </div>
      </div>
    </div>
  );
}
