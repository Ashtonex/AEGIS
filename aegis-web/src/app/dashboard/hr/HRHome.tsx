"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowRight, Banknote, Briefcase, CalendarDays, FileText, Loader2, ShieldCheck, UserMinus, Users, UserX,
} from "lucide-react";
import { getPeopleRegister, getPeopleSummary, type PeopleSummary, type RegisterRow } from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { PersonCardModal } from "@/components/people/PersonCardModal";
import { formatDate } from "@/components/people/ui";

function Kpi({ label, value, tone = "text-paper", hint }: { label: string; value: ReactNode; tone?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-ink-mid bg-ink-light p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate">{hint}</p>}
    </div>
  );
}

function Bars({ title, rows }: { title: string; rows: { name: string; people: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.people)));
  return (
    <section className="rounded-lg border border-ink-mid bg-ink-light p-4">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-slate">{title}</h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[minmax(0,11rem)_1fr_2rem] items-center gap-3 text-sm">
            <span className={`truncate ${r.name.startsWith("No ") ? "text-amber-300" : "text-slate-light"}`}>{r.name}</span>
            <span className="h-2 overflow-hidden rounded-full bg-ink"><span className={`block h-full rounded-full ${r.name.startsWith("No ") ? "bg-amber-500/70" : "bg-signal/80"}`} style={{ width: `${(Number(r.people) / max) * 100}%` }} /></span>
            <span className="text-right font-mono text-paper">{r.people}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const MODULES: { href: string; label: string; text: string; icon: ReactNode }[] = [
  { href: "/dashboard/hr/employees", label: "Employee Register", text: "Everyone, their cards and status", icon: <Users className="h-4 w-4" /> },
  { href: "/dashboard/hr/documents", label: "Contracts & Docs", text: "Signed contracts and expiry", icon: <FileText className="h-4 w-4" /> },
  { href: "/dashboard/hr/credentials", label: "Credentials", text: "Licences, certificates, registrations", icon: <ShieldCheck className="h-4 w-4" /> },
  { href: "/dashboard/hr/leave", label: "Leave", text: "Requests, calendar and absence", icon: <CalendarDays className="h-4 w-4" /> },
  { href: "/dashboard/hr/payroll", label: "Payroll", text: "Pay profiles, PAYE and NSSA, payslips", icon: <Banknote className="h-4 w-4" /> },
  { href: "/dashboard/hr/recruitment", label: "Recruitment", text: "Candidates and assessments", icon: <Briefcase className="h-4 w-4" /> },
];

/** HR landing page: the whole organisation at a glance and what needs fixing. */
export function HRHome() {
  const [summary, setSummary] = useState<PeopleSummary | null>(null);
  const [attention, setAttention] = useState<RegisterRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [s, r] = await Promise.all([getPeopleSummary(), getPeopleRegister({ status: "current" })]);
      setSummary(s.data);
      setAttention(r.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "HR dashboard could not be loaded.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const disabledLogins = attention.filter((r) => r.login_active === false);
  const incomplete = attention
    .map((r) => ({ row: r, gaps: [!r.position_name && "role", !r.start_date && "start date", !r.has_pay_profile && "pay", !r.personal_complete && "personal details", !r.line_manager_name && "line manager"].filter(Boolean) as string[] }))
    .filter((x) => x.gaps.length > 0)
    .sort((a, b) => b.gaps.length - a.gaps.length);

  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader title="HR Dashboard" subtitle="Six Nine Construction's people at a glance: who is here, who has left, and what is missing." />
      {error && <p role="alert" className="flex items-center gap-2 rounded-sm border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200"><AlertTriangle className="h-4 w-4" />{error}</p>}
      {!summary ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-signal" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Headcount" value={summary.headcount} hint="Everyone who has not left" />
            <Kpi label="Active" value={summary.active} tone="text-emerald-400" />
            <Kpi label="On leave today" value={summary.on_leave_today} tone="text-blue-400" />
            <Kpi label="Suspended" value={summary.suspended} tone="text-amber-400" />
            <Kpi label="Not on a project" value={summary.unallocated} hint="No live allocation" />
            <Kpi label="Left the organisation" value={summary.former} tone="text-slate-light" />
          </div>

          {disabledLogins.length > 0 && (
            <section className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-4">
              <div className="flex items-start gap-3">
                <UserX className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-amber-100">{disabledLogins.length} {disabledLogins.length === 1 ? "person is" : "people are"} still listed as staff but cannot log in</p>
                  <p className="text-sm text-amber-100/80">If they have left, open their card and use <strong>History → Mark as left</strong>. If it is a duplicate login, mark the duplicate as left.</p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {disabledLogins.map((r) => (
                      <li key={r.id}>
                        <button onClick={() => setOpenId(r.id)} className="rounded-sm border border-amber-500/40 bg-ink px-3 py-1.5 text-sm text-paper hover:border-amber-300">
                          {r.employee_name}<span className="text-slate"> · {r.login_email}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Bars title="People by discipline" rows={summary.by_category} />
            <Bars title="People by department" rows={summary.by_department} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section className="rounded-lg border border-ink-mid bg-ink-light">
              <div className="flex items-center justify-between border-b border-ink-mid px-4 py-3">
                <h2 className="font-mono text-xs uppercase tracking-wider text-slate">Incomplete person cards</h2>
                <span className="font-mono text-xs text-paper">{incomplete.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-px bg-ink-mid sm:grid-cols-4">
                {[["No role", summary.missing_role], ["No start date", summary.missing_start_date], ["No pay profile", summary.missing_pay_profile], ["Personal details missing", summary.missing_personal]].map(([label, n]) => (
                  <div key={label as string} className="bg-ink-light p-3"><p className="text-[11px] text-slate">{label}</p><p className={`font-mono text-lg ${Number(n) ? "text-amber-300" : "text-emerald-300"}`}>{n}</p></div>
                ))}
              </div>
              <ul className="max-h-80 divide-y divide-ink-mid overflow-y-auto">
                {incomplete.map(({ row, gaps }) => (
                  <li key={row.id}>
                    <button onClick={() => setOpenId(row.id)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-ink-mid/20">
                      <span className="min-w-0"><span className="text-sm text-paper">{row.employee_name}</span><span className="block truncate text-xs text-slate">Missing {gaps.join(", ")}</span></span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate" />
                    </button>
                  </li>
                ))}
                {!incomplete.length && <li className="p-4 text-sm text-emerald-300">Every card is complete.</li>}
              </ul>
            </section>

            <div className="space-y-6">
              <section className="rounded-lg border border-ink-mid bg-ink-light p-4">
                <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-slate">HR work areas</h2>
                <ul className="grid gap-2">
                  {MODULES.map((m) => (
                    <li key={m.href}>
                      <Link href={m.href} className="flex items-center gap-3 rounded-sm border border-ink-mid bg-ink px-3 py-2.5 hover:border-signal/50">
                        <span className="text-signal">{m.icon}</span>
                        <span className="min-w-0 flex-1"><span className="block text-sm text-paper">{m.label}</span><span className="block truncate text-xs text-slate">{m.text}</span></span>
                        <ArrowRight className="h-4 w-4 text-slate" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="rounded-lg border border-ink-mid bg-ink-light p-4">
                <h2 className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-slate"><UserMinus className="h-4 w-4" />Recent leavers</h2>
                {summary.recent_leavers.length === 0 ? <p className="text-sm text-slate-light">Nobody has been recorded as leaving.</p> : (
                  <ul className="space-y-2">
                    {summary.recent_leavers.map((l) => (
                      <li key={l.id}><button onClick={() => setOpenId(l.id)} className="text-left text-sm text-paper hover:text-signal">{l.employee_name}<span className="text-slate"> · left {formatDate(l.end_date)}{l.left_reason ? ` · ${l.left_reason}` : ""}</span></button></li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      )}
      {openId && <PersonCardModal employeeId={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} />}
    </div>
  );
}
