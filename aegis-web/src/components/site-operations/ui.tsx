"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Lock } from "lucide-react";
import { ApiError } from "@/lib/api/core";

export type ApiRecord = Record<string, any> & { id: string };

export const fieldClass =
  "h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper placeholder:text-slate outline-none transition focus:border-signal disabled:cursor-not-allowed disabled:opacity-50";
export const areaClass =
  "min-h-24 w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper placeholder:text-slate outline-none transition focus:border-signal disabled:cursor-not-allowed disabled:opacity-50";

/** The backend's own message for 4xx answers (they explain what to do);
 * a generic fallback for network trouble and server errors. */
export function errorText(reason: unknown, fallback: string) {
  if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500 && reason.message) return reason.message;
  return fallback;
}

export function num(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function qty(value: unknown) {
  return new Intl.NumberFormat("en-ZW", { maximumFractionDigits: 2 }).format(num(value));
}

export function usd(value: unknown, digits = 0) {
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(num(value));
}

export function timeOf(value: unknown) {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-ZW", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Harare" }).format(d);
}

export function dayLabel(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "2-digit", month: "short" }) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("en-ZW", opts).format(d);
}

export function Panel({ title, subtitle, step, done, actions, children, className = "" }: {
  title: string; subtitle?: string; step?: number; done?: boolean; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`border border-ink-mid bg-ink ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-mid px-4 py-3">
        <div className="flex items-start gap-3">
          {step !== undefined ? (
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center font-mono text-xs font-bold ${done ? "bg-emerald-500 text-ink" : "border border-signal/60 text-signal"}`}>
              {done ? <CheckCircle2 className="h-4 w-4" /> : step}
            </span>
          ) : null}
          <div>
            <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">{title}</h3>
            {subtitle ? <p className="mt-1 text-xs text-slate-light">{subtitle}</p> : null}
          </div>
        </div>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Btn({ tone = "primary", busy, icon, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "ghost" | "danger" | "success"; busy?: boolean; icon?: ReactNode;
}) {
  const tones = {
    primary: "bg-signal text-ink hover:brightness-110",
    ghost: "border border-ink-mid text-slate-light hover:border-signal hover:text-paper",
    danger: "border border-red-500/50 text-red-300 hover:bg-red-950/30",
    success: "bg-emerald-500 text-ink hover:brightness-110",
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex h-10 items-center justify-center gap-2 px-4 font-mono text-xs font-bold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]} ${className}`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Pill({ tone = "slate", children }: { tone?: "slate" | "green" | "amber" | "red" | "blue" | "gold"; children: ReactNode }) {
  const tones = {
    slate: "border-slate-500/40 bg-slate-900/40 text-slate-300",
    green: "border-emerald-500/40 bg-emerald-950/30 text-emerald-300",
    amber: "border-amber-500/40 bg-amber-950/30 text-amber-300",
    red: "border-red-500/40 bg-red-950/30 text-red-300",
    blue: "border-blue-500/40 bg-blue-950/30 text-blue-300",
    gold: "border-signal/40 bg-signal/10 text-signal",
  };
  return <span className={`inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tones[tone]}`}>{children}</span>;
}

export function Notice({ tone, children, onClose }: { tone: "error" | "info" | "success"; children: ReactNode; onClose?: () => void }) {
  const style = tone === "error" ? "border-red-500/30 bg-red-950/20 text-red-200"
    : tone === "success" ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-200"
    : "border-signal/30 bg-signal/10 text-slate-light";
  return (
    <div className={`flex items-start gap-3 border p-3 text-sm ${style}`} role={tone === "error" ? "alert" : "status"}>
      {tone === "success" ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
      <div className="flex-1">{children}</div>
      {onClose ? <button onClick={onClose} className="text-xs uppercase tracking-wider opacity-70 hover:opacity-100">Dismiss</button> : null}
    </div>
  );
}

export function Locked({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-ink-mid bg-ink-light/20 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center border border-signal/40 text-signal"><Lock className="h-5 w-5" /></span>
      <p className="font-mono text-sm font-bold uppercase tracking-widest text-paper">{title}</p>
      <p className="max-w-md text-sm text-slate-light">{body}</p>
      {action}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 border transition disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "border-emerald-500 bg-emerald-500/30" : "border-ink-mid bg-ink-light"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 transition-all ${checked ? "left-6 bg-emerald-400" : "left-0.5 bg-slate"}`} />
    </button>
  );
}
