"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CheckCircle2, ChevronDown, ChevronRight, Clock, History, Loader2, Mail } from "lucide-react";
import { decideDraftBudget, getDraftBudgetReminders, sendDraftBudgetReminders } from "@/lib/api";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function fmtDate(value: unknown) {
  if (!value) return "-";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function daysSince(value: unknown) {
  if (!value) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(String(value)).getTime()) / 86400000));
}

const card = "bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden";

/**
 * Project budgets split by where they are in their life:
 *  - Approved: the one working budget per project.
 *  - Draft: waiting on a decision. The project's QS, PM, the MD and Finance
 *    oversight are reminded every weekday until it is approved or cancelled.
 *  - Superseded: replaced versions (and cancelled drafts), kept for history.
 */
export function ProjectBudgetsPanel({ budgets, onChanged }: { budgets: RecordData[]; onChanged: () => Promise<unknown> | void }) {
  const [reminders, setReminders] = useState<Record<string, RecordData[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [openDraft, setOpenDraft] = useState<string | null>(null);

  const loadReminders = useCallback(async () => {
    try {
      const res = await getDraftBudgetReminders();
      const map: Record<string, RecordData[]> = {};
      for (const r of res.data || []) map[r.budget_id] = r.recipients || [];
      setReminders(map);
    } catch {
      setReminders({});
    }
  }, []);
  useEffect(() => { void loadReminders(); }, [loadReminders, budgets]);

  const groups = useMemo(() => {
    const byVersion = (a: RecordData, b: RecordData) =>
      String(a.project_name || "").localeCompare(String(b.project_name || "")) || Number(b.budget_version || 0) - Number(a.budget_version || 0);
    const approved = budgets.filter((b) => b.status === "approved").sort(byVersion);
    const drafts = budgets.filter((b) => b.status === "draft").sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const history = budgets.filter((b) => b.status === "superseded" || b.status === "cancelled").sort(byVersion);
    const approvedByProject = new Map(approved.map((b) => [b.project_id, b]));
    return { approved, drafts, history, approvedByProject };
  }, [budgets]);

  const act = async (key: string, fn: () => Promise<any>, after?: () => void) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fn();
      setNotice({ text: res?.message || "Done.", tone: "ok" });
      after?.();
      await onChanged();
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "Action failed.", tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const approve = (b: RecordData) => {
    const current = groups.approvedByProject.get(b.project_id);
    const msg = current
      ? `Approve v${b.budget_version} (${money(b.total_amount)}) for ${b.project_name}? The current approved v${current.budget_version} (${money(current.total_amount)}) moves to Superseded.`
      : `Approve v${b.budget_version} (${money(b.total_amount)}) as ${b.project_name}'s working budget?`;
    if (!window.confirm(msg)) return;
    void act(`approve-${b.id}`, () => decideDraftBudget(b.id, "approve"));
  };

  const cancel = (b: RecordData) => {
    const reason = window.prompt(`Why is ${b.project_name} v${b.budget_version} being cancelled? (required)`)?.trim();
    if (!reason) return;
    void act(`cancel-${b.id}`, () => decideDraftBudget(b.id, "cancel", reason));
  };

  return (
    <div className="space-y-5">
      {notice && (
        <div className={`border px-4 py-2.5 text-sm rounded flex justify-between ${notice.tone === "error" ? "border-red-500/30 bg-red-950/20 text-red-200" : "border-signal/30 bg-signal/10 text-paper"}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper">×</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat icon={CheckCircle2} tone="text-emerald-400" label="Approved budgets" value={String(groups.approved.length)} sub={money(groups.approved.reduce((s, b) => s + Number(b.total_amount || 0), 0))} />
        <Stat icon={Clock} tone={groups.drafts.length ? "text-amber-400" : "text-paper"} label="Drafts awaiting approval" value={String(groups.drafts.length)} sub={groups.drafts.length ? `Oldest waiting ${plural(daysSince(groups.drafts[0]?.created_at), "day")}` : "None"} />
        <Stat icon={History} tone="text-slate-light" label="Superseded / cancelled" value={String(groups.history.length)} sub="Kept for audit history" />
      </div>

      {/* Drafts */}
      <section className={`${card} ${groups.drafts.length ? "border-amber-500/30" : ""}`}>
        <div className="px-4 py-3 border-b border-ink-mid bg-ink/30 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="font-mono text-xs tracking-wider uppercase text-amber-300">Draft budgets, awaiting approval</span>
            <p className="text-[11px] text-slate-light mt-0.5">The project&apos;s QS and PM, the MD and nyasha@ get an email reminder every weekday at 07:00 until each draft is approved or cancelled.</p>
          </div>
          {groups.drafts.length > 0 && (
            <button
              disabled={busy !== null}
              onClick={() => void act("remind-all", () => sendDraftBudgetReminders())}
              className="inline-flex items-center gap-2 border border-amber-500/40 text-amber-200 px-3 py-1.5 rounded-sm text-xs hover:bg-amber-950/30 disabled:opacity-50"
            >
              {busy === "remind-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}Remind everyone now
            </button>
          )}
        </div>
        {groups.drafts.length === 0 ? (
          <p className="p-4 text-sm text-slate-light">No drafts waiting. Every project budget has been decided.</p>
        ) : (
          <div className="divide-y divide-ink-mid">
            {groups.drafts.map((b) => {
              const current = groups.approvedByProject.get(b.project_id);
              const recipients = reminders[b.id] || [];
              const open = openDraft === b.id;
              const delta = current ? Number(b.total_amount || 0) - Number(current.total_amount || 0) : null;
              return (
                <div key={b.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => setOpenDraft(open ? null : b.id)} className="text-slate hover:text-paper">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <div className="flex-1 min-w-[200px] cursor-pointer" onClick={() => setOpenDraft(open ? null : b.id)}>
                      <p className="text-paper font-medium hover:text-signal">{b.project_name}</p>
                      <p className="text-[11px] text-slate-light">v{b.budget_version} · {b.label || "Draft"} · uploaded {fmtDate(b.created_at)} · <span className="text-amber-300">{plural(daysSince(b.created_at), "day")} waiting</span></p>
                    </div>
                    <div className="text-right">
                      <p className="text-paper font-semibold tabular-nums">{money(b.total_amount)}</p>
                      <p className="text-[11px] text-slate">
                        {current ? <>vs approved {money(current.total_amount)} <span className={delta! > 0 ? "text-red-300" : "text-emerald-300"}>({delta! >= 0 ? "+" : ""}{money(delta)})</span></> : "No approved budget yet"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button disabled={busy !== null} onClick={() => approve(b)} className="border border-emerald-500/40 text-emerald-300 px-2.5 py-1 rounded-sm text-xs hover:bg-emerald-950/30 disabled:opacity-50">
                        {busy === `approve-${b.id}` ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Approve"}
                      </button>
                      <button disabled={busy !== null} onClick={() => cancel(b)} className="border border-red-500/40 text-red-300 px-2.5 py-1 rounded-sm text-xs hover:bg-red-950/30 disabled:opacity-50">Cancel</button>
                      <button
                        disabled={busy !== null}
                        title="Send this draft's reminder now"
                        onClick={() => void act(`remind-${b.id}`, () => sendDraftBudgetReminders(b.id))}
                        className="border border-ink-mid text-slate-light px-2.5 py-1 rounded-sm text-xs hover:border-signal/50 hover:text-paper disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        {busy === `remind-${b.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}Remind
                      </button>
                    </div>
                  </div>
                  {open && (
                    <div className="mt-3 ml-7 rounded border border-ink-mid bg-ink/40 p-3 text-xs">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-slate mb-2">Reminder goes to</p>
                      {recipients.length === 0 ? <p className="text-slate-light">Loading recipients…</p> : (
                        <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                          {recipients.map((r) => (
                            <li key={r.email} className="flex items-center gap-2">
                              <Mail className="h-3 w-3 text-slate" />
                              <span className="text-paper">{r.name !== r.email ? r.name : r.email}</span>
                              <span className="text-slate truncate">{r.reason}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {recipients.some((r) => String(r.reason).includes("no ")) && (
                        <p className="mt-2 text-amber-200/80">No QS or PM is named on this project, so every user with that role is reminded. Assign the project team to narrow it down.</p>
                      )}
                      {b.notes && <p className="mt-2 text-slate-light whitespace-pre-line">Notes: {b.notes}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Approved */}
      <BudgetTable title="Approved project budgets" subtitle="One working budget per project. Spend and forecasts are measured against these." rows={groups.approved} tone="emerald" />

      {/* History */}
      <section className={card}>
        <button onClick={() => setShowHistory((v) => !v)} className="w-full px-4 py-3 flex items-center justify-between bg-ink/30 hover:bg-ink-mid/20">
          <span className="flex items-center gap-2 font-mono text-xs tracking-wider uppercase text-slate">
            {showHistory ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Superseded &amp; cancelled ({groups.history.length})
          </span>
          <span className="text-[11px] text-slate-light">Earlier versions replaced by a newer approval</span>
        </button>
        {showHistory && <BudgetTable rows={groups.history} bare tone="slate" />}
      </section>
    </div>
  );
}

function BudgetTable({ title, subtitle, rows, tone, bare = false }: { title?: string; subtitle?: string; rows: RecordData[]; tone: "emerald" | "slate"; bare?: boolean }) {
  const statusClass = (s: string) =>
    s === "approved" ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
      : s === "cancelled" ? "border-red-500/30 bg-red-950/20 text-red-300"
        : "border-slate-500/30 bg-slate-950/20 text-slate-300";
  const table = (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider">
            <th className="p-3">Project</th><th className="p-3">Version</th><th className="p-3">Label</th>
            <th className="p-3">Effective</th><th className="p-3 text-right">Amount</th><th className="p-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.length === 0 ? (
            <tr><td colSpan={6} className="p-4 text-center text-slate">Nothing here.</td></tr>
          ) : rows.map((b) => (
            <tr key={b.id} className={`hover:bg-ink-mid/10 ${tone === "slate" ? "text-slate-light" : ""}`}>
              <td className="p-3 text-paper font-medium">{b.project_name || b.project_id}</td>
              <td className="p-3 font-mono">v{b.budget_version}</td>
              <td className="p-3 text-slate-light">{b.label || "-"}</td>
              <td className="p-3 text-slate-light">{fmtDate(b.effective_date)}</td>
              <td className="p-3 text-right tabular-nums font-semibold">{money(b.total_amount ?? b.allocated_amount)}</td>
              <td className="p-3"><span className={`border px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider ${statusClass(b.status)}`}>{b.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  if (bare) return table;
  return (
    <section className={card}>
      <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
        <span className="font-mono text-xs tracking-wider uppercase text-emerald-300">{title}</span>
        {subtitle && <p className="text-[11px] text-slate-light mt-0.5">{subtitle}</p>}
      </div>
      {table}
    </section>
  );
}

function Stat({ icon: Icon, tone, label, value, sub }: { icon: any; tone: string; label: string; value: string; sub: string }) {
  return (
    <div className="bg-ink-light border border-ink-mid rounded-lg p-3.5">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-slate"><Icon className="h-3.5 w-3.5" />{label}</div>
      <p className={`mt-1.5 text-xl font-semibold ${tone}`}>{value}</p>
      <p className="text-[11px] text-slate-light">{sub}</p>
    </div>
  );
}
