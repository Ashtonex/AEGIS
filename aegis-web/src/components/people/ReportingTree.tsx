"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, UserCog } from "lucide-react";
import { getPeopleRegister, updatePersonEmployment, type RegisterRow } from "@/lib/api";
import { PersonCardModal } from "./PersonCardModal";
import { inputClass } from "./ui";

type Node = RegisterRow & { reports: Node[] };

function buildTree(rows: RegisterRow[]) {
  const byId = new Map<string, Node>(rows.map((r) => [r.id, { ...r, reports: [] }]));
  const roots: Node[] = [];
  for (const node of byId.values()) {
    const manager = node.line_manager_id ? byId.get(node.line_manager_id) : undefined;
    if (manager) manager.reports.push(node);
    else roots.push(node);
  }
  const sort = (list: Node[]) => {
    list.sort((a, b) => b.reports.length - a.reports.length || a.employee_name.localeCompare(b.employee_name));
    list.forEach((n) => sort(n.reports));
  };
  sort(roots);
  // People at the top with nobody under them have no manager set yet; keep them apart.
  return { tops: roots.filter((r) => r.reports.length > 0), unplaced: roots.filter((r) => r.reports.length === 0) };
}

function countBelow(node: Node): number {
  return node.reports.reduce((sum, r) => sum + 1 + countBelow(r), 0);
}

/**
 * Who reports to whom, drawn from each person's line manager. Line managers are
 * set here (inline) or on the person card; every change is dated server-side.
 */
export function ReportingTree({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await getPeopleRegister({ status: "current" })).data);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reporting lines could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const { tops, unplaced } = useMemo(() => buildTree(rows), [rows]);

  async function setManager(personId: string, managerId: string) {
    setSavingId(personId);
    setError("");
    try {
      await updatePersonEmployment(personId, { line_manager_id: managerId || null });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change the line manager.");
    } finally {
      setSavingId(null);
    }
  }

  const managerPicker = (node: RegisterRow) => (
    <select
      className={`${inputClass} min-h-8 w-48 py-1 text-xs`}
      value={node.line_manager_id ?? ""}
      onChange={(e) => void setManager(node.id, e.target.value)}
      disabled={savingId === node.id}
      aria-label={`Line manager for ${node.employee_name}`}
      onClick={(e) => e.stopPropagation()}
    >
      <option value="">No line manager</option>
      {rows.filter((r) => r.id !== node.id).map((r) => <option key={r.id} value={r.id}>{r.employee_name}</option>)}
    </select>
  );

  function renderNode(node: Node, depth: number) {
    const isCollapsed = collapsed.has(node.id);
    const below = countBelow(node);
    return (
      <li key={node.id}>
        <div className="group flex flex-wrap items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-ink-mid/20" style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}>
          {node.reports.length ? (
            <button
              onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n; })}
              className="text-slate hover:text-paper" aria-label={isCollapsed ? "Expand" : "Collapse"}
            >
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : <span className="inline-block w-4" />}
          <button onClick={() => setOpenId(node.id)} className="min-w-0 text-left">
            <span className="text-sm font-medium text-paper">{node.employee_name}</span>
            <span className="text-xs text-slate-light"> · {node.position_name || node.job_title || "Role not set"}</span>
            {below > 0 && <span className="ml-2 rounded-sm border border-signal/30 px-1.5 text-[10px] text-signal">{below} below</span>}
          </button>
          {canEdit && <span className="ml-auto opacity-60 group-hover:opacity-100">{savingId === node.id ? <Loader2 className="h-4 w-4 animate-spin text-signal" /> : managerPicker(node)}</span>}
        </div>
        {!isCollapsed && node.reports.length > 0 && (
          <ul className="border-l border-ink-mid" style={{ marginLeft: `${depth * 1.5 + 1}rem` }}>
            {node.reports.map((r) => renderNode(r, 0))}
          </ul>
        )}
      </li>
    );
  }

  if (loading && !rows.length) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-signal" /></div>;

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-sm border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}
      <section className="rounded-lg border border-ink-mid bg-ink-light p-4">
        <h2 className="mb-1 font-mono text-xs uppercase tracking-wider text-slate">How reporting works</h2>
        <p className="text-sm text-slate-light">
          Every person has one <strong className="text-paper">line manager</strong>. That person approves their leave, confirms their weekly hours,
          and sits above them on the org chart. Pick the manager next to anyone below, or on the Employment tab of their card.
          Changes are dated, so the history of who reported to whom is kept.
        </p>
      </section>
      <section className="rounded-lg border border-ink-mid bg-ink-light p-3">
        {tops.length === 0 ? (
          <p className="p-3 text-sm text-slate-light">No reporting lines yet. Start with the Managing Director&apos;s direct reports: set their line manager to the MD.</p>
        ) : (
          <ul>{tops.map((n) => renderNode(n, 0))}</ul>
        )}
      </section>
      {unplaced.length > 0 && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-950/10 p-3">
          <h2 className="mb-2 flex items-center gap-2 px-2 font-mono text-xs uppercase tracking-wider text-amber-300"><UserCog className="h-4 w-4" />No line manager yet ({unplaced.length})</h2>
          <ul>{unplaced.map((n) => renderNode(n, 0))}</ul>
        </section>
      )}
      {openId && <PersonCardModal employeeId={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} initialTab="employment" />}
    </div>
  );
}
