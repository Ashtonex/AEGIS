"use client";

import { type ReactNode } from "react";
import { AlertTriangle, ClipboardList, Loader2, X } from "lucide-react";


// ─── Types ────────────────────────────────────────────────────────────────────

export type Rec = Record<string, any> & { id: string };

// Main views are tasks / purchases / suppliers; the rest are the detailed lists
// (still reachable at their old URLs).
export type Tab = "tasks" | "plans" | "purchases" | "requisitions" | "rfqs" | "orders" | "suppliers" | "invoices" | "pricing";

export interface LineItem { description: string; qty: string; uom: string; unit_cost: string; }

export interface PaymentEvidencePayload {
  poDocumentId: string;
  grnDocumentId: string;
  invoiceDocumentId: string;
  approvalDocumentId: string;
  reason: string;
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

export function tx(v: unknown, fallback = "—") {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

export function num(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function money(v: unknown) {
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num(v));
}

export function qty(v: unknown) {
  return new Intl.NumberFormat("en-ZW", { maximumFractionDigits: 3 }).format(num(v));
}

export function dt(v: unknown) {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat("en-ZW", { dateStyle: "medium" }).format(d);
}

export function pct(v: unknown) { return `${Math.round(num(v))}%`; }

export function itemType(value: unknown) {
  const normalized = tx(value, "material").toLowerCase();
  return ["material", "supply", "tool"].includes(normalized) ? normalized : "material";
}

export function stockValue(row: Rec) {
  if (row.stock_value !== undefined && row.stock_value !== null) return num(row.stock_value);
  return num(row.available_qty ?? row.quantity ?? row.stock_quantity) * num(row.unit_price_inc_vat ?? row.standard_cost ?? row.unit_cost);
}

export function movementDate(row: Rec) {
  const value = row.movement_at ?? row.created_at ?? row.updated_at;
  const date = new Date(String(value ?? 0));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}


// ─── Badge helpers ────────────────────────────────────────────────────────────

export function prStatusClass(s: unknown): string {
  const v = tx(s, "draft").toLowerCase();
  if (v === "approved") return "border-emerald-500/40 bg-emerald-950/20 text-emerald-300";
  if (v === "submitted") return "border-blue-500/40 bg-blue-950/20 text-blue-300";
  if (v === "rejected") return "border-red-500/40 bg-red-950/20 text-red-300";
  if (v === "ordered") return "border-purple-500/40 bg-purple-950/20 text-purple-300";
  return "border-slate-500/40 bg-slate-800/40 text-slate-400";
}

export function poStatusClass(s: unknown): string {
  const v = tx(s, "draft").toLowerCase();
  if (v === "approved") return "border-blue-500/40 bg-blue-950/20 text-blue-300";
  if (v === "issued") return "border-purple-500/40 bg-purple-950/20 text-purple-300";
  if (v === "partially_received") return "border-amber-500/40 bg-amber-950/20 text-amber-300";
  if (v === "received") return "border-emerald-500/40 bg-emerald-950/20 text-emerald-300";
  if (v === "cancelled") return "border-red-500/40 bg-red-950/20 text-red-300";
  return "border-slate-500/40 bg-slate-800/40 text-slate-400";
}

export function supplierStatusClass(s: unknown): string {
  const v = tx(s, "active").toLowerCase();
  if (v === "active") return "border-emerald-500/40 bg-emerald-950/20 text-emerald-300";
  if (v === "suspended") return "border-amber-500/40 bg-amber-950/20 text-amber-300";
  return "border-red-500/40 bg-red-950/20 text-red-300";
}

export function matchStatusClass(s: unknown): string {
  const v = tx(s, "unmatched").toLowerCase();
  if (v === "matched") return "border-emerald-500/40 bg-emerald-950/20 text-emerald-300";
  if (v === "partial") return "border-amber-500/40 bg-amber-950/20 text-amber-300";
  return "border-red-500/40 bg-red-950/20 text-red-300";
}

export function priorityClass(p: unknown): string {
  const v = tx(p, "normal").toLowerCase();
  if (v === "emergency") return "border-red-500/60 bg-red-950/30 text-red-300";
  if (v === "urgent") return "border-amber-500/40 bg-amber-950/20 text-amber-300";
  if (v === "low") return "border-slate-600/40 bg-slate-900/40 text-slate-500";
  return "border-slate-500/40 bg-slate-800/40 text-slate-400";
}


export function loadFailureMessage(reason: unknown) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  const normalizedMessage = rawMessage.toLowerCase();
  if (
    normalizedMessage.includes("signal is aborted") ||
    normalizedMessage.includes("operation was aborted") ||
    normalizedMessage.includes("aborterror") ||
    normalizedMessage.includes("timeouterror")
  ) {
    return "The procurement feed is still synchronizing. Please retry once the connection is ready.";
  }
  return "Procurement data could not be loaded.";
}


export function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (!rawMessage || /aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  // Business-rule rejections (budget caps, self-approval, stage guards) come
  // through as the backend's own HTTPException detail text, which is written
  // to be user-facing - surface it instead of a generic fallback so the user
  // knows what to actually do (e.g. supply an override reason).
  return rawMessage;
}


export function isPoOverdue(po: Rec) {
  if (!["issued", "partially_received"].includes(tx(po.status).toLowerCase())) return false;
  const raw = po.expected_delivery_date ?? po.required_by_date ?? po.required_by;
  if (!raw) return false;
  const date = new Date(String(raw));
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}


export function StatusChips({ value, onChange, rows, statusOf, amountOf, options, extra }: {
  value: string;
  onChange: (value: string) => void;
  rows: Rec[];
  statusOf: (row: Rec) => string;
  amountOf?: (row: Rec) => number;
  options: [string, string][];
  extra?: { key: string; label: string; count: number };
}) {
  const chip = (key: string, label: string, count: number, amount?: number, warn = false) => (
    <button
      key={key}
      type="button"
      onClick={() => onChange(value === key && key !== "all" ? "all" : key)}
      className={`inline-flex h-9 shrink-0 items-center gap-2 border px-3 font-mono text-[10px] uppercase ${value === key ? "border-signal bg-signal/15 text-signal" : "border-ink-mid bg-ink text-slate-light hover:border-signal/50 hover:text-paper"}`}
    >
      {label}
      <span className={`font-semibold ${value === key ? "" : warn && count ? "text-amber-300" : "text-paper"}`}>{count}</span>
      {amount !== undefined && amount > 0 && <span className="normal-case text-slate">{money(amount)}</span>}
    </button>
  );
  return (
    <div className="flex min-w-0 gap-1.5 overflow-x-auto">
      {chip("all", "All", rows.length)}
      {options.map(([key, label]) => {
        const matching = rows.filter((r) => statusOf(r) === key);
        return chip(key, label, matching.length, amountOf ? matching.reduce((sum, r) => sum + amountOf(r), 0) : undefined, key === "submitted" || key === "unmatched");
      })}
      {extra && chip(extra.key, extra.label, extra.count, undefined, true)}
    </div>
  );
}


// ─── Shared primitives ────────────────────────────────────────────────────────

export function KpiCard({ icon, label, value, tone, large }: { icon: ReactNode; label: string; value: string; tone?: string; large?: boolean; }) {
  return (
    <div className="border border-ink-mid bg-ink p-4">
      <div className="flex items-center justify-between text-slate">
        <p className="font-mono text-[10px] uppercase tracking-wider">{label}</p>
        <span className="text-signal [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      </div>
      <p className={`mt-4 font-mono ${large ? "text-xl" : "text-2xl"} ${tone ?? "text-paper"}`}>{value}</p>
    </div>
  );
}


export function Banner({ tone, message, onClose }: { tone: "error" | "info"; message: string; onClose?: () => void; }) {
  const style = tone === "error" ? "border-red-500/30 bg-red-950/20 text-red-200" : "border-signal/30 bg-signal/10 text-slate-light";
  return (
    <div className={`mb-4 flex items-start gap-3 border p-4 text-sm ${style}`}>
      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
      <span className="flex-1">{message}</span>
      {onClose && <button onClick={onClose} className="shrink-0 text-slate hover:text-paper"><X className="h-4 w-4" /></button>}
    </div>
  );
}


export function LoadingState({ label }: { label: string; }) {
  return <div className="flex h-48 items-center justify-center gap-3 text-sm text-slate-light"><Loader2 className="h-5 w-5 animate-spin text-signal" />{label}</div>;
}


export function EmptyState({ label, sub }: { label: string; sub: string; }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center p-6 text-center text-slate-light">
      <ClipboardList className="h-8 w-8 text-slate" />
      <p className="mt-3 text-sm text-paper">{label}</p>
      <p className="mt-1 text-xs">{sub}</p>
    </div>
  );
}


export function InfoCard({ label, value, tone }: { label: string; value: string; tone?: string; }) {
  return (
    <div className="border border-ink-mid p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p>
      <p className={`mt-2 font-mono text-sm ${tone ?? "text-paper"}`}>{value}</p>
    </div>
  );
}
