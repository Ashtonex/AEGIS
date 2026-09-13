"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { getProjectPortfolio } from "@/lib/api";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

const ATTENTION_CLASSES: Record<string, string> = {
  good: "border-emerald-500/40 text-emerald-300 bg-emerald-950/20",
  watch: "border-amber-500/40 text-amber-300 bg-amber-950/20",
  at_risk: "border-red-500/40 text-red-300 bg-red-950/20",
};

const FACTOR_LABELS: Record<string, string> = {
  budget_overrun_ratio: "Budget Overrun Ratio",
  open_ccb_findings: "Open CCB Findings",
  retention_held: "Retention Held",
  pending_variation_age: "Pending Variation Age",
  gl_reconciliation_drift: "GL Reconciliation Drift",
};

const TRUTH_STATUS_CLASSES: Record<string, string> = {
  SYSTEM_GENERATED: "text-emerald-300",
  ESTIMATED: "text-amber-300",
  INCOMPLETE: "text-slate-light",
};

function FactorRow({ name, factor }: { name: string; factor: RecordData }) {
  const value = factor.value;
  const displayValue = value == null
    ? "-"
    : typeof value === "object"
    ? Object.entries(value).map(([k, v]) => `${k}: ${v ?? "-"}`).join(", ")
    : String(value);
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink-mid/50 py-1.5 text-xs last:border-0">
      <div>
        <span className="text-paper">{FACTOR_LABELS[name] || name}</span>
        <span className={`ml-2 font-mono text-[9px] uppercase ${TRUTH_STATUS_CLASSES[factor.truth_status] || "text-slate-light"}`}>
          {factor.truth_status}
        </span>
        <p className="mt-0.5 text-[10px] text-slate-light">{factor.note}</p>
      </div>
      <span className="shrink-0 text-right text-slate-light">{displayValue}</span>
    </div>
  );
}

export function ProjectPortfolioPanel() {
  const [rows, setRows] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getProjectPortfolio();
      setRows(res.data ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to load project portfolio.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Business reporting</p>
          <h2 className="mt-1 text-xl font-semibold text-paper">Project Portfolio</h2>
          <p className="mt-1 text-sm text-slate-light">Budget, forecast, and margin across active projects. Click a project to see its full health factor breakdown - never just the attention chip alone.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-sm border border-ink-mid px-3 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center rounded-sm border border-ink-mid bg-ink-light">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-light">No active projects to show.</p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-ink-mid bg-ink-light">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-ink-mid font-mono text-[11px] uppercase tracking-wider text-slate">
                <th className="p-4">Project</th>
                <th className="p-4">Approved Budget</th>
                <th className="p-4">Committed</th>
                <th className="p-4">Actual</th>
                <th className="p-4">EAC</th>
                <th className="p-4">Margin %</th>
                <th className="p-4">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {rows.map((r) => {
                const isExpanded = expanded === r.project_id;
                const marginPct = r.forecast_margin_pct;
                const marginTone = marginPct == null ? "text-slate-light" : marginPct >= 15 ? "text-emerald-400" : marginPct >= 5 ? "text-amber-400" : "text-red-400";
                return (
                  <Fragment key={r.project_id}>
                    <tr className="cursor-pointer hover:bg-ink-mid/10" onClick={() => setExpanded(isExpanded ? null : r.project_id)}>
                      <td className="p-4 text-paper">
                        <div className="flex items-center gap-1.5">
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-slate" /> : <ChevronDown className="h-3.5 w-3.5 text-slate" />}
                          {r.project_title}
                        </div>
                      </td>
                      <td className="p-4 text-paper">{money(r.approved_budget)}</td>
                      <td className="p-4 text-paper">{money(r.committed_cost)}</td>
                      <td className="p-4 text-paper">{money(r.actual_cost_to_date)}</td>
                      <td className="p-4 text-paper">{money(r.estimate_at_completion)}</td>
                      <td className={`p-4 ${marginTone}`}>{marginPct == null ? "-" : `${marginPct.toFixed(1)}%`}</td>
                      <td className="p-4">
                        <span className={`font-mono text-[10px] uppercase px-2 py-0.5 border rounded-sm ${ATTENTION_CLASSES[r.health?.attention_level] || ""}`}>
                          {r.health?.attention_level}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="bg-ink/40 p-4">
                          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate">Health factor breakdown</p>
                          {Object.entries(r.health?.factors || {}).map(([name, factor]) => (
                            <FactorRow key={name} name={name} factor={factor as RecordData} />
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
