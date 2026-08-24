"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarCheck, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";

import { decideWeeklySiteBudget, getWeeklySiteBudgets } from "@/lib/api";

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

function dateLabel(value: unknown) {
  if (!value) return "No date";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { dateStyle: "medium" }).format(date);
}

function errMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function SiteAgentPortalHome() {
  const [budgets, setBudgets] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getWeeklySiteBudgets({ status: "submitted" });
      setBudgets(Array.isArray(result.data) ? result.data : []);
    } catch (loadError) {
      setError(errMessage(loadError, "Site Agent weekly budget queue could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: "approved" | "rejected") {
    setSaving(`${id}:${decision}`);
    setNotice(null);
    setError(null);
    try {
      await decideWeeklySiteBudget(id, decision, notes[id] || (decision === "approved" ? "Practicality and programme impact accepted." : "Weekly plan is not executable as submitted."));
      setNotice(decision === "approved" ? "Weekly execution plan approved." : "Weekly execution plan rejected for correction.");
      await load();
    } catch (decisionError) {
      setError(errMessage(decisionError, "Site Agent decision could not be saved."));
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="min-h-screen bg-ink text-paper">
      <section className="border-b border-ink-mid bg-ink-light">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Programme control</p>
            <h1 className="mt-2 font-display text-3xl sm:text-4xl">Site Agent Portal</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-light">
              Confirm weekly execution practicality, site coordination, constraints and programme impact before work packages proceed.
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
            <h2 className="text-lg font-semibold">Weekly execution plans</h2>
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-light">{budgets.length} awaiting decision</span>
          </div>
          {budgets.length ? (
            <div className="divide-y divide-ink-mid">
              {budgets.map((budget) => (
                <article key={budget.id} className="grid gap-4 p-4 xl:grid-cols-[1fr_320px]">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-signal">{dateLabel(budget.week_start)} · {text(budget.status, "submitted")}</p>
                    <h3 className="mt-1 font-semibold">{text(budget.project_name, "Project")} · {text(budget.site_name, "Site")}</h3>
                    <p className="mt-2 text-sm text-slate-light">{text(budget.work_plan, "No work plan recorded.")}</p>
                    <p className="mt-2 text-xs text-slate-light">Planned value {money(budget.total_planned_amount)} · variance gates {text(budget.variance_count, "0")}</p>
                    {num(budget.variance_count) > 0 ? <p className="mt-2 border border-amber-500/30 bg-amber-950/20 p-2 text-xs text-amber-100">This plan contains variance gates. Approval confirms execution practicality only; QS/client gates still control commercial release.</p> : null}
                  </div>
                  <div className="space-y-3">
                    <Field label="Site Agent notes"><textarea rows={4} value={notes[budget.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [budget.id]: event.target.value }))} className="textarea" /></Field>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void decide(budget.id, "approved")} disabled={Boolean(saving)} className="inline-flex h-9 flex-1 items-center justify-center gap-2 bg-signal px-3 font-mono text-[10px] uppercase tracking-widest text-ink disabled:opacity-50">
                        {saving === `${budget.id}:approved` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarCheck className="h-3.5 w-3.5" />}
                        Approve
                      </button>
                      <button type="button" onClick={() => void decide(budget.id, "rejected")} disabled={Boolean(saving)} className="inline-flex h-9 flex-1 items-center justify-center gap-2 border border-red-500/40 px-3 font-mono text-[10px] uppercase tracking-widest text-red-200 disabled:opacity-50">
                        <XCircle className="h-3.5 w-3.5" />
                        Reject
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="p-5 text-sm text-slate-light">No weekly execution plans are waiting for Site Agent review.</p>
          )}
        </div>
      </section>
      <style jsx>{`.textarea{width:100%;resize:none;border:1px solid rgb(47 55 69);background:#09111f;padding:.75rem;font-size:.875rem;color:#f8fafc;outline:none}`}</style>
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
