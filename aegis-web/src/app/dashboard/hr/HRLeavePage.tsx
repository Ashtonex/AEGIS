"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, FileDown, Inbox, Loader2, Plane, Plus, Search, Users, X,
} from "lucide-react";
import {
  approveHRLeaveRequest, createHRLeaveRequest, downloadEmployeeLeaveRecordPdf, getHRLeaveRequests, getLeaveBalances,
  type LeaveBalance,
} from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { Field, formatDate, inputClass, primaryButton, secondaryButton } from "@/components/people/ui";
import { AbsencePanel } from "./HRAttendancePage";

type LeaveRequest = {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days_requested: number | string;
  reason: string | null;
  status: string;
  rejection_reason: string | null;
  created_at: string;
};

type View = "requests" | "people" | "calendar" | "absence";

const LEAVE_TYPES: [string, string][] = [
  ["annual", "Annual"], ["sick", "Sick"], ["maternity", "Maternity"], ["paternity", "Paternity"],
  ["compassionate", "Compassionate"], ["study", "Study"], ["unpaid", "Unpaid"], ["other", "Other"],
];
const typeLabel = (value: string) => LEAVE_TYPES.find(([k]) => k === value)?.[1] ?? value;

const STATUS_TONE: Record<string, string> = {
  pending: "border-blue-500/30 bg-blue-950/30 text-blue-300",
  approved: "border-emerald-500/30 bg-emerald-950/30 text-emerald-300",
  rejected: "border-red-500/30 bg-red-950/30 text-red-300",
  cancelled: "border-slate-500/30 bg-slate-900/40 text-slate-300",
};
const TYPE_DOT: Record<string, string> = {
  annual: "bg-emerald-400", sick: "bg-amber-400", maternity: "bg-pink-400", paternity: "bg-sky-400",
  compassionate: "bg-violet-400", study: "bg-cyan-400", unpaid: "bg-slate-400", other: "bg-slate-400",
};

const harareToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare" }).format(new Date());
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const calendarDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
const days = (value: number | string) => {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};
const dateRange = (from: string, to: string) => (from.slice(0, 10) === to.slice(0, 10) ? formatDate(from.slice(0, 10)) : `${formatDate(from.slice(0, 10))} – ${formatDate(to.slice(0, 10))}`);

function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_TONE[status] ?? STATUS_TONE.cancelled}`}>{status}</span>;
}

function TypeTag({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-paper">
      <span className={`h-2 w-2 rounded-full ${TYPE_DOT[type] ?? TYPE_DOT.other}`} />
      {typeLabel(type)}
    </span>
  );
}

function useLeaveRecordDownload(onError: (message: string) => void) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const download = useCallback(async (employeeId: string, name: string, year?: number) => {
    setBusyId(employeeId);
    try {
      const blob = await downloadEmployeeLeaveRecordPdf(employeeId, year);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `SNC_Leave_Record_${name.replace(/[^A-Za-z0-9]+/g, "_")}${year ? `_${year}` : ""}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not generate the leave record PDF.");
    } finally {
      setBusyId(null);
    }
  }, [onError]);
  return { busyId, download };
}

