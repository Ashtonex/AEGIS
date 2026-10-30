"use client";

/**
 * Commercial review: the calculator's real build-up (each % with its base),
 * markup vs margin, review flags that link to the line or action, and the
 * independent BOQ approval (four-eyes - the server refuses self-approval).
 */
import React, { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CircleAlert, Info, ShieldCheck } from "lucide-react";
import type { CommercialBreakdown, ReviewFlag } from "@/lib/api/quotations";
import { CommercialInputs, PreviewTotals, formatMoney } from "./domain";
import { NumberField } from "./NumberField";

interface Props {
  quotationId: string;
  currency: string;
  inputs: CommercialInputs;
  onInputsChange: (patch: Partial<CommercialInputs>) => void;
  preview: PreviewTotals;
  breakdown: CommercialBreakdown | null;
  flags: ReviewFlag[];
  readOnly: boolean;
  dirty: boolean;
  approval: { status?: string; decided_by_name?: string; decided_at?: string; notes?: string } | null;
  canApprove: boolean;
  isAuthor: boolean;
  onApproveBoq: (decision: "approved" | "changes_requested", notes: string) => Promise<void>;
  onOpenLine: (lineId: string) => void;
  onOpenSection: (section: string) => void;
}

const inputCls = "w-full bg-void border border-ink-mid rounded-sm px-2 py-1.5 text-sm text-paper focus:border-signal focus:outline-none";
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${v.toFixed(2)}%`);

export function CommercialReview(props: Props) {
  const { currency, inputs, onInputsChange, preview, breakdown, flags, readOnly, dirty, approval } = props;
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = { error: flags.filter((f) => f.severity === "error").length, warning: flags.filter((f) => f.severity === "warning").length };

  const decide = async (decision: "approved" | "changes_requested") => {
    setBusy(true);
    setError(null);
    try {
      await props.onApproveBoq(decision, notes);
      setNotes("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, key: keyof CommercialInputs, hint: string) => (
    <label className="text-xs text-slate block">
      {label}
      <NumberField className={inputCls} disabled={readOnly} value={inputs[key] as number} onValueChange={(v) => onInputsChange({ [key]: v } as Partial<CommercialInputs>)} />
      <span className="text-[11px] text-slate/80">{hint}</span>
    </label>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="border border-ink-mid rounded-sm bg-ink p-4 space-y-4">
        <h2 className="text-sm font-semibold text-paper">Markups and adjustments</h2>
        <div className="grid grid-cols-2 gap-3">
          {field("Preliminaries", "preliminaries", "Fixed amount")}
          {field("Overheads %", "overhead_pct", "% of direct + preliminaries")}
          {field("Contingency %", "contingency_pct", "% of direct + preliminaries")}
          {field("Profit %", "profit_pct", "% of direct + preliminaries (not compounded)")}
          {field("Provisional sums", "provisional_sums", "Added after markups")}
          {field("Discount", "discount", "Taken off before tax")}
        </div>
        <label className="flex items-center gap-2 text-sm text-paper">
          <input type="checkbox" disabled={readOnly} checked={inputs.apply_vat} onChange={(e) => onInputsChange({ apply_vat: e.target.checked })} />
          Charge VAT
          <span className="text-xs text-slate">
            {breakdown?.tax.applied
              ? `${(Number(breakdown.tax.rate) * 100).toFixed(2)}% · ${breakdown.tax.source === "legacy_default" ? "legacy default - no rate table configured" : "Finance > Statutory rate table"}`
              : "rate is resolved on the server when saved"}
          </span>
        </label>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate">
              <th className="text-left font-normal pb-1">Step</th>
              <th className="text-left font-normal pb-1 hidden sm:table-cell">Basis</th>
              <th className="text-right font-normal pb-1">Saved (server)</th>
              <th className="text-right font-normal pb-1">Preview</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["direct_costs", preview.direct], ["preliminaries", preview.prelims], ["overhead", preview.overhead],
              ["contingency", preview.contingency], ["profit", preview.profit], ["provisional_sums", preview.provisional],
              ["discount", -preview.discount], ["taxable", preview.taxable], ["tax", preview.tax], ["grand_total", preview.grand],
            ].map(([key, value]) => {
              const step = breakdown?.steps.find((s) => s.key === key);
              const strong = key === "grand_total" || key === "taxable";
              const changed = step && Math.abs(Number(step.amount) - (value as number)) >= 0.005;
              return (
                <tr key={key as string} className={`border-t border-ink-mid ${strong ? "font-semibold" : ""}`}>
                  <td className="py-1.5 pr-2">{step?.label ?? key}</td>
                  <td className="py-1.5 pr-2 text-xs text-slate hidden sm:table-cell">{step?.basis}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{step ? formatMoney(step.amount, currency) : "—"}</td>
                  <td className={`py-1.5 text-right font-mono tabular-nums ${changed ? "text-signal" : "text-slate"}`}>{formatMoney(value as number, currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {dirty && <p className="text-xs text-signal">Preview includes unsaved changes. Saved figures are re-priced on the server.</p>}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="border border-ink-mid rounded-sm p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate">Markup</p>
            <p className="text-lg font-semibold font-mono">{pct(breakdown?.markup_pct ?? preview.markupPct)}</p>
            <p className="text-[11px] text-slate">profit ÷ cost</p>
          </div>
          <div className="border border-ink-mid rounded-sm p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate">Margin</p>
            <p className="text-lg font-semibold font-mono">{pct(breakdown?.margin_pct ?? preview.marginPct)}</p>
            <p className="text-[11px] text-slate">profit ÷ selling value excl. tax</p>
          </div>
        </div>
        <p className="text-[11px] text-slate">Cost = direct + preliminaries + overheads + contingency + provisional sums. Profit = selling value excl. tax − cost (so a discount reduces it).</p>
      </section>

      <div className="space-y-4">
        <section className="border border-ink-mid rounded-sm bg-ink p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-paper">Review flags</h2>
            <span className="text-xs text-slate">{counts.error} blocking · {counts.warning} warnings{dirty ? " · as at last save" : ""}</span>
          </div>
          {flags.length === 0 ? (
            <p className="text-sm text-success">No open review flags.</p>
          ) : (
            <ul className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
              {flags.map((f, i) => {
                const Icon = f.severity === "error" ? CircleAlert : f.severity === "warning" ? AlertTriangle : Info;
                const color = f.severity === "error" ? "text-danger" : f.severity === "warning" ? "text-warning" : "text-slate";
                return (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} aria-hidden />
                    <span className="flex-1 text-paper/90">{f.message}</span>
                    {f.line_id ? (
                      <button type="button" className="text-xs text-signal hover:underline whitespace-nowrap" onClick={() => props.onOpenLine(f.line_id!)}>Go to line</button>
                    ) : f.action ? (
                      <button type="button" className="text-xs text-signal hover:underline whitespace-nowrap" onClick={() => props.onOpenSection(f.action!)}>Open</button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[11px] text-slate mt-3">
            Low-margin warning uses the Commercial Control Brain&apos;s existing 10% profit floor. AI analysis on the{" "}
            <Link href={`/dashboard/quotations/intelligence`} className="text-signal hover:underline">Commercial Brain</Link> is advisory only and never changes prices.
          </p>
        </section>

        <section className="border border-ink-mid rounded-sm bg-ink p-4 space-y-2">
          <h2 className="text-sm font-semibold text-paper flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Independent BOQ approval</h2>
          <p className="text-sm">
            Status: <span className={approval?.status === "approved" ? "text-success" : "text-warning"}>{approval?.status?.replace(/_/g, " ") || "not requested"}</span>
            {approval?.decided_by_name ? <span className="text-slate"> · {approval.decided_by_name}{approval.decided_at ? `, ${approval.decided_at.slice(0, 10)}` : ""}</span> : null}
          </p>
          {approval?.notes && <p className="text-xs text-slate">“{approval.notes}”</p>}
          <p className="text-[11px] text-slate">Approval covers the saved lines; editing lines afterwards sends it back for review. Approval is internal - it is not client acceptance or award.</p>
          {props.isAuthor && !props.canApprove ? (
            <p className="text-xs text-slate">You built this estimate, so someone else must approve it.</p>
          ) : props.canApprove ? (
            <div className="space-y-2">
              <textarea className={inputCls} rows={2} placeholder="Notes (required to send back)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              {dirty && <p className="text-xs text-warning">Save first - approval applies to the saved lines.</p>}
              <div className="flex gap-2">
                <button type="button" disabled={busy || dirty} onClick={() => decide("approved")} className="px-3 py-1.5 text-xs rounded-sm bg-success/20 text-success border border-success/40 disabled:opacity-40">Approve BOQ</button>
                <button type="button" disabled={busy || dirty || !notes.trim()} onClick={() => decide("changes_requested")} className="px-3 py-1.5 text-xs rounded-sm border border-warning/40 text-warning disabled:opacity-40">Send back</button>
              </div>
              {error && <p className="text-xs text-danger" role="alert">{error}</p>}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
