"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { AlertTriangle, BadgeDollarSign, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";

import { getSiteVariances, reviewSiteVarianceQs } from "@/lib/api";

type Rec = Record<string, any> & { id: string };

function text(value: unknown, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num(value));
}

function errMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function QsPortalHome() {
  const [variances, setVariances] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Record<string, { cost_impact: string; time_impact_days: string; notes: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getSiteVariances({ status: "submitted" });
      setVariances(Array.isArray(result.data) ? result.data : []);
    } catch (loadError) {
      setError(errMessage(loadError, "QS variance queue could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: "reviewed" | "rejected") {
    const draft = review[id] ?? { cost_impact: "0", time_impact_days: "0", notes: "" };
    setSaving(`${id}:${decision}`);
    setNotice(null);
    setError(null);
    try {
      await reviewSiteVarianceQs(id, {
        decision,
        cost_impact: num(draft.cost_impact),
        time_impact_days: Math.trunc(num(draft.time_impact_days)),
        notes: draft.notes || null,
      });
      setNotice(decision === "reviewed" ? "QS entitlement review saved." : "Variance rejected for correction.");
      await load();
    } catch (reviewError) {
      setError(errMessage(reviewError, "QS review could not be saved."));
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="min-h-screen bg-ink text-paper">
      <section className="border-b border-ink-mid bg-ink-light">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Commercial control</p>
            <h1 className="mt-2 font-display text-3xl sm:text-4xl">QS Portal</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-light">
              Review site-originated variances, price entitlement, and keep master budget authority separate from weekly site execution.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 border border-ink-mid px-4 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {notice ? <Banner tone="success">{notice}</Banner> : null}
        <div className="border border-ink-mid bg-ink-light">
          <div className="flex items-center justify-between border-b border-ink-mid p-4">
            <h2 className="text-lg font-semibold">Variance entitlement queue</h2>
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-light">{variances.length} open</span>
          </div>
          {variances.length ? (
            <div className="divide-y divide-ink-mid">
              {variances.map((variance) => {
                const draft = review[variance.id] ?? { cost_impact: String(variance.cost_impact ?? "0"), time_impact_days: String(variance.time_impact_days ?? "0"), notes: "" };
                return (
                  <article key={variance.id} className="grid gap-4 p-4 xl:grid-cols-[1fr_320px]">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">{text(variance.variance_number)} · {text(variance.variance_classification)}</p>
                      <h3 className="mt-1 font-semibold">{text(variance.title ?? variance.weekly_budget_description, "Variance")}</h3>
                      <p className="mt-2 text-sm text-slate-light">{text(variance.description)}</p>
                      <p className="mt-2 text-xs text-slate-light">{text(variance.project_name, "Project")} · planned {text(variance.planned_qty)} · available {text(variance.available_qty)} · current estimate {money(variance.cost_impact)}</p>
                      {variance.proceed_at_risk ? <p className="mt-2 border border-amber-500/30 bg-amber-950/20 p-2 text-xs text-amber-100">PROCEED AT RISK · formal approval due {text(variance.formal_approval_deadline, "not set")}</p> : null}
                    </div>
                    <div className="space-y-3">
                      <Field label="QS cost impact"><input value={draft.cost_impact} onChange={(event) => setReview((current) => ({ ...current, [variance.id]: { ...draft, cost_impact: event.target.value } }))} className="field" /></Field>
                      <Field label="Time impact days"><input value={draft.time_impact_days} onChange={(event) => setReview((current) => ({ ...current, [variance.id]: { ...draft, time_impact_days: event.target.value } }))} className="field" /></Field>
                      <Field label="Entitlement notes"><textarea rows={3} value={draft.notes} onChange={(event) => setReview((current) => ({ ...current, [variance.id]: { ...draft, notes: event.target.value } }))} className="textarea" /></Field>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void decide(variance.id, "reviewed")} disabled={Boolean(saving)} className="inline-flex h-9 flex-1 items-center justify-center gap-2 bg-signal px-3 font-mono text-[10px] uppercase tracking-widest text-ink disabled:opacity-50">
                          {saving === `${variance.id}:reviewed` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeDollarSign className="h-3.5 w-3.5" />}
                          Reviewed
                        </button>
                        <button type="button" onClick={() => void decide(variance.id, "rejected")} disabled={Boolean(saving)} className="inline-flex h-9 flex-1 items-center justify-center gap-2 border border-red-500/40 px-3 font-mono text-[10px] uppercase tracking-widest text-red-200 disabled:opacity-50">
                          <XCircle className="h-3.5 w-3.5" />
                          Reject
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="p-5 text-sm text-slate-light">No site-originated variances are waiting for QS review.</p>
          )}
        </div>
      </section>
      <style jsx>{`.field{height:2.5rem;width:100%;border:1px solid rgb(47 55 69);background:#09111f;padding:0 .75rem;font-size:.875rem;color:#f8fafc;outline:none}.textarea{width:100%;resize:none;border:1px solid rgb(47 55 69);background:#09111f;padding:.75rem;font-size:.875rem;color:#f8fafc;outline:none}`}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="font-mono text-[10px] uppercase tracking-widest text-slate-light">{label}</span><div className="mt-2">{children}</div></label>;
}

function Banner({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const cls = tone === "error" ? "border-red-500/30 bg-red-950/30 text-red-200" : "border-emerald-500/30 bg-emerald-950/20 text-emerald-200";
  return <div className={`mb-4 flex gap-3 border p-4 text-sm ${cls}`}>{tone === "error" ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}<span>{children}</span></div>;
}
