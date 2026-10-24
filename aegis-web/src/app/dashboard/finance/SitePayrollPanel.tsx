"use client";

import type React from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck, Ban, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, HardHat, Loader2, Pencil,
  Plus, Printer, Save, Send, UserPlus, Wallet, X,
} from "lucide-react";
import {
  createSitePayRun,
  createSiteWorker,
  decideSitePayRun,
  getFinanceCashAccounts,
  getSitePayRun,
  getSitePayRuns,
  getSitePayrollSummary,
  getSiteTimeEntries,
  getSiteWorkers,
  saveSiteTimeEntries,
  updateSiteWorker,
} from "@/lib/api";

type RecordData = Record<string, any>;

function money(value: unknown, digits = 2) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number.isFinite(num) ? num : 0);
}
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mondayOf(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function escapeHtml(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const card = "bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]";
const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const labelClass = "block text-[10px] font-mono uppercase tracking-wider text-slate mb-1";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50 disabled:cursor-not-allowed";
const ghostClass = "inline-flex items-center gap-1.5 border border-ink-mid text-paper px-3 py-1.5 rounded-sm text-xs hover:border-signal/50 disabled:opacity-50";

const RUN_STATUS: Record<string, string> = {
  draft: "border-slate-500/30 bg-slate-950/20 text-slate-300",
  approved: "border-sky-500/30 bg-sky-950/20 text-sky-300",
  paid: "border-emerald-500/30 bg-emerald-950/20 text-emerald-300",
  cancelled: "border-red-500/30 bg-red-950/20 text-red-300",
};

function emptyWorker(projectId: string) {
  return { project_id: projectId, full_name: "", national_id: "", phone: "", trade: "", hourly_rate: "", overtime_rate: "", currency: "USD", payment_method: "cash", payment_details: "", status: "active", start_date: "", end_date: "", notes: "" };
}

type Cell = { regular: string; overtime: string; locked: boolean; dirty: boolean };

/**
 * Site payroll: hourly labour deployed to a project who aren't AEGIS users
 * or HR employees. Log them on the project, fill in the week's hours, then
 * gather unpaid hours into a site pay run: draft -> approved -> paid.
 * Paying posts one cashbook payment and the gross wages as labour cost on
 * the project.
 */
export function SitePayrollPanel({ projects }: { projects: RecordData[] }) {
  const [projectId, setProjectId] = useState("");
  const [summary, setSummary] = useState<RecordData[]>([]);
  const [workers, setWorkers] = useState<RecordData[]>([]);
  const [runs, setRuns] = useState<RecordData[]>([]);
  const [accounts, setAccounts] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [grid, setGrid] = useState<Record<string, Cell>>({});
  const [showOvertime, setShowOvertime] = useState(false);

  const [workerForm, setWorkerForm] = useState<RecordData | null>(null);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const [runForm, setRunForm] = useState(() => ({ period_start: iso(mondayOf(new Date())), period_end: iso(addDays(mondayOf(new Date()), 6)), payment_date: iso(new Date()), cash_account_id: "", notes: "" }));
  const [deductions, setDeductions] = useState<Record<string, { amount: string; note: string }>>({});
  const [showRunForm, setShowRunForm] = useState(false);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<RecordData | null>(null);
  const [payMethod, setPayMethod] = useState("cash");

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const project = projects.find((p) => p.id === projectId);

  const notify = (text: string, tone: "ok" | "error" = "ok") => setNotice({ text, tone });

  const loadSummary = useCallback(async () => {
    const [s, a] = await Promise.allSettled([getSitePayrollSummary(), getFinanceCashAccounts()]);
    if (s.status === "fulfilled") setSummary(s.value.data || []);
    if (a.status === "fulfilled") setAccounts(a.value.data || []);
  }, []);

  const loadProject = useCallback(async () => {
    if (!projectId) { setWorkers([]); setRuns([]); setGrid({}); return; }
    setLoading(true);
    const from = iso(weekStart);
    const to = iso(addDays(weekStart, 6));
    const [w, t, r] = await Promise.allSettled([
      getSiteWorkers({ project_id: projectId, include_inactive: true }),
      getSiteTimeEntries({ project_id: projectId, date_from: from, date_to: to }),
      getSitePayRuns({ project_id: projectId }),
    ]);
    if (w.status === "fulfilled") setWorkers(w.value.data || []);
    if (r.status === "fulfilled") setRuns(r.value.data || []);
    const next: Record<string, Cell> = {};
    if (t.status === "fulfilled") {
      for (const e of t.value.data || []) {
        next[`${e.worker_id}|${String(e.work_date).slice(0, 10)}`] = {
          regular: Number(e.regular_hours) ? String(Number(e.regular_hours)) : "",
          overtime: Number(e.overtime_hours) ? String(Number(e.overtime_hours)) : "",
          locked: !!e.pay_run_id,
          dirty: false,
        };
        if (Number(e.overtime_hours)) setShowOvertime(true);
      }
    }
    setGrid(next);
    setLoading(false);
  }, [projectId, weekStart]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void loadProject(); }, [loadProject]);

  const activeWorkers = workers.filter((w) => w.status === "active");
  const shownWorkers = showInactive ? workers : activeWorkers;
  const dirtyCount = Object.values(grid).filter((c) => c.dirty).length;

  const cell = (workerId: string, day: Date): Cell => grid[`${workerId}|${iso(day)}`] || { regular: "", overtime: "", locked: false, dirty: false };
  const setCell = (workerId: string, day: Date, patch: Partial<Cell>) => {
    const key = `${workerId}|${iso(day)}`;
    setGrid((g) => ({ ...g, [key]: { ...(g[key] || { regular: "", overtime: "", locked: false, dirty: false }), ...patch, dirty: true } }));
  };
  const rowTotals = (w: RecordData) => {
    let reg = 0, ot = 0;
    for (const d of days) { const c = cell(w.id, d); reg += Number(c.regular) || 0; ot += Number(c.overtime) || 0; }
    const rate = Number(w.hourly_rate || 0);
    const otRate = w.overtime_rate != null && w.overtime_rate !== "" ? Number(w.overtime_rate) : rate * 1.5;
    return { reg, ot, pay: reg * rate + ot * otRate };
  };
  const weekTotals = shownWorkers.reduce((acc, w) => { const t = rowTotals(w); return { reg: acc.reg + t.reg, ot: acc.ot + t.ot, pay: acc.pay + t.pay }; }, { reg: 0, ot: 0, pay: 0 });

  const fillDefault = (hours: number) => {
    setGrid((g) => {
      const next = { ...g };
      for (const w of activeWorkers) {
        for (const d of days.slice(0, 5)) {
          const key = `${w.id}|${iso(d)}`;
          const c = next[key];
          if (c?.locked || (c && (c.regular || c.overtime))) continue;
          next[key] = { regular: String(hours), overtime: c?.overtime || "", locked: false, dirty: true };
        }
      }
      return next;
    });
  };

  const run = async (key: string, fn: () => Promise<any>, after?: () => void | Promise<void>) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fn();
      notify(res?.message || "Done.");
      await after?.();
      await Promise.all([loadProject(), loadSummary()]);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Action failed.", "error");
    } finally {
      setBusy(null);
    }
  };

  const saveTimesheet = () => {
    const entries = Object.entries(grid)
      .filter(([, c]) => c.dirty && !c.locked)
      .map(([key, c]) => {
        const [worker_id, work_date] = key.split("|");
        return { worker_id, work_date, regular_hours: Math.min(24, Number(c.regular) || 0), overtime_hours: Math.min(24, Number(c.overtime) || 0) };
      });
    if (!entries.length) return;
    void run("save", () => saveSiteTimeEntries({ project_id: projectId, entries }));
  };

  const saveWorker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerForm) return;
    const payload = {
      ...workerForm,
      project_id: workerForm.project_id || projectId || null,
      hourly_rate: Number(workerForm.hourly_rate) || 0,
      overtime_rate: workerForm.overtime_rate === "" ? null : Number(workerForm.overtime_rate),
      start_date: workerForm.start_date || null,
      end_date: workerForm.end_date || null,
      national_id: workerForm.national_id || null,
      phone: workerForm.phone || null,
      trade: workerForm.trade || null,
      payment_details: workerForm.payment_details || null,
      notes: workerForm.notes || null,
    };
    void run("worker", () => (editingWorkerId ? updateSiteWorker(editingWorkerId, payload) : createSiteWorker(payload)), () => { setWorkerForm(null); setEditingWorkerId(null); });
  };

  const editWorker = (w: RecordData) => {
    setEditingWorkerId(w.id);
    setWorkerForm({
      project_id: w.project_id || "", full_name: w.full_name || "", national_id: w.national_id || "", phone: w.phone || "", trade: w.trade || "",
      hourly_rate: String(w.hourly_rate ?? ""), overtime_rate: w.overtime_rate == null ? "" : String(w.overtime_rate), currency: w.currency || "USD",
      payment_method: w.payment_method || "cash", payment_details: w.payment_details || "", status: w.status || "active",
      start_date: w.start_date ? String(w.start_date).slice(0, 10) : "", end_date: w.end_date ? String(w.end_date).slice(0, 10) : "", notes: w.notes || "",
    });
  };

  const createRun = (e: React.FormEvent) => {
    e.preventDefault();
    void run("run", () => createSitePayRun({
      project_id: projectId,
      ...runForm,
      cash_account_id: runForm.cash_account_id || null,
      notes: runForm.notes || null,
      deductions: Object.entries(deductions).filter(([, d]) => Number(d.amount) > 0).map(([worker_id, d]) => ({ worker_id, amount: Number(d.amount), note: d.note || null })),
    }), () => { setShowRunForm(false); setDeductions({}); });
  };

  const toggleRun = async (id: string) => {
    if (openRunId === id) { setOpenRunId(null); setOpenRun(null); return; }
    setOpenRunId(id);
    setOpenRun(null);
    try { setOpenRun((await getSitePayRun(id)).data); } catch { setOpenRun({ lines: [] }); }
  };

  const decide = (r: RecordData, action: "approve" | "pay" | "cancel") => {
    if (action === "pay") {
      const acct = r.cash_account_id || runForm.cash_account_id;
      if (!acct) { notify("Choose the cash account to pay from (in the new-run form) or set it on the run.", "error"); return; }
      if (!window.confirm(`Pay ${r.run_number}: ${money(r.total_net)} to ${r.worker_count} workers?`)) return;
      void run(`pay-${r.id}`, () => decideSitePayRun(r.id, { action, cash_account_id: acct, payment_method: payMethod }));
      return;
    }
    if (action === "cancel" && !window.confirm(`Cancel ${r.run_number}? Its hours become unpaid again.`)) return;
    void run(`${action}-${r.id}`, () => decideSitePayRun(r.id, { action }));
  };

  const printSheet = async (r: RecordData) => {
    const detail = openRun?.id === r.id ? openRun : (await getSitePayRun(r.id)).data;
    const lines: RecordData[] = detail?.lines || [];
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(r.run_number)}</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}h1{font-size:16px;margin:0}table{border-collapse:collapse;width:100%;margin-top:14px}th,td{border:1px solid #999;padding:6px;text-align:left}td.n,th.n{text-align:right}.sig{width:140px}.meta{margin-top:4px;color:#444}</style></head><body>
      <h1>Six Nine Construction - Site Wages Sheet</h1>
      <div class="meta">${escapeHtml(r.project_name)} · Run ${escapeHtml(r.run_number)} · Period ${escapeHtml(r.period_start)} to ${escapeHtml(r.period_end)} · Pay date ${escapeHtml(r.payment_date)}</div>
      <table><thead><tr><th>#</th><th>Name</th><th>ID No.</th><th>Trade</th><th class="n">Hrs</th><th class="n">OT</th><th class="n">Rate</th><th class="n">Gross</th><th class="n">Deduct.</th><th class="n">Net</th><th>Paid via</th><th class="sig">Signature</th></tr></thead><tbody>
      ${lines.map((l, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(l.full_name)}</td><td>${escapeHtml(l.national_id || "")}</td><td>${escapeHtml(l.trade || "")}</td><td class="n">${Number(l.regular_hours)}</td><td class="n">${Number(l.overtime_hours)}</td><td class="n">${Number(l.hourly_rate).toFixed(2)}</td><td class="n">${Number(l.gross_pay).toFixed(2)}</td><td class="n">${Number(l.deductions).toFixed(2)}</td><td class="n"><b>${Number(l.net_pay).toFixed(2)}</b></td><td>${escapeHtml(String(l.payment_method || "").replace("_", " "))} ${escapeHtml(l.payment_details || "")}</td><td></td></tr>`).join("")}
      <tr><td colspan="7"><b>Total (${lines.length} workers)</b></td><td class="n"><b>${Number(r.total_gross).toFixed(2)}</b></td><td class="n">${Number(r.total_deductions).toFixed(2)}</td><td class="n"><b>${Number(r.total_net).toFixed(2)}</b></td><td colspan="2"></td></tr>
      </tbody></table>
      <p style="margin-top:30px">Prepared by: ____________________ &nbsp;&nbsp; Approved by: ____________________ &nbsp;&nbsp; Paid by: ____________________</p>
      <script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-5">
      {notice && (
        <div className={`border px-4 py-2.5 text-sm rounded flex justify-between gap-3 ${notice.tone === "error" ? "border-red-500/30 bg-red-950/20 text-red-200" : "border-signal/30 bg-signal/10 text-paper"}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Projects with site labour */}
      <section className={`${card} p-4`}>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="w-80">
            <label className={labelClass}>Project</label>
            <select className={inputClass} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Choose a project to run its site payroll</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <p className="text-xs text-slate-light pb-2 max-w-xl">Site payroll is for hourly people working on a project who aren&apos;t registered on AEGIS or in HR. Monthly staff are paid from the Staff payroll tab.</p>
        </div>
        {summary.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            {summary.map((s) => (
              <button key={s.project_id} onClick={() => setProjectId(s.project_id)} className={`text-left rounded border px-3 py-2 transition-colors ${projectId === s.project_id ? "border-signal/60 bg-signal/10" : "border-ink-mid hover:border-signal/30"}`}>
                <p className="text-paper text-sm font-medium truncate">{s.project_name}</p>
                <p className="text-[11px] text-slate-light">{s.active_workers} active · {Number(s.hours_this_month).toFixed(0)} hrs this month</p>
                <div className="flex gap-3 mt-1 text-[11px]">
                  <span className="text-amber-300">Unpaid {money(Number(s.unrun_value) + Number(s.open_runs), 0)}</span>
                  <span className="text-slate">Paid {money(s.paid_to_date, 0)}</span>
                </div>
              </button>
            ))}
          </div>
        ) : <p className="text-xs text-slate">No project has site labour logged yet.</p>}
      </section>

      {!projectId ? null : loading && workers.length === 0 ? (
        <div className={`${card} p-8 flex items-center gap-3 text-slate`}><Loader2 className="h-4 w-4 animate-spin" />Loading {project?.name}…</div>
      ) : (
        <>
          {/* Workers */}
          <section className={card}>
            <div className="px-4 py-3 border-b border-ink-mid flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs uppercase tracking-wider text-slate flex items-center gap-1.5"><HardHat className="h-3.5 w-3.5" />Site workers on {project?.name}</span>
              <label className="text-[11px] text-slate flex items-center gap-1.5 ml-auto"><input type="checkbox" className="accent-signal" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label>
              <button onClick={() => { setEditingWorkerId(null); setWorkerForm(workerForm && !editingWorkerId ? null : emptyWorker(projectId)); }} className={ghostClass}>
                {workerForm && !editingWorkerId ? <X className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}{workerForm && !editingWorkerId ? "Cancel" : "Add worker"}
              </button>
            </div>
            {workerForm && (
              <form onSubmit={saveWorker} className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 border-b border-ink-mid bg-ink/30">
                <div className="md:col-span-2"><label className={labelClass}>Full name</label><input className={inputClass} required value={workerForm.full_name} onChange={(e) => setWorkerForm({ ...workerForm, full_name: e.target.value })} /></div>
                <div><label className={labelClass}>National ID</label><input className={inputClass} value={workerForm.national_id} onChange={(e) => setWorkerForm({ ...workerForm, national_id: e.target.value })} /></div>
                <div><label className={labelClass}>Phone</label><input className={inputClass} value={workerForm.phone} onChange={(e) => setWorkerForm({ ...workerForm, phone: e.target.value })} /></div>
                <div><label className={labelClass}>Trade</label><input className={inputClass} placeholder="General hand, bricklayer…" value={workerForm.trade} onChange={(e) => setWorkerForm({ ...workerForm, trade: e.target.value })} /></div>
                <div><label className={labelClass}>Hourly rate (USD)</label><input className={inputClass} type="number" min="0" step="0.01" required value={workerForm.hourly_rate} onChange={(e) => setWorkerForm({ ...workerForm, hourly_rate: e.target.value })} /></div>
                <div><label className={labelClass}>Overtime rate</label><input className={inputClass} type="number" min="0" step="0.01" placeholder="Default 1.5× hourly" value={workerForm.overtime_rate} onChange={(e) => setWorkerForm({ ...workerForm, overtime_rate: e.target.value })} /></div>
                <div>
                  <label className={labelClass}>Deployed to</label>
                  <select className={inputClass} value={workerForm.project_id} onChange={(e) => setWorkerForm({ ...workerForm, project_id: e.target.value })}>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Paid by</label>
                  <select className={inputClass} value={workerForm.payment_method} onChange={(e) => setWorkerForm({ ...workerForm, payment_method: e.target.value })}>
                    <option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option>
                  </select>
                </div>
                <div><label className={labelClass}>{workerForm.payment_method === "mobile_money" ? "Mobile number" : workerForm.payment_method === "bank_transfer" ? "Bank & account" : "Payment details"}</label><input className={inputClass} value={workerForm.payment_details} onChange={(e) => setWorkerForm({ ...workerForm, payment_details: e.target.value })} /></div>
                <div><label className={labelClass}>Start date</label><input className={inputClass} type="date" value={workerForm.start_date} onChange={(e) => setWorkerForm({ ...workerForm, start_date: e.target.value })} /></div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select className={inputClass} value={workerForm.status} onChange={(e) => setWorkerForm({ ...workerForm, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive (left site)</option></select>
                </div>
                <div className="md:col-span-4 flex justify-end gap-2">
                  {editingWorkerId && <button type="button" onClick={() => { setWorkerForm(null); setEditingWorkerId(null); }} className={ghostClass}>Cancel</button>}
                  <button disabled={busy !== null} className={buttonClass}><BadgeCheck className="h-4 w-4" />{editingWorkerId ? "Save changes" : "Add to site payroll"}</button>
                </div>
              </form>
            )}
            {shownWorkers.length === 0 ? (
              <p className="p-4 text-sm text-slate-light">No site workers on this project yet. Add the people working there.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-ink-mid text-slate font-mono text-[10px] uppercase tracking-wider"><th className="p-2 pl-4">Name</th><th className="p-2">Trade</th><th className="p-2">ID / phone</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">OT rate</th><th className="p-2">Paid by</th><th className="p-2 text-right">Unpaid hrs</th><th className="p-2">Last worked</th><th className="p-2"></th></tr></thead>
                  <tbody className="divide-y divide-ink-mid">
                    {shownWorkers.map((w) => (
                      <tr key={w.id} className={w.status !== "active" ? "opacity-50" : ""}>
                        <td className="p-2 pl-4 text-paper font-medium">{w.full_name}{w.status !== "active" && <span className="ml-2 text-[9px] uppercase font-mono text-slate">inactive</span>}</td>
                        <td className="p-2 text-slate-light">{w.trade || "-"}</td>
                        <td className="p-2 text-slate-light text-xs">{w.national_id || "-"}<br />{w.phone || ""}</td>
                        <td className="p-2 text-right tabular-nums text-paper">{money(w.hourly_rate)}/h</td>
                        <td className="p-2 text-right tabular-nums text-slate-light">{w.overtime_rate != null ? money(w.overtime_rate) : "1.5×"}</td>
                        <td className="p-2 text-slate-light text-xs">{String(w.payment_method).replace("_", " ")}{w.payment_details ? ` · ${w.payment_details}` : ""}</td>
                        <td className="p-2 text-right tabular-nums text-amber-300">{(Number(w.unpaid_regular_hours) + Number(w.unpaid_overtime_hours)).toFixed(1)}</td>
                        <td className="p-2 text-slate-light text-xs">{w.last_worked ? String(w.last_worked).slice(0, 10) : "-"}</td>
                        <td className="p-2 text-right"><button onClick={() => editWorker(w)} className="text-slate hover:text-signal" title="Edit"><Pencil className="h-3.5 w-3.5" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Timesheet */}
          <section className={card}>
            <div className="px-4 py-3 border-b border-ink-mid flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs uppercase tracking-wider text-slate flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Weekly timesheet</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setWeekStart(addDays(weekStart, -7))} disabled={dirtyCount > 0} className="p-1 text-slate hover:text-paper disabled:opacity-30" title={dirtyCount ? "Save first" : "Previous week"}><ChevronLeft className="h-4 w-4" /></button>
                <span className="text-sm text-paper tabular-nums">{days[0].toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} - {days[6].toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                <button onClick={() => setWeekStart(addDays(weekStart, 7))} disabled={dirtyCount > 0} className="p-1 text-slate hover:text-paper disabled:opacity-30" title={dirtyCount ? "Save first" : "Next week"}><ChevronRight className="h-4 w-4" /></button>
                <button onClick={() => setWeekStart(mondayOf(new Date()))} disabled={dirtyCount > 0} className="text-[11px] text-signal hover:underline ml-1 disabled:opacity-30">This week</button>
              </div>
              <label className="text-[11px] text-slate flex items-center gap-1.5"><input type="checkbox" className="accent-signal" checked={showOvertime} onChange={(e) => setShowOvertime(e.target.checked)} />Overtime</label>
              <button onClick={() => fillDefault(8)} className={ghostClass} title="Fill empty Mon-Fri cells with 8 hours for active workers">Fill 8h Mon-Fri</button>
              <button disabled={dirtyCount === 0 || busy !== null} onClick={saveTimesheet} className={`${buttonClass} ml-auto py-1.5`}>
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save{dirtyCount ? ` (${dirtyCount})` : ""}
              </button>
            </div>
            {activeWorkers.length === 0 ? <p className="p-4 text-sm text-slate-light">Add active workers first.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[10px] uppercase tracking-wider">
                      <th className="p-2 pl-4 text-left min-w-[160px]">Worker</th>
                      {days.map((d) => <th key={iso(d)} className={`p-2 text-center w-20 ${d.getDay() === 0 || d.getDay() === 6 ? "text-slate/70" : ""}`}>{d.toLocaleDateString("en-GB", { weekday: "short" })}<br /><span className="normal-case">{d.getDate()}</span></th>)}
                      <th className="p-2 text-right">Hours</th><th className="p-2 pr-4 text-right">Est. pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {activeWorkers.map((w) => {
                      const t = rowTotals(w);
                      return (
                        <tr key={w.id}>
                          <td className="p-2 pl-4"><p className="text-paper">{w.full_name}</p><p className="text-[10px] text-slate">{money(w.hourly_rate)}/h</p></td>
                          {days.map((d) => {
                            const c = cell(w.id, d);
                            return (
                              <td key={iso(d)} className="p-1 text-center align-top">
                                <input
                                  className={`w-16 bg-ink border rounded px-1.5 py-1 text-center text-sm tabular-nums focus:outline-none focus:border-signal/50 ${c.locked ? "border-emerald-500/30 text-emerald-300/80" : c.dirty ? "border-signal/50 text-paper" : "border-ink-mid text-paper"}`}
                                  inputMode="decimal" placeholder="-" disabled={c.locked} title={c.locked ? "On a pay run - cancel the run to edit" : "Regular hours"}
                                  value={c.regular} onChange={(e) => setCell(w.id, d, { regular: e.target.value.replace(/[^0-9.]/g, "") })}
                                />
                                {showOvertime && (
                                  <input
                                    className={`mt-1 w-16 bg-ink border rounded px-1.5 py-0.5 text-center text-xs tabular-nums focus:outline-none ${c.locked ? "border-emerald-500/20 text-emerald-300/60" : "border-amber-500/30 text-amber-200"}`}
                                    inputMode="decimal" placeholder="OT" disabled={c.locked} title="Overtime hours"
                                    value={c.overtime} onChange={(e) => setCell(w.id, d, { overtime: e.target.value.replace(/[^0-9.]/g, "") })}
                                  />
                                )}
                              </td>
                            );
                          })}
                          <td className="p-2 text-right tabular-nums text-paper">{t.reg}{t.ot ? <span className="text-amber-300"> +{t.ot}</span> : null}</td>
                          <td className="p-2 pr-4 text-right tabular-nums text-paper">{money(t.pay)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-ink/30 font-semibold">
                      <td className="p-2 pl-4 text-slate text-xs uppercase font-mono">Week total</td>
                      <td colSpan={7} />
                      <td className="p-2 text-right tabular-nums text-paper">{weekTotals.reg}{weekTotals.ot ? <span className="text-amber-300"> +{weekTotals.ot}</span> : null}</td>
                      <td className="p-2 pr-4 text-right tabular-nums text-signal">{money(weekTotals.pay)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="px-4 py-2 text-[11px] text-slate">Green cells are already on a pay run and locked. Clearing a cell to blank removes that day. Days beyond 24 hours are capped.</p>
              </div>
            )}
          </section>

          {/* Pay runs */}
          <section className={card}>
            <div className="px-4 py-3 border-b border-ink-mid flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs uppercase tracking-wider text-slate flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" />Site pay runs</span>
              <label className="text-[11px] text-slate flex items-center gap-1.5 ml-auto">Pay out by
                <select className="bg-ink border border-ink-mid rounded px-2 py-1 text-xs text-paper" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option>
                </select>
              </label>
              <button onClick={() => { setShowRunForm((v) => !v); setRunForm((f) => ({ ...f, period_start: iso(weekStart), period_end: iso(addDays(weekStart, 6)) })); }} className={ghostClass}>
                {showRunForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{showRunForm ? "Cancel" : "New pay run"}
              </button>
            </div>
            {showRunForm && (
              <form onSubmit={createRun} className="p-4 border-b border-ink-mid bg-ink/30 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <div><label className={labelClass}>Period start</label><input type="date" className={inputClass} value={runForm.period_start} onChange={(e) => setRunForm({ ...runForm, period_start: e.target.value })} /></div>
                  <div><label className={labelClass}>Period end</label><input type="date" className={inputClass} value={runForm.period_end} onChange={(e) => setRunForm({ ...runForm, period_end: e.target.value })} /></div>
                  <div><label className={labelClass}>Pay date</label><input type="date" className={inputClass} value={runForm.payment_date} onChange={(e) => setRunForm({ ...runForm, payment_date: e.target.value })} /></div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>Pay from</label>
                    <select className={inputClass} value={runForm.cash_account_id} onChange={(e) => setRunForm({ ...runForm, cash_account_id: e.target.value })}>
                      <option value="">Choose later</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name} · {money(a.current_balance, 0)}</option>)}
                    </select>
                  </div>
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer text-slate-light">Deductions (advances, damages): optional</summary>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {activeWorkers.map((w) => (
                      <div key={w.id} className="flex items-center gap-2">
                        <span className="text-paper w-40 truncate">{w.full_name}</span>
                        <input className="w-24 bg-ink border border-ink-mid rounded px-2 py-1 text-xs text-paper" placeholder="0.00" value={deductions[w.id]?.amount || ""} onChange={(e) => setDeductions({ ...deductions, [w.id]: { amount: e.target.value, note: deductions[w.id]?.note || "" } })} />
                        <input className="flex-1 bg-ink border border-ink-mid rounded px-2 py-1 text-xs text-paper" placeholder="Reason" value={deductions[w.id]?.note || ""} onChange={(e) => setDeductions({ ...deductions, [w.id]: { amount: deductions[w.id]?.amount || "", note: e.target.value } })} />
                      </div>
                    ))}
                  </div>
                </details>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-slate-light">Gathers every unpaid hour logged on {project?.name} in the period, priced at each worker&apos;s current rate.</p>
                  <button disabled={busy !== null} className={buttonClass}>{busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Create draft run</button>
                </div>
              </form>
            )}
            {runs.length === 0 ? <p className="p-4 text-sm text-slate-light">No site pay runs for this project yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-ink-mid text-slate font-mono text-[10px] uppercase tracking-wider"><th className="p-2 pl-4"></th><th className="p-2">Run</th><th className="p-2">Period</th><th className="p-2 text-right">Workers</th><th className="p-2 text-right">Hours</th><th className="p-2 text-right">Gross</th><th className="p-2 text-right">Net</th><th className="p-2">Status</th><th className="p-2 pr-4 text-right">Actions</th></tr></thead>
                  <tbody className="divide-y divide-ink-mid">
                    {runs.map((r) => (
                      <Fragment key={r.id}>
                        <tr className="hover:bg-ink-mid/10 cursor-pointer" onClick={() => void toggleRun(r.id)}>
                          <td className="p-2 pl-4 text-slate">{openRunId === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                          <td className="p-2 font-mono text-xs text-paper">{r.run_number}</td>
                          <td className="p-2 text-slate-light text-xs">{String(r.period_start).slice(0, 10)} → {String(r.period_end).slice(0, 10)}</td>
                          <td className="p-2 text-right tabular-nums">{r.worker_count}</td>
                          <td className="p-2 text-right tabular-nums">{Number(r.total_hours).toFixed(1)}</td>
                          <td className="p-2 text-right tabular-nums">{money(r.total_gross)}</td>
                          <td className="p-2 text-right tabular-nums font-semibold text-paper">{money(r.total_net)}</td>
                          <td className="p-2"><span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${RUN_STATUS[r.status] || ""}`}>{r.status}</span></td>
                          <td className="p-2 pr-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex gap-1.5">
                              <button onClick={() => void printSheet(r)} className="text-slate hover:text-paper" title="Print wages / signing sheet"><Printer className="h-3.5 w-3.5" /></button>
                              {r.status === "draft" && <button disabled={busy !== null} onClick={() => decide(r, "approve")} className="border border-sky-500/40 text-sky-300 px-2 py-0.5 rounded-sm text-[11px] hover:bg-sky-950/30">Approve</button>}
                              {r.status === "approved" && <button disabled={busy !== null} onClick={() => decide(r, "pay")} className="border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded-sm text-[11px] hover:bg-emerald-950/30">{busy === `pay-${r.id}` ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Pay"}</button>}
                              {(r.status === "draft" || r.status === "approved") && <button disabled={busy !== null} onClick={() => decide(r, "cancel")} className="text-slate hover:text-red-300" title="Cancel run"><Ban className="h-3.5 w-3.5" /></button>}
                            </div>
                          </td>
                        </tr>
                        {openRunId === r.id && (
                          <tr><td colSpan={9} className="bg-ink/30 px-4 py-3">
                            {!openRun ? <p className="text-xs text-slate flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Loading…</p> : (
                              <table className="w-full text-xs">
                                <thead><tr className="text-slate font-mono text-[10px] uppercase"><th className="p-1.5 text-left">Worker</th><th className="p-1.5 text-right">Hrs</th><th className="p-1.5 text-right">OT</th><th className="p-1.5 text-right">Rate</th><th className="p-1.5 text-right">Gross</th><th className="p-1.5 text-right">Deductions</th><th className="p-1.5 text-right">Net</th><th className="p-1.5 text-left">Paid via</th></tr></thead>
                                <tbody className="divide-y divide-ink-mid">
                                  {(openRun.lines || []).map((l: RecordData) => (
                                    <tr key={l.id}>
                                      <td className="p-1.5 text-paper">{l.full_name}<span className="text-slate"> {l.trade ? `· ${l.trade}` : ""}</span></td>
                                      <td className="p-1.5 text-right tabular-nums">{Number(l.regular_hours)}</td>
                                      <td className="p-1.5 text-right tabular-nums text-amber-300">{Number(l.overtime_hours) || "-"}</td>
                                      <td className="p-1.5 text-right tabular-nums">{money(l.hourly_rate)}</td>
                                      <td className="p-1.5 text-right tabular-nums">{money(l.gross_pay)}</td>
                                      <td className="p-1.5 text-right tabular-nums text-red-300">{Number(l.deductions) ? `${money(l.deductions)}${l.deduction_note ? ` (${l.deduction_note})` : ""}` : "-"}</td>
                                      <td className="p-1.5 text-right tabular-nums font-semibold text-paper">{money(l.net_pay)}</td>
                                      <td className="p-1.5 text-slate-light">{String(l.payment_method).replace("_", " ")} {l.payment_details || ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {r.status === "paid" && <p className="mt-2 text-[11px] text-emerald-300/80">Paid {r.paid_at ? new Date(r.paid_at).toLocaleString("en-GB") : ""} from {r.account_name || "cash account"}. Gross wages posted as labour cost on the project.</p>}
                          </td></tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
