"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderKanban, Loader2, Search, X } from "lucide-react";
import { getCostCodesByProject } from "@/lib/api";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

const card = "bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden";

function UseBar({ budget, actual }: { budget: number; actual: number }) {
  if (budget <= 0) return <span className="text-[11px] text-slate">{actual > 0 ? "No budget line" : "-"}</span>;
  const pct = (actual / budget) * 100;
  const tone = pct > 100 ? "bg-red-400" : pct > 85 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="h-1.5 flex-1 rounded-full bg-ink overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <span className={`text-[11px] tabular-nums w-10 text-right ${pct > 100 ? "text-red-300" : "text-slate-light"}`}>{pct.toFixed(0)}%</span>
    </div>
  );
}

/**
 * Cost codes as each project uses them: budgeted (approved budget lines),
 * drafted (lines on a draft awaiting approval) and actual (posted cost
 * transactions). Codes no project uses yet are listed at the bottom.
 */
export function CostCodesByProjectPanel({ departmentId, refreshKey }: { departmentId: string; refreshKey?: number }) {
  const [data, setData] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [showUnassigned, setShowUnassigned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCostCodesByProject({ department_id: departmentId || undefined })
      .then((res) => { if (!cancelled) { setData(res.data || null); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load cost codes."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [departmentId, refreshKey]);

  const projects = useMemo<RecordData[]>(() => {
    const q = search.trim().toLowerCase();
    const list: RecordData[] = data?.projects || [];
    if (!q) return list;
    return list
      .map((p) => {
        const projectHit = `${p.project_name} ${p.project_code || ""}`.toLowerCase().includes(q);
        const codes = projectHit ? p.codes : p.codes.filter((c: RecordData) => `${c.code} ${c.name}`.toLowerCase().includes(q));
        return { ...p, codes } as RecordData;
      })
      .filter((p) => p.codes.length > 0);
  }, [data, search]);

  const unassigned: RecordData[] = data?.unassigned || [];

  if (loading) return <div className={`${card} p-8 flex items-center gap-3 text-slate`}><Loader2 className="h-4 w-4 animate-spin" />Loading cost codes…</div>;
  if (error) return <div className="rounded border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-100">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a project, code or description…" className="w-full bg-ink border border-ink-mid rounded px-3 py-2 pl-8 text-sm text-paper focus:outline-none focus:border-signal/50" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate hover:text-paper"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={() => setOpen(Object.fromEntries(projects.map((p) => [p.project_id, true])))} className="text-signal hover:underline">Expand all</button>
          <span className="text-slate">·</span>
          <button onClick={() => setOpen({})} className="text-signal hover:underline">Collapse all</button>
        </div>
        <span className="text-xs text-slate-light ml-auto">{projects.length} projects · {projects.reduce((s, p) => s + p.codes.length, 0)} code lines</span>
      </div>

      {projects.length === 0 ? (
        <div className={`${card} p-6 text-sm text-slate-light text-center`}>No project uses a cost code yet. Codes attach to a project through its budget lines and posted costs.</div>
      ) : projects.map((p) => {
        const isOpen = !!open[p.project_id] || !!search;
        return (
          <section key={p.project_id} className={card}>
            <button onClick={() => setOpen((o) => ({ ...o, [p.project_id]: !o[p.project_id] }))} className="w-full px-4 py-3 flex flex-wrap items-center gap-3 text-left bg-ink/30 hover:bg-ink-mid/20">
              {isOpen ? <ChevronDown className="h-4 w-4 text-slate" /> : <ChevronRight className="h-4 w-4 text-slate" />}
              <FolderKanban className="h-4 w-4 text-signal" />
              <span className="text-paper font-medium flex-1 min-w-[180px]">{p.project_name}{p.project_code && <span className="ml-2 font-mono text-xs text-slate">{p.project_code}</span>}</span>
              <span className="text-[11px] text-slate">{p.codes.length} codes</span>
              <span className="text-xs text-slate-light">Budget <span className="text-paper tabular-nums">{money(p.budget_amount)}</span></span>
              {p.draft_amount > 0 && <span className="text-xs text-amber-300">Draft {money(p.draft_amount)}</span>}
              <span className="text-xs text-slate-light">Actual <span className="text-paper tabular-nums">{money(p.actual_amount)}</span></span>
              <div className="w-40"><UseBar budget={p.budget_amount} actual={p.actual_amount} /></div>
            </button>
            {isOpen && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-y border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider">
                      <th className="px-4 py-2">Code</th><th className="px-4 py-2">Description</th><th className="px-4 py-2">Category</th>
                      <th className="px-4 py-2 text-right">Budget</th><th className="px-4 py-2 text-right">Draft</th>
                      <th className="px-4 py-2 text-right">Actual</th><th className="px-4 py-2">Used</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {p.codes.map((c: RecordData) => (
                      <tr key={c.cost_code_id} className="hover:bg-ink-mid/10">
                        <td className="px-4 py-2 font-mono text-signal whitespace-nowrap">{c.code}</td>
                        <td className="px-4 py-2 text-paper">{c.name}</td>
                        <td className="px-4 py-2 text-slate-light capitalize">{c.category}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-paper">{c.budget_amount ? money(c.budget_amount) : "-"}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-amber-300/90">{c.draft_amount ? money(c.draft_amount) : "-"}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-paper">{c.actual_amount ? money(c.actual_amount) : "-"}</td>
                        <td className="px-4 py-2"><UseBar budget={c.budget_amount} actual={c.actual_amount} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {unassigned.length > 0 && (
        <section className={card}>
          <button onClick={() => setShowUnassigned((v) => !v)} className="w-full px-4 py-3 flex items-center gap-2 text-left bg-ink/30 hover:bg-ink-mid/20">
            {showUnassigned ? <ChevronDown className="h-4 w-4 text-slate" /> : <ChevronRight className="h-4 w-4 text-slate" />}
            <span className="font-mono text-xs uppercase tracking-wider text-slate">Not used on any project ({unassigned.length})</span>
          </button>
          {showUnassigned && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-1 p-4 text-sm">
              {unassigned.map((c) => (
                <div key={c.id} className="flex gap-2 min-w-0"><span className="font-mono text-signal">{c.code}</span><span className="text-paper truncate">{c.name}</span><span className="text-slate capitalize ml-auto">{c.category}</span></div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
