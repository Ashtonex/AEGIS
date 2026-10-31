"use client";

import { dateValue } from "./page";

type RecordData = Record<string, any>;

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat("en-ZW", { maximumFractionDigits: 2 }).format(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return dateValue(value);
  return String(value).replace(/_/g, " ");
}

function columnLabel(value: string) {
  return value.replace(/_/g, " ");
}

export function OperationList({ title, rows, columns, empty }: { title: string; rows: RecordData[]; columns: string[]; empty: string }) {
  return (
    <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-ink-mid bg-ink/30 px-4 py-3">
        <span className="font-mono text-xs tracking-wider uppercase text-slate">{title}</span>
        <span className="font-mono text-xs text-paper">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-light">{empty}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                {columns.map((column) => <th key={column} className="p-4">{columnLabel(column)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {rows.map((row, index) => (
                <tr key={row.id || index} className="hover:bg-ink-mid/10">
                  {columns.map((column) => (
                    <td key={column} className="p-4 text-slate-light">
                      <span className={/(status|stage|severity|outcome|type)$/.test(column) ? "capitalize" : ""}>{formatCell(row[column])}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
