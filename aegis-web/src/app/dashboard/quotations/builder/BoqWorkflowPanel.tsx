"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, History, Loader2, RotateCcw, ShieldCheck, XCircle } from "lucide-react";

import {
  decideBoqApproval,
  findSimilarPastBoqLines,
  getQuotation,
  type PastBoqResult,
} from "@/lib/api/quotations";

const STATUS_STYLE: Record<string, { label: string; tone: string }> = {
  pending_review: { label: "Awaiting green light", tone: "border-amber-400/40 text-amber-200" },
  approved: { label: "Green-lit for production", tone: "border-emerald-500/40 text-emerald-300" },
  changes_requested: { label: "Changes requested", tone: "border-amber-500/40 text-amber-300" },
  rejected: { label: "Rejected", tone: "border-red-500/40 text-red-300" },
};

interface BuilderLine {
  description: string;
  unit: string;
  rate: number;
}

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The BOQ's production gate and its link to AEGIS's memory of past work.
 *  - Green light: approving snapshots the saved BOQ into the rate library;
 *    sending it back / rejecting takes it out again.
 *  - Past projects: looks every line up against approved BOQs from earlier
 *    projects and lets the estimator pull a past rate into a line.
 */
export function BoqWorkflowPanel({
  quotationId,
  lineItems,
  onApplyRate,
}: {
  quotationId: string;
  lineItems: BuilderLine[];
  onApplyRate: (index: number, rate: number) => void;
}) {
  const [approval, setApproval] = useState<Record<string, any> | null>(null);
  const [notes, setNotes] = useState("");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [lookup, setLookup] = useState<{ results: PastBoqResult[]; indexes: number[]; library: { lines: number; boqs: number } } | null>(null);
  const [searching, setSearching] = useState(false);
  const [onlyMatched, setOnlyMatched] = useState(true);

  const loadApproval = useCallback(async () => {
    try {
      const res = await getQuotation(quotationId);
      const meta = res.data?.metadata;
      const parsed = typeof meta === "string" ? JSON.parse(meta) : meta;
      setApproval(parsed?.boq_approval || null);
    } catch {
      setApproval(null);
    }
  }, [quotationId]);

  useEffect(() => { void loadApproval(); }, [loadApproval]);

  const decide = async (decision: "approved" | "changes_requested" | "rejected") => {
    if (decision !== "approved" && !notes.trim()) {
      setFeedback({ ok: false, text: "Write what needs to change before sending it back." });
      return;
    }
    setDeciding(decision);
    setFeedback(null);
    try {
      const res = await decideBoqApproval(quotationId, decision, notes.trim() || undefined);
      setApproval(res.data?.boq_approval || null);
      setNotes("");
      setFeedback({
        ok: true,
        text: decision === "approved"
          ? `Green-lit. ${res.data?.knowledge_lines ?? 0} lines added to the AEGIS rate library for future projects.`
          : res.message || "Decision recorded.",
      });
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : "The decision could not be saved." });
    } finally {
      setDeciding(null);
    }
  };

  const searchPast = async () => {
    setSearching(true);
    setFeedback(null);
    try {
      const indexes = lineItems
        .map((li, i) => (li.description?.trim() ? i : -1))
        .filter((i) => i >= 0)
        .slice(0, 400);
      const res = await findSimilarPastBoqLines(
        indexes.map((i) => ({ description: lineItems[i].description, unit: lineItems[i].unit })),
        quotationId,
        3,
      );
      if (res.data) setLookup({ results: res.data.results, indexes, library: res.data.library });
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : "Past projects could not be searched." });
    } finally {
      setSearching(false);
    }
  };

  const status = approval?.status ? STATUS_STYLE[approval.status] : null;
  const rows = lookup
    ? lookup.results.map((r, k) => ({ result: r, index: lookup.indexes[k] })).filter((row) => !onlyMatched || row.result.matches.length > 0)
    : [];
  const matchedCount = lookup ? lookup.results.filter((r) => r.matches.length > 0).length : 0;

  return (
    <section className="print:hidden grid gap-4 border border-ink-mid bg-ink-light/40 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      {/* Production gate */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-signal">
            <ShieldCheck className="h-3.5 w-3.5" /> Production green light
          </span>
          <span className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase ${status?.tone || "border-ink-mid text-slate"}`}>
            {status?.label || "Not submitted"}
          </span>
        </div>
        {approval?.decided_at && (
          <p className="text-[11px] text-slate">
            Last decision by {approval.decided_by_name || "a reviewer"} on {new Date(approval.decided_at).toLocaleString()}
            {approval.notes ? ` - "${approval.notes}"` : ""}
          </p>
        )}
        <p className="text-[11px] text-slate">
          Save your edits first - approval reads the saved BOQ. Approved BOQs become reference data AEGIS pulls from on future projects; editing lines later sends it back for re-approval.
        </p>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Review notes (required to send back or reject)"
          className="w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
        />
        <div className="grid grid-cols-3 gap-2">
          <button type="button" disabled={!!deciding} onClick={() => void decide("approved")}
            className="flex items-center justify-center gap-1 bg-emerald-600/80 px-2 py-2 font-mono text-[10px] font-bold uppercase text-white hover:bg-emerald-600 disabled:opacity-40">
            {deciding === "approved" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Green light
          </button>
          <button type="button" disabled={!!deciding} onClick={() => void decide("changes_requested")}
            className="flex items-center justify-center gap-1 border border-amber-500/40 px-2 py-2 font-mono text-[10px] uppercase text-amber-200 hover:bg-amber-500/10 disabled:opacity-40">
            {deciding === "changes_requested" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Send back
          </button>
          <button type="button" disabled={!!deciding} onClick={() => void decide("rejected")}
            className="flex items-center justify-center gap-1 border border-red-500/40 px-2 py-2 font-mono text-[10px] uppercase text-red-300 hover:bg-red-500/10 disabled:opacity-40">
            {deciding === "rejected" ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />} Reject
          </button>
        </div>
        {feedback && <p className={`text-xs ${feedback.ok ? "text-emerald-400" : "text-red-300"}`}>{feedback.text}</p>}
      </div>

      {/* Past projects */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-signal">
            <History className="h-3.5 w-3.5" /> From past projects
          </span>
          <div className="flex items-center gap-3">
            {lookup && (
              <label className="flex items-center gap-1 text-[10px] text-slate">
                <input type="checkbox" checked={onlyMatched} onChange={(e) => setOnlyMatched(e.target.checked)} /> Matched only
              </label>
            )}
            <button type="button" onClick={() => void searchPast()} disabled={searching}
              className="flex items-center gap-1 border border-ink-mid bg-ink px-3 py-1.5 font-mono text-[10px] uppercase text-paper hover:border-signal disabled:opacity-40">
              {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <History className="h-3 w-3" />} {lookup ? "Search again" : "Search past BOQs"}
            </button>
          </div>
        </div>
        {!lookup ? (
          <p className="text-[11px] text-slate">Compare every line with the rates on approved BOQs from earlier projects, and pull a past rate in with one click.</p>
        ) : lookup.library.lines === 0 ? (
          <p className="text-[11px] text-slate">The rate library is empty - green-light this BOQ to start it. Every approved BOQ after this makes the next estimate faster.</p>
        ) : (
          <>
            <p className="text-[11px] text-slate">
              {matchedCount} of {lookup.results.length} lines have comparable items across {lookup.library.boqs} approved BOQ{lookup.library.boqs === 1 ? "" : "s"} ({lookup.library.lines} lines).
            </p>
            <div className="max-h-80 overflow-auto border border-ink-mid">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-ink text-left font-mono text-[9px] uppercase text-slate">
                  <tr>
                    <th className="p-2">Line</th>
                    <th className="p-2 text-right">Your rate</th>
                    <th className="p-2 text-right">Past median</th>
                    <th className="p-2">Closest past item</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {rows.map(({ result, index }) => {
                    const best = result.matches[0];
                    const current = lineItems[index];
                    const suggested = result.rate_summary?.median ?? (best?.same_unit ? best.rate : undefined);
                    return (
                      <tr key={index} className="align-top">
                        <td className="max-w-[220px] p-2 text-paper">
                          <span className="line-clamp-2">{current?.description}</span>
                          <span className="text-slate"> ({current?.unit})</span>
                        </td>
                        <td className="p-2 text-right font-mono text-paper">{money(Number(current?.rate) || 0)}</td>
                        <td className="p-2 text-right font-mono">
                          {result.rate_summary ? (
                            <span title={`min ${money(result.rate_summary.min)} / max ${money(result.rate_summary.max)} over ${result.rate_summary.samples}`}>
                              {money(result.rate_summary.median)} <span className="text-slate">×{result.rate_summary.samples}</span>
                            </span>
                          ) : <span className="text-slate">-</span>}
                        </td>
                        <td className="max-w-[240px] p-2 text-slate">
                          {best ? (
                            <>
                              <span className="line-clamp-2 text-paper">{best.description}</span>
                              <span>{best.project_title || "Past project"} · {money(best.rate)}/{best.unit} · {Math.round(best.score * 100)}% match</span>
                            </>
                          ) : "No comparable item"}
                        </td>
                        <td className="p-2">
                          {suggested !== undefined && suggested > 0 && (
                            <button type="button" onClick={() => onApplyRate(index, suggested)}
                              className="whitespace-nowrap border border-signal/40 px-2 py-1 font-mono text-[9px] uppercase text-signal hover:bg-signal/10">
                              Use {money(suggested)}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
