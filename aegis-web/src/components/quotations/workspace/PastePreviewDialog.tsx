"use client";

/** Validation and column-mapping preview for pasted spreadsheet rows. */
import React, { useMemo, useState } from "react";
import { BoqLine, formatMoney, formatQty } from "./domain";
import { PASTE_FIELDS, PasteField, guessMapping, mapRows, parseClipboardTable } from "./paste";

interface Props {
  text: string;
  defaultSection: string;
  currency: string;
  onCancel: () => void;
  onConfirm: (lines: BoqLine[]) => void;
}

export function PastePreviewDialog({ text, defaultSection, currency, onCancel, onConfirm }: Props) {
  const table = useMemo(() => parseClipboardTable(text), [text]);
  const guess = useMemo(() => guessMapping(table), [table]);
  const [mapping, setMapping] = useState<PasteField[]>(guess.mapping);
  const [hasHeader, setHasHeader] = useState(guess.hasHeader);
  const rows = useMemo(() => mapRows(table, mapping, hasHeader, defaultSection), [table, mapping, hasHeader, defaultSection]);
  const valid = rows.filter((r) => r.line);
  const invalid = rows.filter((r) => !r.line);
  const duplicateTarget = mapping.filter((m) => m !== "ignore").length !== new Set(mapping.filter((m) => m !== "ignore")).size;
  const noDescription = !mapping.includes("description");

  return (
    <div className="fixed inset-0 z-50 bg-void/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="paste-title">
      <div className="bg-ink border border-ink-mid rounded-sm w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-ink-mid">
          <h2 id="paste-title" className="text-base font-semibold text-paper">Paste {table.length} row{table.length === 1 ? "" : "s"} into the BOQ</h2>
          <p className="text-xs text-slate mt-1">Check each column&apos;s meaning. Rows with errors are not imported; nothing is truncated or shifted silently.</p>
          <label className="text-xs text-slate flex items-center gap-2 mt-2">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> First row is a header
          </label>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-ink-light">
              <tr>
                <th className="p-1.5 text-left text-slate font-normal">Row</th>
                {mapping.map((m, i) => (
                  <th key={i} className="p-1.5 text-left">
                    <select aria-label={`Column ${i + 1} meaning`} className="bg-void border border-ink-mid rounded-sm text-xs text-paper px-1 py-0.5" value={m}
                      onChange={(e) => setMapping(mapping.map((x, j) => (j === i ? (e.target.value as PasteField) : x)))}>
                      {PASTE_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  </th>
                ))}
                <th className="p-1.5 text-left text-slate font-normal">Result</th>
              </tr>
            </thead>
            <tbody>
              {(hasHeader ? table.slice(1) : table).slice(0, 300).map((cells, r) => {
                const result = rows[r];
                return (
                  <tr key={r} className={`border-t border-ink-mid ${result.line ? "" : "bg-danger/10"}`}>
                    <td className="p-1.5 text-slate font-mono">{result.sourceRow}</td>
                    {mapping.map((_, c) => <td key={c} className="p-1.5 text-paper max-w-[260px] truncate" title={cells[c]}>{cells[c]}</td>)}
                    <td className="p-1.5">
                      {result.line ? (
                        <span className="text-success">{result.line.item_type === "note" ? "note" : `${formatQty(result.line.qty)} ${result.line.unit} @ ${formatMoney(result.line.rate, currency)}`}</span>
                      ) : null}
                      {[...result.errors, ...result.warnings].map((m, k) => (
                        <div key={k} className={k < result.errors.length ? "text-danger" : "text-warning"}>{m}</div>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {table.length > 300 && <p className="p-2 text-xs text-slate">Showing the first 300 rows; all {table.length} are validated.</p>}
        </div>
        <div className="p-4 border-t border-ink-mid flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate">
            {valid.length} valid · <span className={invalid.length ? "text-danger" : ""}>{invalid.length} with errors</span>
            {duplicateTarget && <span className="text-danger"> · two columns map to the same field</span>}
            {noDescription && <span className="text-danger"> · map a Description column</span>}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs border border-ink-mid rounded-sm text-slate hover:text-paper">Cancel</button>
            <button type="button" disabled={!valid.length || duplicateTarget || noDescription}
              onClick={() => onConfirm(valid.map((r) => r.line!))}
              className="px-3 py-1.5 text-xs rounded-sm bg-signal text-void font-semibold disabled:opacity-40">
              Insert {valid.length} line{valid.length === 1 ? "" : "s"}{invalid.length ? ` (skip ${invalid.length})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
