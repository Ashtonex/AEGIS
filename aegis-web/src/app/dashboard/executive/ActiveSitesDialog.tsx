"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ExternalLink, HardHat, Info, Loader2, UserX } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getExecutiveSiteDetail,
  type ExecutiveSite,
  type ExecutiveSiteDetail,
  type ExecutiveSitesSummary,
  type SiteFlag,
  type SiteTeamMember,
} from "@/lib/api";

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const num = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "—";
const words = (value: string | null | undefined) => (value ? value.replace(/_/g, " ") : "—");

const HEALTH: Record<ExecutiveSite["health"], { dot: string; label: string; tone: string }> = {
  red: { dot: "bg-red-400", label: "Needs action", tone: "border-red-500/40 text-red-300 bg-red-950/20" },
  amber: { dot: "bg-amber-400", label: "Watch", tone: "border-amber-500/40 text-amber-300 bg-amber-950/20" },
  green: { dot: "bg-emerald-400", label: "On track", tone: "border-emerald-500/40 text-emerald-300 bg-emerald-950/20" },
  idle: { dot: "bg-slate", label: "Idle", tone: "border-ink-mid text-slate-light" },
};
const ACTIVITY: Record<ExecutiveSite["activity"], string> = {
  working_today: "Working today",
  active_week: "Worked this week",
  idle: "No labour in 7 days",
};
const FLAG_TONE: Record<SiteFlag["level"], string> = {
  critical: "border-red-500/40 bg-red-950/20 text-red-300",
  warning: "border-amber-500/40 bg-amber-950/20 text-amber-300",
  info: "border-ink-mid text-slate-light",
};

