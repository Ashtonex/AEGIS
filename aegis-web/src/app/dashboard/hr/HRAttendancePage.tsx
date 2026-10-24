"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, MessageSquareWarning } from "lucide-react";
import {
  decideWeeklyHours, getAbsenceReport, getAttendanceBoard, getWeeklyHours,
  type AbsenceRow, type BoardRow, type WeeksRow,
} from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { PersonCardModal } from "@/components/people/PersonCardModal";
import { formatDate, humanise, inputClass, secondaryButton } from "@/components/people/ui";

const harareToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare" }).format(new Date());
const shift = (iso: string, days: number) => new Date(new Date(`${iso}T12:00:00`).getTime() + days * 86400000).toISOString().slice(0, 10);
const lastFriday = (iso: string) => { const d = new Date(`${iso}T12:00:00`); return shift(iso, -((d.getDay() + 2) % 7)); };

const STATE: Record<string, { label: string; tone: string }> = {
  in: { label: "In", tone: "text-emerald-300" },
  late: { label: "Late", tone: "text-amber-300" },
  not_in: { label: "Not signed in", tone: "text-red-300" },
  leave: { label: "On leave", tone: "text-blue-300" },
  holiday: { label: "Public holiday", tone: "text-violet-300" },
  off: { label: "Off (weekend)", tone: "text-slate" },
  present: { label: "Present (manual)", tone: "text-emerald-300" },
  absent: { label: "Absent", tone: "text-red-300" },
  on_leave: { label: "On leave", tone: "text-blue-300" },
};

