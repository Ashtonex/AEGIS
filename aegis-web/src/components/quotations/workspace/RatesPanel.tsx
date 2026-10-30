"use client";

/**
 * Rates & resources: every resource used in this estimate's build-ups with
 * its unit cost, source and age, and a rate refresh against the approved BOQ
 * library (finance.boq_knowledge_lines). Refresh is preview -> select ->
 * apply; applied rates record their source on the line and are saved like
 * any other edit (audited). Issued revisions are frozen and never refreshed.
 */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { findSimilarPastBoqLines } from "@/lib/api/quotations";
import { BoqLine, RESOURCE_TYPES, canonicalUnit, formatMoney, lineAmount, roundCents } from "./domain";

interface Props {
  quotationId: string;
  currency: string;
  lines: BoqLine[];
  readOnly: boolean;
  onApply: (lines: BoqLine[]) => void;
  onOpenLine: (lineId: string) => void;
}

interface Proposal {
  line: BoqLine;
  proposed: number;
  samples: number;
  basis: string;
  selected: boolean;
}

const daysSince = (iso?: string) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null;
};

export function RatesPanel({ quotationId, currency, lines, readOnly, onApply, onOpenLine }: Props) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resources = useMemo(() => {
    const map = new Map<string, { type: string; name: string; unit: string; costs: Set<number>; sources: Set<string>; oldest: number | null; lines: string[] }>();
    for (const line of lines) {
      for (const b of line.buildup) {
        const key = `${b.type}|${b.name.trim().toLowerCase()}|${canonicalUnit(b.unit)}`;
        const r = map.get(key) ?? { type: b.type, name: b.name || "Unnamed", unit: b.unit, costs: new Set<number>(), sources: new Set<string>(), oldest: null, lines: [] };
        r.costs.add(b.rate);
        if (b.source) r.sources.add(b.source);
        const age = daysSince(b.source_date);
        if (age !== null) r.oldest = Math.max(r.oldest ?? 0, age);
        r.lines.push(line.line_id);
        map.set(key, r);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }, [lines]);

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      const candidates = lines.filter((l) => l.item_type !== "note" && l.description.trim()).slice(0, 500);
      const res = await findSimilarPastBoqLines(candidates.map((l) => ({ description: l.description, unit: l.unit })), quotationId, 5);
      const out: Proposal[] = [];
      (res.data?.results || []).forEach((result, i) => {
        const line = candidates[i];
        const summary = result.rate_summary;
        if (!line || !summary || !summary.samples) return;
        if (canonicalUnit(summary.unit || "") !== canonicalUnit(line.unit)) return;
        const sameCurrency = result.matches.every((m) => !m.currency || m.currency === currency);
        if (!sameCurrency) return;
        const proposed = roundCents(summary.median);
        if (proposed === roundCents(line.rate)) return;
        out.push({ line, proposed, samples: summary.samples, basis: `median of ${summary.samples} approved line(s), ${summary.min.toFixed(2)}–${summary.max.toFixed(2)}`, selected: false });
      });
      setProposals(out);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selected = proposals?.filter((p) => p.selected) ?? [];
  const impact = selected.reduce((acc, p) => acc + roundCents(p.line.qty * p.proposed) - lineAmount(p.line), 0);

  const apply = () => {
    const today = new Date().toISOString().slice(0, 10);
    onApply(selected.map((p) => ({ ...p.line, rate: p.proposed, rate_source: { type: "boq_knowledge_median", date: today, note: p.basis } })));
    setProposals(null);
  };

  return (
    <div className="space-y-4">
      <section className="border border-ink-mid rounded-sm bg-ink p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-paper">Rate refresh from approved BOQs</h2>
          <Link href="/dashboard/quotations/rates" className="text-xs text-signal hover:underline">Rate library</Link>
        </div>
        <p className="text-xs text-slate">Proposes the median rate of past approved lines with the same unit and currency. Nothing changes until you select and apply. Proposals are evidence, not instructions - check scope and date before applying.</p>
        <button type="button" disabled={busy || readOnly} onClick={preview} className="px-3 py-1.5 text-xs rounded-sm border border-signal/50 text-signal disabled:opacity-40 inline-flex items-center gap-1">
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Preview rate changes
        </button>
        {readOnly && <p className="text-xs text-slate">Decided quotations and issued revisions are frozen.</p>}
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
        {proposals && (proposals.length === 0 ? <p className="text-sm text-slate">No different approved rates found for these lines.</p> : (
          <>
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full text-xs min-w-[720px]">
                <thead className="sticky top-0 bg-ink"><tr className="text-left text-slate">
                  <th className="py-1"><input type="checkbox" aria-label="Select all" checked={proposals.every((p) => p.selected)} onChange={(e) => setProposals(proposals.map((p) => ({ ...p, selected: e.target.checked })))} /></th>
                  <th className="font-normal py-1">Line</th><th className="font-normal py-1 text-right">Current</th><th className="font-normal py-1 text-right">Proposed</th><th className="font-normal py-1 text-right">Δ amount</th><th className="font-normal py-1">Evidence</th>
                </tr></thead>
                <tbody>
                  {proposals.map((p, i) => (
                    <tr key={p.line.line_id} className="border-t border-ink-mid">
                      <td className="py-1"><input type="checkbox" aria-label={`Select ${p.line.description}`} checked={p.selected} onChange={(e) => setProposals(proposals.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))} /></td>
                      <td className="py-1"><button type="button" className="text-left hover:text-signal" onClick={() => onOpenLine(p.line.line_id)}>{p.line.item_no ? `${p.line.item_no} · ` : ""}{p.line.description}</button></td>
                      <td className="py-1 text-right font-mono">{formatMoney(p.line.rate, currency)}</td>
                      <td className="py-1 text-right font-mono">{formatMoney(p.proposed, currency)}</td>
                      <td className="py-1 text-right font-mono">{formatMoney(roundCents(p.line.qty * p.proposed) - lineAmount(p.line), currency)}</td>
                      <td className="py-1 text-slate">{p.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate">{selected.length} selected · direct-cost impact <span className="font-mono text-paper">{formatMoney(impact, currency)}</span> (markups and tax follow)</p>
              <div className="flex gap-2">
                <button type="button" className="px-3 py-1.5 text-xs border border-ink-mid rounded-sm text-slate" onClick={() => setProposals(null)}>Discard</button>
                <button type="button" disabled={!selected.length} onClick={apply} className="px-3 py-1.5 text-xs rounded-sm bg-signal text-void font-semibold disabled:opacity-40">Apply {selected.length}</button>
              </div>
            </div>
          </>
        ))}
      </section>

      <section className="border border-ink-mid rounded-sm bg-ink p-4">
        <h2 className="text-sm font-semibold text-paper mb-2">Resources in this estimate</h2>
        {resources.length === 0 ? <p className="text-sm text-slate">No build-ups yet. Select a BOQ line and add resources in the inspector.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[720px]">
              <thead><tr className="text-left text-slate"><th className="font-normal py-1">Type</th><th className="font-normal py-1">Resource</th><th className="font-normal py-1">Unit</th><th className="font-normal py-1 text-right">Unit cost</th><th className="font-normal py-1">Source</th><th className="font-normal py-1 text-right">Oldest price</th><th className="font-normal py-1 text-right">Lines</th></tr></thead>
              <tbody>
                {resources.map((r, i) => {
                  const costs = Array.from(r.costs);
                  return (
                    <tr key={i} className="border-t border-ink-mid">
                      <td className="py-1 text-slate">{RESOURCE_TYPES.find((t) => t.id === r.type)?.label ?? r.type}</td>
                      <td className="py-1">{r.name}</td>
                      <td className="py-1">{r.unit}</td>
                      <td className={`py-1 text-right font-mono ${costs.length > 1 ? "text-warning" : ""}`} title={costs.length > 1 ? "Priced differently on different lines" : undefined}>{costs.map((c) => formatMoney(c, currency)).join(" / ")}</td>
                      <td className="py-1 text-slate">{Array.from(r.sources).join(", ") || "—"}</td>
                      <td className="py-1 text-right">{r.oldest === null ? <span className="text-slate">undated</span> : `${r.oldest} d`}</td>
                      <td className="py-1 text-right"><button type="button" className="text-signal hover:underline" onClick={() => onOpenLine(r.lines[0])}>{r.lines.length}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate mt-2">Inventory, procurement and fleet costs are not pulled in automatically yet - record the supplier/PO/plant rate and its date as the resource source.</p>
      </section>
    </div>
  );
}
