import type { ReactNode } from "react";

export const inputClass =
  "min-h-10 w-full rounded-sm border border-ink-mid bg-ink px-3 py-2 text-sm text-paper placeholder:text-slate focus:border-signal/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70";
export const primaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-sm bg-signal px-4 py-2 text-sm font-semibold text-ink hover:bg-signal-hover disabled:opacity-50";
export const secondaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-ink-mid px-4 py-2 text-sm text-paper hover:border-signal/50 disabled:opacity-50";
export const dangerButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-red-500/40 bg-red-950/30 px-4 py-2 text-sm text-red-200 hover:bg-red-900/40 disabled:opacity-50";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-slate-light">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate">{hint}</span>}
    </label>
  );
}

export function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-ZW", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function humanise(value?: string | null) {
  if (!value) return "Not recorded";
  return value.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

const STATUS_STYLES: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-950/30 text-emerald-300",
  on_leave: "border-blue-500/30 bg-blue-950/30 text-blue-300",
  suspended: "border-amber-500/30 bg-amber-950/30 text-amber-300",
  terminated: "border-slate-500/30 bg-slate-900/40 text-slate-300",
};

export function StatusPill({ status }: { status: string }) {
  const label = status === "terminated" ? "Left" : humanise(status);
  return (
    <span className={`inline-flex rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLES[status] ?? STATUS_STYLES.terminated}`}>
      {label}
    </span>
  );
}

export const EMPLOYMENT_TYPES: { value: string; label: string }[] = [
  { value: "permanent", label: "Permanent" },
  { value: "fixed_term", label: "Fixed-term contract" },
  { value: "casual", label: "Casual / daily" },
  { value: "intern", label: "Intern / attachment" },
  { value: "consultant", label: "Consultant" },
];

export function today() {
  return new Date().toISOString().slice(0, 10);
}
