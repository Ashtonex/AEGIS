"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createWorkforceTimesheet, getHRAttendance, getMyPermissions,
  getWorkforceAllocations, getWorkforceTimesheets, recordHRAttendance,
  transitionWorkforceTimesheet, type WorkforceTimeRecord,
} from "@/lib/api";

type Worker = { id: string; employee_name?: string; [key: string]: unknown };
type Allocation = { id: string; employee_id: string; employee_name?: string; project_id: string; project_name?: string; starts_on: string; ends_on: string; status: string; role_on_project?: string; allocation_percent: string | number };
type Attendance = { id: string; employee_id: string; employee_name?: string; project_id?: string; status: string; check_in?: string; check_out?: string; regular_hours: string | number; overtime_hours: string | number };
const inputClass = "h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper";
const buttonClass = "border border-ink-mid px-3 py-2 text-xs text-signal hover:border-signal disabled:opacity-40";
const cellClass = "px-4 py-3 text-sm";
const text = (value: unknown) => typeof value === "string" && value ? value : "Not recorded";
const hours = (row: { regular_hours: string | number; overtime_hours: string | number }) => Number(row.regular_hours) + Number(row.overtime_hours);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function WorkforceOperations({ employees }: { employees: Worker[] }) {
  const [date, setDate] = useState(today);
  const [tab, setTab] = useState("Daily board");
  const [project, setProject] = useState("");
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [timesheets, setTimesheets] = useState<WorkforceTimeRecord[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [capture, setCapture] = useState<"attendance" | "timesheet" | null>(null);
  const [attendanceStatus, setAttendanceStatus] = useState("present");
  const mutationLock = useRef(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void Promise.allSettled([getWorkforceAllocations(), getHRAttendance({ date }), getWorkforceTimesheets(date), getMyPermissions()]).then(([a, b, c, d]) => {
      if (!current) return;
      setAllocations(a.status === "fulfilled" && Array.isArray(a.value.data) ? a.value.data : []);
      setAttendance(b.status === "fulfilled" && Array.isArray(b.value.data) ? b.value.data : []);
      setTimesheets(c.status === "fulfilled" && Array.isArray(c.value.data) ? c.value.data : []);
      setPermissions(d.status === "fulfilled" && Array.isArray(d.value.data) ? d.value.data : []);
      setWarnings([(a.status === "rejected" || !Array.isArray(a.value.data)) ? "Deployments unavailable" : "", (b.status === "rejected" || !Array.isArray(b.value.data)) ? "Attendance unavailable" : "", (c.status === "rejected" || !Array.isArray(c.value.data)) ? "Timesheets unavailable" : "", (d.status === "rejected" || !Array.isArray(d.value.data)) ? "Permissions unavailable; capture and review disabled" : ""].filter(Boolean));
      setLoading(false);
    });
    return () => { current = false; };
  }, [date, revision]);

  const can = (action: string) => permissions.includes(`workforce.${action}`) || permissions.includes("*");
  const projects = useMemo(() => Array.from(new Map(allocations.map(a => [a.project_id, a.project_name || a.project_id])).entries()), [allocations]);
  const active = allocations.filter(a => a.status === "active" && a.starts_on <= date && a.ends_on >= date && (!project || a.project_id === project));
  const daily = attendance.filter(a => !project || a.project_id === project);
  const sheets = timesheets.filter(a => !project || a.project_id === project);
  const expected = new Set(active.map(a => a.employee_id));
  const present = new Set(daily.filter(a => ["present", "late", "half_day"].includes(a.status)).map(a => a.employee_id));
  const missing = Array.from(expected).filter(id => !daily.some(a => a.employee_id === id));
  const workerName = (id: string) => employees.find(e => e.id === id)?.employee_name || id;
  const projectName = (id?: string) => projects.find(([key]) => key === id)?.[1] || id || "No project";
  const exceptions = [
    ...missing.map(id => ({ id: `missing-${id}`, worker: workerName(id), reason: "Active deployment has no attendance record", tone: "text-amber-300" })),
    ...daily.filter(a => !active.some(d => d.employee_id === a.employee_id && d.project_id === a.project_id) && present.has(a.employee_id)).map(a => ({ id: `deployment-${a.id}`, worker: a.employee_name || workerName(a.employee_id), reason: "Presence recorded without an active project deployment", tone: "text-red-300" })),
    ...daily.filter(a => a.check_in && !a.check_out).map(a => ({ id: `exit-${a.id}`, worker: a.employee_name || workerName(a.employee_id), reason: "Clock-in has no clock-out", tone: "text-amber-300" })),
    ...daily.filter(a => Number(a.overtime_hours) > 0).map(a => ({ id: `ot-${a.id}`, worker: a.employee_name || workerName(a.employee_id), reason: "Overtime recorded; separate authorisation must be checked", tone: "text-amber-300" })),
    ...employees.filter(e => typeof e.end_date === "string" && e.end_date < date && present.has(e.id)).map(e => ({ id: `contract-${e.id}`, worker: workerName(e.id), reason: "Attendance after recorded contract expiry", tone: "text-red-300" })),
  ];

  async function mutate(action: () => Promise<unknown>, success: string) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true); setMessage("");
    try { await action(); setMessage(success); setCapture(null); setRevision(v => v + 1); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The record could not be saved. Please retry."); }
    finally { mutationLock.current = false; setBusy(false); }
  }

  return <section className="mb-6 border border-ink-mid bg-ink">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-mid p-4">
      <div><h2 className="font-display text-xl">Site workforce control</h2><p className="mt-1 text-xs text-slate-light">Deployment authority, recorded presence and use of time. Dates use Harare time.</p></div>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Work date" type="date" required value={date} disabled={busy} onChange={e => { if (e.target.value) { setDate(e.target.value); setCapture(null); } }} className={inputClass} />
        <select aria-label="Project filter" value={project} disabled={busy} onChange={e => setProject(e.target.value)} className={inputClass}><option value="">All projects</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <button disabled={loading || busy} className={buttonClass} onClick={() => setRevision(v => v + 1)}>Refresh operations</button>
      </div>
    </header>
    <nav aria-label="Workforce operations" className="flex flex-wrap gap-1 border-b border-ink-mid p-2">{["Daily board", "Deployments", "Timesheets", "Exceptions"].map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)} className={`px-4 py-3 text-sm ${tab === name ? "bg-signal text-ink" : "text-slate-light hover:text-paper"}`}>{name}</button>)}</nav>
    {warnings.length > 0 && <p role="alert" className="p-4 text-sm text-amber-300">{warnings.join(". ")}. Totals and exceptions may be incomplete.</p>}
    {message && <p role="status" className="border-b border-ink-mid p-4 text-sm">{message}</p>}
    {loading ? <p role="status" className="p-8 text-sm text-slate-light">Loading operational records…</p> : <>
      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">{[["Expected workers", expected.size], ["Recorded present", present.size], ["Attendance not captured", missing.length], ["Recorded hours", daily.reduce((sum, a) => sum + hours(a), 0).toFixed(1)]].map(([label, value]) => <div key={label} className="border border-ink-mid bg-ink-light p-3"><p className="text-xs text-slate-light">{label}</p><p className="mt-2 font-mono text-2xl">{warnings.length ? "—" : value}</p></div>)}</div>
      <p className="px-4 pb-4 text-xs text-slate-light">Presence is recorded evidence, not supervisor verification. Operational timesheet approval does not authorise payroll or overtime. Deployment list is limited to the latest 500 records.</p>
      {can("create") && <div className="flex gap-2 px-4 pb-4"><button className={buttonClass} disabled={busy} onClick={() => { setCapture("attendance"); setAttendanceStatus("present"); }}>Record attendance</button><button className={buttonClass} disabled={busy} onClick={() => setCapture("timesheet")}>Add timesheet</button></div>}
      {capture && <form key={capture} className="m-4 grid gap-3 border border-ink-mid bg-ink-light p-4 md:grid-cols-2" onSubmit={e => {
        e.preventDefault(); const data = new FormData(e.currentTarget);
        const absent = capture === "attendance" && ["absent", "on_leave"].includes(attendanceStatus);
        const payload = { employee_id: String(data.get("employee_id")), project_id: String(data.get("project_id")), regular_hours: absent ? 0 : Number(data.get("regular_hours")), overtime_hours: absent ? 0 : Number(data.get("overtime_hours")) };
        if (payload.regular_hours + payload.overtime_hours > 24) { setMessage("Total hours cannot exceed 24."); return; }
        void mutate(() => capture === "attendance" ? recordHRAttendance({ ...payload, attendance_date: date, status: attendanceStatus, notes: String(data.get("description")) }) : createWorkforceTimesheet({ ...payload, work_date: date, description: String(data.get("description")) }), capture === "attendance" ? "Attendance recorded. Existing clock evidence is preserved." : "Draft timesheet saved. Submit it for independent review.");
      }}>
        <h3 className="md:col-span-2">{capture === "attendance" ? "Manual attendance register" : "Draft timesheet"} · {date}</h3>
        <label className="grid gap-1 text-xs">Worker<select required name="employee_id" className={inputClass}><option value="">Select worker</option>{employees.map(e => <option key={e.id} value={e.id}>{e.employee_name || e.id}</option>)}</select></label>
        <label className="grid gap-1 text-xs">Project<select required name="project_id" defaultValue={project} className={inputClass}><option value="">Select allocated project</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        {capture === "attendance" && <label className="grid gap-1 text-xs">Attendance status<select value={attendanceStatus} onChange={e => setAttendanceStatus(e.target.value)} className={inputClass}>{["present", "absent", "late", "half_day", "on_leave", "public_holiday"].map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label>}
        {!(capture === "attendance" && ["absent", "on_leave"].includes(attendanceStatus)) && <><label className="grid gap-1 text-xs">Ordinary hours<input required name="regular_hours" type="number" min="0" max="24" step="0.25" defaultValue="8" className={inputClass} /></label><label className="grid gap-1 text-xs">Overtime worked (authorisation checked separately)<input required name="overtime_hours" type="number" min="0" max="24" step="0.25" defaultValue="0" className={inputClass} /></label></>}
        <label className="grid gap-1 text-xs md:col-span-2">{capture === "timesheet" ? "Activity, work package and evidence" : "Notes / absence reason"}<textarea required={capture === "timesheet" || ["absent", "on_leave"].includes(attendanceStatus)} name="description" maxLength={2000} className="min-h-20 border border-ink-mid bg-ink p-3 text-sm" /></label>
        <div className="flex gap-2 md:col-span-2"><button disabled={busy} className={buttonClass}>{busy ? "Saving…" : "Save record"}</button><button type="button" disabled={busy} onClick={() => setCapture(null)} className={buttonClass}>Cancel</button></div>
      </form>}
      <div className="overflow-x-auto">
        {tab === "Daily board" && <table className="w-full min-w-[750px] text-left"><thead><tr>{["Worker", "Project", "Status", "Clock evidence", "Hours", "Overtime"].map(h => <th key={h} className={cellClass}>{h}</th>)}</tr></thead><tbody>{daily.map(a => <tr key={a.id} className="border-t border-ink-mid"><td className={cellClass}>{a.employee_name || workerName(a.employee_id)}</td><td className={cellClass}>{projectName(a.project_id)}</td><td className={cellClass}>{a.status.replaceAll("_", " ")}</td><td className={cellClass}>{a.check_in ? `${new Date(a.check_in).toLocaleTimeString("en-GB", { timeZone: "Africa/Harare" })} → ${a.check_out ? new Date(a.check_out).toLocaleTimeString("en-GB", { timeZone: "Africa/Harare" }) : "Missing exit"}` : "No clock timestamps"}</td><td className={cellClass}>{hours(a).toFixed(1)}</td><td className={cellClass}>{Number(a.overtime_hours).toFixed(1)}</td></tr>)}</tbody></table>}
        {tab === "Deployments" && <table className="w-full min-w-[750px] text-left"><thead><tr>{["Worker", "Project", "Role", "Period", "Capacity", "Status"].map(h => <th key={h} className={cellClass}>{h}</th>)}</tr></thead><tbody>{allocations.filter(a => !project || a.project_id === project).map(a => <tr key={a.id} className="border-t border-ink-mid"><td className={cellClass}>{a.employee_name || workerName(a.employee_id)}</td><td className={cellClass}>{projectName(a.project_id)}</td><td className={cellClass}>{text(a.role_on_project)}</td><td className={cellClass}>{a.starts_on} → {a.ends_on}</td><td className={cellClass}>{a.allocation_percent}%</td><td className={cellClass}>{a.status}</td></tr>)}</tbody></table>}
        {tab === "Timesheets" && <table className="w-full min-w-[850px] text-left"><thead><tr>{["Worker / project", "Activity evidence", "Hours / OT", "Status", "Review"].map(h => <th key={h} className={cellClass}>{h}</th>)}</tr></thead><tbody>{sheets.map(s => <tr key={s.id} className="border-t border-ink-mid"><td className={cellClass}>{s.employee_name || workerName(s.employee_id)}<p className="text-xs text-slate-light">{s.project_name || projectName(s.project_id)}</p></td><td className={`${cellClass} max-w-sm whitespace-pre-wrap`}>{text(s.description)}</td><td className={cellClass}>{hours(s).toFixed(1)} / {Number(s.overtime_hours).toFixed(1)}</td><td className={cellClass}>{s.status}</td><td className={cellClass}>{can("update") && s.status === "draft" && <button disabled={busy} className={buttonClass} onClick={() => void mutate(() => transitionWorkforceTimesheet(s.id, "submit"), "Timesheet submitted for review.")}>Submit</button>}{can("update") && s.status === "submitted" && <div className="flex gap-2"><button disabled={busy} className={buttonClass} onClick={() => void mutate(() => transitionWorkforceTimesheet(s.id, "approved"), "Operational time approved; payroll verification remains separate.")}>Approve time</button><button disabled={busy} className={buttonClass} onClick={() => void mutate(() => transitionWorkforceTimesheet(s.id, "rejected"), "Timesheet rejected; original evidence retained.")}>Reject</button></div>}{["approved", "rejected"].includes(s.status) && <span className="text-xs text-slate-light">Decision recorded · {s.approved_at ? new Date(s.approved_at).toLocaleDateString("en-GB") : "Date unavailable"}</span>}</td></tr>)}</tbody></table>}
        {tab === "Exceptions" && (warnings.length ? <p className="p-6 text-amber-300">Restore all operational sources before assessing exceptions.</p> : <ul className="divide-y divide-ink-mid">{exceptions.map(e => <li key={e.id} className="p-4"><p className="text-sm">{e.worker}</p><p className={`mt-1 text-xs ${e.tone}`}>{e.reason}</p></li>)}</ul>)}
      </div>
      {((tab === "Daily board" && daily.length === 0) || (tab === "Timesheets" && sheets.length === 0) || (tab === "Deployments" && !allocations.some(a => !project || a.project_id === project)) || (tab === "Exceptions" && !warnings.length && !exceptions.length)) && <p className="p-8 text-center text-sm text-slate-light">{tab === "Exceptions" ? "No exceptions detected in the loaded records." : "No records for this view."}</p>}
    </>}
  </section>;
}
