"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Send, RotateCcw, Trash2, Lock, LockOpen, ChevronDown, ChevronRight, Check, X } from "lucide-react";
import {
  getChartOfAccounts, createChartOfAccount,
  getAccountingPeriods, createAccountingPeriod, softCloseAccountingPeriod, closeAccountingPeriod, reopenAccountingPeriod, lockAccountingPeriod,
  getJournalEntries, getJournalEntry, createJournalEntry, deleteJournalEntry, postJournalEntry, reverseJournalEntry,
  getTrialBalance,
  getGlBridgeProposals, approveGlBridgeProposal, rejectGlBridgeProposal,
} from "@/lib/api";
import { useLiveTable } from "@/lib/live/LiveDataProvider";

type RecordData = Record<string, any>;
type View = "journals" | "proposals" | "accounts" | "periods" | "trial-balance";

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number.isFinite(num) ? num : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";
const tabButtonClass = (active: boolean) =>
  `px-4 py-2 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px ${active ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`;

const ACCOUNT_CATEGORIES = [
  "asset", "liability", "equity", "revenue", "direct_project_cost",
  "operating_expense", "other_income", "other_expense", "tax",
];

const PERIOD_STATUS_CLASS: Record<string, string> = {
  open: "border-emerald-500/30 bg-emerald-950/20 text-emerald-300",
  soft_closed: "border-amber-500/30 bg-amber-950/20 text-amber-300",
  closed: "border-slate-500/30 bg-slate-950/20 text-slate-300",
  audited: "border-sky-500/30 bg-sky-950/20 text-sky-300",
  locked: "border-red-500/30 bg-red-950/20 text-red-300",
};

const JOURNAL_STATUS_CLASS: Record<string, string> = {
  draft: "border-slate-500/30 bg-slate-950/20 text-slate-300",
  posted: "border-emerald-500/30 bg-emerald-950/20 text-emerald-300",
};

function emptyLine() {
  return { account_id: "", debit_amount: "", credit_amount: "", description: "" };
}

