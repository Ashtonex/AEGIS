"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, BookOpen, Check, CircleDollarSign, Coins, Landmark, Link2, Loader2,
  Pencil, Plus, Scissors, Search, Trash2, Wallet, X,
} from "lucide-react";
import {
  getBankLineAllocations,
  getProjectMoneyWorkspace,
  saveBankLineAllocations,
  searchBankStatementLines,
  tagBankStatementLines,
  updateInternalProject,
  type BankLineAllocation,
  type BankStatementLineFilter,
} from "@/lib/api";
import { CATEGORIES, categoryLabel } from "./BankStatementReviewPanel";

type RecordData = Record<string, any>;
type Tab = "overview" | "in" | "out" | "cash" | "attribute" | "claims" | "ledger";

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "overview", label: "Overview", icon: CircleDollarSign },
  { key: "in", label: "Money in", icon: ArrowDownLeft },
  { key: "out", label: "Money out", icon: ArrowUpRight },
  { key: "cash", label: "Cash used", icon: Coins },
  { key: "attribute", label: "Attribute money", icon: Link2 },
  { key: "claims", label: "Claims & budget", icon: Landmark },
  { key: "ledger", label: "Ledger", icon: BookOpen },
];

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center justify-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";
const ghostClass = "inline-flex items-center justify-center gap-2 border border-ink-mid text-paper px-3 py-2 rounded-sm text-sm hover:border-signal/50 disabled:opacity-50";
const cardClass = "bg-ink-light border border-ink-mid rounded-lg";

function money(value: unknown, decimals = 2) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    .format(Number.isFinite(num) ? num : 0);
}

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * One project, everything about its money: what it's worth, what's been
 * claimed and collected, where the money went and why - and the controls to
 * attribute bank lines or withdrawn cash to it. Every change goes through the
 * same bank-books sync, so the dashboard, claims, costs, petty cash and the
 * financial statements all move together.
 */
