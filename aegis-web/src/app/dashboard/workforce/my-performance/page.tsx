"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { disputeScorecard, getMyScorecards, type Scorecard } from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { AreaGrid, GradeBadge, Narrative, StandingText, Trend } from "@/components/people/PerformanceScorecard";
import { formatDate, inputClass, primaryButton, secondaryButton } from "@/components/people/ui";

const DISPUTE_HOURS = 48;
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : "Your scorecards could not be loaded.");

export default function MyPerformancePage() {
  const [cards, setCards] = useState<Scorecard[] | null>(null);
  const [linked, setLinked] = useState(true);
  const [par, setPar] = useState(60);
  const [selected, setSelected] = useState(0);
  const [note, setNote] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await getMyScorecards();
      setLinked(r.data.linked);
      setPar(r.data.par_score ?? 60);
      setCards(r.data.cards);
    } catch (reason) {
      setCards([]);
      setError(errorText(reason));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const card = cards?.[selected];
  const trend = cards ? cards.slice(0, 8).map((c) => c.final_score).reverse() : [];
  const canDispute = !!card && !card.dispute_status && !!card.emailed_at
    && Date.now() - new Date(card.emailed_at).getTime() < DISPUTE_HOURS * 3600 * 1000;

  const submitDispute = async () => {
    if (!card) return;
    setBusy(true);
    setError("");
    try {
      setNotice((await disputeScorecard(card.id, note)).message ?? "Dispute sent.");
      setDisputing(false);
      setNote("");
      await load();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <DashboardPageHeader
        className="mb-0 border-b-0 pb-0"
        title="My Performance"
        subtitle={`Your weekly scorecard, graded every Friday from what AEGIS recorded. Par is ${par}.`}
      />
      {cards === null && <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-signal" /></div>}
      {error && <p role="alert" className="rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</p>}
      {notice && <p className="rounded-sm border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200">{notice}</p>}
      {cards !== null && !linked && (
        <p className="rounded-sm border border-ink-mid bg-ink-light p-5 text-sm text-slate-light">Your login is not linked to a person record yet. HR needs to link it in the People Register.</p>
      )}
      {cards !== null && linked && !cards.length && (
        <p className="rounded-sm border border-ink-mid bg-ink-light p-5 text-sm text-slate-light">No scorecards have been issued to you yet. They arrive every Friday morning.</p>
      )}
      {card && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select className={`${inputClass} w-60`} value={selected} onChange={(e) => { setSelected(Number(e.target.value)); setDisputing(false); }} aria-label="Week">
              {cards!.map((c, i) => <option key={c.id} value={i}>Week ending {formatDate(c.week_end)}</option>)}
            </select>
            <Trend values={trend} />
          </div>

          <section className="flex flex-wrap items-center gap-6 rounded-sm border border-ink-mid bg-ink-light p-5">
            <GradeBadge grade={card.final_grade} score={card.final_score} size="lg" />
            <div className="space-y-1 text-sm">
              <StandingText card={card} />
              <div className="text-slate-light">Friday {formatDate(card.week_start)} to Thursday {formatDate(card.week_end)}</div>
              {card.override_score !== null && <div className="text-signal">Adjusted by management: {card.override_reason}</div>}
            </div>
            <dl className="ml-auto grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-slate">Bonus</dt><dd className="text-paper">N/A</dd>
              <dt className="text-slate">Salary increase</dt><dd className="text-paper">N/A</dd>
            </dl>
          </section>

          <AreaGrid card={card} />
          <section className="rounded-sm border border-ink-mid bg-ink-light p-5"><Narrative card={card} /></section>

          <section className="space-y-3 rounded-sm border border-ink-mid bg-ink-light p-5 text-sm">
            <h3 className="font-mono text-[11px] uppercase tracking-wider text-slate">Contest this week</h3>
            {card.dispute_status ? (
              <div className="space-y-1">
                <p className="text-slate-light"><strong className="text-paper">Your dispute ({card.dispute_status}):</strong> {card.dispute_note}</p>
                {card.dispute_resolution && <p className="text-slate-light"><strong className="text-paper">HR&apos;s answer:</strong> {card.dispute_resolution}</p>}
              </div>
            ) : canDispute ? (
              disputing ? (
                <div className="space-y-2">
                  <textarea className={`${inputClass} min-h-24`} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Which line is wrong and why - e.g. “Delivery: the Troutbeck BOQ task was closed on Tuesday, before its due date.”" />
                  <div className="flex gap-2">
                    <button className={primaryButton} disabled={busy || note.trim().length < 10} onClick={submitDispute}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send to HR and my line manager</button>
                    <button className={secondaryButton} onClick={() => setDisputing(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-slate-light">If something on this scorecard is wrong you have {DISPUTE_HOURS} hours from when it was emailed to say so.</p>
                  <button className={secondaryButton} onClick={() => setDisputing(true)}>Dispute a line</button>
                </div>
              )
            ) : (
              <p className="text-slate">The {DISPUTE_HOURS}-hour window to contest this week has closed.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
