"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileSpreadsheet, Filter, Loader2, RefreshCw, Search, ShieldAlert, Tag, X } from "lucide-react";
import {
  getBankBooksAudit,
  getBankWorkbookStatus,
  publishBankWorkbook,
  getBankStatementAllocationSummary,
  getFinanceCashAccounts,
  searchBankStatementLines,
  tagBankStatementLines,
  type BankStatementLineFilter,
  type BankStatementLineTags,
} from "@/lib/api";
import { TagRulesPanel } from "./TagRulesPanel";

type RecordData = Record<string, any>;

const PAGE_SIZE = 100;
const CLEAR = "__clear__";

// Suggested categories. Stored as plain text, so anything added here later
// simply shows up as a new option.
export const CATEGORIES: { value: string; label: string }[] = [
  { value: "client_receipt", label: "Client receipt" },
  { value: "capital_injection", label: "Capital / owner injection" },
  { value: "internal_transfer", label: "Internal transfer" },
  { value: "cash_withdrawal", label: "Cash withdrawal" },
  { value: "supplier_payment", label: "Supplier / materials" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "equipment_hire", label: "Equipment / plant hire" },
  { value: "fuel_transport", label: "Fuel & transport" },
  { value: "salaries_wages", label: "Salaries & wages" },
  { value: "tax_statutory", label: "Tax & statutory (ZIMRA/NSSA)" },
  { value: "bank_charges", label: "Bank charges & IMTT" },
  { value: "card_purchase", label: "Card / POS purchase" },
  { value: "owner_drawings", label: "Owner drawings" },
  { value: "tithe_donation", label: "Tithe / donation" },
  { value: "refund", label: "Refund" },
  { value: "reversal", label: "Bank reversal" },
  { value: "site_petty_cash", label: "Handed to site petty cash" },
  { value: "other", label: "Other" },
];
export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center justify-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";
const cardClass = "bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]";

function money(value: unknown, decimals = 2) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number.isFinite(num) ? num : 0);
}

export function categoryLabel(value?: string | null) {
  if (!value) return "";
  return CATEGORY_LABEL[value] || value.replaceAll("_", " ");
}

const EMPTY_TAGS = { project_id: "", counterparty_name: "", category: "", notes: "" };

