"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { getFinanceDepartments, getFinanceStatements } from "@/lib/api";

type RecordData = Record<string, any>;
type PeriodType = "day" | "week" | "month" | "quarter" | "year";

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateLabel(value: unknown) {
  if (!value) return "";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { dateStyle: "medium" }).format(d);
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";

const PERIODS: { value: PeriodType; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

export function FinancialStatementsPanel() {
  const [departments, setDepartments] = useState<RecordData[]>([]);
  const [statement, setStatement] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodType>("month");
  const [anchorDate, setAnchorDate] = useState(today());
  const [departmentId, setDepartmentId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [deptRes, stmtRes] = await Promise.allSettled([
        getFinanceDepartments(),
        getFinanceStatements({ period, anchor_date: anchorDate, department_id: departmentId || undefined }),
      ]);
      if (deptRes.status === "fulfilled") setDepartments(deptRes.value.data ?? []);
      if (stmtRes.status === "fulfilled") setStatement(stmtRes.value.data ?? null);
      else setError("Financial statement could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [period, anchorDate, departmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const segment = statement?.segment;
  const revenue = segment?.total_revenue ?? 0;
  const cost = segment?.total_cost ?? 0;
  const net = segment?.net ?? 0;
  const marginPct = revenue > 0 ? (net / revenue) * 100 : 0;
  const marginTone = marginPct >= 15 ? "text-emerald-400" : marginPct >= 5 ? "text-amber-400" : "text-red-400";

  const cash = statement?.cash_position;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Business reporting</p>
          <h2 className="mt-1 text-xl font-semibold text-paper">Financial Statements</h2>
          <p className="mt-1 text-sm text-slate-light">Revenue, cost, and cash position by period and business segment.</p>
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

      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-ink-mid bg-ink-light p-4">
        <div className="flex overflow-hidden rounded-sm border border-ink-mid">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${period === p.value ? "bg-signal text-ink" : "bg-ink text-slate hover:text-paper"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div>
          <label className="mb-1 block text-xs font-mono uppercase text-slate">Anchor date</label>
          <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-mono uppercase text-slate">Segment</label>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={inputClass}>
            <option value="">All (consolidated)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        {statement?.period && (
          <p className="ml-auto font-mono text-xs text-slate-light">
            {dateLabel(statement.period.date_from)} - {dateLabel(statement.period.date_to)}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center rounded-sm border border-ink-mid bg-ink-light">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Revenue</p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-paper">
                <TrendingUp className="h-4 w-4 text-emerald-400" /> {money(revenue)}
              </p>
            </div>
            <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Cost</p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-paper">
                <TrendingDown className="h-4 w-4 text-red-400" /> {money(cost)}
              </p>
            </div>
            <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Net</p>
              <p className={`mt-1 text-lg font-semibold tracking-tight ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(net)}</p>
            </div>
            <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Margin</p>
              <p className={`mt-1 text-lg font-semibold tracking-tight ${marginTone}`}>{marginPct.toFixed(1)}%</p>
            </div>
          </div>

          <div className="rounded-sm border border-ink-mid bg-ink-light p-4">
            <div className="mb-3 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-slate" />
              <span className="font-mono text-xs uppercase tracking-wider text-slate">Cash position</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-light">Total cash</p>
                <p className="mt-1 text-xl font-semibold text-paper">{money(cash?.total_cash)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-light">Trailing monthly burn</p>
                <p className="mt-1 text-xl font-semibold text-paper">{money(cash?.trailing_monthly_burn)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-light">Runway</p>
                <p className="mt-1 text-xl font-semibold text-paper">
                  {cash?.runway_months != null ? `${cash.runway_months} months` : "No burn recorded"}
                </p>
              </div>
            </div>
          </div>

          {!departmentId && statement?.departments && statement.departments.length > 0 && (
            <div className="overflow-hidden rounded-sm border border-ink-mid bg-ink-light">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light font-mono text-[11px] uppercase tracking-wider text-slate">
                    <th className="p-4">Segment</th>
                    <th className="p-4">Revenue</th>
                    <th className="p-4">Cost</th>
                    <th className="p-4">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {statement.departments.map((d: RecordData) => (
                    <tr key={d.department_id ?? "unassigned"} className="hover:bg-ink-mid/10">
                      <td className="p-4 text-paper">{d.department_name}</td>
                      <td className="p-4 text-paper">{money(d.total_revenue)}</td>
                      <td className="p-4 text-paper">{money(d.total_cost)}</td>
                      <td className={`p-4 ${d.net >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(d.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