export function activeSitesHeadline(summary: ExecutiveSitesSummary | null): { value: string; sub: string } {
  if (!summary) return { value: "—", sub: "" };
  return {
    value: `${summary.active_week} working`,
    sub: `${summary.working_today} on site today · ${summary.idle} idle`,
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sites: ExecutiveSite[];
  summary: ExecutiveSitesSummary | null;
  loading: boolean;
  error: string | null;
};

export function ActiveSitesDialog({ open, onOpenChange, sites, summary, loading, error }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showIdle, setShowIdle] = useState(false);

  // Reopening the dialog starts from the site list.
  useEffect(() => { if (!open) setSelectedId(null); }, [open]);

  const working = sites.filter((site) => site.activity !== "idle");
  const idle = sites.filter((site) => site.activity === "idle");
  const selected = sites.find((site) => site.project_id === selectedId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-4 sm:p-6">
        {selected ? (
          <SiteDetailView site={selected} onBack={() => setSelectedId(null)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Active sites</DialogTitle>
              <DialogDescription>
                Open projects by what happened on site in the last 7 days: crew, hours, labour cost, daily targets and the team in charge.
              </DialogDescription>
            </DialogHeader>
            {summary && <SummaryStrip summary={summary} />}
            {error && <p className="border border-red-500/40 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}
            {loading && !sites.length ? (
              <p className="flex items-center gap-2 text-sm text-slate"><Loader2 className="h-4 w-4 animate-spin" /> Loading sites…</p>
            ) : (
              <div className="space-y-4">
                <section className="space-y-2">
                  <h3 className="font-mono text-[10px] uppercase tracking-widest text-slate">Working ({working.length})</h3>
                  {working.length ? working.map((site) => <SiteRow key={site.project_id} site={site} onSelect={setSelectedId} />)
                    : <p className="text-sm text-slate-light">No site recorded any labour in the last 7 days.</p>}
                </section>
                {idle.length > 0 && (
                  <section className="space-y-2">
                    <button type="button" onClick={() => setShowIdle((v) => !v)}
                      className="font-mono text-[10px] uppercase tracking-widest text-slate hover:text-paper">
                      {showIdle ? "Hide" : "Show"} idle projects ({idle.length})
                    </button>
                    {showIdle && idle.map((site) => <SiteRow key={site.project_id} site={site} onSelect={setSelectedId} />)}
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryStrip({ summary }: { summary: ExecutiveSitesSummary }) {
  const items = [
    { label: "On site today", value: `${summary.working_today} sites · ${summary.today_headcount} people` },
    { label: "Worked this week", value: `${summary.active_week} of ${summary.total}` },
    { label: "Need attention", value: String(summary.needs_attention) },
    { label: "Crew this week", value: String(summary.week_headcount) },
    { label: "Hours this week", value: num(summary.week_hours) },
    { label: "Labour cost this week", value: money(summary.week_labour_cost) },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="border border-ink-mid p-2">
          <p className="font-mono text-[9px] uppercase tracking-wider text-slate">{item.label}</p>
          <p className="mt-1 font-mono text-sm text-paper">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function SiteRow({ site, onSelect }: { site: ExecutiveSite; onSelect: (id: string) => void }) {
  const health = HEALTH[site.health];
  const week = site.week;
  const topFlag = site.flags.find((flag) => flag.level !== "info");
  return (
    <button type="button" onClick={() => onSelect(site.project_id)}
      className="w-full border border-ink-mid p-3 text-left transition-colors hover:border-signal focus-visible:outline focus-visible:outline-signal">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-paper">
            <span className={`h-2 w-2 shrink-0 rounded-full ${health.dot}`} aria-hidden />
            <span className="truncate">{site.name || "Unnamed project"}</span>
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase text-slate">
            {ACTIVITY[site.activity]} · {words(site.status)}{site.client_name ? ` · ${site.client_name}` : ""}
          </p>
        </div>
        <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${health.tone}`}>{health.label}</span>
      </div>
      {site.activity !== "idle" && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs text-slate-light sm:grid-cols-5">
          <span>Today: <span className="text-paper">{week.today?.headcount ?? 0}</span> on site</span>
          <span>Crew: <span className="text-paper">{week.headcount}</span></span>
          <span>Hours: <span className="text-paper">{num(week.total_hours)}</span></span>
          <span>Labour: <span className="text-paper">{money(week.labour_cost)}</span></span>
          <span>Targets: <span className="text-paper">{week.targets_total ? `${week.targets_met}/${week.targets_total}` : "none set"}</span></span>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-light">
        <PeopleLine site={site} />
      </p>
      {topFlag && <p className={`mt-2 text-xs ${topFlag.level === "critical" ? "text-red-300" : "text-amber-300"}`}>{topFlag.message}</p>}
    </button>
  );
}

function PeopleLine({ site }: { site: ExecutiveSite }) {
  const part = (label: string, members: SiteTeamMember[]) =>
    `${label}: ${members.length ? members.map((m) => m.name || "Unnamed").join(", ") : "none"}`;
  return <>{[part("Eng", site.people.engineer), part("Clerk", site.people.clerk), part("Foreman", site.people.foreman)].join(" · ")}</>;
}

function SiteDetailView({ site, onBack }: { site: ExecutiveSite; onBack: () => void }) {
  const [detail, setDetail] = useState<ExecutiveSiteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    getExecutiveSiteDetail(site.project_id)
      .then((res) => { if (!cancelled) setDetail(res.data ?? null); })
      .catch(() => { if (!cancelled) setError("Site detail could not be loaded."); });
    return () => { cancelled = true; };
  }, [site.project_id]);

  // The list row already has the 7-day summary; show it straight away and
  // fill in the daily series, targets and report when the detail arrives.
  const view: ExecutiveSite = detail ?? site;
  const week = view.week;
  const health = HEALTH[view.health];
  const costPerHour = week.total_hours ? week.labour_cost / week.total_hours : null;

  return (
    <div className="space-y-5">
      <DialogHeader>
        <button type="button" onClick={onBack} className="flex w-fit items-center gap-1 font-mono text-[10px] uppercase text-slate hover:text-paper">
          <ArrowLeft className="h-3 w-3" /> All sites
        </button>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {view.name || "Unnamed project"}
          <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${health.tone}`}>{health.label}</span>
        </DialogTitle>
        <DialogDescription>
          {ACTIVITY[view.activity]} · {words(view.status)}
          {view.client_name ? ` · ${view.client_name}` : ""}
          {view.planned_completion_date ? ` · due ${shortDate(view.planned_completion_date)}` : ""}
        </DialogDescription>
      </DialogHeader>

      {view.flags.length > 0 && (
        <section className="space-y-1.5">
          {view.flags.map((flag) => (
            <p key={flag.code + flag.message} className={`flex items-start gap-2 border p-2 text-sm ${FLAG_TONE[flag.level]}`}>
              {flag.level === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              {flag.message}
            </p>
          ))}
        </section>
      )}

      <TeamSection site={view} />

      <section>
        <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate">Last 7 days</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="On site today" value={`${week.today?.headcount ?? 0} people`} sub={week.today?.day_status ? `Day ${words(week.today.day_status)}` : "Day not started"} />
          <Stat label="Crew" value={`${week.headcount} people`} sub={`${week.worked_days} day(s) worked · ${week.person_days} person-days`} />
          <Stat label="Hours" value={num(week.total_hours)} sub={`${num(week.overtime_hours)} overtime · ${num(week.hours_per_person_day)} per person-day`} />
          <Stat label="Labour cost" value={money(week.labour_cost)} sub={`${costPerHour === null ? "—" : money(costPerHour)}/hr${week.missing_rates ? ` · ${week.missing_rates} without a rate` : ""}`} />
          <Stat label="Daily targets met" value={week.targets_total ? `${week.targets_met} of ${week.targets_total}` : "None set"} sub={week.targets_total ? `${Math.round((week.targets_met / week.targets_total) * 100)}%` : "Set targets in Site Operations"} />
          <Stat label="Planned value" value={money(week.planned_value)} sub="What the targets were worth" />
          <Stat label="Earned value" value={money(week.earned_value)} sub={week.planned_value ? `${Math.round((week.earned_value / week.planned_value) * 100)}% of planned` : "—"} />
          <Stat label="Reports" value={week.unreported_days ? `${week.unreported_days} missing` : "Up to date"} sub={`Last worked ${shortDate(week.last_worked_date)}`} />
        </div>
      </section>

      {view.budget && <BudgetBar budget={view.budget} />}

      {error && <p className="border border-red-500/40 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}
      {!detail && !error && <p className="flex items-center gap-2 text-sm text-slate"><Loader2 className="h-4 w-4 animate-spin" /> Loading daily detail…</p>}
      {detail && (
        <>
          <DailySection detail={detail} />
          <TargetsSection detail={detail} />
          <ReportSection detail={detail} />
        </>
      )}

      <div className="flex flex-wrap gap-2 border-t border-ink-mid pt-3">
        <Link href={`/dashboard/projects/${view.project_id}`} className="flex items-center gap-1 border border-ink-mid px-3 py-1.5 text-xs text-paper hover:border-signal">
          Open project workspace <ExternalLink className="h-3 w-3" />
        </Link>
        <Link href="/dashboard/site-operations" className="flex items-center gap-1 border border-ink-mid px-3 py-1.5 text-xs text-paper hover:border-signal">
          Site operations <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-ink-mid p-2">
      <p className="font-mono text-[9px] uppercase tracking-wider text-slate">{label}</p>
      <p className="mt-1 font-mono text-base text-paper">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-light">{sub}</p>}
    </div>
  );
}

function TeamSection({ site }: { site: ExecutiveSite }) {
  const groups: Array<[string, SiteTeamMember[]]> = [
    ["Site engineer", site.people.engineer],
    ["Site clerk", site.people.clerk],
    ["Foreman", site.people.foreman],
    ["Others", site.people.other],
  ];
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate">Team in charge</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {groups.filter(([label, members]) => label !== "Others" || members.length).map(([label, members]) => (
          <div key={label} className="border border-ink-mid p-2">
            <p className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-slate"><HardHat className="h-3 w-3" /> {label}</p>
            {members.length ? members.map((m) => (
              <p key={`${m.user_id}-${m.role}`} className={`mt-1 text-sm ${m.account_active ? "text-paper" : "text-red-300"}`}>
                {m.name || "Unnamed"}
                {label === "Others" && m.role ? <span className="text-slate-light"> · {m.role}</span> : null}
                {!m.account_active && <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] uppercase"><UserX className="h-3 w-3" /> deactivated</span>}
              </p>
            )) : <p className="mt-1 text-sm text-amber-300">Not assigned</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function BudgetBar({ budget }: { budget: NonNullable<ExecutiveSite["budget"]> }) {
  const total = budget.approved_budget || 0;
  const spentPct = total ? Math.min((budget.actual_cost / total) * 100, 100) : 0;
  const committedPct = total ? Math.min((budget.committed_cost / total) * 100, 100 - spentPct) : 0;
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate">Budget</h3>
      <div className="h-2 w-full overflow-hidden bg-ink-mid">
        <div className="flex h-full">
          <div className="h-full bg-signal" style={{ width: `${spentPct}%` }} />
          <div className="h-full bg-amber-400/70" style={{ width: `${committedPct}%` }} />
        </div>
      </div>
      <p className="mt-1.5 font-mono text-xs text-slate-light">
        {money(budget.actual_cost)} spent + {money(budget.committed_cost)} committed of {money(budget.approved_budget)}
        {" · "}{money(budget.remaining)} left · {words(budget.status)}
      </p>
    </section>
  );
}

function DailySection({ detail }: { detail: ExecutiveSiteDetail }) {
  const data = detail.daily.map((d) => ({ ...d, label: shortDate(d.date) }));
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate">Last 14 days</h3>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="var(--dxl-ink-mid, #2a2a2a)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#8a8a8a" }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: "#8a8a8a" }} />
            <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", fontSize: 12 }}
              formatter={(value, name) => [name === "Labour cost" ? money(Number(value)) : num(Number(value)), name]} />
            <Bar dataKey="total_hours" name="Hours" fill="var(--dxl-signal, #c8a24a)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left font-mono text-xs">
          <thead className="text-[10px] uppercase text-slate">
            <tr><th className="py-1 pr-2">Day</th><th className="pr-2">Crew</th><th className="pr-2">Hours</th><th className="pr-2">OT</th><th className="pr-2">Labour</th><th className="pr-2">Targets</th><th className="pr-2">Earned</th><th className="pr-2">Day</th><th>Report</th></tr>
          </thead>
          <tbody className="text-slate-light">
            {[...detail.daily].reverse().filter((d) => d.headcount || d.targets_total || d.day_status || d.report_status).map((d) => {
              const lowHours = d.headcount > 0 && d.total_hours / d.headcount < 2;
              return (
                <tr key={d.date} className="border-t border-ink-mid">
                  <td className="py-1 pr-2 text-paper">{shortDate(d.date)}</td>
                  <td className="pr-2">{d.headcount}</td>
                  <td className={`pr-2 ${lowHours ? "text-red-300" : ""}`}>{num(d.total_hours)}</td>
                  <td className="pr-2">{num(d.overtime_hours)}</td>
                  <td className="pr-2">{money(d.labour_cost)}</td>
                  <td className="pr-2">{d.targets_total ? `${d.targets_met}/${d.targets_total}` : "—"}</td>
                  <td className="pr-2">{d.planned_value ? `${money(d.earned_value)} / ${money(d.planned_value)}` : "—"}</td>
                  <td className="pr-2">{words(d.day_status)}</td>
                  <td>{words(d.report_status)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TargetsSection({ detail }: { detail: ExecutiveSiteDetail }) {
  if (!detail.targets.length) {
    return (
      <section>
        <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate">Daily targets</h3>
        <p className="text-sm text-amber-300">No daily targets have been set for this site.</p>
      </section>
    );
  }
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate">Daily targets · {shortDate(detail.targets[0].target_date)}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="font-mono text-[10px] uppercase text-slate">
            <tr><th className="py-1 pr-2">Work</th><th className="pr-2">Target</th><th className="pr-2">Achieved</th><th className="pr-2">Value</th><th>Status</th></tr>
          </thead>
          <tbody className="text-slate-light">
            {detail.targets.map((t) => {
              const met = t.status === "done" || (t.target_qty && (t.achieved_qty ?? 0) >= t.target_qty);
              return (
                <tr key={t.id} className="border-t border-ink-mid">
                  <td className="py-1 pr-2 text-paper">{t.description || t.work_package || "—"}{t.work_package && t.description ? <span className="text-slate"> · {t.work_package}</span> : null}</td>
                  <td className="pr-2 font-mono">{num(t.target_qty, 2)} {t.unit || ""}</td>
                  <td className={`pr-2 font-mono ${met ? "text-emerald-300" : ""}`}>{num(t.achieved_qty ?? 0, 2)} {t.unit || ""}</td>
                  <td className="pr-2 font-mono">{money(t.planned_amount)}</td>
                  <td className="font-mono">{words(t.status)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportSection({ detail }: { detail: ExecutiveSiteDetail }) {
  const report = detail.latest_report;
  const recon = detail.last_reconciliation;
  return (
    <section className="grid grid-cols-1 gap-2 lg:grid-cols-3">
      <div className="border border-ink-mid p-3 lg:col-span-2">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-slate">Latest site report</h3>
        {report ? (
          <div className="mt-2 space-y-1.5 text-sm text-slate-light">
            <p className="font-mono text-xs text-paper">{shortDate(report.report_date)} · {words(report.status)}{report.engineer_review_status ? ` · engineer ${words(report.engineer_review_status)}` : ""}</p>
            {report.actual_work && <p><span className="text-slate">Work done:</span> {report.actual_work}</p>}
            {report.delays && <p><span className="text-slate">Delays:</span> {report.delays}</p>}
            {report.safety_notes && <p><span className="text-slate">Safety:</span> {report.safety_notes}</p>}
            {!report.actual_work && !report.delays && !report.safety_notes && <p>Nothing written in this report yet.</p>}
          </div>
        ) : <p className="mt-2 text-sm text-amber-300">No site report has been filed.</p>}
      </div>
      <div className="border border-ink-mid p-3">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-slate">Saturday reconciliation</h3>
        {recon ? (
          <p className="mt-2 font-mono text-xs text-paper">Week ending {shortDate(recon.week_ending)} · {words(recon.status)}</p>
        ) : <p className="mt-2 text-sm text-amber-300">Never reconciled.</p>}
      </div>
    </section>
  );
}