export function ProjectMoneyModal({
  projectId,
  projects,
  onClose,
  onChanged,
  claimsAndBudget,
}: {
  projectId: string;
  projects: RecordData[];
  onClose: () => void;
  onChanged: () => Promise<unknown> | void;
  claimsAndBudget?: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editLine, setEditLine] = useState<RecordData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getProjectMoneyWorkspace(projectId);
      setData(res.data || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this project.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !editLine) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editLine]);

  const changed = async (message?: string) => {
    if (message) setNotice(message);
    await load();
    await onChanged();
  };

  const project = data?.project;
  const summary = data?.summary || {};

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/85 backdrop-blur-sm p-0 md:p-6" role="dialog" aria-modal="true">
      <div className="bg-ink border border-ink-mid w-full max-w-7xl flex flex-col md:rounded-lg overflow-hidden shadow-2xl">
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-ink-mid bg-ink-light">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate">Project money</p>
            <h2 className="text-lg md:text-xl font-semibold text-paper truncate">
              {project ? project.name : loading ? "Loading..." : "Project"}
            </h2>
            {project && (
              <p className="text-xs text-slate mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {project.project_code && <span className="font-mono">{project.project_code}</span>}
                {project.client_name && <span>Client: <span className="text-paper">{project.client_name}</span></span>}
                {project.department_name && <span>{project.department_name}</span>}
                <span className="uppercase font-mono">{project.status}</span>
                {project.is_historical && <span className="text-amber-300">Historical</span>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-slate hover:text-paper p-1" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        <nav className="flex gap-1 overflow-x-auto px-3 border-b border-ink-mid bg-ink-light">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === key ? "border-signal text-paper" : "border-transparent text-slate hover:text-paper"}`}
            >
              <Icon className="h-4 w-4" />{label}
              {key === "in" && data ? <Count n={data.money_in.length} /> : null}
              {key === "out" && data ? <Count n={data.money_out.length} /> : null}
              {key === "cash" && data ? <Count n={data.cash_uses.length} /> : null}
            </button>
          ))}
        </nav>

        {notice && (
          <div className="mx-5 mt-4 border border-signal/30 bg-signal/10 px-4 py-2 text-sm text-paper flex justify-between items-center">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-slate hover:text-paper"><X className="h-4 w-4" /></button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {loading && !data ? (
            <div className="flex items-center gap-2 text-slate"><Loader2 className="h-4 w-4 animate-spin" />Loading project money...</div>
          ) : error ? (
            <div className="border border-red-500/30 bg-red-950/20 text-red-200 px-4 py-3 text-sm">{error}</div>
          ) : data ? (
            <>
              {tab === "overview" && <Overview data={data} onChanged={changed} />}
              {tab === "in" && <LineTable rows={data.money_in} direction="in" onEdit={setEditLine} empty="No money in has been attributed to this project yet." />}
              {tab === "out" && <MoneyOut rows={data.money_out} onEdit={setEditLine} />}
              {tab === "cash" && <CashUsed rows={data.cash_uses} onEdit={setEditLine} />}
              {tab === "attribute" && <Attribute projectId={projectId} onEdit={setEditLine} onChanged={changed} />}
              {tab === "claims" && <ClaimsAndBudget data={data} extra={claimsAndBudget} />}
              {tab === "ledger" && <Ledger rows={data.ledger} />}
            </>
          ) : null}
        </div>

        <footer className="px-5 py-3 border-t border-ink-mid bg-ink-light text-[11px] text-slate flex flex-wrap gap-x-4 gap-y-1">
          <span>Bank in {money(summary.bank_in)}</span>
          <span>Bank out {money(summary.bank_out)}</span>
          <span>Cash used {money(summary.cash_used)}</span>
          <span className="ml-auto">Changes here update claims, costs, petty cash and the general ledger together.</span>
        </footer>
      </div>

      {editLine && (
        <AllocationEditor
          line={editLine}
          projectId={projectId}
          projects={projects}
          onClose={() => setEditLine(null)}
          onSaved={async (msg) => { setEditLine(null); await changed(msg); }}
        />
      )}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="text-[10px] font-mono bg-ink border border-ink-mid rounded px-1.5">{n}</span>;
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: "in" | "out" | "warn"; sub?: string }) {
  const color = tone === "in" ? "text-emerald-300" : tone === "out" ? "text-red-300" : tone === "warn" ? "text-amber-300" : "text-paper";
  return (
    <div className={`${cardClass} p-4`}>
      <p className="text-[10px] uppercase font-mono tracking-widest text-slate">{label}</p>
      <p className={`text-xl font-semibold tracking-tight mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate mt-1">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Overview({ data, onChanged }: { data: RecordData; onChanged: (msg?: string) => Promise<void> }) {
  const s = data.summary;
  const project = data.project;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(num(project.contract_value) || ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const contract = num(s.contract_value);
  const collected = num(s.collected);
  const cost = num(s.actual_cost);
  const margin = collected - cost;
  const marginPct = collected > 0 ? (margin / collected) * 100 : 0;
  const budget = s.budget != null ? num(s.budget) : null;
  const costs: RecordData[] = data.costs_by_category || [];
  const maxCost = Math.max(1, ...costs.map((c) => num(c.amount)));
  const unclassified = num(costs.find((c) => c.cost_category === "other")?.from_bank);

  const saveValue = async () => {
    setBusy(true);
    setErr(null);
    try {
      await updateInternalProject(project.id, { contract_value: Number(value) || 0 });
      setEditing(false);
      await onChanged("Contract value confirmed.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update the contract value.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${cardClass} p-4 lg:col-span-1`}>
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Contract value</p>
          {editing ? (
            <div className="mt-2 space-y-2">
              <input className={inputClass} type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
              <div className="flex gap-2">
                <button className={buttonClass} disabled={busy} onClick={() => void saveValue()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Confirm value
                </button>
                <button className={ghostClass} onClick={() => setEditing(false)}>Cancel</button>
              </div>
              {err && <p className="text-xs text-red-300">{err}</p>}
            </div>
          ) : (
            <div className="flex items-end justify-between mt-1">
              <p className={`text-2xl font-semibold ${contract ? "text-paper" : "text-amber-300"}`}>{contract ? money(contract) : "Not set"}</p>
              <button className="text-xs text-signal hover:underline inline-flex items-center gap-1" onClick={() => setEditing(true)}>
                <Pencil className="h-3 w-3" />{contract ? "Change" : "Set value"}
              </button>
            </div>
          )}
          {!editing && collected > 0 && (
            <p className="text-[11px] text-slate mt-2">
              {contract ? `${((collected / contract) * 100).toFixed(0)}% collected. ` : ""}
              Collected so far: <button className="underline hover:text-paper" onClick={() => { setValue(String(collected)); setEditing(true); }}>{money(collected)}</button>
            </p>
          )}
        </div>
        <Stat label="Collected" value={money(collected)} tone="in" sub={`Certified ${money(s.certified)}`} />
        <Stat label="Actual cost" value={money(cost)} tone="out" sub={budget != null ? `Budget ${money(budget)}${budget ? ` · ${((cost / budget) * 100).toFixed(0)}% used` : ""}` : "No budget set"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Margin to date" value={money(margin)} tone={margin >= 0 ? "in" : "out"} sub={collected > 0 ? `${marginPct.toFixed(1)}% of money collected` : "Nothing collected yet"} />
        <Stat label="Still to claim on contract" value={s.outstanding_on_contract != null ? money(s.outstanding_on_contract) : "-"} sub={contract ? "Contract value less certified" : "Set a contract value first"} />
        <Stat label="Cash spent on site" value={money(s.cash_used)} sub="Withdrawn cash attributed to this project" />
      </div>

      {(unclassified > 0 || !contract) && (
        <div className="border border-amber-500/30 bg-amber-950/20 text-amber-100 px-4 py-3 text-sm space-y-1">
          <p className="font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4" />To make these figures reliable</p>
          {!contract && <p>Confirm the contract value so the margin and what&apos;s left to claim are meaningful.</p>}
          {unclassified > 0 && <p>{money(unclassified)} of costs from the bank have no cost type yet (they show as &ldquo;other&rdquo;). Open Money out and set a category on each.</p>}
          <p className="text-amber-200/80">Costs only include money attributed here. Cash withdrawals still sitting in HQ Petty Cash aren&apos;t counted until you attribute them (Attribute money).</p>
        </div>
      )}

      <div className={`${cardClass} p-4`}>
        <p className="text-xs font-mono uppercase tracking-wider text-slate mb-3">Where the money went</p>
        {costs.length === 0 ? (
          <p className="text-sm text-slate">No costs recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {costs.map((c) => (
              <div key={c.cost_category} className="grid grid-cols-[140px_1fr_110px] gap-3 items-center text-sm">
                <span className="text-paper capitalize">{c.cost_category === "other" ? "Other / unclassified" : c.cost_category}</span>
                <div className="h-2 bg-ink rounded overflow-hidden"><div className="h-full bg-signal/80" style={{ width: `${(num(c.amount) / maxCost) * 100}%` }} /></div>
                <span className="text-right font-mono text-red-300">{money(c.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LineTable({ rows, direction, onEdit, empty }: { rows: RecordData[]; direction: "in" | "out"; onEdit: (line: RecordData) => void; empty: string }) {
  const total = rows.reduce((sum, r) => sum + num(r.amount), 0);
  if (rows.length === 0) return <p className="text-sm text-slate">{empty}</p>;
  return (
    <div className={`${cardClass} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px] tracking-wider">
              <th className="p-2">Date</th><th className="p-2">Who</th><th className="p-2 min-w-[240px]">What the bank shows</th>
              <th className="p-2">Category</th><th className="p-2 text-right">Amount</th><th className="p-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-mid">
            {rows.map((r, i) => (
              <tr key={`${r.line_id}-${r.allocation_id || i}`} className="align-top hover:bg-ink-mid/20">
                <td className="p-2 font-mono text-slate-light whitespace-nowrap">{r.transaction_date}</td>
                <td className="p-2 text-paper">{r.counterparty_name || <span className="text-slate">-</span>}</td>
                <td className="p-2 text-paper">
                  <div className="line-clamp-2">{r.description || r.bank_description}</div>
                  <div className="text-[10px] text-slate font-mono mt-0.5">
                    {r.reference}
                    {r.split && <span className="ml-2 text-amber-300 font-sans">part of {money(r.line_amount)} line</span>}
                  </div>
                </td>
                <td className="p-2 text-slate-light">{categoryLabel(r.category) || <span className="text-amber-300">Not set</span>}</td>
                <td className={`p-2 text-right font-mono whitespace-nowrap ${direction === "in" ? "text-emerald-300" : "text-red-300"}`}>{money(r.amount)}</td>
                <td className="p-2 text-right">
                  <button onClick={() => onEdit(r)} className="text-slate hover:text-signal inline-flex items-center gap-1" title="Split or re-attribute">
                    <Scissors className="h-3.5 w-3.5" />Split
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink-mid">
              <td colSpan={4} className="p-2 text-right text-slate font-mono uppercase text-[10px]">{rows.length} lines</td>
              <td className={`p-2 text-right font-mono ${direction === "in" ? "text-emerald-300" : "text-red-300"}`}>{money(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function MoneyOut({ rows, onEdit }: { rows: RecordData[]; onEdit: (line: RecordData) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, RecordData[]>();
    rows.forEach((r) => {
      const key = r.category || "__none__";
      map.set(key, [...(map.get(key) || []), r]);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].reduce((s, r) => s + num(r.amount), 0) - a[1].reduce((s, r) => s + num(r.amount), 0));
  }, [rows]);
  if (rows.length === 0) return <p className="text-sm text-slate">No payments from the bank have been attributed to this project yet. Use Attribute money to find them.</p>;
  return (
    <div className="space-y-5">
      {groups.map(([key, items]) => (
        <section key={key}>
          <h3 className="text-sm font-semibold text-paper mb-2 flex items-center gap-2">
            {key === "__none__" ? <span className="text-amber-300">No category yet</span> : categoryLabel(key)}
            <span className="text-xs font-mono text-red-300">{money(items.reduce((s, r) => s + num(r.amount), 0))}</span>
          </h3>
          <LineTable rows={items} direction="out" onEdit={onEdit} empty="" />
        </section>
      ))}
    </div>
  );
}

function CashUsed({ rows, onEdit }: { rows: RecordData[]; onEdit: (line: RecordData) => void }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate">No withdrawn cash has been attributed to this project yet. Use Attribute money &rarr; &ldquo;Cash not yet accounted for&rdquo; to say what cash was spent here.</p>;
  }
  return (
    <div className={`${cardClass} overflow-hidden`}>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px] tracking-wider">
            <th className="p-2">Used on</th><th className="p-2">What it was used for</th><th className="p-2">Category</th>
            <th className="p-2">From withdrawal</th><th className="p-2 text-right">Amount</th><th className="p-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.map((r, i) => (
            <tr key={`${r.line_id}-${r.allocation_id || i}`} className="hover:bg-ink-mid/20">
              <td className="p-2 font-mono text-slate-light">{r.allocation_date}</td>
              <td className="p-2 text-paper">{r.description || <span className="text-slate">-</span>}</td>
              <td className="p-2 text-slate-light">{categoryLabel(r.category) || "-"}</td>
              <td className="p-2 text-slate-light">{r.transaction_date} · {money(r.line_amount, 0)} {r.counterparty_name ? `by ${r.counterparty_name}` : ""}</td>
              <td className="p-2 text-right font-mono text-red-300">{money(r.amount)}</td>
              <td className="p-2 text-right"><button onClick={() => onEdit(r)} className="text-slate hover:text-signal inline-flex items-center gap-1"><Pencil className="h-3.5 w-3.5" />Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Attribute({ projectId, onEdit, onChanged }: { projectId: string; onEdit: (line: RecordData) => void; onChanged: (msg?: string) => Promise<void> }) {
  const [mode, setMode] = useState<"lines" | "cash">("lines");
  const [q, setQ] = useState("");
  const [direction, setDirection] = useState<"" | "in" | "out">("");
  const [rows, setRows] = useState<RecordData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const search = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    try {
      const filter: BankStatementLineFilter = mode === "cash"
        ? { unallocated_cash: true, q: q || undefined }
        : { tag_status: "no_project", q: q || undefined, direction: direction || undefined };
      const res = await searchBankStatementLines(filter, 1, 50);
      const data = (res.data || []).filter((r: RecordData) => mode === "cash" || r.category !== "cash_withdrawal");
      setRows(data);
      setTotal(Number((res.meta as RecordData)?.total || data.length));
    } finally {
      setLoading(false);
    }
  }, [mode, q, direction]);

  useEffect(() => { void search(); }, [search]);

  const assignWhole = async (line: RecordData) => {
    setBusyId(line.id);
    try {
      await tagBankStatementLines({ line_ids: [line.id] }, { project_id: projectId, ...(category ? { category } : {}) });
      await onChanged("Line attributed to this project.");
      await search();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button className={mode === "lines" ? buttonClass : ghostClass} onClick={() => setMode("lines")}><Landmark className="h-4 w-4" />Bank lines with no project</button>
        <button className={mode === "cash" ? buttonClass : ghostClass} onClick={() => setMode("cash")}><Wallet className="h-4 w-4" />Cash not yet accounted for</button>
      </div>
      <p className="text-xs text-slate">
        {mode === "cash"
          ? "Cash withdrawals sit in HQ Petty Cash until you say what they paid for. Choose a withdrawal and record the part spent on this project (or handed to its site petty cash)."
          : "Attribute a whole line to this project, or split it if only part of it belongs here."}
      </p>
      <form onSubmit={search} className="grid grid-cols-1 md:grid-cols-[1fr_180px_220px_auto] gap-2">
        <div className="relative">
          <Search className="h-4 w-4 text-slate absolute left-3 top-1/2 -translate-y-1/2" />
          <input className={`${inputClass} pl-9`} placeholder="Search description, name, reference or amount" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {mode === "lines" ? (
          <select className={inputClass} value={direction} onChange={(e) => setDirection(e.target.value as "" | "in" | "out")}>
            <option value="">Money in &amp; out</option><option value="in">Money in</option><option value="out">Money out</option>
          </select>
        ) : <div />}
        {mode === "lines" ? (
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} title="Category to set when attributing a whole line">
            <option value="">Keep line&apos;s category</option>
            {CATEGORIES.filter((c) => c.value !== "site_petty_cash").map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        ) : <div />}
        <button className={buttonClass} type="submit"><Search className="h-4 w-4" />Search</button>
      </form>

      <div className={`${cardClass} overflow-hidden`}>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px] tracking-wider">
              <th className="p-2">Date</th><th className="p-2 min-w-[240px]">Bank line</th><th className="p-2">Category</th>
              <th className="p-2 text-right">{mode === "cash" ? "Unaccounted" : "Amount"}</th><th className="p-2 text-right">Attribute</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-mid">
            {loading ? (
              <tr><td colSpan={5} className="p-4 text-slate"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Searching...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="p-4 text-slate">Nothing matches.</td></tr>
            ) : rows.map((r) => {
              const amount = num(r.amount);
              const remaining = Math.abs(amount) - num(r.allocated_amount);
              return (
                <tr key={r.id} className="align-top hover:bg-ink-mid/20">
                  <td className="p-2 font-mono text-slate-light whitespace-nowrap">{r.transaction_date}</td>
                  <td className="p-2 text-paper">
                    <div className="line-clamp-2">{r.description}</div>
                    <div className="text-[10px] text-slate font-mono">{r.reference}{r.counterparty_name ? <span className="font-sans"> · {r.counterparty_name}</span> : null}</div>
                  </td>
                  <td className="p-2 text-slate-light">{categoryLabel(r.category) || "-"}</td>
                  <td className={`p-2 text-right font-mono whitespace-nowrap ${amount > 0 ? "text-emerald-300" : "text-red-300"}`}>
                    {money(mode === "cash" ? remaining : Math.abs(amount))}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap space-x-3">
                    {mode === "lines" && (
                      <button disabled={busyId === r.id} onClick={() => void assignWhole(r)} className="text-signal hover:underline disabled:opacity-50">
                        {busyId === r.id ? "Saving..." : "Whole line"}
                      </button>
                    )}
                    <button onClick={() => onEdit({ ...r, line_id: r.id, prefill_remaining: remaining })} className="text-slate hover:text-signal">
                      {mode === "cash" ? "Record use" : "Split"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {total > rows.length && <p className="px-3 py-2 text-[11px] text-slate border-t border-ink-mid">Showing {rows.length} of {total} - narrow the search to find more.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ClaimsAndBudget({ data, extra }: { data: RecordData; extra?: React.ReactNode }) {
  const claims: RecordData[] = data.claims || [];
  return (
    <div className="space-y-6">
      <div className={`${cardClass} overflow-hidden`}>
        <div className="px-4 py-3 border-b border-ink-mid text-xs font-mono uppercase tracking-wider text-slate">Claims against this project</div>
        {claims.length === 0 ? <p className="p-4 text-sm text-slate">No claims yet.</p> : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px] tracking-wider">
                <th className="p-2">Claim</th><th className="p-2">Period</th><th className="p-2">Status</th>
                <th className="p-2 text-right">Certified</th><th className="p-2 text-right">Paid</th><th className="p-2">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {claims.map((c) => (
                <tr key={c.id}>
                  <td className="p-2 font-mono text-paper">{c.claim_number}</td>
                  <td className="p-2 text-slate-light">{c.claim_period_start}{c.claim_period_end !== c.claim_period_start ? ` - ${c.claim_period_end}` : ""}</td>
                  <td className="p-2 uppercase font-mono text-[10px] text-slate-light">{c.status}</td>
                  <td className="p-2 text-right font-mono text-paper">{money(c.certified_amount)}</td>
                  <td className="p-2 text-right font-mono text-emerald-300">{c.status === "paid" ? money(c.net_claim_amount) : "-"}</td>
                  <td className="p-2 text-slate-light">{String(c.claim_number).startsWith("BANK-") ? "Bank statement" : "Recorded in AEGIS"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {extra && (
        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-slate mb-2">Budget, variations and new claims</p>
          {extra}
        </div>
      )}
    </div>
  );
}

function Ledger({ rows }: { rows: RecordData[] }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-slate">No ledger entries carry this project yet.</p>;
  return (
    <div className={`${cardClass} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-ink-mid text-xs text-slate">Posted general ledger lines tagged to this project - the same figures the financial statements use.</div>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px] tracking-wider">
            <th className="p-2">Account</th><th className="p-2">Type</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th><th className="p-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.map((r) => (
            <tr key={r.account_code}>
              <td className="p-2 text-paper"><span className="font-mono text-slate mr-2">{r.account_code}</span>{r.account_name}</td>
              <td className="p-2 text-slate-light">{String(r.account_category).replaceAll("_", " ")}</td>
              <td className="p-2 text-right font-mono">{money(r.debit)}</td>
              <td className="p-2 text-right font-mono">{money(r.credit)}</td>
              <td className="p-2 text-right font-mono text-paper">{money(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Draft = { key: string; id?: string; project_id: string; category: string; amount: string; description: string; allocation_date: string };

function AllocationEditor({ line, projectId, projects, onClose, onSaved }: {
  line: RecordData;
  projectId: string;
  projects: RecordData[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const lineId: string = line.line_id || line.id;
  const lineAmount = Math.abs(num(line.line_amount ?? line.amount));
  const isCash = (line.line_category ?? line.category) === "cash_withdrawal";
  const lineDate: string = line.transaction_date;
  const [rows, setRows] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getBankLineAllocations(lineId)
      .then((res) => {
        if (!alive) return;
        const existing: Draft[] = (res.data || []).map((a: BankLineAllocation) => ({
          key: a.id || Math.random().toString(36), id: a.id, project_id: a.project_id || "", category: a.category || "",
          amount: String(a.amount), description: a.description || "", allocation_date: a.allocation_date || lineDate,
        }));
        const allocated = existing.reduce((s, r) => s + num(r.amount), 0);
        const room = Math.max(0, +(lineAmount - allocated).toFixed(2));
        if (room > 0 && !existing.some((r) => r.project_id === projectId && !r.id)) {
          existing.push({
            key: "new", project_id: projectId, category: isCash ? "" : (line.category || ""),
            amount: String(existing.length === 0 && !isCash ? lineAmount : room), description: "", allocation_date: lineDate,
          });
        }
        setRows(existing);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load this line."))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [lineId, lineAmount, lineDate, projectId, isCash, line.category]);

  const allocated = rows.reduce((s, r) => s + num(r.amount), 0);
  const remaining = +(lineAmount - allocated).toFixed(2);
  const update = (key: string, patch: Partial<Draft>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    if (remaining < 0) { setErr("The parts add up to more than the line."); return; }
    if (rows.some((r) => !(num(r.amount) > 0))) { setErr("Every part needs an amount above zero."); return; }
    setBusy(true);
    setErr(null);
    try {
      await saveBankLineAllocations(lineId, rows.map((r) => ({
        id: r.id, project_id: r.project_id || null, category: r.category || null, amount: num(r.amount),
        description: r.description || null, allocation_date: r.allocation_date || null,
      })));
      await onSaved(isCash ? "Cash use saved." : "Split saved.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const categories = isCash ? CATEGORIES.filter((c) => !["cash_withdrawal", "client_receipt", "capital_injection", "reversal", "internal_transfer"].includes(c.value)) : CATEGORIES;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-3" role="dialog" aria-modal="true">
      <div className="bg-ink-light border border-ink-mid rounded-lg w-full max-w-4xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-ink-mid flex justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate">{isCash ? "How was this cash used?" : "Split this transaction"}</p>
            <p className="text-paper font-semibold mt-1">{money(lineAmount)} · {lineDate}</p>
            <p className="text-xs text-slate mt-1 line-clamp-2">{line.bank_description || line.description} <span className="font-mono">{line.reference}</span></p>
          </div>
          <button onClick={onClose} className="text-slate hover:text-paper self-start"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <p className="text-xs text-slate">
            {isCash
              ? "Each row is part of this withdrawal and what it paid for. Pick “Handed to site petty cash” if it went to a project's site float. Whatever you don't record stays in HQ Petty Cash."
              : "Each row is part of this bank line. Whatever isn't split off keeps the line's own project and category."}
          </p>
          {loading ? <p className="text-sm text-slate"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading...</p> : (
            <>
              {rows.map((r) => (
                <div key={r.key} className="grid grid-cols-1 md:grid-cols-[1.4fr_1.2fr_120px_130px_1.4fr_32px] gap-2 items-start">
                  <select className={inputClass} value={r.project_id} onChange={(e) => update(r.key, { project_id: e.target.value })}>
                    <option value="">No project</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select className={inputClass} value={r.category} onChange={(e) => update(r.key, { category: e.target.value })}>
                    <option value="">Category...</option>
                    {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <input className={inputClass} type="number" min="0" step="0.01" value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} aria-label="Amount" />
                  <input className={inputClass} type="date" value={r.allocation_date} onChange={(e) => update(r.key, { allocation_date: e.target.value })} aria-label="Date" />
                  <input className={inputClass} placeholder={isCash ? "What it paid for" : "Note (optional)"} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} />
                  <button onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))} className="text-slate hover:text-red-300 p-2" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <button
                className={ghostClass}
                onClick={() => setRows((prev) => [...prev, { key: Math.random().toString(36), project_id: projectId, category: "", amount: String(Math.max(0, remaining)), description: "", allocation_date: lineDate }])}
              >
                <Plus className="h-4 w-4" />Add part
              </button>
            </>
          )}
        </div>
        <div className="px-5 py-4 border-t border-ink-mid flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate">
            Allocated <span className="text-paper font-mono">{money(allocated)}</span> of {money(lineAmount)} ·{" "}
            <span className={remaining < 0 ? "text-red-300" : "text-paper"}>{remaining < 0 ? `${money(-remaining)} too much` : `${money(remaining)} ${isCash ? "stays in HQ Petty Cash" : "stays with the line"}`}</span>
          </span>
          {err && <span className="text-sm text-red-300">{err}</span>}
          <div className="ml-auto flex gap-2">
            <button className={ghostClass} onClick={onClose}>Cancel</button>
            <button className={buttonClass} disabled={busy || loading || remaining < 0} onClick={() => void save()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
