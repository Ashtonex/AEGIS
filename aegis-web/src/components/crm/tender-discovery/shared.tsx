"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { ConnectionState, Readiness, RelevanceBand, DiscoveryRun } from "@/lib/api/tender-discovery";

const HARARE = "Africa/Harare";

export function fmtHarare(value: string | null | undefined, withTime = true): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: HARARE, day: "2-digit", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(d);
}

export function relativeDays(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  const days = ms / 86400000;
  if (days < 0) return "closed";
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h left`;
  return `${Math.floor(days)}d left`;
}

export const CONNECTION_LABEL: Record<ConnectionState, { label: string; tone: string }> = {
  not_connected: { label: "Not connected", tone: "text-slate-light border-white/10 bg-white/[0.03]" },
  awaiting_user_login: { label: "Awaiting user login", tone: "text-amber-300 border-amber-400/30 bg-amber-400/10" },
  connected_verified: { label: "Connected and verified", tone: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10" },
  session_expired: { label: "Session expired", tone: "text-amber-300 border-amber-400/30 bg-amber-400/10" },
  access_restricted: { label: "Access restricted", tone: "text-rose-300 border-rose-400/30 bg-rose-400/10" },
  connection_error: { label: "Connection error", tone: "text-rose-300 border-rose-400/30 bg-rose-400/10" },
};

export const BAND_TONE: Record<RelevanceBand, string> = {
  strong: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  possible: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  weak: "text-slate-light border-white/10 bg-white/[0.03]",
};

export const READINESS_LABEL: Record<Readiness, { label: string; tone: string }> = {
  unverified: { label: "Unverified", tone: "text-slate-light border-white/10" },
  requirements_missing: { label: "Requirements missing", tone: "text-amber-300 border-amber-400/30" },
  ready_for_internal_decision: { label: "Ready for internal decision", tone: "text-emerald-300 border-emerald-400/30" },
};

export const RUN_STATUS_TONE: Record<DiscoveryRun["status"], string> = {
  queued: "text-slate-light border-white/10",
  running: "text-sky-300 border-sky-400/30",
  completed: "text-emerald-300 border-emerald-400/30",
  partial: "text-amber-300 border-amber-400/30",
  failed: "text-rose-300 border-rose-400/30",
  cancelled: "text-slate-light border-white/10",
};

export const OUTCOME_LABEL: Record<string, string> = {
  matches_found: "Matches found",
  no_matches: "No matching tenders (all pages read)",
  no_notices_listed: "Portal listed no notices",
  access_failed: "Portal could not be reached",
  extraction_failed: "Pages could not be read",
  interrupted: "Interrupted - resumable",
  cancelled: "Cancelled",
  restricted: "Access restricted by portal",
};

export function Chip({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider", className)}>
      {children}
    </span>
  );
}

export function Panel({ title, actions, children, className }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-sm border border-white/5 bg-[#0A0A0A] p-4", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-mono text-[11px] uppercase tracking-widest text-slate-light">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export const btn = {
  primary: "inline-flex items-center justify-center gap-1.5 rounded-sm bg-[#D4AF37] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-black transition hover:bg-[#D4AF37]/90 disabled:cursor-not-allowed disabled:opacity-40",
  ghost: "inline-flex items-center justify-center gap-1.5 rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-paper transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40",
  danger: "inline-flex items-center justify-center gap-1.5 rounded-sm border border-rose-400/30 bg-rose-400/10 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-rose-200 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-40",
};

export const input = "w-full rounded-sm border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-paper placeholder:text-slate focus:border-[#D4AF37]/50 focus:outline-none";

export function errorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { status?: number; message?: string } | null;
  if (anyErr?.status === 403) return "You don't have permission for this action.";
  return anyErr?.message || fallback;
}
