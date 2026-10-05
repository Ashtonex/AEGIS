"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, Loader2, X } from "lucide-react";
import { confirmMyWeek, getMyWeek, type WeekDay, type WeekView } from "@/lib/api";
import { formatDate, humanise, inputClass, primaryButton, secondaryButton } from "./ui";

const KIND_STYLE: Record<WeekDay["kind"], string> = {
  worked: "text-emerald-300",
  absent: "text-red-300",
  leave: "text-blue-300",
  holiday: "text-violet-300",
  weekend: "text-slate",
  future: "text-slate",
};

function label(day: WeekDay) {
  if (day.kind === "leave") return `On ${humanise(day.leave_type)} leave`;
  if (day.kind === "holiday") return day.holiday || "Public holiday";
  if (day.kind === "absent") return "No sign-in";
  if (day.kind === "weekend") return day.check_in ? "Weekend (signed in)" : "Weekend";
  if (day.kind === "future") return "Not yet";
  return day.check_in ? `${day.check_in} – ${day.check_out ?? "16:30"}${day.auto_closed ? " (auto)" : ""}` : "Recorded";
}

/** Saturday–Friday hours: the employee confirms or corrects (with a reason). Scrolls inside itself. */
export function WeeklyHoursModal({ weekEnd, onClose, onDone }: { weekEnd?: string; onClose: () => void; onDone?: () => void }) {
  const [week, setWeek] = useState<WeekView | null>(null);
  const [hours, setHours] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    let active = true;
    getMyWeek(weekEnd)
      .then((r) => {
        if (!active) return;
        setWeek(r.data);
        const source = r.data.confirmation?.days?.length ? r.data.confirmation.days : r.data.days;
        setHours(Object.fromEntries(source.map((d) => [d.date, String(d.confirmed_hours ?? d.recorded_hours)])));
        setNotes(Object.fromEntries(source.filter((d) => d.note).map((d) => [d.date, d.note as string])));
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Your week could not be loaded."); });
    return () => { active = false; };
  }, [weekEnd]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  const total = useMemo(() => Object.values(hours).reduce((s, h) => s + (Number(h) || 0), 0), [hours]);
  const locked = week?.confirmation?.status === "approved";
  // A week can be confirmed from its Friday (Harare time) onwards.
  const isFutureWeek = week ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare" }).format(new Date()) < week.week_end : false;

  async function submit() {
    if (!week) return;
    setBusy(true); setError("");
    try {
      const days = week.days.map((d) => ({ date: d.date, hours: Number(hours[d.date] ?? d.recorded_hours) || 0, note: notes[d.date] || undefined }));
      const result = await confirmMyWeek(week.week_end, days);
      setWeek(result.data.week);
      setDone(`Submitted ${result.data.confirmed_hours} hours${result.data.corrections ? ` with ${result.data.corrections} correction(s)` : ""}. Your line manager has been told.`);
      onDone?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not submit your week.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6">
      <div role="dialog" aria-modal="true" aria-label="Confirm your hours for the week" className="flex h-full w-full max-w-3xl flex-col overflow-hidden border border-ink-mid bg-ink-light shadow-2xl sm:h-auto sm:max-h-[88vh] sm:rounded-lg">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink-mid px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-paper"><CalendarCheck className="h-5 w-5 text-signal" />Your hours this week</h2>
            {week && <p className="text-sm text-slate-light">{formatDate(week.week_start)} to {formatDate(week.week_end)}. Check them, fix anything wrong, and confirm.</p>}
          </div>
          <button onClick={onClose} className="rounded-sm p-2 text-slate hover:bg-ink-mid/40 hover:text-paper" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="mb-3 rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</p>}
          {done && <p role="status" className="mb-3 rounded-sm border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{done}</p>}
          {!week ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-signal" /></div> : (
            <>
              {week.confirmation && (
                <p className="mb-3 text-sm text-slate-light">
                  Status: <strong className="text-paper">{humanise(week.confirmation.status)}</strong>
                  {week.confirmation.decision_note ? ` · "${week.confirmation.decision_note}"` : ""}
                </p>
              )}
              <ul className="divide-y divide-ink-mid rounded-sm border border-ink-mid">
                {week.days.map((d) => {
                  const value = hours[d.date] ?? String(d.recorded_hours);
                  const changed = Math.abs((Number(value) || 0) - d.recorded_hours) >= 0.01;
                  const fixed = d.kind === "leave" || d.kind === "future" || locked;
                  return (
                    <li key={d.date} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[8rem_1fr_6rem] sm:items-center">
                      <div>
                        <p className="text-sm font-medium text-paper">{d.weekday}</p>
                        <p className="text-xs text-slate">{formatDate(d.date)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm ${KIND_STYLE[d.kind]}`}>{label(d)}</p>
                        <p className="text-xs text-slate">AEGIS recorded {d.recorded_hours}h</p>
                        {changed && !fixed && (
                          <input
                            className={`${inputClass} mt-1 min-h-8 py-1 text-xs`}
                            placeholder="Why is this different? e.g. on site without a laptop"
                            value={notes[d.date] ?? ""}
                            onChange={(e) => setNotes((n) => ({ ...n, [d.date]: e.target.value }))}
                            maxLength={500}
                          />
                        )}
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={16}
                        step={0.25}
                        className={`${inputClass} text-right font-mono ${changed ? "border-signal/60" : ""}`}
                        value={d.kind === "leave" ? "0" : value}
                        onChange={(e) => setHours((h) => ({ ...h, [d.date]: e.target.value }))}
                        disabled={fixed}
                        aria-label={`Hours on ${d.weekday}`}
                      />
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-sm border border-ink-mid p-2"><p className="text-xs text-slate">Recorded</p><p className="font-mono text-paper">{week.recorded_hours}h</p></div>
                <div className="rounded-sm border border-ink-mid p-2"><p className="text-xs text-slate">You are confirming</p><p className="font-mono text-signal">{Math.round(total * 100) / 100}h</p></div>
                <div className="rounded-sm border border-ink-mid p-2"><p className="text-xs text-slate">Leave days</p><p className="font-mono text-blue-300">{week.leave_days}</p></div>
              </div>
              <p className="mt-3 text-xs text-slate">Time counts from your first AEGIS sign-in each day until 16:30. Leave days are left out automatically.</p>
            </>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-ink-mid px-5 py-3">
          <button className={secondaryButton} onClick={onClose}>{done || locked ? "Close" : "Remind me later"}</button>
          {!locked && !done && <button className={primaryButton} onClick={() => void submit()} disabled={busy || !week || isFutureWeek}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Confirm my week</button>}
        </div>
      </div>
    </div>
  );
}