function TodayBoard({ onOpen }: { onOpen: (id: string) => void }) {
  const [day, setDay] = useState(harareToday());
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setRows(null);
    setError("");
    getAttendanceBoard(day)
      .then((r) => { if (active) setRows(r.data.people); })
      .catch((reason) => { if (active) { setRows([]); setError(`Attendance register could not be loaded. ${reason instanceof Error ? reason.message : ""}`.trim()); } });
    return () => { active = false; };
  }, [day]);
  const count = (s: string[]) => rows?.filter((r) => s.includes(r.state)).length ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className={secondaryButton} onClick={() => setDay(shift(day, -1))} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></button>
        <input type="date" className={`${inputClass} w-44`} value={day} max={harareToday()} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button className={secondaryButton} onClick={() => setDay(shift(day, 1))} disabled={day >= harareToday()} aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
        {error && <p role="alert" className="w-full rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</p>}
        <span className="text-sm text-slate-light">{count(["in", "late", "present"])} in · {count(["late"])} late · {count(["not_in", "absent"])} not in · {count(["leave", "on_leave"])} on leave</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-ink-mid bg-ink-light">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">
            <tr><th className="p-3">Employee</th><th className="p-3">Status</th><th className="p-3">In</th><th className="p-3">Out</th><th className="p-3 text-right">Hours</th><th className="p-3">Source</th></tr>
          </thead>
          <tbody className="divide-y divide-ink-mid">
            {rows === null ? <tr><td colSpan={6} className="p-4"><Loader2 className="h-5 w-5 animate-spin text-signal" /></td></tr> : rows.map((r) => (
              <tr key={r.employee_id} className="cursor-pointer hover:bg-ink-mid/20" onClick={() => onOpen(r.employee_id)}>
                <td className="p-3"><span className="text-paper">{r.employee_name}</span><span className="block text-xs text-slate">{r.position_name || "—"}</span></td>
                <td className={`p-3 ${STATE[r.state]?.tone ?? "text-slate-light"}`}>{STATE[r.state]?.label ?? humanise(r.state)}{r.leave_type ? ` (${r.leave_type})` : ""}</td>
                <td className="p-3 font-mono text-slate-light">{r.check_in ?? "—"}</td>
                <td className="p-3 font-mono text-slate-light">{r.check_out ? `${r.check_out}${r.auto_closed ? " auto" : ""}` : r.check_in ? "counting" : "—"}</td>
                <td className="p-3 text-right font-mono text-paper">{r.hours ? r.hours.toFixed(2) : "—"}</td>
                <td className="p-3 text-xs text-slate">{r.source === "aegis_login" ? "AEGIS sign-in" : r.source ? humanise(r.source) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate">Check-in is the first AEGIS sign-in of the day; the clock stops at 16:30. A Teams presence record and site clock-in hardware will be matched against this later.</p>
    </div>
  );
}

function WeeklyConfirmations({ onOpen }: { onOpen: (id: string) => void }) {
  const [weekEnd, setWeekEnd] = useState(lastFriday(harareToday()));
  const [data, setData] = useState<{ people: WeeksRow[]; totals: Record<string, number>; week_start: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setData(null);
    try { setData((await getWeeklyHours(weekEnd)).data); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not load."); }
  }, [weekEnd]);
  useEffect(() => { void load(); }, [load]);

  async function decide(row: WeeksRow, decision: "approved" | "queried") {
    if (!row.id) return;
    const note = decision === "queried" ? window.prompt(`What should ${row.employee_name} check?`) ?? "" : undefined;
    if (decision === "queried" && !note) return;
    setBusy(row.id); setMessage("");
    try { await decideWeeklyHours(row.id, decision, note); await load(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not save."); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className={secondaryButton} onClick={() => setWeekEnd(shift(weekEnd, -7))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm text-paper">Week {data ? formatDate(data.week_start) : "…"} – {formatDate(weekEnd)}</span>
        <button className={secondaryButton} onClick={() => setWeekEnd(shift(weekEnd, 7))} disabled={weekEnd >= lastFriday(harareToday())} aria-label="Next week"><ChevronRight className="h-4 w-4" /></button>
        {data && <span className="text-sm text-slate-light">{data.totals.submitted} waiting · {data.totals.approved} approved · {data.totals.queried} queried · {data.totals.missing} not submitted · {data.totals.with_corrections} with corrections</span>}
      </div>
      {message && <p className="text-sm text-red-300">{message}</p>}
      <div className="overflow-x-auto rounded-lg border border-ink-mid bg-ink-light">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">
            <tr><th className="p-3">Employee</th><th className="p-3 text-right">Recorded</th><th className="p-3 text-right">Confirmed</th><th className="p-3">Corrections</th><th className="p-3">Status</th><th className="p-3" /></tr>
          </thead>
          <tbody className="divide-y divide-ink-mid">
            {!data ? <tr><td colSpan={6} className="p-4"><Loader2 className="h-5 w-5 animate-spin text-signal" /></td></tr> : data.people.map((r) => (
              <Fragment key={r.employee_id}>
                <tr className="hover:bg-ink-mid/20">
                  <td className="p-3"><button className="text-left text-paper hover:text-signal" onClick={() => onOpen(r.employee_id)}>{r.employee_name}</button><span className="block text-xs text-slate">{r.position_name || "—"}</span></td>
                  <td className="p-3 text-right font-mono text-slate-light">{r.recorded_hours ?? "—"}</td>
                  <td className="p-3 text-right font-mono text-paper">{r.confirmed_hours ?? "—"}</td>
                  <td className="p-3">{r.corrections ? <button className="inline-flex items-center gap-1 text-amber-300 hover:underline" onClick={() => setExpanded(expanded === r.employee_id ? null : r.employee_id)}><MessageSquareWarning className="h-4 w-4" />{r.corrections} day(s)</button> : r.status ? <span className="text-slate">None</span> : "—"}</td>
                  <td className="p-3">{r.status ? <span className={r.status === "approved" ? "text-emerald-300" : r.status === "queried" ? "text-red-300" : "text-signal"}>{humanise(r.status)}{r.decided_by_name ? ` · ${r.decided_by_name}` : ""}</span> : <span className="text-slate">Not submitted</span>}</td>
                  <td className="p-3 text-right">
                    {r.id && r.status !== "approved" && (
                      <span className="inline-flex gap-2">
                        <button className={secondaryButton} disabled={busy === r.id} onClick={() => void decide(r, "approved")}><Check className="h-4 w-4" />Approve</button>
                        <button className={secondaryButton} disabled={busy === r.id} onClick={() => void decide(r, "queried")}>Query</button>
                      </span>
                    )}
                  </td>
                </tr>
                {expanded === r.employee_id && r.days && (
                  <tr><td colSpan={6} className="bg-ink px-6 py-3">
                    <ul className="space-y-1 text-sm">
                      {r.days.filter((d) => d.corrected).map((d) => (
                        <li key={d.date} className="text-slate-light"><span className="text-paper">{d.weekday} {formatDate(d.date)}</span>: recorded {d.recorded_hours}h, claimed <span className="text-signal">{d.confirmed_hours}h</span>, &ldquo;{d.note}&rdquo;</li>
                      ))}
                    </ul>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate">Staff confirm their Saturday–Friday hours from Friday. Their line manager or HR approves them here, and payroll uses approved weeks.</p>
    </div>
  );
}

export function AbsenceReport({ onOpen }: { onOpen: (id: string) => void }) {
  const today = harareToday();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<AbsenceRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setRows(null);
    getAbsenceReport(from, to).then((r) => { if (active) { setRows(r.data.people); setError(""); } })
      .catch((reason) => { if (active) { setRows([]); setError(reason instanceof Error ? reason.message : "Could not load."); } });
    return () => { active = false; };
  }, [from, to]);
  const sorted = [...(rows ?? [])].sort((a, b) => b.absent - a.absent || b.leave - a.leave);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm text-slate-light">From<input type="date" className={`${inputClass} w-44`} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="grid gap-1 text-sm text-slate-light">To<input type="date" className={`${inputClass} w-44`} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-ink-mid bg-ink-light">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">
            <tr><th className="p-3">Employee</th><th className="p-3 text-right">Working days</th><th className="p-3 text-right">Present</th><th className="p-3 text-right">On leave</th><th className="p-3 text-right">Absent</th><th className="p-3 text-right">Late</th><th className="p-3 text-right">Hours</th><th className="p-3 text-right">Attendance</th></tr>
          </thead>
          <tbody className="divide-y divide-ink-mid">
            {rows === null ? <tr><td colSpan={8} className="p-4"><Loader2 className="h-5 w-5 animate-spin text-signal" /></td></tr> : sorted.map((r) => (
              <tr key={r.employee_id} className="cursor-pointer hover:bg-ink-mid/20" onClick={() => onOpen(r.employee_id)} title={r.absent_dates.length ? `Absent: ${r.absent_dates.join(", ")}` : undefined}>
                <td className="p-3"><span className="text-paper">{r.employee_name}</span><span className="block text-xs text-slate">{r.position_name || "—"}</span></td>
                <td className="p-3 text-right font-mono text-slate-light">{r.workdays}</td>
                <td className="p-3 text-right font-mono text-paper">{r.present}</td>
                <td className="p-3 text-right font-mono text-blue-300">{r.leave}{Object.keys(r.leave_by_type).length ? <span className="block text-[10px] text-slate">{Object.entries(r.leave_by_type).map(([k, v]) => `${v} ${k}`).join(", ")}</span> : null}</td>
                <td className={`p-3 text-right font-mono ${r.absent ? "text-red-300" : "text-slate"}`}>{r.absent}</td>
                <td className={`p-3 text-right font-mono ${r.late ? "text-amber-300" : "text-slate"}`}>{r.late}</td>
                <td className="p-3 text-right font-mono text-slate-light">{r.hours}</td>
                <td className="p-3 text-right font-mono">{r.attendance_rate == null ? "—" : `${r.attendance_rate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate">Absent means a working day (Mon–Fri, not a public holiday) with no sign-in, no attendance record and no approved leave. Hover a row to see the dates.</p>
    </div>
  );
}

export function HRAttendancePage() {
  const [tab, setTab] = useState<"today" | "weeks" | "absence">("today");
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-5 p-6">
      <DashboardPageHeader title="Attendance" subtitle="Automatic check-in from AEGIS sign-ins, the 16:30 cut-off, weekly hour confirmations and absence." />
      <nav className="flex gap-1 border-b border-ink-mid" aria-label="Attendance views">
        {([["today", "Daily board"], ["weeks", "Weekly hours"], ["absence", "Absence"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`border-b-2 px-4 py-2 text-sm ${tab === id ? "border-signal text-paper" : "border-transparent text-slate-light hover:text-paper"}`}>{label}</button>
        ))}
      </nav>
      {tab === "today" && <TodayBoard onOpen={setOpenId} />}
      {tab === "weeks" && <WeeklyConfirmations onOpen={setOpenId} />}
      {tab === "absence" && <AbsenceReport onOpen={setOpenId} />}
      {openId && <PersonCardModal employeeId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** Absence summary for the Leave page: how many days each person was away, and why. */
export function AbsencePanel() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <section className="space-y-3 rounded-lg border border-ink-mid bg-ink-light p-4">
      <h2 className="font-mono text-xs uppercase tracking-wider text-slate">Days absent per employee</h2>
      <AbsenceReport onOpen={setOpenId} />
      {openId && <PersonCardModal employeeId={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}
