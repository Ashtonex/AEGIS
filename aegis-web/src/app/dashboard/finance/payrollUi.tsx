"use client";

import type React from "react";

/** Shared look for the staff payroll and payroll setup panels. */

export function money(value: unknown, currency = "USD", digits = 0) {
  const num = typeof value === "number" ? value : Number(value);
  try {
    return new Intl.NumberFormat("en-ZW", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number.isFinite(num) ? num : 0);
  } catch {
    // Unknown ISO code (e.g. ZWG on an older ICU): fall back to code + number.
    return `${currency} ${(Number.isFinite(num) ? num : 0).toLocaleString("en-ZW", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }
}

export const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
export const labelClass = "block text-[11px] font-mono uppercase tracking-wider text-slate mb-1";
export const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50 disabled:cursor-not-allowed";
export const ghostButtonClass = "inline-flex items-center gap-2 border border-ink-mid text-paper font-medium px-3 py-2 rounded-sm text-sm hover:border-signal/50 disabled:opacity-50";

export function EmptyState({ icon: Icon, title, subtitle, compact = false }: { icon: any; title: string; subtitle: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-6" : "py-10"}`}>
      <div className="h-10 w-10 rounded-full bg-ink-mid/40 flex items-center justify-center mb-3">
        <Icon className="h-4.5 w-4.5 text-slate" />
      </div>
      <p className="text-sm text-paper font-medium">{title}</p>
      <p className="text-xs text-slate mt-1 max-w-xs">{subtitle}</p>
    </div>
  );
}

export function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
      <div className="border-b border-ink-mid px-4 py-3 flex items-center justify-between gap-3">
        <span className="font-mono text-xs uppercase tracking-wider text-slate">{title}</span>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Notice({ notice, onClose }: { notice: { text: string; tone: "ok" | "error" } | null; onClose: () => void }) {
  if (!notice) return null;
  return (
    <div className={`border px-4 py-3 text-sm flex justify-between items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-fast ${notice.tone === "error" ? "border-red-500/30 bg-red-950/20 text-red-300" : "border-signal/30 bg-signal/10 text-paper"}`}>
      <span className="whitespace-pre-line">{notice.text}</span>
      <button onClick={onClose} className="hover:opacity-70 flex-shrink-0" aria-label="Dismiss">×</button>
    </div>
  );
}

export function Flag({ on, label }: { on: boolean; label: string }) {
  if (!on) return null;
  return (
    <span className="inline-block px-1.5 py-0.5 mr-1 mb-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border border-ink-mid text-slate-light">
      {label}
    </span>
  );
}