export function HRLeavePage() {
  const thisYear = new Date().getFullYear();
  const [view, setView] = useState<View>("requests");
  const [requests, setRequests] = useState<LeaveRequest[] | null>(null);
  const [people, setPeople] = useState<LeaveBalance[] | null>(null);
  const [balanceYear, setBalanceYear] = useState(thisYear);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [applyFor, setApplyFor] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const showError = useCallback((text: string) => setNotice({ tone: "error", text }), []);
  const { busyId, download } = useLeaveRecordDownload(showError);

  const loadRequests = useCallback(async () => {
    try {
      const res = await getHRLeaveRequests();
      setRequests(res.data || []);
    } catch (reason) {
      setRequests([]);
      showError(reason instanceof Error ? reason.message : "Leave requests could not be loaded.");
    }
  }, [showError]);

  const loadBalances = useCallback(async (year: number) => {
    try {
      const res = await getLeaveBalances(year);
      setPeople(res.data?.people || []);
    } catch (reason) {
      setPeople([]);
      showError(reason instanceof Error ? reason.message : "Leave balances could not be loaded.");
    }
  }, [showError]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);
  useEffect(() => { void loadBalances(balanceYear); }, [loadBalances, balanceYear]);

  const refresh = useCallback(async () => {
    await Promise.all([loadRequests(), loadBalances(balanceYear)]);
  }, [loadRequests, loadBalances, balanceYear]);

  const decide = useCallback(async (id: string, decision: "approved" | "rejected", reason?: string) => {
    try {
      await approveHRLeaveRequest(id, decision, reason || (decision === "approved" ? "Approved from Leave Management." : undefined));
      setNotice({ tone: "ok", text: `Leave request ${decision}.` });
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Could not record the decision.");
    }
  }, [refresh, showError]);

  const today = harareToday();
  const stats = useMemo(() => {
    const list = requests ?? [];
    const soon = addDays(today, 14);
    return {
      pending: list.filter((r) => r.status === "pending").length,
      onLeave: list.filter((r) => r.status === "approved" && r.start_date.slice(0, 10) <= today && r.end_date.slice(0, 10) >= today),
      upcoming: list.filter((r) => r.status === "approved" && r.start_date.slice(0, 10) > today && r.start_date.slice(0, 10) <= soon),
      takenThisYear: (people ?? []).reduce((sum, p) => sum + p.days_taken, 0),
    };
  }, [requests, people, today]);

  const loading = requests === null || people === null;

  return (
    <div className="space-y-5 p-6">
      <DashboardPageHeader
        title="Leave Management"
        subtitle="Requests to decide, who is away, everyone's balance and a printable leave record per person."
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setExportOpen(true)} className={secondaryButton}>
              <FileDown className="h-4 w-4" /> Leave record PDF
            </button>
            <button type="button" onClick={() => setApplyFor("")} className={primaryButton}>
              <Plus className="h-4 w-4" /> Apply leave
            </button>
          </div>
        }
      />

      {notice && (
        <div className={`flex items-start justify-between gap-3 rounded border px-4 py-3 text-sm ${notice.tone === "ok" ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-100" : "border-red-500/40 bg-red-950/20 text-red-100"}`}>
          <span className="flex items-start gap-2">
            {notice.tone === "ok" ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            {notice.text}
          </span>
          <button type="button" onClick={() => setNotice(null)} className="text-slate hover:text-paper" aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={Inbox} label="Awaiting your decision" value={loading ? "…" : String(stats.pending)} tone={stats.pending ? "text-blue-300" : "text-paper"}
          onClick={() => { setView("requests"); setStatusFilter("pending"); }} />
        <StatTile icon={Plane} label="On leave today" value={loading ? "…" : String(stats.onLeave.length)}
          hint={stats.onLeave.slice(0, 3).map((r) => r.employee_name).join(", ")} onClick={() => setView("calendar")} />
        <StatTile icon={Clock} label="Starting in the next 14 days" value={loading ? "…" : String(stats.upcoming.length)}
          hint={stats.upcoming.slice(0, 3).map((r) => r.employee_name).join(", ")} onClick={() => setView("calendar")} />
        <StatTile icon={CalendarDays} label={`Approved leave days in ${balanceYear}`} value={loading ? "…" : days(stats.takenThisYear)} onClick={() => setView("people")} />
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-ink-mid" aria-label="Leave views">
        {([
          ["requests", "Requests", stats.pending || null],
          ["people", "People & balances", null],
          ["calendar", "Calendar", null],
          ["absence", "Absence report", null],
        ] as const).map(([id, label, count]) => (
          <button key={id} type="button" onClick={() => setView(id)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2 text-sm ${view === id ? "border-signal text-paper" : "border-transparent text-slate-light hover:text-paper"}`}>
            {label}
            {count ? <span className="rounded-full bg-blue-500/20 px-1.5 font-mono text-[10px] text-blue-200">{count}</span> : null}
          </button>
        ))}
      </nav>

      {loading && view !== "absence" ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-signal" /></div>
      ) : view === "requests" ? (
        <RequestsView requests={requests ?? []} people={people ?? []} statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          onDecide={decide} onDownload={download} busyId={busyId} />
      ) : view === "people" ? (
        <PeopleView people={people ?? []} year={balanceYear} setYear={setBalanceYear} onDownload={download} busyId={busyId} onApply={setApplyFor} />
      ) : view === "calendar" ? (
        <CalendarView requests={requests ?? []} today={today} />
      ) : (
        <AbsencePanel />
      )}

      {applyFor !== null && (
        <ApplyLeaveModal people={people ?? []} initialEmployeeId={applyFor} onClose={() => setApplyFor(null)}
          onSaved={async () => { setApplyFor(null); setNotice({ tone: "ok", text: "Leave request submitted." }); await refresh(); }} />
      )}
      {exportOpen && (
        <ExportModal people={people ?? []} busyId={busyId} onClose={() => setExportOpen(false)}
          onDownload={async (id, name, year) => { await download(id, name, year); }} />
      )}
    </div>
  );
}

function StatTile({ icon: Icon, label, value, hint, tone = "text-paper", onClick }: {
  icon: typeof Inbox; label: string; value: string; hint?: string; tone?: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="group rounded-lg border border-ink-mid bg-ink-light p-4 text-left transition-colors hover:border-signal/40">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-light">{label}</span>
        <Icon className="h-4 w-4 text-slate group-hover:text-signal" />
      </div>
      <p className={`mt-2 font-mono text-2xl ${tone}`}>{value}</p>
      <p className="mt-1 h-4 truncate text-xs text-slate">{hint || " "}</p>
    </button>
  );
}

function DownloadButton({ busy, onClick, label = "PDF" }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} title="Download this person's leave record"
      className="inline-flex items-center gap-1.5 rounded-sm border border-ink-mid px-2.5 py-1 text-xs text-slate-light hover:border-signal/50 hover:text-paper disabled:opacity-50">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} {label}
    </button>
  );
}

function PendingCard({ request, balance, onDecide }: {
  request: LeaveRequest; balance?: LeaveBalance; onDecide: (id: string, decision: "approved" | "rejected", reason?: string) => Promise<void>;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (decision: "approved" | "rejected") => {
    setBusy(true);
    await onDecide(request.id, decision, decision === "rejected" ? reason.trim() : undefined);
    setBusy(false);
  };
  const exceeds = request.leave_type === "annual" && balance && Number(request.days_requested) > balance.annual_remaining;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-blue-500/25 bg-ink-light p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-paper">{request.employee_name}</p>
          <p className="mt-0.5 text-xs text-slate-light">{dateRange(request.start_date, request.end_date)}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg text-paper">{days(request.days_requested)}<span className="ml-1 text-xs text-slate">days</span></p>
          <TypeTag type={request.leave_type} />
        </div>
      </div>
      <p className="text-sm text-slate-light">{request.reason?.trim() || <span className="italic text-slate">No reason given</span>}</p>
      {balance && request.leave_type === "annual" && (
        <p className={`text-xs ${exceeds ? "text-amber-300" : "text-slate"}`}>
          {exceeds && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
          {days(balance.annual_remaining)} of {balance.annual_leave_days} annual days left this year
        </p>
      )}
      {declining ? (
        <div className="space-y-2">
          <input autoFocus className={inputClass} placeholder="Reason for declining (sent to the employee)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeclining(false)} className="px-3 py-1.5 text-xs text-slate-light hover:text-paper">Back</button>
            <button type="button" disabled={busy} onClick={() => run("rejected")} className="rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/40 disabled:opacity-50">Decline request</button>
          </div>
        </div>
      ) : (
        <div className="mt-auto flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setDeclining(true)} className="rounded-sm border border-ink-mid px-3 py-1.5 text-xs text-slate-light hover:border-red-500/40 hover:text-red-200 disabled:opacity-50">Decline</button>
          <button type="button" disabled={busy} onClick={() => run("approved")} className="inline-flex items-center gap-1.5 rounded-sm bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
          </button>
        </div>
      )}
    </div>
  );
}

function RequestsView({ requests, people, statusFilter, setStatusFilter, onDecide, onDownload, busyId }: {
  requests: LeaveRequest[]; people: LeaveBalance[]; statusFilter: string; setStatusFilter: (s: string) => void;
  onDecide: (id: string, decision: "approved" | "rejected", reason?: string) => Promise<void>;
  onDownload: (id: string, name: string) => void; busyId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const balances = useMemo(() => new Map(people.map((p) => [p.employee_id, p])), [people]);
  const pending = requests.filter((r) => r.status === "pending").sort((a, b) => a.start_date.localeCompare(b.start_date));
  const counts = requests.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const filtered = requests
    .filter((r) => statusFilter === "all" || r.status === statusFilter)
    .filter((r) => type === "all" || r.leave_type === type)
    .filter((r) => !query.trim() || `${r.employee_name} ${r.reason ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));

  return (
    <div className="space-y-6">
      {pending.length > 0 && statusFilter !== "approved" && statusFilter !== "rejected" && (
        <section className="space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-wider text-slate">Needs a decision · {pending.length}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pending.map((r) => <PendingCard key={r.id} request={r} balance={balances.get(r.employee_id)} onDecide={onDecide} />)}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
            <input className={`${inputClass} pl-9`} placeholder="Search name or reason" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "pending", "approved", "rejected"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs capitalize ${statusFilter === s ? "border-signal/60 bg-signal/10 text-paper" : "border-ink-mid text-slate-light hover:text-paper"}`}>
                {s} <span className="font-mono text-slate">{s === "all" ? requests.length : counts[s] || 0}</span>
              </button>
            ))}
          </div>
          <select className={`${inputClass} w-auto`} value={type} onChange={(e) => setType(e.target.value)} aria-label="Leave type">
            <option value="all">All leave types</option>
            {LEAVE_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>

        <div className="overflow-x-auto rounded-lg border border-ink-mid bg-ink-light">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">
              <tr><th className="p-3">Employee</th><th className="p-3">Type</th><th className="p-3">Dates</th><th className="p-3 text-right">Days</th><th className="p-3">Reason</th><th className="p-3">Status</th><th className="p-3 text-right">Record</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-light">{requests.length ? "No requests match these filters." : "No leave requests have been logged yet."}</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} className="cursor-pointer align-top hover:bg-ink-mid/20" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                  <td className="p-3 font-medium text-paper">{r.employee_name}</td>
                  <td className="p-3"><TypeTag type={r.leave_type} /></td>
                  <td className="whitespace-nowrap p-3 text-slate-light">{dateRange(r.start_date, r.end_date)}</td>
                  <td className="p-3 text-right font-mono text-paper">{days(r.days_requested)}</td>
                  <td className="max-w-xs p-3 text-slate-light">
                    <p className={openId === r.id ? "whitespace-pre-wrap" : "line-clamp-1"}>{r.reason?.trim() || <span className="italic text-slate">No reason given</span>}</p>
                    {openId === r.id && r.rejection_reason && <p className="mt-1 text-xs text-red-300">Declined: {r.rejection_reason}</p>}
                    {openId === r.id && <p className="mt-1 text-xs text-slate">Logged {formatDate(r.created_at)}</p>}
                  </td>
                  <td className="p-3"><StatusBadge status={r.status} /></td>
                  <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <DownloadButton busy={busyId === r.employee_id} onClick={() => onDownload(r.employee_id, r.employee_name)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate">Click a row to read the full reason. The PDF covers every leave request for that person.</p>
      </section>
    </div>
  );
}

function PeopleView({ people, year, setYear, onDownload, busyId, onApply }: {
  people: LeaveBalance[]; year: number; setYear: (y: number) => void;
  onDownload: (id: string, name: string, year?: number) => void; busyId: string | null; onApply: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"year" | "all">("all");
  const thisYear = new Date().getFullYear();
  const shown = people.filter((p) => !query.trim() || `${p.employee_name} ${p.employee_number ?? ""} ${p.job_title ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
          <input className={`${inputClass} pl-9`} placeholder="Search people" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <label className="grid gap-1 text-xs text-slate-light">Balance year
          <select className={`${inputClass} w-28`} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 5 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-light">PDF covers
          <select className={`${inputClass} w-40`} value={scope} onChange={(e) => setScope(e.target.value as "year" | "all")}>
            <option value="all">Full history</option>
            <option value="year">{year} only</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto rounded-lg border border-ink-mid bg-ink-light">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">
            <tr><th className="p-3">Employee</th><th className="p-3 w-64">Annual leave {year}</th><th className="p-3 text-right">All leave taken</th><th className="p-3 text-right">Pending</th><th className="p-3">Last leave</th><th className="p-3 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-ink-mid">
            {shown.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-light">No one matches that search.</td></tr>
            ) : shown.map((p) => {
              const used = p.annual_leave_days ? Math.min(100, (p.annual_taken / p.annual_leave_days) * 100) : 0;
              return (
                <tr key={p.employee_id} className="hover:bg-ink-mid/10">
                  <td className="p-3">
                    <span className="flex items-center gap-2 text-paper">{p.employee_name}
                      {p.on_leave_today && <span className="rounded-sm border border-blue-500/30 bg-blue-950/30 px-1.5 font-mono text-[10px] uppercase text-blue-300">On leave</span>}
                    </span>
                    <span className="block text-xs text-slate">{[p.employee_number, p.job_title].filter(Boolean).join(" · ") || "—"}</span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-slate-light">{days(p.annual_taken)} of {p.annual_leave_days} used</span>
                      <span className={`font-mono ${p.annual_remaining < 0 ? "text-red-300" : p.annual_remaining <= 3 ? "text-amber-300" : "text-emerald-300"}`}>{days(p.annual_remaining)} left</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-mid">
                      <div className={`h-full rounded-full ${used >= 100 ? "bg-red-400" : used >= 85 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${used}%` }} />
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono text-slate-light">{days(p.days_taken)}</td>
                  <td className={`p-3 text-right font-mono ${p.pending_count ? "text-blue-300" : "text-slate"}`}>{p.pending_count}</td>
                  <td className="p-3 text-slate-light">{p.last_leave_end ? formatDate(p.last_leave_end) : <span className="text-slate">None</span>}</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => onApply(p.employee_id)} className="rounded-sm border border-ink-mid px-2.5 py-1 text-xs text-slate-light hover:border-signal/50 hover:text-paper">Apply</button>
                      <DownloadButton busy={busyId === p.employee_id} onClick={() => onDownload(p.employee_id, p.employee_name, scope === "year" ? year : undefined)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate">Annual balance counts approved annual leave starting in {year}. &ldquo;All leave taken&rdquo; is every approved type that year.</p>
    </section>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function CalendarView({ requests, today }: { requests: LeaveRequest[]; today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [showPending, setShowPending] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const first = `${month}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const gridStart = addDays(first, -lead);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const gridEnd = cells[cells.length - 1];

  const byDay = new Map<string, LeaveRequest[]>();
  for (const r of requests) {
    if (r.status !== "approved" && !(showPending && r.status === "pending")) continue;
    const start = r.start_date.slice(0, 10);
    const end = r.end_date.slice(0, 10);
    if (end < gridStart || start > gridEnd) continue;
    const from = start < gridStart ? gridStart : start;
    const span = calendarDays(from, end < gridEnd ? end : gridEnd);
    for (let i = 0; i < span; i++) {
      const day = addDays(from, i);
      byDay.set(day, [...(byDay.get(day) ?? []), r]);
    }
  }

  const shiftMonth = (n: number) => {
    const d = new Date(`${first}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
    setSelected(null);
  };
  const title = new Intl.DateTimeFormat("en-ZW", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T00:00:00Z`));
  const selectedRows = selected ? byDay.get(selected) ?? [] : [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => shiftMonth(-1)} className={secondaryButton} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <h2 className="w-44 text-center text-base font-semibold text-paper">{title}</h2>
          <button type="button" onClick={() => shiftMonth(1)} className={secondaryButton} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
          <button type="button" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }} className="ml-1 text-sm text-signal hover:underline">Today</button>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-light">
          <input type="checkbox" checked={showPending} onChange={(e) => setShowPending(e.target.checked)} className="accent-signal" /> Show pending requests
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="overflow-hidden rounded-lg border border-ink-mid">
          <div className="grid grid-cols-7 border-b border-ink-mid bg-ink-light">
            {WEEKDAYS.map((d) => <div key={d} className="px-2 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-slate">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-px bg-ink-mid">
            {cells.map((day, i) => {
              const rows = byDay.get(day) ?? [];
              const inMonth = day.startsWith(month);
              const weekend = i % 7 >= 5;
              return (
                <button key={day} type="button" onClick={() => setSelected(day)}
                  className={`min-h-24 p-1.5 text-left align-top transition-colors ${weekend ? "bg-ink/70" : "bg-ink"} ${selected === day ? "ring-1 ring-inset ring-signal" : "hover:bg-ink-light"}`}>
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${day === today ? "bg-signal font-semibold text-ink" : inMonth ? "text-paper" : "text-slate/50"}`}>
                    {Number(day.slice(8))}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {rows.slice(0, 3).map((r) => (
                      <div key={r.id} className={`flex items-center gap-1 truncate rounded-sm px-1 py-0.5 text-[11px] ${r.status === "pending" ? "border border-dashed border-blue-500/40 text-blue-200" : "bg-ink-light text-slate-light"}`}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_DOT[r.leave_type] ?? TYPE_DOT.other}`} />
                        <span className="truncate">{r.employee_name.split(" ")[0]}</span>
                      </div>
                    ))}
                    {rows.length > 3 && <p className="px-1 text-[10px] text-slate">+{rows.length - 3} more</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="rounded-lg border border-ink-mid bg-ink-light p-4">
          {selected ? (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-paper"><Users className="h-4 w-4 text-slate" />{formatDate(selected)}</p>
              {selectedRows.length === 0 ? <p className="mt-3 text-sm text-slate-light">Nobody is on leave.</p> : (
                <ul className="mt-3 space-y-3">
                  {selectedRows.map((r) => (
                    <li key={r.id} className="border-l-2 border-ink-mid pl-3">
                      <p className="text-sm text-paper">{r.employee_name}</p>
                      <p className="text-xs text-slate-light">{typeLabel(r.leave_type)} · {dateRange(r.start_date, r.end_date)}</p>
                      {r.status === "pending" && <p className="text-xs text-blue-300">Pending approval</p>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-light">Pick a day to see who is away.</p>
          )}
          <div className="mt-5 space-y-1.5 border-t border-ink-mid pt-3">
            {LEAVE_TYPES.slice(0, 6).map(([k, label]) => (
              <p key={k} className="flex items-center gap-2 text-xs text-slate-light"><span className={`h-2 w-2 rounded-full ${TYPE_DOT[k]}`} />{label}</p>
            ))}
            <p className="flex items-center gap-2 text-xs text-slate-light"><span className="h-2.5 w-4 rounded-sm border border-dashed border-blue-500/50" />Pending</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function ApplyLeaveModal({ people, initialEmployeeId, onClose, onSaved }: {
  people: LeaveBalance[]; initialEmployeeId: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({ employee_id: initialEmployeeId, leave_type: "annual", start_date: "", end_date: "", days_requested: "1", reason: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const person = people.find((p) => p.employee_id === form.employee_id);

  const setDates = (start: string, end: string) => {
    let daysRequested = form.days_requested;
    if (start && end && end >= start) {
      // Weekdays only, the usual basis for leave; HR can still adjust it.
      let count = 0;
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
        if (dow !== 0 && dow !== 6) count++;
      }
      daysRequested = String(Math.max(1, count));
    }
    setForm({ ...form, start_date: start, end_date: end, days_requested: daysRequested });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const daysRequested = Number(form.days_requested);
    if (!form.employee_id) return setError("Choose who the leave is for.");
    if (!form.start_date || !form.end_date) return setError("Pick the first and last day of leave.");
    if (form.end_date < form.start_date) return setError("The last day must be on or after the first day.");
    if (!daysRequested || daysRequested <= 0) return setError("Days must be more than zero.");
    setSaving(true);
    setError("");
    try {
      await createHRLeaveRequest({ ...form, days_requested: daysRequested });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the request.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg space-y-4 rounded-lg border border-ink-mid bg-ink-light p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid pb-3">
          <h2 className="text-base font-semibold text-paper">Apply leave</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <Field label="Employee">
          <select className={inputClass} value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} required>
            <option value="">Choose a person</option>
            {people.map((p) => <option key={p.employee_id} value={p.employee_id}>{p.employee_name}{p.employee_number ? ` (${p.employee_number})` : ""}</option>)}
          </select>
        </Field>
        {person && (
          <p className="-mt-2 text-xs text-slate">{days(person.annual_remaining)} of {person.annual_leave_days} annual days left · {person.pending_count} pending</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputClass} value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })}>
              {LEAVE_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </Field>
          <Field label="Working days" hint="Weekdays in the range; adjust for public holidays or half days.">
            <input type="number" min="0.5" step="0.5" className={inputClass} value={form.days_requested} onChange={(e) => setForm({ ...form, days_requested: e.target.value })} required />
          </Field>
          <Field label="First day">
            <input type="date" className={inputClass} value={form.start_date} onChange={(e) => setDates(e.target.value, form.end_date && form.end_date < e.target.value ? e.target.value : form.end_date)} required />
          </Field>
          <Field label="Last day">
            <input type="date" className={inputClass} min={form.start_date || undefined} value={form.end_date} onChange={(e) => setDates(form.start_date, e.target.value)} required />
          </Field>
        </div>
        <Field label="Reason">
          <textarea className={`${inputClass} h-20`} placeholder="Why is this leave needed?" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-ink-mid pt-3">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button type="submit" disabled={saving} className={primaryButton}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Submit request</button>
        </div>
      </form>
    </div>
  );
}

function ExportModal({ people, busyId, onClose, onDownload }: {
  people: LeaveBalance[]; busyId: string | null; onClose: () => void; onDownload: (id: string, name: string, year?: number) => Promise<void>;
}) {
  const thisYear = new Date().getFullYear();
  const [employeeId, setEmployeeId] = useState("");
  const [year, setYear] = useState("all");
  const person = people.find((p) => p.employee_id === employeeId);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-4 rounded-lg border border-ink-mid bg-ink-light p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid pb-3">
          <h2 className="text-base font-semibold text-paper">Leave record PDF</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-sm text-slate-light">A Six Nine branded record of one person&rsquo;s leave: every request with its dates, days, reason and decision, their annual balance and a sign-off block.</p>
        <Field label="Employee">
          <select className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Choose a person</option>
            {people.map((p) => <option key={p.employee_id} value={p.employee_id}>{p.employee_name}{p.request_count ? ` · ${p.request_count} request${p.request_count === 1 ? "" : "s"}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Period">
          <select className={inputClass} value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">Full history</option>
            {Array.from({ length: 5 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 border-t border-ink-mid pt-3">
          <button type="button" onClick={onClose} className={secondaryButton}>Close</button>
          <button type="button" disabled={!person || busyId === employeeId} className={primaryButton}
            onClick={async () => { if (person) { await onDownload(person.employee_id, person.employee_name, year === "all" ? undefined : Number(year)); onClose(); } }}>
            {busyId === employeeId ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
