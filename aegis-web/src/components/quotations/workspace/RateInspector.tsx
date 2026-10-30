"use client";

/**
 * Side inspector for the selected BOQ line: resource build-up (per ONE unit
 * of the BOQ line), each resource's contribution, the resulting unit rate,
 * and past approved rates for the same work. Nothing changes the line's rate
 * until the estimator applies it, and every applied rate records its source.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, History, Check, X } from "lucide-react";
import { findSimilarPastBoqLines, type PastBoqMatch, type ReviewFlag } from "@/lib/api/quotations";
import { NumberField } from "./NumberField";
import { BoqLine, BuildupLine, RESOURCE_TYPES, ResourceType, buildupTotal, formatMoney, formatQty, lineAmount, roundCents, wastageWarning } from "./domain";

interface Props {
  line: BoqLine | null;
  quotationId: string;
  currency: string;
  readOnly: boolean;
  flags: ReviewFlag[];
  onUpdate: (lineId: string, patch: Partial<BoqLine>) => void;
  onClose: () => void;
}

const inputCls = "w-full bg-void border border-ink-mid rounded-sm px-1.5 py-1 text-xs text-paper focus:border-signal focus:outline-none";

export function RateInspector({ line, quotationId, currency, readOnly, flags, onUpdate, onClose }: Props) {
  const [past, setPast] = useState<{ loading: boolean; matches: PastBoqMatch[]; summary: { median: number; samples: number; unit: string | null } | null; error?: string } | null>(null);
  const [preview, setPreview] = useState<PastBoqMatch | null>(null);

  useEffect(() => {
    setPast(null);
    setPreview(null);
  }, [line?.line_id]);

  const total = useMemo(() => (line ? buildupTotal(line) : 0), [line]);

  if (!line) {
    return (
      <aside className="border border-ink-mid rounded-sm bg-ink p-4 text-sm text-slate" aria-label="Rate build-up">
        Select a line to see and edit its rate build-up.
      </aside>
    );
  }

  const setBuildup = (buildup: BuildupLine[]) => onUpdate(line.line_id, { buildup });
  const editRow = (i: number, patch: Partial<BuildupLine>) => setBuildup(line.buildup.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const byType = RESOURCE_TYPES.map((t) => ({ ...t, amount: line.buildup.filter((b) => b.type === t.id).reduce((a, b) => a + b.qty * b.rate, 0) })).filter((t) => t.amount);
  const mismatch = line.buildup.length > 0 && roundCents(total) !== roundCents(line.rate);
  const currencyIssues = line.buildup.filter((b) => b.currency && b.currency !== currency);
  const wastage = wastageWarning(line);

  const loadPast = async () => {
    setPast({ loading: true, matches: [], summary: null });
    try {
      const res = await findSimilarPastBoqLines([{ description: line.description, unit: line.unit }], quotationId, 8);
      const result = res.data?.results?.[0];
      setPast({
        loading: false,
        matches: result?.matches || [],
        summary: result?.rate_summary ? { median: result.rate_summary.median, samples: result.rate_summary.samples, unit: result.rate_summary.unit } : null,
      });
    } catch (err) {
      setPast({ loading: false, matches: [], summary: null, error: (err as Error).message });
    }
  };

  const applyPast = (match: PastBoqMatch) => {
    onUpdate(line.line_id, {
      rate: match.rate,
      rate_source: { type: "boq_knowledge", ref: match.quotation_id, date: match.approved_at?.slice(0, 10), note: `${match.project_title || match.client_name || "Approved BOQ"}: ${match.description}` },
    });
    setPreview(null);
  };

  return (
    <aside className="border border-ink-mid rounded-sm bg-ink flex flex-col min-h-0" aria-label="Rate build-up">
      <div className="flex items-start justify-between gap-2 p-3 border-b border-ink-mid">
        <div className="min-w-0">
          <p className="text-[11px] font-mono text-slate">{line.item_no || "—"} · {line.section}</p>
          <h3 className="text-sm font-semibold text-paper line-clamp-2">{line.description || "Untitled line"}</h3>
          <p className="text-xs text-slate mt-0.5">{formatQty(line.qty)} {line.unit} × {formatMoney(line.rate, currency)} = <span className="text-paper font-mono">{formatMoney(lineAmount(line), currency)}</span></p>
        </div>
        <button type="button" onClick={onClose} className="text-slate hover:text-paper p-1" aria-label="Close inspector"><X className="w-4 h-4" /></button>
      </div>

      <div className="p-3 space-y-3 overflow-y-auto">
        {flags.length > 0 && (
          <ul className="space-y-1">
            {flags.map((f, i) => (
              <li key={i} className={`text-xs rounded-sm px-2 py-1 border ${f.severity === "error" ? "border-danger/40 text-danger" : f.severity === "warning" ? "border-warning/40 text-warning" : "border-ink-mid text-slate"}`}>{f.message}</li>
            ))}
          </ul>
        )}

        <section>
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate">Build-up per 1 {line.unit || "unit"}</h4>
            {!readOnly && (
              <button type="button" className="text-xs text-signal hover:underline flex items-center gap-1"
                onClick={() => setBuildup([...line.buildup, { type: "material", name: "", qty: 1, unit: "", rate: 0, currency, source_date: new Date().toISOString().slice(0, 10) }])}>
                <Plus className="w-3 h-3" /> Resource
              </button>
            )}
          </div>
          {line.buildup.length === 0 ? (
            <p className="text-xs text-slate">No build-up. The rate is entered directly{line.rate_source?.type ? ` (${line.rate_source.type})` : ""}.</p>
          ) : (
            <div className="space-y-2">
              {line.buildup.map((b, i) => (
                <div key={i} className="border border-ink-mid rounded-sm p-2 space-y-1.5">
                  <div className="grid grid-cols-[1fr_auto] gap-1.5">
                    <input className={inputCls} aria-label="Resource name" placeholder="Resource" disabled={readOnly} value={b.name} onChange={(e) => editRow(i, { name: e.target.value })} />
                    <select className={inputCls} aria-label="Resource type" disabled={readOnly} value={b.type} onChange={(e) => editRow(i, { type: e.target.value as ResourceType })}>
                      {RESOURCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    <label className="text-[10px] text-slate">Qty
                      <NumberField className={inputCls} disabled={readOnly} value={b.qty} onValueChange={(v) => editRow(i, { qty: v })} />
                    </label>
                    <label className="text-[10px] text-slate">Unit
                      <input className={inputCls} disabled={readOnly} value={b.unit} onChange={(e) => editRow(i, { unit: e.target.value })} />
                    </label>
                    <label className="text-[10px] text-slate">Unit cost
                      <NumberField className={inputCls} disabled={readOnly} value={b.rate} onValueChange={(v) => editRow(i, { rate: v })} />
                    </label>
                    <div className="text-[10px] text-slate">Contribution
                      <div className="text-xs text-paper font-mono pt-1 text-right">{formatMoney(b.qty * b.rate, currency)}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_auto] gap-1.5 items-end">
                    <input className={inputCls} aria-label="Source (supplier, PO, rate library)" placeholder="Source: supplier / PO / library" disabled={readOnly} value={b.source || ""} onChange={(e) => editRow(i, { source: e.target.value })} />
                    <input className={`${inputCls} w-[118px]`} type="date" aria-label="Source date" disabled={readOnly} value={b.source_date || ""} onChange={(e) => editRow(i, { source_date: e.target.value })} />
                    {!readOnly && (
                      <button type="button" className="p-1 text-slate hover:text-danger" aria-label="Remove resource" onClick={() => setBuildup(line.buildup.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                  {b.currency && b.currency !== currency && (
                    <p className="text-[11px] text-danger">Priced in {b.currency}; this estimate is in {currency}. Convert it and note the rate/date - no automatic conversion is applied.</p>
                  )}
                  <input className={inputCls} aria-label="Conversion or assumption note" placeholder="Conversion / assumption (e.g. 7 bags per m³ at 1:2:4)" disabled={readOnly} value={b.conversion_note || ""} onChange={(e) => editRow(i, { conversion_note: e.target.value })} />
                </div>
              ))}
            </div>
          )}
        </section>

        {line.buildup.length > 0 && (
          <section className="border border-ink-mid rounded-sm p-2 text-xs space-y-1">
            {byType.map((t) => (
              <div key={t.id} className="flex justify-between"><span className="text-slate">{t.label}</span><span className="font-mono">{formatMoney(t.amount, currency)}</span></div>
            ))}
            <div className="flex justify-between border-t border-ink-mid pt-1 font-semibold"><span>Build-up rate</span><span className="font-mono">{formatMoney(total, currency)}</span></div>
            <div className="flex justify-between"><span className="text-slate">Line rate</span><span className="font-mono">{formatMoney(line.rate, currency)}</span></div>
            {mismatch && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-warning">Line rate differs from its build-up.</span>
                {!readOnly && (
                  <button type="button" className="text-signal hover:underline whitespace-nowrap"
                    onClick={() => onUpdate(line.line_id, { rate: roundCents(total), rate_source: { type: "buildup", date: new Date().toISOString().slice(0, 10) } })}>
                    Use build-up
                  </button>
                )}
              </div>
            )}
            {currencyIssues.length > 0 && <p className="text-danger">{currencyIssues.length} resource(s) priced in another currency.</p>}
            {wastage && <p className="text-warning">{wastage}</p>}
            <p className="text-slate">Overheads, contingency and profit are added once, at estimate level (Commercial review) - do not include them here.</p>
          </section>
        )}

        <section>
          <label className="text-[11px] text-slate block">Reason if priced at zero
            <input className={inputCls} disabled={readOnly} value={line.zero_rate_reason || ""} placeholder="e.g. client-supplied, included in 2.3" onChange={(e) => onUpdate(line.line_id, { zero_rate_reason: e.target.value })} />
          </label>
          {line.rate_source?.type && (
            <p className="text-[11px] text-slate mt-1">Rate source: {line.rate_source.type}{line.rate_source.date ? ` · ${line.rate_source.date}` : ""}{line.rate_source.note ? ` · ${line.rate_source.note}` : ""}</p>
          )}
        </section>

        <section>
          <button type="button" onClick={loadPast} className="text-xs text-signal hover:underline flex items-center gap-1">
            <History className="w-3.5 h-3.5" /> Past approved rates for this work
          </button>
          {past?.loading && <p className="text-xs text-slate mt-1">Searching the approved BOQ library…</p>}
          {past?.error && <p className="text-xs text-danger mt-1">{past.error}</p>}
          {past && !past.loading && !past.error && past.matches.length === 0 && <p className="text-xs text-slate mt-1">No similar approved lines yet.</p>}
          {past?.summary && <p className="text-[11px] text-slate mt-1">Median {formatMoney(past.summary.median, currency)} per {past.summary.unit || "unit"} over {past.summary.samples} sample(s).</p>}
          <ul className="mt-1 space-y-1">
            {past?.matches.map((m) => (
              <li key={m.id} className="border border-ink-mid rounded-sm p-1.5 text-[11px]">
                <div className="flex justify-between gap-2">
                  <span className="text-paper line-clamp-2">{m.description}</span>
                  <span className="font-mono whitespace-nowrap">{formatMoney(m.rate, m.currency || currency)}/{m.unit || "?"}</span>
                </div>
                <div className="flex justify-between text-slate gap-2">
                  <span className="truncate">{m.project_title || m.client_name || "Approved BOQ"} · {m.approved_at?.slice(0, 10) || "undated"}{!m.same_unit ? " · different unit" : ""}</span>
                  {!readOnly && m.same_unit && (m.currency || currency) === currency && (
                    <button type="button" className="text-signal hover:underline" onClick={() => setPreview(m)}>Preview</button>
                  )}
                </div>
                {preview?.id === m.id && (
                  <div className="mt-1 border-t border-ink-mid pt-1 space-y-0.5">
                    <div className="flex justify-between"><span>Line amount now</span><span className="font-mono">{formatMoney(lineAmount(line), currency)}</span></div>
                    <div className="flex justify-between"><span>With this rate</span><span className="font-mono">{formatMoney(roundCents(line.qty * m.rate), currency)}</span></div>
                    <div className="flex justify-between font-semibold"><span>Change</span><span className="font-mono">{formatMoney(roundCents(line.qty * m.rate) - lineAmount(line), currency)}</span></div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button type="button" className="text-slate hover:text-paper" onClick={() => setPreview(null)}>Cancel</button>
                      <button type="button" className="text-signal hover:underline flex items-center gap-1" onClick={() => applyPast(m)}><Check className="w-3 h-3" /> Apply</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}
