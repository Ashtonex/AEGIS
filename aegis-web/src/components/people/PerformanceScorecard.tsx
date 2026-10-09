"use client";

import type { ReactNode } from "react";
import type { PerformanceAreaKey, Scorecard } from "@/lib/api";
import { formatDate } from "./ui";

export const AREAS: PerformanceAreaKey[] = ["delivery", "reliability", "records", "responsiveness", "output"];

const GRADE_TONE: Record<string, string> = {
  A: "border-emerald-500/40 bg-emerald-950/40 text-emerald-300",
  B: "border-green-500/40 bg-green-950/30 text-green-300",
  C: "border-amber-500/40 bg-amber-950/30 text-amber-300",
  D: "border-orange-500/40 bg-orange-950/30 text-orange-300",
  F: "border-red-500/40 bg-red-950/30 text-red-300",
};

const STANDING_TONE: Record<string, string> = {
  good: "text-emerald-300",
  passed: "text-emerald-300",
  watch: "text-amber-300",
  would_assist: "text-orange-300",
  assisted_opened: "text-orange-300",
  assisted: "text-orange-300",
  escalated: "text-red-300",
  insufficient_data: "text-slate",
  not_onboarded: "text-slate",
};

export const scoreText = (value: number | string | null | undefined) =>
  value === null || value === undefined ? "–" : Math.round(Number(value)).toString();

export function scoreTone(value: number | null | undefined) {
  if (value === null || value === undefined) return "text-slate";
  if (value < 60) return "text-red-300";
  if (value < 85) return "text-amber-300";
  return "text-emerald-300";
}

export function GradeBadge({ grade, score, size = "sm" }: { grade: string | null; score: number | null; size?: "sm" | "lg" }) {
  if (!grade) return <span className="text-xs text-slate">Not graded</span>;
  const big = size === "lg";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center justify-center rounded-sm border font-bold ${GRADE_TONE[grade] ?? ""} ${big ? "h-12 w-12 text-2xl" : "h-7 w-7 text-sm"}`}>{grade}</span>
      <span className={`font-mono ${big ? "text-2xl text-paper" : "text-sm text-paper"}`}>{scoreText(score)}</span>
    </span>
  );
}

export function StandingText({ card }: { card: Scorecard }) {
  return <span className={`text-xs font-semibold ${STANDING_TONE[card.standing] ?? "text-slate-light"}`}>{card.standing_label}</span>;
}

export function Trend({ values }: { values?: (number | null)[] }) {
  if (!values?.length) return <span className="text-xs text-slate">–</span>;
  return (
    <span className="inline-flex items-end gap-0.5" aria-label={`Last ${values.length} weeks: ${values.map(scoreText).join(", ")}`}>
      {values.map((v, i) => (
        <span key={i} title={scoreText(v)} className={`w-1.5 rounded-sm ${v === null ? "bg-ink-mid" : v < 60 ? "bg-red-400/70" : v < 85 ? "bg-amber-400/70" : "bg-emerald-400/70"}`}
          style={{ height: `${Math.max(3, ((v ?? 0) / 100) * 22)}px` }} />
      ))}
    </span>
  );
}

function metricLines(key: PerformanceAreaKey, m: Record<string, unknown>): string[] {
  const n = (k: string) => Number(m[k] ?? 0);
  switch (key) {
    case "delivery":
      return [
        `${n("on_time")} of ${n("tasks_due")} due this week closed on time${n("closed_late") ? `, ${n("closed_late")} late` : ""}`,
        `${n("overdue")} of ${n("open_tasks")} open tasks overdue`,
        ...(n("missing_evidence") ? [`${n("missing_evidence")} closed without required evidence`] : []),
      ];
    case "reliability":
      return [`Signed in ${n("present")} of ${n("working_days")} working days`, ...(n("late") ? [`Late ${n("late")}×`] : [])];
    case "records":
      return [
        m.hours_confirmed === null || m.hours_confirmed === undefined ? "Hours confirmation not due"
          : m.hours_confirmed ? `Hours confirmed (week ending ${formatDate(String(m.hours_week_end))})` : `Hours NOT confirmed (week ending ${formatDate(String(m.hours_week_end))})`,
        ...(n("completed") ? [`${n("completed") - n("missing_outcome")} of ${n("completed")} completed tasks have an outcome`] : []),
      ];
    case "responsiveness":
      return [`${n("picked_up_in_48h")} of ${n("new_tasks")} new tasks picked up within 48h`];
    case "output": {
      const work = Object.entries((m.work as Record<string, number>) ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
      return [`Work recorded on ${n("days_with_work")} of ${n("working_days")} working days`, ...(work.length ? [work.map(([k, v]) => `${v} ${k}`).join(" · ")] : [])];
    }
  }
}

export function AreaGrid({ card }: { card: Scorecard }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {AREAS.map((key) => {
        const c = card.components[key];
        if (!c) return null;
        return (
          <div key={key} className="rounded-sm border border-ink-mid bg-ink p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-paper">{c.label}</span>
              <span className="font-mono text-[11px] text-slate">{c.weight}%</span>
            </div>
            <div className={`mt-1 font-mono text-2xl ${scoreTone(c.score)}`}>{c.score === null ? "—" : scoreText(c.score)}</div>
            <ul className="mt-2 space-y-1 text-xs text-slate-light">
              {c.score === null ? <li>Not measured this week</li> : metricLines(key, c.metrics).map((line) => <li key={line}>{line}</li>)}
            </ul>
            <p className="mt-2 text-[11px] text-slate">Target: {c.target}</p>
          </div>
        );
      })}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-slate">{title}</h4>
      {children}
    </div>
  );
}

export function Narrative({ card }: { card: Scorecard }) {
  const list = (items: string[], empty: string) => items.length
    ? <ul className="list-disc space-y-1 pl-5 text-sm text-slate-light">{items.map((i) => <li key={i}>{i}</li>)}</ul>
    : <p className="text-sm text-slate">{empty}</p>;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Block title="What went well">{list(card.went_well, "Nothing reached the target this week.")}</Block>
      <Block title="Areas to improve">{list(card.to_improve, "Nothing below target.")}</Block>
      <Block title="Focus next week">{list(card.next_focus.map((f) => `${f.title} (due ${formatDate(f.due_date)})`), "No overdue tasks.")}</Block>
    </div>
  );
}