export function GeneralLedgerPanel() {
  const [view, setView] = useState<View>("journals");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<RecordData[]>([]);
  const [periods, setPeriods] = useState<RecordData[]>([]);
  const [journals, setJournals] = useState<RecordData[]>([]);
  const [proposals, setProposals] = useState<RecordData[]>([]);
  const [trialBalance, setTrialBalance] = useState<RecordData[]>([]);
  const [expandedJournalId, setExpandedJournalId] = useState<string | null>(null);
  const [journalDetail, setJournalDetail] = useState<RecordData | null>(null);

  const [showNewAccount, setShowNewAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({ account_code: "", account_name: "", account_category: "operating_expense", normal_balance: "debit", description: "" });

  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [periodForm, setPeriodForm] = useState({ period_start: monthStart(), period_end: today() });
  const [reopenTargetId, setReopenTargetId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  const [showNewJournal, setShowNewJournal] = useState(false);
  const [journalForm, setJournalForm] = useState({ period_id: "", entry_date: today(), description: "" });
  const [journalLines, setJournalLines] = useState<RecordData[]>([emptyLine(), emptyLine()]);

  const openPeriods = useMemo(() => periods.filter((p) => p.status === "open" || p.status === "soft_closed"), [periods]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [acctRes, periodRes, journalRes] = await Promise.all([
        getChartOfAccounts(),
        getAccountingPeriods(),
        getJournalEntries({ page_size: 100 }),
      ]);
      setAccounts(acctRes.data || []);
      setPeriods(periodRes.data || []);
      setJournals(journalRes.data || []);
    } catch {
      setNotice("Failed to load General Ledger data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrialBalance = useCallback(async () => {
    try {
      const res = await getTrialBalance();
      setTrialBalance(res.data || []);
    } catch {
      setTrialBalance([]);
    }
  }, []);

  const loadProposals = useCallback(async () => {
    try {
      const res = await getGlBridgeProposals("pending_review");
      setProposals(res.data || []);
    } catch {
      setProposals([]);
    }
  }, []);

  useEffect(() => { void loadAll(); void loadProposals(); }, [loadAll, loadProposals]);
  useEffect(() => { if (view === "trial-balance") void loadTrialBalance(); }, [view, loadTrialBalance]);

  useLiveTable("finance.journal_entries", () => { void loadAll(); void loadProposals(); });
  useLiveTable("finance.accounting_periods", () => void loadAll());
  useLiveTable("finance.chart_of_accounts", () => void loadAll());

  const toggleJournalExpand = async (id: string) => {
    if (expandedJournalId === id) {
      setExpandedJournalId(null);
      setJournalDetail(null);
      return;
    }
    setExpandedJournalId(id);
    try {
      const res = await getJournalEntry(id);
      setJournalDetail(res.data);
    } catch {
      setJournalDetail(null);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createChartOfAccount(accountForm);
      setNotice("Account created.");
      setShowNewAccount(false);
      setAccountForm({ account_code: "", account_name: "", account_category: "operating_expense", normal_balance: "debit", description: "" });
      await loadAll();
    } catch {
      setNotice("Failed to create account.");
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createAccountingPeriod(periodForm);
      setNotice("Accounting period created.");
      setShowNewPeriod(false);
      await loadAll();
    } catch {
      setNotice("Failed to create accounting period.");
    } finally {
      setBusy(false);
    }
  };

  const handlePeriodAction = async (action: "soft-close" | "close" | "lock", periodId: string) => {
    setBusy(true);
    try {
      if (action === "soft-close") await softCloseAccountingPeriod(periodId);
      if (action === "close") await closeAccountingPeriod(periodId);
      if (action === "lock") await lockAccountingPeriod(periodId);
      setNotice("Period updated.");
      await loadAll();
    } catch (err: any) {
      setNotice(err?.message || "Cannot close period - draft journals may remain open in it.");
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    if (!reopenTargetId || !reopenReason.trim()) return;
    setBusy(true);
    try {
      await reopenAccountingPeriod(reopenTargetId, reopenReason);
      setNotice("Period reopened.");
      setReopenTargetId(null);
      setReopenReason("");
      await loadAll();
    } catch {
      setNotice("Failed to reopen period.");
    } finally {
      setBusy(false);
    }
  };

  const lineTotals = useMemo(() => {
    const debit = journalLines.reduce((sum, l) => sum + (Number(l.debit_amount) || 0), 0);
    const credit = journalLines.reduce((sum, l) => sum + (Number(l.credit_amount) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 && debit > 0 };
  }, [journalLines]);

  const handleCreateJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createJournalEntry({
        ...journalForm,
        lines: journalLines
          .filter((l) => l.account_id && (Number(l.debit_amount) > 0 || Number(l.credit_amount) > 0))
          .map((l) => ({
            account_id: l.account_id,
            debit_amount: Number(l.debit_amount) || 0,
            credit_amount: Number(l.credit_amount) || 0,
            description: l.description || undefined,
          })),
      });
      setNotice("Journal entry created as draft.");
      setShowNewJournal(false);
      setJournalForm({ period_id: "", entry_date: today(), description: "" });
      setJournalLines([emptyLine(), emptyLine()]);
      await loadAll();
    } catch (err: any) {
      setNotice(err?.message || "Failed to create journal entry - check that debits equal credits.");
    } finally {
      setBusy(false);
    }
  };

  const handlePost = async (id: string) => {
    setBusy(true);
    try {
      await postJournalEntry(id);
      setNotice("Journal entry posted.");
      await loadAll();
    } catch (err: any) {
      setNotice(err?.message || "Failed to post journal entry.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteJournalEntry(id);
      setNotice("Draft journal entry deleted.");
      await loadAll();
    } catch {
      setNotice("Only draft journal entries can be deleted.");
    } finally {
      setBusy(false);
    }
  };

  const handleReverse = async (id: string) => {
    const reason = window.prompt("Reason for reversal (required):");
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      await reverseJournalEntry(id, { reversal_date: today(), reason });
      setNotice("Journal entry reversed.");
      await loadAll();
    } catch (err: any) {
      setNotice(err?.message || "Failed to reverse journal entry.");
    } finally {
      setBusy(false);
    }
  };

  const handleApproveProposal = async (id: string) => {
    setBusy(true);
    try {
      await approveGlBridgeProposal(id);
      setNotice("Proposal approved and posted to the ledger.");
      await loadAll();
      await loadProposals();
    } catch (err: any) {
      setNotice(err?.message || "Failed to approve proposal.");
    } finally {
      setBusy(false);
    }
  };

  const handleRejectProposal = async (id: string) => {
    const reason = window.prompt("Reason for rejecting this proposed journal (required):");
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      await rejectGlBridgeProposal(id, reason);
      setNotice("Proposal rejected. It stays on record as an un-postable draft for audit.");
      await loadProposals();
    } catch (err: any) {
      setNotice(err?.message || "Failed to reject proposal.");
    } finally {
      setBusy(false);
    }
  };

  const trialBalanceTotals = useMemo(() => {
    const debit = trialBalance.reduce((sum, r) => sum + Number(r.total_debit || 0), 0);
    const credit = trialBalance.reduce((sum, r) => sum + Number(r.total_credit || 0), 0);
    return { debit, credit };
  }, [trialBalance]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-signal">General Ledger</h2>
          <p className="text-xs text-slate-light mt-0.5">Double-entry journals, chart of accounts and accounting period control.</p>
        </div>
      </div>

      {notice && (
        <div className="px-4 py-2 text-xs text-paper border border-ink-mid rounded-sm bg-signal/10 flex justify-between items-center">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper">&times;</button>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-ink-mid">
        <button onClick={() => setView("journals")} className={tabButtonClass(view === "journals")}>Journals</button>
        <button onClick={() => setView("proposals")} className={`${tabButtonClass(view === "proposals")} inline-flex items-center gap-1.5`}>
          Proposed Journals
          {proposals.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-amber-950/40 border border-amber-500/30 text-amber-300">{proposals.length}</span>
          )}
        </button>
        <button onClick={() => setView("accounts")} className={tabButtonClass(view === "accounts")}>Chart of Accounts</button>
        <button onClick={() => setView("periods")} className={tabButtonClass(view === "periods")}>Accounting Periods</button>
        <button onClick={() => setView("trial-balance")} className={tabButtonClass(view === "trial-balance")}>Trial Balance</button>
        <div className="flex-1" />
        {view === "journals" && (
          <button onClick={() => setShowNewJournal(true)} className="flex items-center gap-1.5 text-xs text-slate hover:text-paper mb-2">
            <Plus className="h-3.5 w-3.5" />New journal
          </button>
        )}
        {view === "accounts" && (
          <button onClick={() => setShowNewAccount(true)} className="flex items-center gap-1.5 text-xs text-slate hover:text-paper mb-2">
            <Plus className="h-3.5 w-3.5" />New account
          </button>
        )}
        {view === "periods" && (
          <button onClick={() => setShowNewPeriod(true)} className="flex items-center gap-1.5 text-xs text-slate hover:text-paper mb-2">
            <Plus className="h-3.5 w-3.5" />New period
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-8 text-slate"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          {view === "journals" && (
            <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4"></th>
                      <th className="p-4">Journal</th>
                      <th className="p-4">Date</th>
                      <th className="p-4">Period</th>
                      <th className="p-4">Description</th>
                      <th className="p-4">Source</th>
                      <th className="p-4 text-right">Debit</th>
                      <th className="p-4 text-right">Credit</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {journals.length === 0 ? (
                      <tr><td colSpan={10} className="p-4 text-center text-slate">No journal entries recorded.</td></tr>
                    ) : (
                      journals.map((j) => (
                        <Fragment key={j.id}>
                          <tr className="hover:bg-ink-mid/10 cursor-pointer" onClick={() => void toggleJournalExpand(j.id)}>
                            <td className="p-4 text-slate">{expandedJournalId === j.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                            <td className="p-4 font-mono text-signal">{j.journal_number}</td>
                            <td className="p-4 text-slate-light">{j.entry_date}</td>
                            <td className="p-4 text-slate-light">{j.period_code}</td>
                            <td className="p-4 text-paper max-w-xs truncate">{j.description}</td>
                            <td className="p-4 text-slate-light">{j.source_type || "manual"}</td>
                            <td className="p-4 text-right text-paper">{money(j.total_debit)}</td>
                            <td className="p-4 text-right text-paper">{money(j.total_credit)}</td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${JOURNAL_STATUS_CLASS[j.status] || ""}`}>{j.status}</span>
                            </td>
                            <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-2">
                                {j.status === "draft" && (
                                  <>
                                    <button onClick={() => void handlePost(j.id)} disabled={busy} className="text-slate hover:text-emerald-400 disabled:opacity-50" title="Post"><Send className="h-4 w-4" /></button>
                                    <button onClick={() => void handleDelete(j.id)} disabled={busy} className="text-slate hover:text-red-400 disabled:opacity-50" title="Delete draft"><Trash2 className="h-4 w-4" /></button>
                                  </>
                                )}
                                {j.status === "posted" && !j.reversed_by_journal_id && (
                                  <button onClick={() => void handleReverse(j.id)} disabled={busy} className="text-slate hover:text-amber-400 disabled:opacity-50" title="Reverse"><RotateCcw className="h-4 w-4" /></button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expandedJournalId === j.id && journalDetail && (
                            <tr>
                              <td colSpan={10} className="p-0 bg-ink/40">
                                <table className="w-full text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="text-slate font-mono text-[10px] uppercase tracking-wider">
                                      <th className="px-6 py-2">Account</th>
                                      <th className="px-6 py-2">Description</th>
                                      <th className="px-6 py-2 text-right">Debit</th>
                                      <th className="px-6 py-2 text-right">Credit</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-ink-mid/50">
                                    {(journalDetail.lines || []).map((line: RecordData) => (
                                      <tr key={line.id}>
                                        <td className="px-6 py-2 text-paper">{line.account_code} &middot; {line.account_name}</td>
                                        <td className="px-6 py-2 text-slate-light">{line.description || "—"}</td>
                                        <td className="px-6 py-2 text-right text-paper">{Number(line.debit_amount) > 0 ? money(line.debit_amount) : ""}</td>
                                        <td className="px-6 py-2 text-right text-paper">{Number(line.credit_amount) > 0 ? money(line.credit_amount) : ""}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === "proposals" && (
            <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
              <div className="px-4 pt-4 text-xs text-slate-light">
                System-interpreted journals awaiting review. Approving posts the journal to the ledger unchanged; rejecting leaves it as a permanent, un-postable draft for audit — nothing here reaches the General Ledger without a human decision.
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4"></th>
                      <th className="p-4">Journal</th>
                      <th className="p-4">Date</th>
                      <th className="p-4">Source</th>
                      <th className="p-4">Interpretation</th>
                      <th className="p-4 text-right">Amount</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {proposals.length === 0 ? (
                      <tr><td colSpan={7} className="p-4 text-center text-slate">No proposals awaiting review.</td></tr>
                    ) : (
                      proposals.map((p) => (
                        <Fragment key={p.id}>
                          <tr className="hover:bg-ink-mid/10 cursor-pointer" onClick={() => void toggleJournalExpand(p.id)}>
                            <td className="p-4 text-slate">{expandedJournalId === p.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                            <td className="p-4 font-mono text-signal">{p.journal_number}</td>
                            <td className="p-4 text-slate-light">{p.entry_date}</td>
                            <td className="p-4 text-slate-light capitalize">{String(p.source_type || "").replace(/_/g, " ")}</td>
                            <td className="p-4 text-paper max-w-sm truncate">{p.description}</td>
                            <td className="p-4 text-right text-paper">{money(p.total_debit)}</td>
                            <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-2">
                                <button onClick={() => void handleApproveProposal(p.id)} disabled={busy} className="text-slate hover:text-emerald-400 disabled:opacity-50" title="Approve and post"><Check className="h-4 w-4" /></button>
                                <button onClick={() => void handleRejectProposal(p.id)} disabled={busy} className="text-slate hover:text-red-400 disabled:opacity-50" title="Reject"><X className="h-4 w-4" /></button>
                              </div>
                            </td>
                          </tr>
                          {expandedJournalId === p.id && journalDetail && (
                            <tr>
                              <td colSpan={7} className="p-0 bg-ink/40">
                                <table className="w-full text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="text-slate font-mono text-[10px] uppercase tracking-wider">
                                      <th className="px-6 py-2">Account</th>
                                      <th className="px-6 py-2">Dimensions</th>
                                      <th className="px-6 py-2 text-right">Debit</th>
                                      <th className="px-6 py-2 text-right">Credit</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-ink-mid/50">
                                    {(journalDetail.lines || []).map((line: RecordData) => (
                                      <tr key={line.id}>
                                        <td className="px-6 py-2 text-paper">{line.account_code} &middot; {line.account_name}</td>
                                        <td className="px-6 py-2 text-slate-light">{line.project_id ? "Project-tagged" : "—"}</td>
                                        <td className="px-6 py-2 text-right text-paper">{Number(line.debit_amount) > 0 ? money(line.debit_amount) : ""}</td>
                                        <td className="px-6 py-2 text-right text-paper">{Number(line.credit_amount) > 0 ? money(line.credit_amount) : ""}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === "accounts" && (
            <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4">Code</th>
                      <th className="p-4">Name</th>
                      <th className="p-4">Category</th>
                      <th className="p-4">Normal Balance</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {accounts.map((a) => (
                      <tr key={a.id} className="hover:bg-ink-mid/10">
                        <td className="p-4 font-mono text-signal">{a.account_code}</td>
                        <td className="p-4 text-paper">{a.account_name}</td>
                        <td className="p-4 text-slate-light capitalize">{String(a.account_category || "").replace(/_/g, " ")}</td>
                        <td className="p-4 text-slate-light capitalize">{a.normal_balance}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${a.is_active ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300" : "border-slate-500/30 bg-slate-950/20 text-slate-300"}`}>
                            {a.is_active ? "active" : "inactive"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === "periods" && (
            <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4">Period</th>
                      <th className="p-4">Start</th>
                      <th className="p-4">End</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {periods.map((p) => (
                      <tr key={p.id} className="hover:bg-ink-mid/10">
                        <td className="p-4 font-mono text-signal">{p.period_code}</td>
                        <td className="p-4 text-slate-light">{p.period_start}</td>
                        <td className="p-4 text-slate-light">{p.period_end}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${PERIOD_STATUS_CLASS[p.status] || ""}`}>{p.status}</span>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex justify-end gap-3">
                            {p.status === "open" && (
                              <button onClick={() => void handlePeriodAction("soft-close", p.id)} disabled={busy} className="text-xs text-slate hover:text-amber-400 disabled:opacity-50">Soft-close</button>
                            )}
                            {(p.status === "open" || p.status === "soft_closed") && (
                              <button onClick={() => void handlePeriodAction("close", p.id)} disabled={busy} className="text-xs text-slate hover:text-paper disabled:opacity-50">Close</button>
                            )}
                            {(p.status === "closed" || p.status === "audited" || p.status === "locked") && (
                              <button onClick={() => setReopenTargetId(p.id)} disabled={busy} className="text-xs text-slate hover:text-emerald-400 disabled:opacity-50 inline-flex items-center gap-1"><LockOpen className="h-3 w-3" />Reopen</button>
                            )}
                            {(p.status === "closed" || p.status === "audited") && (
                              <button onClick={() => void handlePeriodAction("lock", p.id)} disabled={busy} className="text-xs text-slate hover:text-red-400 disabled:opacity-50 inline-flex items-center gap-1"><Lock className="h-3 w-3" />Lock</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === "trial-balance" && (
            <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4">Code</th>
                      <th className="p-4">Account</th>
                      <th className="p-4">Category</th>
                      <th className="p-4 text-right">Debit</th>
                      <th className="p-4 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {trialBalance.length === 0 ? (
                      <tr><td colSpan={5} className="p-4 text-center text-slate">No posted activity yet.</td></tr>
                    ) : (
                      trialBalance.map((r) => (
                        <tr key={r.account_id} className="hover:bg-ink-mid/10">
                          <td className="p-4 font-mono text-signal">{r.account_code}</td>
                          <td className="p-4 text-paper">{r.account_name}</td>
                          <td className="p-4 text-slate-light capitalize">{String(r.account_category || "").replace(/_/g, " ")}</td>
                          <td className="p-4 text-right text-paper">{money(r.total_debit)}</td>
                          <td className="p-4 text-right text-paper">{money(r.total_credit)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {trialBalance.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-signal/30 font-semibold">
                        <td className="p-4 text-paper" colSpan={3}>Total</td>
                        <td className="p-4 text-right text-paper">{money(trialBalanceTotals.debit)}</td>
                        <td className="p-4 text-right text-paper">{money(trialBalanceTotals.credit)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {showNewAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 w-full max-w-md space-y-4">
            <h3 className="font-mono text-sm uppercase text-signal">New Account</h3>
            <form onSubmit={handleCreateAccount} className="space-y-3">
              <input placeholder="Account code (e.g. 5950)" className={inputClass} value={accountForm.account_code} onChange={(e) => setAccountForm({ ...accountForm, account_code: e.target.value })} required />
              <input placeholder="Account name" className={inputClass} value={accountForm.account_name} onChange={(e) => setAccountForm({ ...accountForm, account_name: e.target.value })} required />
              <div className="grid grid-cols-2 gap-3">
                <select className={inputClass} value={accountForm.account_category} onChange={(e) => setAccountForm({ ...accountForm, account_category: e.target.value })}>
                  {ACCOUNT_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                </select>
                <select className={inputClass} value={accountForm.normal_balance} onChange={(e) => setAccountForm({ ...accountForm, normal_balance: e.target.value })}>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
              <textarea placeholder="Description (optional)" className={inputClass} rows={2} value={accountForm.description} onChange={(e) => setAccountForm({ ...accountForm, description: e.target.value })} />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNewAccount(false)} className="px-3 py-2 text-slate-light hover:text-paper text-sm">Cancel</button>
                <button type="submit" disabled={busy} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create Account</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 w-full max-w-sm space-y-4">
            <h3 className="font-mono text-sm uppercase text-signal">New Accounting Period</h3>
            <form onSubmit={handleCreatePeriod} className="space-y-3">
              <label className="block text-xs text-slate">Period start
                <input type="date" className={inputClass} value={periodForm.period_start} onChange={(e) => setPeriodForm({ ...periodForm, period_start: e.target.value })} required />
              </label>
              <label className="block text-xs text-slate">Period end
                <input type="date" className={inputClass} value={periodForm.period_end} onChange={(e) => setPeriodForm({ ...periodForm, period_end: e.target.value })} required />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNewPeriod(false)} className="px-3 py-2 text-slate-light hover:text-paper text-sm">Cancel</button>
                <button type="submit" disabled={busy} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create Period</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reopenTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 w-full max-w-sm space-y-4">
            <h3 className="font-mono text-sm uppercase text-signal">Reopen Period</h3>
            <p className="text-xs text-slate-light">A reason is required and is recorded in the audit trail.</p>
            <textarea placeholder="Reason for reopening" className={inputClass} rows={3} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} required />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setReopenTargetId(null); setReopenReason(""); }} className="px-3 py-2 text-slate-light hover:text-paper text-sm">Cancel</button>
              <button onClick={() => void handleReopen()} disabled={busy || !reopenReason.trim()} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}Reopen</button>
            </div>
          </div>
        </div>
      )}

      {showNewJournal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-mono text-sm uppercase text-signal">New Journal Entry</h3>
            <form onSubmit={handleCreateJournal} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <select className={inputClass} value={journalForm.period_id} onChange={(e) => setJournalForm({ ...journalForm, period_id: e.target.value })} required>
                  <option value="">Select period</option>
                  {openPeriods.map((p) => <option key={p.id} value={p.id}>{p.period_code} ({p.status})</option>)}
                </select>
                <input type="date" className={inputClass} value={journalForm.entry_date} onChange={(e) => setJournalForm({ ...journalForm, entry_date: e.target.value })} required />
              </div>
              <input placeholder="Description" className={inputClass} value={journalForm.description} onChange={(e) => setJournalForm({ ...journalForm, description: e.target.value })} required />

              <div className="border border-ink-mid rounded-sm divide-y divide-ink-mid">
                {journalLines.map((line, idx) => (
                  <div key={idx} className="p-2 grid grid-cols-12 gap-2 items-center">
                    <select className={`${inputClass} col-span-5`} value={line.account_id} onChange={(e) => {
                      const next = [...journalLines]; next[idx] = { ...line, account_id: e.target.value }; setJournalLines(next);
                    }}>
                      <option value="">Account</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>)}
                    </select>
                    <input type="number" step="0.01" min="0" placeholder="Debit" className={`${inputClass} col-span-2`} value={line.debit_amount} onChange={(e) => {
                      const next = [...journalLines]; next[idx] = { ...line, debit_amount: e.target.value, credit_amount: e.target.value ? "" : line.credit_amount }; setJournalLines(next);
                    }} />
                    <input type="number" step="0.01" min="0" placeholder="Credit" className={`${inputClass} col-span-2`} value={line.credit_amount} onChange={(e) => {
                      const next = [...journalLines]; next[idx] = { ...line, credit_amount: e.target.value, debit_amount: e.target.value ? "" : line.debit_amount }; setJournalLines(next);
                    }} />
                    <input placeholder="Description" className={`${inputClass} col-span-2`} value={line.description} onChange={(e) => {
                      const next = [...journalLines]; next[idx] = { ...line, description: e.target.value }; setJournalLines(next);
                    }} />
                    <button type="button" onClick={() => setJournalLines(journalLines.filter((_, i) => i !== idx))} disabled={journalLines.length <= 2} className="col-span-1 text-slate hover:text-red-400 disabled:opacity-30">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setJournalLines([...journalLines, emptyLine()])} className="text-xs text-slate hover:text-paper flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" />Add line
              </button>

              <div className={`flex justify-between text-sm font-mono px-3 py-2 rounded-sm border ${lineTotals.balanced ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}`}>
                <span>Debit {money(lineTotals.debit)}</span>
                <span>Credit {money(lineTotals.credit)}</span>
                <span>{lineTotals.balanced ? "Balanced" : "Unbalanced"}</span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNewJournal(false)} className="px-3 py-2 text-slate-light hover:text-paper text-sm">Cancel</button>
                <button type="submit" disabled={busy || !lineTotals.balanced} className={buttonClass}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Save Draft</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
