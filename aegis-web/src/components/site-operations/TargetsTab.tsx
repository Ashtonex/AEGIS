"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, CheckCircle2, Layers, Plus, Send, Sparkles, Trash2, XCircle } from "lucide-react";
import {
  createWeeklySiteBudget, decideWeeklySiteBudget, generateDailyTargets, getDailyTargets, getExecutionBudget,
  getWeeklySiteBudgetItems, getWeeklySiteBudgets, notifyDailyTargets, updateDailyTarget,
} from "@/lib/api";
import { ApiRecord, Btn, Locked, Notice, Panel, Pill, Toggle, dayLabel, errorText, fieldClass, num, qty, usd } from "./ui";

function isoAdd(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOf(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return d.toISOString().slice(0, 10);
}

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "blue"> = {
  approved: "green", submitted: "blue", rejected: "red", draft: "slate",
  done: "green", partial: "amber", missed: "red", open: "slate",
};

type Line = { boq_line_item_id: string; work_package: string; description: string; unit: string; planned_qty: string; planned_amount: string };
const EMPTY_LINE: Line = { boq_line_item_id: "", work_package: "", description: "", unit: "item", planned_qty: "", planned_amount: "" };

export function TargetsTab({ projectId, date, onChanged }: { projectId: string; date: string; onChanged: () => void }) {
  const [budgets, setBudgets] = useState<ApiRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [items, setItems] = useState<ApiRecord[]>([]);
  const [targets, setTargets] = useState<ApiRecord[]>([]);
  const [boq, setBoq] = useState<ApiRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5]);
  const [notify, setNotify] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ week_start: mondayOf(date), work_plan: "", lines: [{ ...EMPTY_LINE }] as Line[] });
  const [achieved, setAchieved] = useState<Record<string, string>>({});

  const selected = budgets.find((b) => b.id === selectedId) ?? null;
  const weekStart = selected ? String(selected.week_start).slice(0, 10) : mondayOf(date);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => isoAdd(weekStart, i)), [weekStart]);

  const loadBudgets = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [b, e] = await Promise.allSettled([getWeeklySiteBudgets({ projectId }), getExecutionBudget(projectId)]);
      const list = b.status === "fulfilled" && Array.isArray(b.value.data) ? b.value.data : [];
      setBudgets(list);
      setBoq(e.status === "fulfilled" ? (e.value.data?.line_items ?? []) : []);
      setSelectedId((current) => {
        if (current && list.some((x) => x.id === current)) return current;
        const covering = list.find((x) => String(x.week_start).slice(0, 10) <= date && isoAdd(String(x.week_start).slice(0, 10), 6) >= date && x.status !== "rejected");
        return (covering ?? list[0])?.id ?? "";
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, date]);

  const loadWeek = useCallback(async () => {
    if (!projectId || !selectedId) { setItems([]); setTargets([]); return; }
    const [i, t] = await Promise.allSettled([
      getWeeklySiteBudgetItems(selectedId),
      getDailyTargets({ projectId, dateFrom: weekStart, dateTo: isoAdd(weekStart, 6) }),
    ]);
    setItems(i.status === "fulfilled" && Array.isArray(i.value.data) ? i.value.data : []);
    const list = t.status === "fulfilled" && Array.isArray(t.value.data) ? t.value.data : [];
    setTargets(list);
    setAchieved(Object.fromEntries(list.map((x) => [x.id, String(num(x.achieved_qty) || "")])));
  }, [projectId, selectedId, weekStart]);

  useEffect(() => { void loadBudgets(); }, [loadBudgets]);
  useEffect(() => { void loadWeek(); }, [loadWeek]);

  const act = async (key: string, fn: () => Promise<any>, after?: () => Promise<void> | void) => {
    setBusy(key);
    setMessage(null);
    try {
      const r = await fn();
      setMessage({ tone: "success", text: r?.message ?? "Saved." });
      await after?.();
      onChanged();
    } catch (reason) {
      setMessage({ tone: "error", text: errorText(reason, "That didn't save. Try again.") });
    } finally {
      setBusy(null);
    }
  };

  const byDay = useMemo(() => {
    const map: Record<string, ApiRecord[]> = {};
    for (const t of targets) (map[String(t.target_date).slice(0, 10)] ??= []).push(t);
    return map;
  }, [targets]);

  const progress = useMemo(() => {
    const total = targets.length;
    const done = targets.filter((t) => t.status === "done").length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [targets]);

  if (!projectId) return <Locked title="Choose a project" body="Weekly budgets and daily targets are planned per project." />;

  const submitBudget = async () => {
    const lines = draft.lines.filter((l) => l.description.trim() && num(l.planned_qty) > 0).map((l) => ({
      boq_line_item_id: l.boq_line_item_id || null,
      work_package: l.work_package || null,
      description: l.description,
      unit: l.unit || "item",
      planned_qty: num(l.planned_qty),
      planned_amount: num(l.planned_amount),
    }));
    if (!lines.length) { setMessage({ tone: "error", text: "Add at least one line with a description and quantity." }); return; }
    await act("create", () => createWeeklySiteBudget({ project_id: projectId, week_start: draft.week_start, work_plan: draft.work_plan || null, lines }), async () => {
      setCreating(false);
      setDraft({ week_start: mondayOf(date), work_plan: "", lines: [{ ...EMPTY_LINE }] });
      await loadBudgets();
    });
  };

  return (
    <div className="space-y-4">
      {message ? <Notice tone={message.tone} onClose={() => setMessage(null)}>{message.text}</Notice> : null}

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* budget list */}
        <Panel title="Weekly budgets" subtitle="Set the week's work, then break it into daily targets."
          actions={<Btn tone="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating((v) => !v)}>New</Btn>}>
          {loading && !budgets.length ? <p className="text-sm text-slate-light">Loading…</p> : null}
          {!loading && !budgets.length ? <p className="text-sm text-slate-light">No weekly budget yet for this project.</p> : null}
          <div className="space-y-2">
            {budgets.map((b) => (
              <button key={b.id} onClick={() => setSelectedId(b.id)}
                className={`w-full border p-3 text-left transition ${b.id === selectedId ? "border-signal bg-signal/10" : "border-ink-mid hover:border-signal/50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-paper">Week of {dayLabel(String(b.week_start).slice(0, 10), { day: "2-digit", month: "short" })}</span>
                  <Pill tone={STATUS_TONE[String(b.status)] ?? "slate"}>{b.status}</Pill>
                </div>
                <p className="mt-1 text-xs text-slate-light">{usd(b.total_planned_amount)} planned{num(b.variance_count) ? ` · ${b.variance_count} variance` : ""}</p>
              </button>
            ))}
          </div>
        </Panel>

        <div className="space-y-4">
          {creating ? (
            <Panel title="New weekly budget" subtitle="Pick lines from the BOQ where you can. Lines not on the BOQ go to the QS as variances.">
              <div className="grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
                <label className="text-xs text-slate-light">Week starting
                  <input type="date" value={draft.week_start} onChange={(e) => setDraft({ ...draft, week_start: e.target.value })} className={`${fieldClass} mt-1`} />
                </label>
                <label className="text-xs text-slate-light">Work plan
                  <input value={draft.work_plan} onChange={(e) => setDraft({ ...draft, work_plan: e.target.value })} placeholder="What the site will achieve this week" className={`${fieldClass} mt-1`} />
                </label>
              </div>
              <div className="mt-4 space-y-2">
                {draft.lines.map((line, idx) => (
                  <div key={idx} className="grid gap-2 border border-ink-mid p-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_80px_100px_110px_36px]">
                    <select value={line.boq_line_item_id} onChange={(e) => {
                      const li = boq.find((b) => b.id === e.target.value);
                      const lines = [...draft.lines];
                      lines[idx] = li ? { ...line, boq_line_item_id: li.id, description: li.description ?? "", unit: li.unit ?? "item", work_package: li.item_no ? `BOQ ${li.item_no}` : line.work_package } : { ...line, boq_line_item_id: "" };
                      setDraft({ ...draft, lines });
                    }} className={fieldClass}>
                      <option value="">Free line (not on BOQ)</option>
                      {boq.map((b) => <option key={b.id} value={b.id}>{b.item_no ? `${b.item_no} · ` : ""}{String(b.description).slice(0, 60)} · {qty(b.available_qty)} {b.unit} left</option>)}
                    </select>
                    <input value={line.description} onChange={(e) => { const lines = [...draft.lines]; lines[idx] = { ...line, description: e.target.value }; setDraft({ ...draft, lines }); }} placeholder="Description" className={fieldClass} />
                    <input value={line.unit} onChange={(e) => { const lines = [...draft.lines]; lines[idx] = { ...line, unit: e.target.value }; setDraft({ ...draft, lines }); }} placeholder="Unit" className={fieldClass} />
                    <input type="number" min="0" step="any" value={line.planned_qty} onChange={(e) => { const lines = [...draft.lines]; lines[idx] = { ...line, planned_qty: e.target.value }; setDraft({ ...draft, lines }); }} placeholder="Qty" className={fieldClass} />
                    <input type="number" min="0" step="any" value={line.planned_amount} onChange={(e) => { const lines = [...draft.lines]; lines[idx] = { ...line, planned_amount: e.target.value }; setDraft({ ...draft, lines }); }} placeholder="$ (optional)" className={fieldClass} />
                    <button aria-label="Remove line" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== idx) })} className="flex items-center justify-center text-slate hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap justify-between gap-2">
                <Btn tone="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setDraft({ ...draft, lines: [...draft.lines, { ...EMPTY_LINE }] })}>Add line</Btn>
                <div className="flex gap-2">
                  <Btn tone="ghost" onClick={() => setCreating(false)}>Cancel</Btn>
                  <Btn busy={busy === "create"} icon={<Send className="h-4 w-4" />} onClick={() => void submitBudget()}>Submit weekly budget</Btn>
                </div>
              </div>
            </Panel>
          ) : null}

          {selected ? (
            <>
              <Panel title={`Week of ${dayLabel(weekStart, { weekday: "long", day: "2-digit", month: "long" })}`}
                subtitle={selected.work_plan || "No work plan written."}
                actions={selected.status === "submitted" ? (
                  <div className="flex gap-2">
                    <Btn tone="ghost" busy={busy === "reject"} icon={<XCircle className="h-4 w-4" />}
                      onClick={() => { const reason = window.prompt("Why is this budget rejected?"); if (reason) void act("reject", () => decideWeeklySiteBudget(selected.id, "rejected", reason), loadBudgets); }}>Reject</Btn>
                    <Btn tone="success" busy={busy === "approve"} icon={<CheckCircle2 className="h-4 w-4" />}
                      onClick={() => void act("approve", () => decideWeeklySiteBudget(selected.id, "approved", "Approved from Site Operations."), loadBudgets)}>Approve</Btn>
                  </div>
                ) : <Pill tone={STATUS_TONE[String(selected.status)] ?? "slate"}>{selected.status}</Pill>}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead><tr className="border-b border-ink-mid text-left font-mono text-[10px] uppercase tracking-wider text-slate">
                      <th className="py-2">Line</th><th>Qty</th><th>Amount</th><th>Status</th></tr></thead>
                    <tbody className="divide-y divide-ink-mid">
                      {items.map((it) => (
                        <tr key={it.id}>
                          <td className="py-2 pr-3 text-paper">{it.work_package ? <span className="text-slate-light">{it.work_package} · </span> : null}{it.description}</td>
                          <td className="font-mono text-paper">{qty(it.planned_qty)} {it.unit}</td>
                          <td className="font-mono text-slate-light">{usd(it.planned_amount)}</td>
                          <td><Pill tone={it.variance_required ? "amber" : "green"}>{it.variance_required ? "variance" : "planned"}</Pill></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {["submitted", "approved"].includes(String(selected.status)) && items.length ? (
                  <div className="mt-4 flex flex-col gap-3 border border-signal/30 bg-signal/5 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><Sparkles className="h-4 w-4 text-signal" /> Break into daily targets</p>
                      <p className="mt-1 text-xs text-slate-light">Each line is split evenly across the working days. Engineers get each day&apos;s targets in AEGIS and on Teams.</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {weekDates.map((d, i) => (
                          <button key={d} onClick={() => setDays((cur) => cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort())}
                            className={`border px-2.5 py-1 font-mono text-xs transition ${days.includes(i) ? "border-signal bg-signal text-ink" : "border-ink-mid text-slate-light hover:border-signal/60"}`}>
                            {dayLabel(d, { weekday: "short" })}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col items-start gap-2 lg:items-end">
                      <label className="flex items-center gap-2 text-xs text-slate-light"><Toggle checked={notify} onChange={setNotify} label="Send to engineers" /> Send to engineers on Teams</label>
                      <Btn busy={busy === "gen"} disabled={!days.length} icon={<Layers className="h-4 w-4" />}
                        onClick={() => void act("gen", () => generateDailyTargets(selected.id, { working_days: days, replace_open: true, notify }), loadWeek)}>
                        {targets.length ? "Rebuild daily targets" : "Generate daily targets"}
                      </Btn>
                    </div>
                  </div>
                ) : null}
              </Panel>

              <Panel title="Daily targets this week" subtitle={progress.total ? `${progress.done} of ${progress.total} targets done (${progress.pct}%)` : "Not broken down yet."}
                actions={progress.total ? <div className="h-2 w-40 overflow-hidden bg-ink-light"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress.pct}%` }} /></div> : null}>
                {!targets.length ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-slate-light"><CalendarRange className="h-7 w-7 text-slate" /> Generate daily targets from the weekly budget above.</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {weekDates.filter((d) => byDay[d]?.length).map((d) => (
                      <div key={d} className={`border ${d === date ? "border-signal" : "border-ink-mid"}`}>
                        <div className={`flex items-center justify-between px-3 py-2 ${d === date ? "bg-signal/10" : "bg-ink-light/40"}`}>
                          <span className="font-mono text-xs font-bold uppercase tracking-widest text-paper">{dayLabel(d, { weekday: "long", day: "2-digit", month: "short" })}{d === date ? " · today" : ""}</span>
                          <button title="Send this day's targets to the engineers" disabled={busy === `n-${d}`}
                            onClick={() => void act(`n-${d}`, () => notifyDailyTargets({ project_id: projectId, target_date: d }))}
                            className="text-slate hover:text-signal disabled:opacity-50"><Send className="h-4 w-4" /></button>
                        </div>
                        <ul className="divide-y divide-ink-mid">
                          {byDay[d].map((t) => (
                            <li key={t.id} className="space-y-1.5 px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm text-paper">{t.work_package ? <span className="text-slate-light">{t.work_package} · </span> : null}{t.description}</p>
                                <Pill tone={STATUS_TONE[String(t.status)] ?? "slate"}>{t.status}</Pill>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-slate-light">
                                <span>Target <b className="font-mono text-paper">{qty(t.target_qty)}</b> {t.unit}</span>
                                <span className="ml-auto">Done</span>
                                <input type="number" min="0" step="any" value={achieved[t.id] ?? ""} onChange={(e) => setAchieved({ ...achieved, [t.id]: e.target.value })}
                                  onBlur={() => { const v = achieved[t.id]; if (v !== "" && num(v) !== num(t.achieved_qty)) void act(`t-${t.id}`, () => updateDailyTarget(t.id, { achieved_qty: num(v) }), loadWeek); }}
                                  className="h-7 w-20 border border-ink-mid bg-ink-light px-2 text-right font-mono text-xs text-paper outline-none focus:border-signal" />
                              </div>
                              <div className="h-1 overflow-hidden bg-ink-light"><div className={`h-full ${t.status === "done" ? "bg-emerald-500" : "bg-signal"}`} style={{ width: `${Math.min(100, num(t.target_qty) ? (num(t.achieved_qty) / num(t.target_qty)) * 100 : 0)}%` }} /></div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </>
          ) : !creating ? (
            <Locked title="No weekly budget selected" body="Create this week's budget first. It feeds material requests and the daily targets the engineers work to."
              action={<Btn icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New weekly budget</Btn>} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
