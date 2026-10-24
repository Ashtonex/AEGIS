"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, Loader2, Mail, RefreshCw, Settings2, X } from "lucide-react";
import {
  computePerformanceWeek, getAssistedPeriods, getPerformanceSettings, getScorecard, getScorecardEmail, getScorecards,
  getScoredWeeks, overrideScorecard, resolveScorecardDispute, sendPerformanceDigest, updateAssistedPeriod,
  updatePerformanceSettings,
  type AssistedPeriod, type PerformanceSettings, type Scorecard, type ScoredWeek,
} from "@/lib/api";
import { AREAS, AreaGrid, GradeBadge, Narrative, StandingText, Trend, scoreText, scoreTone } from "@/components/people/PerformanceScorecard";
import { Field, formatDate, inputClass, primaryButton, secondaryButton } from "@/components/people/ui";

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : "The request could not be completed.");
const FLAGGED = ["would_assist", "assisted_opened", "assisted", "escalated"];

export function PerformancePanel() {
  const [settings, setSettings] = useState<PerformanceSettings | null>(null);
  const [weeks, setWeeks] = useState<ScoredWeek[]>([]);
  const [week, setWeek] = useState<string>("");
  const [cards, setCards] = useState<Scorecard[] | null>(null);
  const [scope, setScope] = useState<"all" | "team">("all");
  const [periods, setPeriods] = useState<AssistedPeriod[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadWeek = useCallback(async (weekEnd?: string) => {
    setCards(null);
    const r = await getScorecards(weekEnd || undefined);
    setCards(r.data.cards);
    setScope(r.data.scope ?? "all");
    if (r.data.week_end) setWeek(r.data.week_end);
  }, []);

  const load = useCallback(async (weekEnd?: string) => {
    setError("");
    try {
      const [s, w, p] = await Promise.all([getPerformanceSettings(), getScoredWeeks(), getAssistedPeriods()]);
      setSettings(s.data);
      setWeeks(w.data);
      setPeriods(p.data);
      await loadWeek(weekEnd);
    } catch (reason) {
      setCards([]);
      setError(`Scorecards could not be loaded. ${errorText(reason)}`);
    }
  }, [loadWeek]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("week") ?? undefined;
    void load(requested);
  }, [load]);

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };

  const latest = settings?.latest_complete_week_end;
  const scoreLatest = () => run("compute", async () => {
    const target = latest ?? week;
    const r = await computePerformanceWeek(target);
    await load(target);
    return r.message ?? "Week scored.";
  });
  const backfill = () => run("backfill", async () => {
    if (!latest) return "Nothing to score.";
    const thursdays = [3, 2, 1, 0].map((back) => {
      const d = new Date(`${latest}T12:00:00`);
      d.setDate(d.getDate() - back * 7);
      return d.toISOString().slice(0, 10);
    });
    for (const t of thursdays) await computePerformanceWeek(t);
    await load(latest);
    return `Scored the last ${thursdays.length} weeks. Shadow-mode history is ready to review.`;
  });
  const digest = () => run("digest", async () => (await sendPerformanceDigest(week)).message ?? "Digest sent.");

  const stats = useMemo(() => {
    const list = cards ?? [];
    const graded = list.map((c) => c.final_score).filter((s): s is number => s !== null);
    const par = settings?.par_score ?? 60;
    return {
      people: list.length,
      average: graded.length ? graded.reduce((a, b) => a + b, 0) / graded.length : null,
      below: graded.filter((s) => s < par).length,
      flagged: list.filter((c) => FLAGGED.includes(c.standing)).length,
      notGraded: list.length - graded.length,
      disputes: list.filter((c) => c.dispute_status === "open").length,
    };
  }, [cards, settings]);

  const sorted = useMemo(() => [...(cards ?? [])].sort((a, b) =>
    (a.final_score === null ? 1 : 0) - (b.final_score === null ? 1 : 0) || (a.final_score ?? 0) - (b.final_score ?? 0)), [cards]);

  const mode = cards?.[0]?.mode ?? settings?.mode;
  const canManage = !!settings?.can_manage;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select className={`${inputClass} w-56`} value={week} onChange={(e) => { setWeek(e.target.value); void loadWeek(e.target.value).catch((r) => setError(errorText(r))); }} aria-label="Week">
          {!weeks.length && <option value="">No weeks scored yet</option>}
          {weeks.map((w) => <option key={w.week_end} value={w.week_end}>Week ending {formatDate(w.week_end)}{w.mode === "shadow" ? " · shadow" : ""}</option>)}
        </select>
        {settings && (
          <span className={`rounded-sm border px-2 py-1 font-mono text-[11px] uppercase tracking-wider ${settings.mode === "live" ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}`}>
            {settings.mode === "live" ? `Live${settings.live_from ? ` from ${formatDate(settings.live_from)}` : ""}` : "Shadow mode"} · par {settings.par_score}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {canManage && (
            <>
              <button className={secondaryButton} onClick={backfill} disabled={!!busy}>{busy === "backfill" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Score last 4 weeks</button>
              <button className={secondaryButton} onClick={scoreLatest} disabled={!!busy}>{busy === "compute" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Score latest week</button>
              <button className={secondaryButton} onClick={digest} disabled={!!busy || !week}>{busy === "digest" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Email digest</button>
              <button className={secondaryButton} onClick={() => setShowSettings(true)}><Settings2 className="h-4 w-4" />Settings</button>
            </>
          )}
        </div>
      </div>

      {error && <p role="alert" className="rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</p>}
      {notice && <p className="rounded-sm border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200">{notice}</p>}
      {mode === "shadow" && (
        <p className="rounded-sm border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
          <strong>Shadow mode.</strong> Scores are computed every Friday at 07:00 but only the management digest is emailed - staff see nothing yet.
          &ldquo;Would enter assisted working&rdquo; shows who live mode would have put on a two-week assisted working period.
          When the scores match what you know, switch to live in Settings.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["People", String(stats.people)],
          ["Average", scoreText(stats.average)],
          [`Below par (${settings?.par_score ?? 60})`, String(stats.below)],
          ["Assisted / would be", String(stats.flagged)],
          ["Not graded", String(stats.notGraded)],
          ["Open disputes", String(stats.disputes)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-sm border border-ink-mid bg-ink-light p-3">
            <div className="font-mono text-[11px] uppercase tracking-wider text-slate">{label}</div>
            <div className="mt-1 font-mono text-xl text-paper">{value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-ink-mid bg-ink-light">
        <div className="flex items-center justify-between border-b border-ink-mid px-4 py-3">
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-slate">{scope === "team" ? "Your team's scorecards" : "Weekly scorecards"}, lowest first</h3>
          <span className="font-mono text-xs text-slate">{week ? `${formatDate(week)}` : ""}</span>
        </div>
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">
            <tr>
              <th className="p-3">Person</th><th className="p-3">Grade</th>
              {AREAS.map((a) => <th key={a} className="p-3 text-right">{settings?.labels[a] ?? a}</th>)}
              <th className="p-3">Trend</th><th className="p-3">Standing</th><th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-mid">
            {cards === null ? <tr><td colSpan={10} className="p-4"><Loader2 className="h-5 w-5 animate-spin text-signal" /></td></tr>
              : !sorted.length ? <tr><td colSpan={10} className="p-6 text-center text-slate-light">{canManage ? "No week has been scored yet. Use “Score last 4 weeks” to build the shadow history now." : "No scorecards for your team yet."}</td></tr>
              : sorted.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-ink-mid/20" onClick={() => setOpenId(c.id)}>
                  <td className="p-3">
                    <span className="text-paper">{c.employee_name}</span>
                    <span className="block text-xs text-slate">{c.job_title || "—"}{c.manager_name ? ` · reports to ${c.manager_name}` : ""}</span>
                  </td>
                  <td className="p-3">
                    <GradeBadge grade={c.final_grade} score={c.final_score} />
                    {c.override_score !== null && <span className="ml-1 text-[10px] uppercase text-signal" title={c.override_reason ?? ""}>adj.</span>}
                  </td>
                  {AREAS.map((a) => {
                    const s = c.components[a]?.score ?? null;
                    return <td key={a} className={`p-3 text-right font-mono ${scoreTone(s)}`}>{s === null ? "—" : scoreText(s)}</td>;
                  })}
                  <td className="p-3"><Trend values={c.trend} /></td>
                  <td className="p-3"><StandingText card={c} />{c.dispute_status === "open" && <span className="ml-2 inline-flex items-center gap-1 text-xs text-red-300"><AlertTriangle className="h-3 w-3" />Disputed</span>}</td>
                  <td className="p-3 text-right"><Eye className="inline h-4 w-4 text-slate" /></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <AssistedWorking periods={periods} canManage={canManage} onChanged={() => void getAssistedPeriods().then((r) => setPeriods(r.data))} />

      {openId && settings && (
        <ScorecardModal id={openId} settings={settings} onClose={() => setOpenId(null)} onChanged={() => void load(week)} />
      )}
      {showSettings && settings && (
        <SettingsModal settings={settings} onClose={() => setShowSettings(false)} onSaved={(s) => { setSettings({ ...settings, ...s }); setShowSettings(false); void load(week); }} />
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={`my-8 w-full ${wide ? "max-w-5xl" : "max-w-lg"} rounded-lg border border-ink-mid bg-ink-light`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-3">
          <h3 className="text-base font-semibold text-paper">{title}</h3>
          <button className="text-slate hover:text-paper" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 p-5">{children}</div>
      </div>
    </div>
  );
}

function ScorecardModal({ id, settings, onClose, onChanged }: { id: string; settings: PerformanceSettings; onClose: () => void; onChanged: () => void }) {
  const [card, setCard] = useState<Scorecard | null>(null);
  const [email, setEmail] = useState<{ subject: string; html: string; to: string | null } | null>(null);
  const [score, setScore] = useState("");
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => getScorecard(id).then((r) => setCard(r.data)).catch((reason) => setError(errorText(reason))), [id]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const canOverride = card?.access === "manage" || card?.access === "manager";
  return (
    <Modal title={card ? `${card.employee_name} · week ending ${formatDate(card.week_end)}` : "Scorecard"} onClose={onClose} wide>
      {error && <p role="alert" className="rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</p>}
      {!card ? <Loader2 className="h-5 w-5 animate-spin text-signal" /> : (
        <>
          <div className="flex flex-wrap items-center gap-6">
            <GradeBadge grade={card.final_grade} score={card.final_score} size="lg" />
            <div className="space-y-1 text-sm">
              <div><StandingText card={card} /></div>
              <div className="text-slate-light">Par {settings.par_score} · {card.mode === "shadow" ? "Shadow week (not sent to staff)" : card.emailed_at ? `Emailed ${formatDate(card.emailed_at)}` : "Not emailed yet"}</div>
              {card.override_score !== null && <div className="text-signal">Adjusted from {scoreText(card.score)}: {card.override_reason}</div>}
            </div>
            <div className="ml-auto"><Trend values={card.trend} /></div>
          </div>
          <AreaGrid card={card} />
          <Narrative card={card} />

          {card.assisted_period && (
            <div className="rounded-sm border border-orange-500/30 bg-orange-950/20 p-3 text-sm text-orange-100">
              Assisted working period ({card.assisted_period.status}): weeks ending {formatDate(card.assisted_period.first_week_end)} to {formatDate(card.assisted_period.last_week_end)}. Target: {card.assisted_period.targets}
            </div>
          )}

          {card.dispute_status && (
            <div className="space-y-2 rounded-sm border border-red-500/30 bg-red-950/20 p-3 text-sm">
              <div className="text-red-200"><strong>Dispute ({card.dispute_status}):</strong> {card.dispute_note}</div>
              {card.dispute_resolution && <div className="text-slate-light">Resolution: {card.dispute_resolution}</div>}
              {card.dispute_status === "open" && card.access === "manage" && (
                <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto_auto]">
                  <input className={inputClass} placeholder="Resolution (sent to the employee)" value={resolution} onChange={(e) => setResolution(e.target.value)} />
                  <input className={inputClass} type="number" min={0} max={100} placeholder="New score" value={score} onChange={(e) => setScore(e.target.value)} />
                  <button className={primaryButton} disabled={busy || resolution.length < 5} onClick={() => act(() => resolveScorecardDispute(card.id, "upheld", resolution, score === "" ? null : Number(score)))}>Uphold</button>
                  <button className={secondaryButton} disabled={busy || resolution.length < 5} onClick={() => act(() => resolveScorecardDispute(card.id, "rejected", resolution))}>Reject</button>
                </div>
              )}
            </div>
          )}

          {canOverride && card.dispute_status !== "open" && (
            <div className="space-y-2 rounded-sm border border-ink-mid p-3">
              <h4 className="font-mono text-[11px] uppercase tracking-wider text-slate">Override the score</h4>
              <p className="text-xs text-slate">Every override is recorded with your name and reason{card.access === "manager" ? ", and HR is notified" : ""}. It can move someone between good and watch, or cancel an assisted working period this week opened; it never opens one.</p>
              <div className="grid gap-2 sm:grid-cols-[120px_1fr_auto_auto]">
                <input className={inputClass} type="number" min={0} max={100} placeholder="Score" value={score} onChange={(e) => setScore(e.target.value)} />
                <input className={inputClass} placeholder="Reason (at least 10 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button className={primaryButton} disabled={busy || score === "" || reason.length < 10} onClick={() => act(() => overrideScorecard(card.id, Number(score), reason))}>Override</button>
                {card.override_score !== null && <button className={secondaryButton} disabled={busy || reason.length < 10} onClick={() => act(() => overrideScorecard(card.id, null, reason))}>Clear</button>}
              </div>
            </div>
          )}

          <div>
            <button className={secondaryButton} onClick={() => email ? setEmail(null) : void getScorecardEmail(card.id).then((r) => setEmail(r.data)).catch((reason) => setError(errorText(reason)))}>
              <Mail className="h-4 w-4" />{email ? "Hide email" : "Preview their email"}
            </button>
            {email && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-slate-light"><strong>To:</strong> {email.to ?? "no address"} · <strong>Subject:</strong> {email.subject}</p>
                <iframe title="Email preview" sandbox="" srcDoc={email.html} className="h-[640px] w-full rounded-sm border border-ink-mid bg-white" />
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function SettingsModal({ settings, onClose, onSaved }: { settings: PerformanceSettings; onClose: () => void; onSaved: (s: Partial<PerformanceSettings>) => void }) {
  const [par, setPar] = useState(String(settings.par_score));
  const [mode, setMode] = useState(settings.mode);
  const [liveFrom, setLiveFrom] = useState(settings.live_from ?? "");
  const [recipients, setRecipients] = useState(settings.digest_recipients);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await updatePerformanceSettings({ par_score: Number(par), mode, live_from: liveFrom || null, digest_recipients: recipients });
      onSaved(r.data);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Scorecard settings" onClose={onClose}>
      {error && <p role="alert" className="rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</p>}
      <Field label="Par score" hint="Below this is below par. Two live weeks below par in a row opens an assisted working period.">
        <input className={inputClass} type="number" min={0} max={100} value={par} onChange={(e) => setPar(e.target.value)} />
      </Field>
      <Field label="Mode" hint="Shadow: computed and emailed to management only. Live: every employee and line manager gets their email on Friday at 07:00.">
        <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as "shadow" | "live")}>
          <option value="shadow">Shadow</option>
          <option value="live">Live</option>
        </select>
      </Field>
      <Field label="Live from (week ending, a Thursday)" hint="Leave blank to go live from the next Friday run.">
        <input className={inputClass} type="date" value={liveFrom} onChange={(e) => setLiveFrom(e.target.value)} />
      </Field>
      <Field label="Digest recipients" hint={`Comma-separated logins. Blank uses: ${settings.default_digest_recipients.join(", ")}`}>
        <input className={inputClass} value={recipients} onChange={(e) => setRecipients(e.target.value)} />
      </Field>
      {mode === "live" && settings.mode !== "live" && (
        <p className="rounded-sm border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
          Going live means every employee gets a graded email on Friday morning. The first live week is the baseline - nobody can enter assisted working until two live weeks are below par.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button className={secondaryButton} onClick={onClose}>Cancel</button>
        <button className={primaryButton} onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
      </div>
    </Modal>
  );
}

function AssistedWorking({ periods, canManage, onChanged }: { periods: AssistedPeriod[]; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const save = async (id: string, payload: Parameters<typeof updateAssistedPeriod>[1]) => {
    setError("");
    try {
      await updateAssistedPeriod(id, payload);
      setEditing(null);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  return (
    <div className="rounded-lg border border-ink-mid bg-ink-light">
      <div className="border-b border-ink-mid px-4 py-3">
        <h3 className="font-mono text-[11px] uppercase tracking-wider text-slate">Assisted working periods</h3>
        <p className="mt-1 text-xs text-slate">Two live weeks below par opens two weeks of supervised work with the line manager. Missing the target escalates to HR - HR decides the outcome after a hearing, not the system.</p>
      </div>
      {error && <p role="alert" className="m-4 rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</p>}
      {!periods.length ? <p className="p-6 text-center text-sm text-slate-light">No assisted working periods.</p> : (
        <div className="divide-y divide-ink-mid">
          {periods.map((p) => (
            <div key={p.id} className="space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-paper">{p.employee_name}</span>
                <span className={`rounded-sm border px-2 py-0.5 text-[11px] uppercase ${p.status === "escalated" ? "border-red-500/40 text-red-300" : p.status === "active" ? "border-orange-500/40 text-orange-300" : "border-ink-mid text-slate-light"}`}>{p.status}</span>
                <span className="text-slate-light">Supervisor: {p.supervisor_name ?? "No line manager set"}</span>
                <span className="text-slate">Weeks ending {formatDate(p.first_week_end)} - {formatDate(p.last_week_end)}</span>
              </div>
              <p className="text-slate-light">Target: {p.targets}</p>
              {p.outcome_note && <p className="text-slate-light">Outcome: {p.outcome_note}</p>}
              {editing === p.id ? (
                <div className="space-y-2">
                  <textarea className={`${inputClass} min-h-24`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Check-in notes: what was agreed, support given, progress seen" />
                  <div className="flex gap-2">
                    <button className={primaryButton} onClick={() => save(p.id, { supervisor_notes: notes })}>Save notes</button>
                    <button className={secondaryButton} onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  {p.supervisor_notes && <p className="whitespace-pre-wrap rounded-sm bg-ink p-2 text-slate-light">{p.supervisor_notes}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button className={secondaryButton} onClick={() => { setEditing(p.id); setNotes(p.supervisor_notes ?? ""); }}>Check-in notes</button>
                    {canManage && ["active", "escalated"].includes(p.status) && (
                      <>
                        <button className={secondaryButton} onClick={() => save(p.id, { status: "passed", outcome_note: "Closed by HR: improvement accepted." })}>Mark passed</button>
                        <button className={secondaryButton} onClick={() => save(p.id, { status: "cancelled", outcome_note: "Cancelled by HR." })}>Cancel period</button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
