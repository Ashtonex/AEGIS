"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, Clock3, HardHat, LogOut, MessageSquareWarning, Play, Plus, Search, ShieldAlert, ShieldCheck,
  Square, Timer, Trash2, UserPlus, Users,
} from "lucide-react";
import {
  addSiteDayAttendance, clockOutSiteDayAttendance, closeSiteDay, openSiteDay, registerProjectHire,
  removeSiteDayAttendance, startSiteDay, updateSiteDay, updateSiteDayAttendance,
} from "@/lib/api";
import { ApiRecord, Btn, Locked, Notice, Panel, Pill, Toggle, areaClass, errorText, fieldClass, num, qty, timeOf } from "./ui";

export type SiteDay = {
  briefing: ApiRecord | null;
  attendance: ApiRecord[];
  gate: { opened: boolean; started: boolean; closed: boolean; unlocked: boolean };
  targets: ApiRecord[];
  roster: { project_hires: ApiRecord[]; employees: ApiRecord[] };
  project_name: string;
  date: string;
  is_today: boolean;
};

type Props = {
  projectId: string;
  date: string;
  day: SiteDay | null;
  onDay: (day: Partial<SiteDay>) => void;
  reload: () => Promise<void>;
};

/** Ticks from clock-in to now (or clock-out) without asking the server. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function elapsed(from: unknown, to: unknown, now: number) {
  if (!from) return "00:00:00";
  const start = new Date(String(from)).getTime();
  const end = to ? new Date(String(to)).getTime() : now;
  const secs = Math.max(0, Math.floor((end - start) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
}

const EMPTY_HIRE = { full_name: "", national_id: "", phone: "", trade: "", hourly_rate: "", payment_method: "cash", payment_details: "" };

export function LabourRegisterTab({ projectId, date, day, onDay, reload }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [showHireForm, setShowHireForm] = useState(false);
  const [hire, setHire] = useState(EMPTY_HIRE);
  const [hirePpe, setHirePpe] = useState(true);
  const [toolbox, setToolbox] = useState({ toolbox_topic: "", toolbox_notes: "" });
  const [safety, setSafety] = useState({ safety_concerns: "", safety_actions: "" });
  // After the start a concern is only saved once the action taken is written.
  const [localConcern, setLocalConcern] = useState(false);

  const briefing = day?.briefing ?? null;
  const attendance = useMemo(() => day?.attendance ?? [], [day?.attendance]);
  const status = String(briefing?.status ?? "none");
  const editable = status === "open";
  const running = status === "started";
  const now = useNow(running);

  useEffect(() => {
    setToolbox({ toolbox_topic: briefing?.toolbox_topic ?? "", toolbox_notes: briefing?.toolbox_notes ?? "" });
    setSafety({ safety_concerns: briefing?.safety_concerns ?? "", safety_actions: briefing?.safety_actions ?? "" });
  }, [briefing?.id, briefing?.toolbox_topic, briefing?.toolbox_notes, briefing?.safety_concerns, briefing?.safety_actions]);

  const run = async (key: string, action: () => Promise<any>, success?: string) => {
    setBusy(key);
    setMessage(null);
    try {
      const response = await action();
      if (response?.data && ("attendance" in response.data || "briefing" in response.data)) onDay(response.data);
      else await reload();
      if (success || response?.message) setMessage({ tone: "success", text: success ?? response.message });
      return true;
    } catch (reason) {
      setMessage({ tone: "error", text: errorText(reason, "That didn't save. Check the connection and try again.") });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const onRegister = useMemo(() => new Set(attendance.map((a) => a.site_worker_id ?? a.employee_id)), [attendance]);
  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    const people: (ApiRecord & { kind: "project_hire" | "employee" })[] = [
      ...(day?.roster.project_hires ?? []).map((p) => ({ ...p, kind: "project_hire" as const })),
      ...(day?.roster.employees ?? []).map((p) => ({ ...p, kind: "employee" as const })),
    ];
    return people
      .filter((p) => !onRegister.has(p.id))
      .filter((p) => !term || `${p.full_name} ${p.trade ?? ""} ${p.national_id ?? ""} ${p.employee_number ?? ""}`.toLowerCase().includes(term))
      .slice(0, term ? 30 : 12);
  }, [day?.roster, onRegister, search]);

  const ppeMissing = attendance.filter((a) => !a.ppe_ok).length;
  const checklist = [
    { label: "People on the register", done: attendance.length > 0 },
    { label: "PPE confirmed for everyone", done: attendance.length > 0 && ppeMissing === 0 },
    { label: "PPE check ticked", done: !!briefing?.ppe_check_completed },
    { label: "Toolbox talk recorded", done: !!briefing?.toolbox_talk_completed && !!String(briefing?.toolbox_topic ?? "").trim() },
    { label: "Safety concern dealt with", done: !briefing?.safety_concern_raised || !!String(briefing?.safety_actions ?? "").trim() },
  ];
  const ready = checklist.every((c) => c.done);
  const clockedIn = attendance.filter((a) => a.clock_in_at && !a.clock_out_at).length;
  const hoursTotal = attendance.reduce((s, a) => s + num(a.regular_hours) + num(a.overtime_hours), 0);

  if (!projectId) {
    return <Locked title="Choose a project" body="Pick the project you are on site for. The whole site day (register, toolbox talk, targets, reports) is per project." />;
  }

  if (!briefing) {
    return (
      <div className="space-y-4">
        {message ? <Notice tone={message.tone} onClose={() => setMessage(null)}>{message.text}</Notice> : null}
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col justify-center gap-4 border border-signal/30 bg-gradient-to-br from-signal/10 via-ink to-ink p-6">
            <Pill tone="gold"><Clock3 className="h-3 w-3" /> First thing on site</Pill>
            <h2 className="text-2xl font-semibold text-paper">Start the site day for {day?.project_name ?? "this project"}</h2>
            <p className="max-w-xl text-sm text-slate-light">
              Register everyone on site, confirm their PPE, give the toolbox talk and deal with any safety concern. Starting the day
              clocks everyone in and unlocks the Daily Report and Material Request tabs.
            </p>
            <div>
              <Btn icon={<Play className="h-4 w-4" />} busy={busy === "open"} disabled={!day?.is_today}
                onClick={() => void run("open", () => openSiteDay({ project_id: projectId, briefing_date: date }), "Site day opened. Build the register.")}>
                Open today&apos;s site day
              </Btn>
              {!day?.is_today ? <p className="mt-2 text-xs text-slate-light">Only today&apos;s site day can be opened. Past days stay readable.</p> : null}
            </div>
          </div>
          <TodayTargetsCard targets={day?.targets ?? []} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {message ? <Notice tone={message.tone} onClose={() => setMessage(null)}>{message.text}</Notice> : null}

      {/* status ribbon */}
      <div className={`flex flex-wrap items-center justify-between gap-4 border p-4 ${running ? "border-emerald-500/40 bg-emerald-950/20" : status === "closed" ? "border-ink-mid bg-ink-light/30" : "border-signal/40 bg-signal/5"}`}>
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center ${running ? "bg-emerald-500 text-ink" : "border border-signal/50 text-signal"}`}>
            {running ? <Timer className="h-5 w-5" /> : status === "closed" ? <CheckCircle2 className="h-5 w-5" /> : <HardHat className="h-5 w-5" />}
          </span>
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-slate-light">Site day · {String(briefing.shift)} shift</p>
            <p className="text-lg font-semibold text-paper">
              {running ? `Work under way since ${timeOf(briefing.started_at)}` : status === "closed" ? `Closed at ${timeOf(briefing.closed_at)}` : "Pre-start: complete the checks below"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6 font-mono">
          <Stat label="On register" value={String(attendance.length)} />
          <Stat label="Clocked in" value={String(clockedIn)} />
          <Stat label="Hours logged" value={qty(hoursTotal)} />
          {status === "closed" ? <Pill tone={briefing.hr_status === "accepted" ? "green" : briefing.hr_status === "rejected" ? "red" : "amber"}>HR: {String(briefing.hr_status).replace("_", " ")}</Pill> : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        {/* register */}
        <Panel step={1} done={attendance.length > 0 && ppeMissing === 0} title="Labour register & PPE"
          subtitle={running ? "Late arrivals clock in when added. Clock people out as they leave." : "Add everyone on site and confirm each person's PPE."}
          actions={status !== "closed" ? (
            <Btn tone="ghost" icon={<UserPlus className="h-4 w-4" />} onClick={() => setShowHireForm((v) => !v)}>New project hire</Btn>
          ) : null}>
          {showHireForm && status !== "closed" ? (
            <form className="mb-4 grid gap-3 border border-signal/30 bg-signal/5 p-4 md:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await run("hire", () => registerProjectHire({
                  project_id: projectId, full_name: hire.full_name, national_id: hire.national_id || null, phone: hire.phone || null,
                  trade: hire.trade || null, hourly_rate: Number(hire.hourly_rate || 0), payment_method: hire.payment_method,
                  payment_details: hire.payment_details || null, briefing_id: briefing.id, ppe_ok: hirePpe,
                }), `${hire.full_name} registered and added to today's register. HR will verify their details.`);
                if (ok) { setHire(EMPTY_HIRE); setShowHireForm(false); await reload(); }
              }}>
              <p className="md:col-span-2 text-xs text-slate-light">
                Not in AEGIS yet? Register them here as a <b className="text-paper">project hire</b>: semi-skilled, paid by the hour, hired for this project.
                They can work today; HR verifies them and can activate or deactivate them at any time.
              </p>
              <input required value={hire.full_name} onChange={(e) => setHire({ ...hire, full_name: e.target.value })} placeholder="Full name *" className={fieldClass} />
              <input value={hire.national_id} onChange={(e) => setHire({ ...hire, national_id: e.target.value })} placeholder="National ID" className={fieldClass} />
              <input value={hire.phone} onChange={(e) => setHire({ ...hire, phone: e.target.value })} placeholder="Phone" className={fieldClass} />
              <input value={hire.trade} onChange={(e) => setHire({ ...hire, trade: e.target.value })} placeholder="Trade (e.g. general hand, bricklayer)" className={fieldClass} />
              <label className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate">$</span>
                <input required type="number" min="0" step="0.01" value={hire.hourly_rate} onChange={(e) => setHire({ ...hire, hourly_rate: e.target.value })} placeholder="Hourly rate *" className={`${fieldClass} pl-6`} />
              </label>
              <select value={hire.payment_method} onChange={(e) => setHire({ ...hire, payment_method: e.target.value })} className={fieldClass}>
                <option value="cash">Paid in cash</option>
                <option value="mobile_money">Mobile money</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
              {hire.payment_method !== "cash" ? (
                <input value={hire.payment_details} onChange={(e) => setHire({ ...hire, payment_details: e.target.value })} placeholder="EcoCash number / bank account" className={`${fieldClass} md:col-span-2`} />
              ) : null}
              <label className="flex items-center gap-3 text-sm text-paper"><Toggle checked={hirePpe} onChange={setHirePpe} label="PPE confirmed" /> PPE confirmed</label>
              <div className="flex justify-end gap-2">
                <Btn type="button" tone="ghost" onClick={() => setShowHireForm(false)}>Cancel</Btn>
                <Btn type="submit" busy={busy === "hire"} icon={<Plus className="h-4 w-4" />}>Register & add</Btn>
              </div>
            </form>
          ) : null}

          {status !== "closed" ? (
            <div className="mb-4">
              <label className="flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 focus-within:border-signal">
                <Search className="h-4 w-4 text-slate" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a project hire or team member to add…" className="h-full w-full bg-transparent text-sm text-paper outline-none placeholder:text-slate" />
              </label>
              {candidates.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {candidates.map((p) => (
                    <button key={`${p.kind}-${p.id}`} disabled={busy === `add-${p.id}`}
                      onClick={() => void run(`add-${p.id}`, () => addSiteDayAttendance(briefing.id, {
                        ...(p.kind === "project_hire" ? { site_worker_id: p.id } : { employee_id: p.id }), ppe_ok: running,
                      }), `${p.full_name} added${running ? " and clocked in" : ""}.`)}
                      className="group inline-flex items-center gap-2 border border-ink-mid bg-ink-light/50 px-3 py-1.5 text-left text-xs text-paper transition hover:border-signal disabled:opacity-50">
                      <Plus className="h-3.5 w-3.5 text-signal" />
                      <span>{p.full_name}</span>
                      <span className="text-slate">{p.trade ?? (p.kind === "employee" ? "SNC staff" : "hire")}</span>
                      {p.kind === "project_hire" && !p.hr_verified ? <span className="text-amber-300">· unverified</span> : null}
                      {p.kind === "project_hire" && p.on_this_project === false ? <span className="text-slate">· other project</span> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate">{search ? "No match. Register them as a new project hire." : "Everyone on this project's list is on the register."}</p>
              )}
            </div>
          ) : null}

          {attendance.length === 0 ? (
            <div className="flex flex-col items-center gap-2 border border-dashed border-ink-mid py-10 text-center text-sm text-slate-light">
              <Users className="h-7 w-7 text-slate" /> Nobody on today&apos;s register yet.
            </div>
          ) : (
            <div className="divide-y divide-ink-mid border border-ink-mid">
              {attendance.map((a) => {
                const working = a.clock_in_at && !a.clock_out_at;
                return (
                  <div key={a.id} className={`grid items-center gap-3 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] ${working ? "bg-emerald-950/10" : ""}`}>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm text-paper">
                        <span className="truncate font-medium">{a.worker_name}</span>
                        <Pill tone={a.worker_kind === "employee" ? "blue" : "slate"}>{a.worker_kind === "employee" ? "SNC staff" : "Project hire"}</Pill>
                        {a.worker_kind === "project_hire" && !a.hr_verified ? <Pill tone="amber">HR to verify</Pill> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-light">
                        {a.trade ?? "General"}{a.hourly_rate ? ` · $${num(a.hourly_rate).toFixed(2)}/h` : ""}
                        {a.clock_in_at ? ` · in ${timeOf(a.clock_in_at)}` : ""}{a.clock_out_at ? ` · out ${timeOf(a.clock_out_at)}` : ""}
                        {a.regular_hours != null ? ` · ${qty(a.regular_hours)}h${num(a.overtime_hours) ? ` + ${qty(a.overtime_hours)}h OT` : ""}` : ""}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-light">
                      <HardHat className={`h-4 w-4 ${a.ppe_ok ? "text-emerald-400" : "text-amber-400"}`} />
                      <Toggle checked={!!a.ppe_ok} label={`PPE for ${a.worker_name}`} disabled={!editable || busy === `ppe-${a.id}`}
                        onChange={(v) => void run(`ppe-${a.id}`, () => updateSiteDayAttendance(a.id, { ppe_ok: v }))} />
                      PPE
                    </label>
                    <div className="flex items-center justify-end gap-2">
                      {a.clock_in_at ? (
                        <span className={`font-mono text-sm tabular-nums ${working ? "text-emerald-300" : "text-slate-light"}`}>{elapsed(a.clock_in_at, a.clock_out_at, now)}</span>
                      ) : null}
                      {working && running ? (
                        <Btn tone="ghost" className="h-8 px-2" busy={busy === `out-${a.id}`} icon={<LogOut className="h-3.5 w-3.5" />}
                          onClick={() => void run(`out-${a.id}`, () => clockOutSiteDayAttendance(a.id))}>Out</Btn>
                      ) : null}
                      {editable ? (
                        <button aria-label={`Remove ${a.worker_name}`} disabled={busy === `rm-${a.id}`} onClick={() => void run(`rm-${a.id}`, () => removeSiteDayAttendance(a.id))}
                          className="p-2 text-slate hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          {/* toolbox */}
          <Panel step={2} done={!!briefing.toolbox_talk_completed && !!String(briefing.toolbox_topic ?? "").trim()} title="Toolbox talk"
            subtitle="What was covered with the team before work started.">
            <div className="space-y-3">
              <input value={toolbox.toolbox_topic} disabled={!editable} onChange={(e) => setToolbox({ ...toolbox, toolbox_topic: e.target.value })}
                onBlur={() => editable && toolbox.toolbox_topic !== (briefing.toolbox_topic ?? "") && void run("tb", () => updateSiteDay(briefing.id, { toolbox_topic: toolbox.toolbox_topic }))}
                placeholder="Topic, e.g. working at heights, excavation safety" className={fieldClass} />
              <textarea value={toolbox.toolbox_notes} disabled={!editable} onChange={(e) => setToolbox({ ...toolbox, toolbox_notes: e.target.value })}
                onBlur={() => editable && toolbox.toolbox_notes !== (briefing.toolbox_notes ?? "") && void run("tb", () => updateSiteDay(briefing.id, { toolbox_notes: toolbox.toolbox_notes }))}
                placeholder="Key points, hazards discussed, questions raised" className={`${areaClass} min-h-20`} />
              <div className="grid gap-2 sm:grid-cols-2">
                <CheckRow label="Toolbox talk done" checked={!!briefing.toolbox_talk_completed} disabled={!editable}
                  onChange={(v) => void run("tbc", () => updateSiteDay(briefing.id, { toolbox_talk_completed: v, toolbox_topic: toolbox.toolbox_topic || null }))} />
                <CheckRow label="PPE check done" checked={!!briefing.ppe_check_completed} disabled={!editable}
                  onChange={(v) => void run("ppec", () => updateSiteDay(briefing.id, { ppe_check_completed: v }))} />
              </div>
            </div>
          </Panel>

          {/* safety */}
          <Panel step={3} done={!briefing.safety_concern_raised || !!String(briefing.safety_actions ?? "").trim()} title="Safety on today's work"
            subtitle="Is there anything unsafe about the work planned today?">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button disabled={status === "closed"} onClick={() => { setLocalConcern(false); void run("sf", () => updateSiteDay(briefing.id, { safety_concern_raised: false })); }}
                  className={`flex items-center justify-center gap-2 border py-2.5 text-sm transition ${!briefing.safety_concern_raised && !localConcern ? "border-emerald-500 bg-emerald-950/30 text-emerald-200" : "border-ink-mid text-slate-light hover:border-emerald-500/60"}`}>
                  <ShieldCheck className="h-4 w-4" /> No concerns
                </button>
                <button disabled={status === "closed"} onClick={() => running ? setLocalConcern(true) : void run("sf", () => updateSiteDay(briefing.id, { safety_concern_raised: true, safety_concerns: safety.safety_concerns || null, safety_actions: safety.safety_actions || null }))}
                  className={`flex items-center justify-center gap-2 border py-2.5 text-sm transition ${briefing.safety_concern_raised || localConcern ? "border-red-500 bg-red-950/30 text-red-200" : "border-ink-mid text-slate-light hover:border-red-500/60"}`}>
                  <ShieldAlert className="h-4 w-4" /> Raise a concern
                </button>
              </div>
              {briefing.safety_concern_raised || localConcern ? (
                <>
                  <textarea value={safety.safety_concerns} disabled={status === "closed"} onChange={(e) => setSafety({ ...safety, safety_concerns: e.target.value })}
                    onBlur={() => safety.safety_concerns !== (briefing.safety_concerns ?? "") && (!running || !!safety.safety_actions.trim()) && void run("sc", () => updateSiteDay(briefing.id, { safety_concern_raised: true, safety_concerns: safety.safety_concerns, safety_actions: safety.safety_actions || null }))}
                    placeholder="What is the concern? (open trench, unstable scaffold, missing barricade…)" className={`${areaClass} min-h-16`} />
                  <textarea value={safety.safety_actions} disabled={status === "closed"} onChange={(e) => setSafety({ ...safety, safety_actions: e.target.value })}
                    onBlur={() => safety.safety_actions.trim() && safety.safety_actions !== (briefing.safety_actions ?? "") && void run("sa", () => updateSiteDay(briefing.id, { safety_concern_raised: true, safety_concerns: safety.safety_concerns, safety_actions: safety.safety_actions })).then((ok) => ok && setLocalConcern(false))}
                    placeholder="Action taken before work starts *" className={`${areaClass} min-h-16`} />
                  <p className="flex items-center gap-2 text-xs text-red-200"><MessageSquareWarning className="h-4 w-4" /> The HSE officer and project manager are notified.</p>
                </>
              ) : null}
            </div>
          </Panel>

          {/* start / close */}
          {status === "open" ? (
            <Panel step={4} done={false} title="Start the day" subtitle="Everyone on the register is clocked in the moment you start.">
              <ul className="mb-4 space-y-1.5">
                {checklist.map((c) => (
                  <li key={c.label} className={`flex items-center gap-2 text-sm ${c.done ? "text-emerald-300" : "text-slate-light"}`}>
                    {c.done ? <CheckCircle2 className="h-4 w-4" /> : <Square className="h-4 w-4 text-slate" />} {c.label}
                  </li>
                ))}
              </ul>
              <Btn className="w-full" tone="success" disabled={!ready} busy={busy === "start"} icon={<Play className="h-4 w-4" />}
                onClick={() => void run("start", () => startSiteDay(briefing.id))}>
                Start site day & clock in {attendance.length || ""}
              </Btn>
            </Panel>
          ) : running ? (
            <Panel title="End of day" subtitle="Clocks out everyone still on site and sends the hours to HR for acceptance and billing.">
              <Btn className="w-full" tone="danger" busy={busy === "close"} icon={<Square className="h-4 w-4" />}
                onClick={() => { if (window.confirm(`Clock out ${clockedIn} people and close the site day?`)) void run("close", () => closeSiteDay(briefing.id)); }}>
                Close site day
              </Btn>
            </Panel>
          ) : null}
          <TodayTargetsCard targets={day?.targets ?? []} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="text-right"><p className="text-[10px] uppercase tracking-widest text-slate">{label}</p><p className="text-xl text-paper tabular-nums">{value}</p></div>;
}

function CheckRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-3 border px-3 py-2 text-sm ${checked ? "border-emerald-500/50 text-emerald-200" : "border-ink-mid text-paper"}`}>
      {label}
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </label>
  );
}

function TodayTargetsCard({ targets }: { targets: ApiRecord[] }) {
  return (
    <Panel title="Today's targets" subtitle="From this week's budget. Brief the team on them.">
      {targets.length === 0 ? (
        <p className="text-sm text-slate-light">No targets for today. Break this week&apos;s budget into daily targets in the Budgets & Targets tab.</p>
      ) : (
        <ul className="space-y-2">
          {targets.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-paper">{t.work_package ? <b>{t.work_package}: </b> : null}{t.description}</span>
              <span className="shrink-0 font-mono text-signal">{qty(t.target_qty)} {t.unit}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