export function BankStatementReviewPanel({ projects }: { projects: RecordData[] }) {
  const [accounts, setAccounts] = useState<RecordData[]>([]);
  const [accountId, setAccountId] = useState("");
  const [draft, setDraft] = useState<BankStatementLineFilter>({ tag_status: "untagged" });
  const [filter, setFilter] = useState<BankStatementLineFilter>({ tag_status: "untagged" });
  const [page, setPage] = useState(1);
  const [lines, setLines] = useState<RecordData[]>([]);
  const [meta, setMeta] = useState<RecordData>({});
  const [summary, setSummary] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [tags, setTags] = useState(EMPTY_TAGS);
  const [audit, setAudit] = useState<RecordData | null>(null);

  const effectiveFilter = useMemo<BankStatementLineFilter>(() => ({ ...filter, cash_account_id: accountId || undefined }), [filter, accountId]);

  useEffect(() => {
    getFinanceCashAccounts()
      .then((res) => {
        const bankAccounts = (res.data || []).filter((a: RecordData) => !a.is_petty_cash);
        setAccounts(bankAccounts);
        if (bankAccounts.length === 1) setAccountId(bankAccounts[0].id);
      })
      .catch(() => setAccounts([]));
  }, []);

  const loadLines = useCallback(async () => {
    setLoading(true);
    try {
      const res = await searchBankStatementLines(effectiveFilter, page, PAGE_SIZE);
      setLines(res.data || []);
      setMeta((res.meta as RecordData) || {});
    } catch (err) {
      setLines([]);
      setMeta({});
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Failed to load statement lines." });
    } finally {
      setLoading(false);
    }
  }, [effectiveFilter, page]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await getBankStatementAllocationSummary(accountId || undefined);
      setSummary(res.data || null);
    } catch {
      setSummary(null);
    }
  }, [accountId]);

  useEffect(() => { void loadLines(); }, [loadLines]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  const loadAudit = useCallback(async () => {
    try {
      const res = await getBankBooksAudit();
      setAudit(res.data || null);
    } catch {
      setAudit(null);
    }
  }, []);
  useEffect(() => { void loadAudit(); }, [loadAudit]);
  useEffect(() => { setSelected(new Set()); setAllMatching(false); }, [effectiveFilter, page]);

  const total = Number(meta.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageIds = lines.map((l) => l.id as string);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectionCount = allMatching ? total : selected.size;

  const applyFilters = (event?: React.FormEvent) => {
    event?.preventDefault();
    setPage(1);
    setFilter({ ...draft });
  };

  const resetFilters = () => {
    const base: BankStatementLineFilter = { tag_status: "untagged" };
    setDraft(base);
    setFilter(base);
    setPage(1);
  };

  const toggleLine = (id: string) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setAllMatching(false);
    setSelected(pageAllSelected ? new Set() : new Set(pageIds));
  };

  const buildTagPayload = (): BankStatementLineTags | null => {
    const payload: BankStatementLineTags = {};
    if (tags.project_id) payload.project_id = tags.project_id === CLEAR ? null : tags.project_id;
    if (tags.category) payload.category = tags.category === CLEAR ? null : tags.category;
    if (tags.counterparty_name.trim()) payload.counterparty_name = tags.counterparty_name.trim() === "-" ? null : tags.counterparty_name.trim();
    if (tags.notes.trim()) payload.notes = tags.notes.trim() === "-" ? null : tags.notes.trim();
    return Object.keys(payload).length ? payload : null;
  };

  const applyTags = async () => {
    const payload = buildTagPayload();
    if (!payload) {
      setNotice({ tone: "error", text: "Choose a project, category, counterparty or note to apply." });
      return;
    }
    if (selectionCount === 0) {
      setNotice({ tone: "error", text: "Select at least one line first." });
      return;
    }
    if (allMatching && !window.confirm(`Apply these tags to all ${total.toLocaleString()} lines matching the current filter?`)) return;

    setBusy(true);
    setNotice(null);
    try {
      const target = allMatching ? { filter: effectiveFilter } : { line_ids: Array.from(selected) };
      const res = await tagBankStatementLines(target, payload);
      setNotice({ tone: "ok", text: `${Number(res.data?.updated || 0).toLocaleString()} line(s) tagged.` });
      setSelected(new Set());
      setAllMatching(false);
      setTags((prev) => ({ ...prev, notes: "" }));
      await Promise.all([loadLines(), loadSummary(), loadAudit()]);
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Failed to tag lines." });
    } finally {
      setBusy(false);
    }
  };

  const progress = summary?.progress || {};
  const taggedPct = Number(progress.total_lines) > 0 ? (Number(progress.tagged_lines) / Number(progress.total_lines)) * 100 : 0;
  const counterparties: string[] = summary?.counterparties || [];

  return (
    <div className="space-y-6">
      <div className={`${cardClass} p-4`}>
        <div className="flex flex-col md:flex-row md:items-end gap-4 justify-between">
          <div>
            <h2 className="text-paper font-semibold">Bank Statement Review</h2>
            <p className="text-xs text-slate mt-1 max-w-2xl">
              Say what each bank line was: the project it belongs to, who paid or was paid, and what it was for.
              Tagging a line to a project also records it in that project&apos;s books: money in as a paid claim, money out as a cost.
              It never posts to the cashbook or changes an account balance.
            </p>
          </div>
          <div className="w-full md:w-72">
            <label className="text-[10px] uppercase font-mono tracking-widest text-slate">Bank account</label>
            <select className={inputClass} value={accountId} onChange={(e) => { setAccountId(e.target.value); setPage(1); }}>
              <option value="">All accounts</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name} · {a.bank_name || a.account_code} {a.account_number ? `(${String(a.account_number).slice(-4)})` : ""}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <Stat label="Lines tagged" value={`${Number(progress.tagged_lines || 0).toLocaleString()} / ${Number(progress.total_lines || 0).toLocaleString()}`}>
            <div className="h-1.5 bg-ink rounded mt-2 overflow-hidden"><div className="h-full bg-signal" style={{ width: `${Math.min(100, taggedPct)}%` }} /></div>
          </Stat>
          <Stat label="Linked to a project" value={Number(progress.project_lines || 0).toLocaleString()} />
          <Stat label="Money in (filtered)" value={money(meta.money_in)} tone="in" />
          <Stat label="Money out (filtered)" value={money(meta.money_out)} tone="out" />
        </div>
      </div>

      {audit && <BooksCheck audit={audit} />}

      <TeamsWorkbook />

      <TagRulesPanel projects={projects} onApplied={() => Promise.all([loadLines(), loadSummary(), loadAudit()])} />

      {notice && (
        <div className={`border px-4 py-3 text-sm flex justify-between items-center ${notice.tone === "ok" ? "border-signal/30 bg-signal/10 text-paper" : "border-red-500/30 bg-red-950/20 text-red-200"}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper" aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      <form onSubmit={applyFilters} className={`${cardClass} p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3`}>
        <div className="xl:col-span-2 relative">
          <Search className="h-4 w-4 text-slate absolute left-3 top-1/2 -translate-y-1/2" />
          <input className={`${inputClass} pl-9`} placeholder="Search description, reference, name or amount" value={draft.q || ""} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        </div>
        <input className={inputClass} type="date" value={draft.date_from || ""} onChange={(e) => setDraft({ ...draft, date_from: e.target.value || undefined })} aria-label="From date" />
        <input className={inputClass} type="date" value={draft.date_to || ""} onChange={(e) => setDraft({ ...draft, date_to: e.target.value || undefined })} aria-label="To date" />
        <select className={inputClass} value={draft.direction || ""} onChange={(e) => setDraft({ ...draft, direction: (e.target.value || undefined) as BankStatementLineFilter["direction"] })}>
          <option value="">Money in &amp; out</option>
          <option value="in">Money in only</option>
          <option value="out">Money out only</option>
        </select>
        <select className={inputClass} value={draft.tag_status || ""} onChange={(e) => setDraft({ ...draft, tag_status: (e.target.value || undefined) as BankStatementLineFilter["tag_status"] })}>
          <option value="">Tagged &amp; untagged</option>
          <option value="untagged">Untagged only</option>
          <option value="no_project">No project yet</option>
          <option value="tagged">Tagged only</option>
        </select>
        <select className={`${inputClass} xl:col-span-2`} value={draft.project_id || ""} onChange={(e) => setDraft({ ...draft, project_id: e.target.value || undefined })}>
          <option value="">Any project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code ? `${p.project_code} · ` : ""}{p.name}</option>)}
        </select>
        <select className={`${inputClass} xl:col-span-2`} value={draft.category || ""} onChange={(e) => setDraft({ ...draft, category: e.target.value || undefined })}>
          <option value="">Any category</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button type="submit" className={buttonClass}><Filter className="h-4 w-4" />Apply filters</button>
        <button type="button" onClick={resetFilters} className="inline-flex items-center justify-center gap-2 border border-ink-mid px-3 py-2 rounded-sm text-sm text-slate hover:text-paper">Reset</button>
      </form>

      <div className={`${cardClass} p-4 space-y-3 xl:sticky xl:top-2 z-10`}>
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate">
          <Tag className="h-4 w-4" />
          Tag {selectionCount > 0 ? <span className="text-signal">{selectionCount.toLocaleString()} selected line{selectionCount === 1 ? "" : "s"}</span> : "selected lines"}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <select className={inputClass} value={tags.project_id} onChange={(e) => setTags({ ...tags, project_id: e.target.value })}>
            <option value="">Project: leave as is</option>
            <option value={CLEAR}>Remove project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code ? `${p.project_code} · ` : ""}{p.name}</option>)}
          </select>
          <select className={inputClass} value={tags.category} onChange={(e) => setTags({ ...tags, category: e.target.value })}>
            <option value="">Category: leave as is</option>
            <option value={CLEAR}>Remove category</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input className={inputClass} list="bank-review-counterparties" placeholder="Who (payer / payee)" value={tags.counterparty_name} onChange={(e) => setTags({ ...tags, counterparty_name: e.target.value })} />
          <datalist id="bank-review-counterparties">{counterparties.map((c) => <option key={c} value={c} />)}</datalist>
          <input className={inputClass} placeholder="Note" value={tags.notes} onChange={(e) => setTags({ ...tags, notes: e.target.value })} />
          <button type="button" onClick={() => void applyTags()} disabled={busy || selectionCount === 0} className={buttonClass}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}Apply to {selectionCount > 0 ? selectionCount.toLocaleString() : "selection"}
          </button>
        </div>
        <p className="text-[11px] text-slate">Fields left on &ldquo;leave as is&rdquo; or blank are not changed. Type a single <span className="font-mono">-</span> in Who or Note to clear it.</p>
        {pageAllSelected && !allMatching && total > lines.length && (
          <div className="text-xs text-paper bg-ink border border-ink-mid rounded px-3 py-2">
            All {lines.length} lines on this page are selected.{" "}
            <button type="button" className="text-signal hover:underline" onClick={() => setAllMatching(true)}>Select all {total.toLocaleString()} lines matching this filter</button>
          </div>
        )}
        {allMatching && (
          <div className="text-xs text-paper bg-signal/10 border border-signal/30 rounded px-3 py-2">
            All {total.toLocaleString()} matching lines are selected.{" "}
            <button type="button" className="text-signal hover:underline" onClick={() => { setAllMatching(false); setSelected(new Set()); }}>Clear selection</button>
          </div>
        )}
      </div>

      <div className={`${cardClass} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px] tracking-wider">
                <th className="p-2 w-8"><input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Select all on this page" /></th>
                <th className="p-2 whitespace-nowrap">Date</th>
                <th className="p-2 min-w-[260px]">Bank description</th>
                <th className="p-2 text-right whitespace-nowrap">In</th>
                <th className="p-2 text-right whitespace-nowrap">Out</th>
                <th className="p-2 min-w-[160px]">Project</th>
                <th className="p-2 min-w-[140px]">Who</th>
                <th className="p-2 min-w-[120px]">Category</th>
                <th className="p-2">Cashbook</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {loading ? (
                <tr><td colSpan={9} className="p-6 text-slate"><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading statement lines...</span></td></tr>
              ) : lines.length === 0 ? (
                <tr><td colSpan={9} className="p-6 text-slate">No statement lines match these filters.</td></tr>
              ) : (
                lines.map((line) => {
                  const amount = Number(line.amount);
                  const isSelected = allMatching || selected.has(line.id);
                  return (
                    <tr key={line.id} onClick={() => toggleLine(line.id)} className={`cursor-pointer align-top ${isSelected ? "bg-signal/5" : "hover:bg-ink-mid/20"}`}>
                      <td className="p-2"><input type="checkbox" checked={isSelected} onChange={() => toggleLine(line.id)} onClick={(e) => e.stopPropagation()} aria-label="Select line" /></td>
                      <td className="p-2 text-slate-light whitespace-nowrap font-mono">{line.transaction_date}</td>
                      <td className="p-2 text-paper">
                        <div className="line-clamp-2">{line.description}</div>
                        <div className="text-[10px] text-slate font-mono mt-0.5">{line.reference}{line.notes ? <span className="font-sans text-slate-light"> · {line.notes}</span> : null}</div>
                      </td>
                      <td className="p-2 text-right font-mono text-emerald-300 whitespace-nowrap">{amount > 0 ? money(amount) : ""}</td>
                      <td className="p-2 text-right font-mono text-red-300 whitespace-nowrap">{amount < 0 ? money(-amount) : ""}</td>
                      <td className="p-2 text-paper">{line.project_name ? <>{line.project_code ? <span className="text-slate">{line.project_code} · </span> : null}{line.project_name}</> : <span className="text-slate">-</span>}</td>
                      <td className="p-2 text-paper">{line.counterparty_name || <span className="text-slate">-</span>}</td>
                      <td className="p-2 text-slate-light">{categoryLabel(line.category) || <span className="text-slate">-</span>}</td>
                      <td className="p-2 text-slate-light whitespace-nowrap">{line.matched_transaction_number || (line.match_status === "unmatched" ? <span className="text-slate">-</span> : line.match_status)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-ink-mid px-4 py-3 text-xs text-slate">
          <span>{total.toLocaleString()} line{total === 1 ? "" : "s"} · page {page} of {totalPages}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="inline-flex items-center gap-1 border border-ink-mid px-2 py-1 rounded-sm hover:text-paper disabled:opacity-40"><ChevronLeft className="h-3 w-3" />Prev</button>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="inline-flex items-center gap-1 border border-ink-mid px-2 py-1 rounded-sm hover:text-paper disabled:opacity-40">Next<ChevronRight className="h-3 w-3" /></button>
            <button type="button" onClick={() => { void loadLines(); void loadSummary(); }} className="inline-flex items-center gap-1 px-2 py-1 hover:text-paper"><RefreshCw className="h-3 w-3" />Refresh</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SummaryTable
          title="By project"
          rows={(summary?.by_project || []).map((r: RecordData) => ({
            key: r.project_id || "none",
            label: r.project_id ? `${r.project_code ? `${r.project_code} · ` : ""}${r.project_name}` : "Not linked to a project",
            muted: !r.project_id,
            ...r,
          }))}
          onPick={(row) => { const next = { ...draft, project_id: row.project_id || undefined, tag_status: row.project_id ? undefined : ("no_project" as const) }; setDraft(next); setFilter(next); setPage(1); }}
        />
        <SummaryTable
          title="By category"
          rows={(summary?.by_category || []).map((r: RecordData) => ({
            key: r.category || "none",
            label: r.category ? categoryLabel(r.category) : "No category",
            muted: !r.category,
            ...r,
          }))}
          onPick={(row) => { if (!row.category) return; const next = { ...draft, category: row.category, tag_status: undefined }; setDraft(next); setFilter(next); setPage(1); }}
        />
      </div>
    </div>
  );
}

function TeamsWorkbook() {
  const [info, setInfo] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getBankWorkbookStatus();
      setInfo(res.data || null);
    } catch {
      setInfo(null);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await publishBankWorkbook();
      setInfo(res.data || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publishing failed.");
    } finally {
      setBusy(false);
    }
  };

  const published = info?.last_published_at ? new Date(info.last_published_at).toLocaleString() : null;
  const changes: RecordData[] = info?.recent_changes || [];
  return (
    <div className={`${cardClass} p-4 space-y-3`}>
    <div className="flex flex-col md:flex-row md:items-center gap-3">
      <FileSpreadsheet className="h-6 w-6 text-emerald-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-paper font-semibold">Excel in Teams</p>
        <p className="text-xs text-slate">
          {info?.file_name || "AEGIS Bank & Project Money.xlsx"} in the Financial Data Room. Edit Category, Project, Who or Note on
          Bank Lines, or change, clear and add parts on Splits &amp; Cash Uses (e.g. what withdrawn cash paid for), and AEGIS applies it
          within about 2 minutes; changes made here show up in the workbook just as fast.
          {published ? ` Last published ${published}${info?.rows_published ? ` (${Number(info.rows_published).toLocaleString()} lines)` : ""}.` : " Not published yet."}
        </p>
        {info?.last_status === "failed" && <p className="text-xs text-red-300 mt-1">Last attempt failed: {info.last_error}</p>}
        {info?.last_status === "retry" && <p className="text-xs text-amber-300 mt-1">{info.last_error}</p>}
        {error && <p className="text-xs text-red-300 mt-1">{error}</p>}
      </div>
      <div className="flex gap-2 shrink-0">
        {info?.web_url && (
          <a href={info.web_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 border border-ink-mid text-paper px-3 py-2 rounded-sm text-sm hover:border-signal/50">
            <ExternalLink className="h-4 w-4" />Open workbook
          </a>
        )}
        <button onClick={() => void publish()} disabled={busy} className={buttonClass}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Sync now
        </button>
      </div>
    </div>
    {changes.length > 0 && (
      <div className="border-t border-ink-mid pt-3">
        <p className="text-[10px] uppercase font-mono tracking-widest text-slate mb-2">Recent edits from Excel</p>
        <ul className="space-y-1 text-xs">
          {changes.slice(0, 8).map((c, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className={c.outcome === "applied" ? "text-emerald-300" : c.outcome === "conflict" ? "text-amber-300" : "text-red-300"}>
                {c.outcome === "applied" ? "Applied" : c.outcome === "conflict" ? "Conflict" : "Not applied"}
              </span>
              <span className="text-paper">{c.field}: {c.old_value || "(blank)"} &rarr; {c.new_value || "(blank)"}</span>
              <span className="text-slate">
                {c.transaction_date} {c.reference} · {c.edited_by_name || "Excel"} · {new Date(c.created_at).toLocaleString()}
              </span>
              {c.message && c.outcome !== "applied" && <span className="text-slate w-full pl-2">{c.message}</span>}
            </li>
          ))}
        </ul>
      </div>
    )}
    </div>
  );
}

function BooksCheck({ audit }: { audit: RecordData }) {
  const todo = audit.to_do || {};
  const checks: RecordData[] = audit.checks || [];
  const items = [
    { label: "Lines with no category or project", value: Number(todo.unclassified_lines || 0).toLocaleString(), note: `${money(todo.unclassified_money_out, 0)} out · ${money(todo.unclassified_money_in, 0)} in (held in Suspense)` },
    { label: "Cash withdrawn, not yet accounted for", value: money(todo.hq_petty_cash_not_yet_accounted_for, 0), note: "Sitting in HQ Petty Cash until you record what it paid for" },
    { label: "Project costs with no cost type", value: money(todo.unclassified_project_costs, 0), note: "Shown as Unclassified Project Costs in the statements" },
  ];
  return (
    <div className={`${cardClass} p-4 space-y-4`}>
      <div className="flex items-center gap-2">
        {audit.all_ok ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <ShieldAlert className="h-5 w-5 text-amber-300" />}
        <h3 className="text-paper font-semibold">Books check</h3>
        <span className="text-xs text-slate">{audit.all_ok ? "The whole statement is carried into the books and ties to the bank." : "Something doesn't tie out yet - see below."}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
        {checks.map((c) => (
          <div key={c.check} className={`rounded border px-3 py-2 text-xs ${c.ok ? "border-emerald-500/30 bg-emerald-950/10" : "border-amber-500/40 bg-amber-950/20"}`}>
            <p className={c.ok ? "text-emerald-300" : "text-amber-200"}>{c.ok ? "OK" : "Check"} · {c.check}</p>
            <p className="text-slate font-mono mt-1 break-words">{c.detail}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {items.map((i) => (
          <div key={i.label} className="bg-ink border border-ink-mid rounded p-3">
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate">{i.label}</p>
            <p className="text-lg font-semibold text-paper mt-1">{i.value}</p>
            <p className="text-[11px] text-slate mt-1">{i.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, tone, children }: { label: string; value: string; tone?: "in" | "out"; children?: React.ReactNode }) {
  const color = tone === "in" ? "text-emerald-300" : tone === "out" ? "text-red-300" : "text-paper";
  return (
    <div className="bg-ink border border-ink-mid rounded p-3">
      <p className="text-[10px] uppercase font-mono tracking-widest text-slate">{label}</p>
      <p className={`text-lg font-semibold tracking-tight mt-1 ${color}`}>{value}</p>
      {children}
    </div>
  );
}

function SummaryTable({ title, rows, onPick }: { title: string; rows: RecordData[]; onPick: (row: RecordData) => void }) {
  return (
    <div className={`${cardClass} overflow-hidden`}>
      <div className="border-b border-ink-mid px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate">{title}</div>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px] tracking-wider">
            <th className="p-2">{title.replace("By ", "")}</th><th className="p-2 text-right">Lines</th><th className="p-2 text-right">In</th><th className="p-2 text-right">Out</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.length === 0 ? (
            <tr><td colSpan={4} className="p-3 text-slate">Nothing yet.</td></tr>
          ) : rows.map((row) => (
            <tr key={row.key} onClick={() => onPick(row)} className="cursor-pointer hover:bg-ink-mid/20" title="Show these lines">
              <td className={`p-2 ${row.muted ? "text-slate" : "text-paper"}`}>{row.label}</td>
              <td className="p-2 text-right text-slate-light font-mono">{Number(row.line_count).toLocaleString()}</td>
              <td className="p-2 text-right text-emerald-300 font-mono">{money(row.money_in, 0)}</td>
              <td className="p-2 text-right text-red-300 font-mono">{money(row.money_out, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
