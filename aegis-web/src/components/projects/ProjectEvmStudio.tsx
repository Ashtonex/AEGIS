"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  TrendingUp,
  DollarSign,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Layers,
  HelpCircle,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  FileSpreadsheet,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getProjectEvmAnalytics, type ProjectEvmData } from "@/lib/api/projects";

interface ProjectEvmStudioProps {
  projectId: string;
}

export function ProjectEvmStudio({ projectId }: ProjectEvmStudioProps) {
  const [data, setData] = useState<ProjectEvmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvm = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getProjectEvmAnalytics(projectId);
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.message || "Failed to load EVM analytics.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error connecting to EVM analytics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEvm();
  }, [projectId]);

  const kpis = data?.kpis;
  const sCurve = data?.s_curve || [];

  // SVG Chart Dimensions & Math
  const chartWidth = 800;
  const chartHeight = 280;
  const padding = { top: 20, right: 30, bottom: 40, left: 70 };

  const maxValue = useMemo(() => {
    if (!sCurve.length) return 100000;
    let max = kpis?.budget_at_completion || 100000;
    for (const pt of sCurve) {
      if (pt.planned_value > max) max = pt.planned_value;
      if (pt.earned_value && pt.earned_value > max) max = pt.earned_value;
      if (pt.actual_cost && pt.actual_cost > max) max = pt.actual_cost;
    }
    return max * 1.15; // 15% headroom
  }, [sCurve, kpis]);

  const getCoordinates = (index: number, val: number | null | undefined) => {
    if (val === null || val === undefined || sCurve.length <= 1) return null;
    const x = padding.left + (index / (sCurve.length - 1)) * (chartWidth - padding.left - padding.right);
    const y = chartHeight - padding.bottom - (val / maxValue) * (chartHeight - padding.top - padding.bottom);
    return { x, y };
  };

  const plannedPath = useMemo(() => {
    return sCurve
      .map((pt, i) => {
        const coords = getCoordinates(i, pt.planned_value);
        return coords ? `${i === 0 ? "M" : "L"} ${coords.x.toFixed(1)} ${coords.y.toFixed(1)}` : "";
      })
      .filter(Boolean)
      .join(" ");
  }, [sCurve, maxValue]);

  const earnedPath = useMemo(() => {
    let first = true;
    return sCurve
      .map((pt, i) => {
        const coords = getCoordinates(i, pt.earned_value);
        if (!coords) return "";
        const cmd = first ? "M" : "L";
        first = false;
        return `${cmd} ${coords.x.toFixed(1)} ${coords.y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(" ");
  }, [sCurve, maxValue]);

  const actualPath = useMemo(() => {
    let first = true;
    return sCurve
      .map((pt, i) => {
        const coords = getCoordinates(i, pt.actual_cost);
        if (!coords) return "";
        const cmd = first ? "M" : "L";
        first = false;
        return `${cmd} ${coords.x.toFixed(1)} ${coords.y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(" ");
  }, [sCurve, maxValue]);

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center border border-ink-mid bg-ink/70">
        <div className="flex items-center gap-2.5 font-mono text-xs text-slate-light">
          <RefreshCw className="h-4 w-4 animate-spin text-signal" />
          <span>Synthesizing Earned Value Commercial S-Curves...</span>
        </div>
      </div>
    );
  }

  if (error || !kpis) {
    return (
      <div className="border border-red-500/30 bg-red-950/20 p-5 text-sm text-red-200">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          <span>{error || "Could not calculate EVM indices."}</span>
        </div>
        <button
          onClick={() => void loadEvm()}
          className="mt-3 px-3 py-1 font-mono text-xs uppercase tracking-wider border border-red-500/40 hover:bg-red-900/40 text-paper"
        >
          Retry Analysis
        </button>
      </div>
    );
  }

  const cpiHealthy = kpis.cost_performance_index >= 1.0;
  const spiHealthy = kpis.schedule_performance_index >= 1.0;

  return (
    <div className="space-y-6">
      {/* Executive Header Banner */}
      <div className="border border-ink-mid bg-ink/80 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 border border-signal/40 bg-signal/10 text-signal">
              Commercial Control
            </span>
            <span className="font-mono text-xs text-slate-light">
              As of: {data.as_of_date}
            </span>
          </div>
          <h2 className="mt-1.5 font-display text-lg sm:text-xl font-bold text-paper flex items-center gap-2">
            Earned Value Management (EVM) S-Curve Studio
          </h2>
          <p className="mt-0.5 text-xs text-slate-light max-w-2xl leading-relaxed">
            Rigorous mathematical verification of cost efficiency (CPI), schedule velocity (SPI),
            and forecast at completion (EAC) calculated against certified subcontracts and CPM programme.
          </p>
        </div>

        <button
          onClick={() => void loadEvm()}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 border border-ink-mid bg-ink-light font-mono text-xs text-slate-light hover:text-paper hover:border-signal transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-signal" : ""}`} />
          <span>Recalculate Indices</span>
        </button>
      </div>

      {/* Primary EVM Quadrant Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Planned Value (PV) */}
        <div className="border border-ink-mid bg-ink/70 p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate">
            <span>PLANNED VALUE (PV)</span>
            <Calendar className="h-4 w-4 text-sky-400 shrink-0" />
          </div>
          <p className="mt-2 font-display text-lg sm:text-2xl font-bold text-sky-300">
            {formatCurrency(kpis.planned_value)}
          </p>
          <p className="mt-1 text-[11px] text-slate-light">
            Target progress: <span className="font-mono font-bold text-paper">{kpis.planned_progress_pct}%</span>
          </p>
        </div>

        {/* Earned Value (EV) */}
        <div className="border border-ink-mid bg-ink/70 p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate">
            <span>EARNED VALUE (EV)</span>
            <TrendingUp className="h-4 w-4 text-emerald-400 shrink-0" />
          </div>
          <p className="mt-2 font-display text-lg sm:text-2xl font-bold text-emerald-400">
            {formatCurrency(kpis.earned_value)}
          </p>
          <p className="mt-1 text-[11px] text-slate-light">
            Physical progress: <span className="font-mono font-bold text-paper">{kpis.physical_progress_pct}%</span>
          </p>
        </div>

        {/* Actual Cost (AC) */}
        <div className="border border-ink-mid bg-ink/70 p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate">
            <span>ACTUAL COST (AC)</span>
            <DollarSign className="h-4 w-4 text-amber-400 shrink-0" />
          </div>
          <p className="mt-2 font-display text-lg sm:text-2xl font-bold text-amber-300">
            {formatCurrency(kpis.actual_cost)}
          </p>
          <p className="mt-1 text-[11px] text-slate-light">
            Certified to date
          </p>
        </div>

        {/* Budget at Completion (BAC) */}
        <div className="border border-ink-mid bg-ink/70 p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate">
            <span>BUDGET AT COMPLETION (BAC)</span>
            <Layers className="h-4 w-4 text-purple-400 shrink-0" />
          </div>
          <p className="mt-2 font-display text-lg sm:text-2xl font-bold text-purple-300">
            {formatCurrency(kpis.budget_at_completion)}
          </p>
          <p className="mt-1 text-[11px] text-slate-light">
            Baseline approved ceiling
          </p>
        </div>
      </div>

      {/* EVM Performance Indices Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* CPI */}
        <div className={`border p-4 ${cpiHealthy ? "border-emerald-500/30 bg-emerald-950/10" : "border-red-500/30 bg-red-950/10"}`}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-slate-light">Cost Performance (CPI)</span>
            {cpiHealthy ? (
              <span className="flex items-center text-xs font-bold text-emerald-400">
                <ArrowUpRight className="h-4 w-4 mr-0.5" /> Healthy
              </span>
            ) : (
              <span className="flex items-center text-xs font-bold text-red-400">
                <ArrowDownRight className="h-4 w-4 mr-0.5" /> Overrun
              </span>
            )}
          </div>
          <p className={`mt-2 font-display text-3xl font-bold ${cpiHealthy ? "text-emerald-400" : "text-red-400"}`}>
            {kpis.cost_performance_index.toFixed(2)}
          </p>
          <p className="mt-1.5 text-xs text-slate-light leading-snug">
            Yielding <span className="text-paper font-bold">${kpis.cost_performance_index.toFixed(2)}</span> of value per $1.00 spent.
            Cost Variance: <span className={kpis.cost_variance >= 0 ? "text-emerald-400" : "text-red-400"}>{formatCurrency(kpis.cost_variance)}</span>
          </p>
        </div>

        {/* SPI */}
        <div className={`border p-4 ${spiHealthy ? "border-emerald-500/30 bg-emerald-950/10" : "border-amber-500/30 bg-amber-950/10"}`}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-slate-light">Schedule Performance (SPI)</span>
            {spiHealthy ? (
              <span className="flex items-center text-xs font-bold text-emerald-400">
                <ArrowUpRight className="h-4 w-4 mr-0.5" /> On Target
              </span>
            ) : (
              <span className="flex items-center text-xs font-bold text-amber-400">
                <ArrowDownRight className="h-4 w-4 mr-0.5" /> Lagging
              </span>
            )}
          </div>
          <p className={`mt-2 font-display text-3xl font-bold ${spiHealthy ? "text-emerald-400" : "text-amber-400"}`}>
            {kpis.schedule_performance_index.toFixed(2)}
          </p>
          <p className="mt-1.5 text-xs text-slate-light leading-snug">
            Progressing at <span className="text-paper font-bold">{(kpis.schedule_performance_index * 100).toFixed(0)}%</span> of planned pace.
            Schedule Variance: <span className={kpis.schedule_variance >= 0 ? "text-emerald-400" : "text-amber-400"}>{formatCurrency(kpis.schedule_variance)}</span>
          </p>
        </div>

        {/* EAC */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate">
            <span>ESTIMATE AT COMPLETION</span>
            <Activity className="h-4 w-4 text-signal shrink-0" />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-paper">
            {formatCurrency(kpis.estimate_at_completion)}
          </p>
          <p className="mt-1.5 text-xs text-slate-light leading-snug">
            Variance at Completion (VAC):{" "}
            <span className={kpis.variance_at_completion >= 0 ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
              {formatCurrency(kpis.variance_at_completion)}
            </span>
          </p>
        </div>

        {/* TCPI */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate">
            <span>TO-COMPLETE INDEX (TCPI)</span>
            <HelpCircle className="h-4 w-4 text-slate shrink-0" />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-paper">
            {kpis.to_complete_performance_index.toFixed(2)}
          </p>
          <p className="mt-1.5 text-xs text-slate-light leading-snug">
            Required efficiency on remaining work to finish within approved BAC budget.
          </p>
        </div>
      </div>

      {/* Visual S-Curve Graph Canvas */}
      <div className="border border-ink-mid bg-ink/90 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-ink-mid gap-3">
          <div>
            <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">
              Cumulative Commercial S-Curve Trajectory
            </h3>
            <p className="text-xs text-slate-light mt-0.5">
              Comparison of Planned Value (PV), Earned Value (EV), and Actual Cost (AC) over project lifecycle.
            </p>
          </div>

          {/* S-Curve Legend */}
          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 bg-sky-400 inline-block border-b border-dashed" />
              <span className="text-slate-light">Planned (PV)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-1 bg-emerald-400 inline-block" />
              <span className="text-slate-light">Earned (EV)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-1 bg-amber-400 inline-block" />
              <span className="text-slate-light">Actual (AC)</span>
            </div>
          </div>
        </div>

        {/* SVG Drawing Area */}
        <div className="mt-6 w-full overflow-x-auto">
          <div className="min-w-[650px]">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto overflow-visible">
              {/* Horizontal grid lines */}
              {[0, 0.25, 0.5, 0.75, 1.0].map((frac, idx) => {
                const y = chartHeight - padding.bottom - frac * (chartHeight - padding.top - padding.bottom);
                const val = maxValue * frac;
                return (
                  <g key={idx}>
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={chartWidth - padding.right}
                      y2={y}
                      stroke="rgba(255,255,255,0.08)"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={padding.left - 8}
                      y={y + 4}
                      textAnchor="end"
                      fill="rgba(255,255,255,0.4)"
                      className="text-[10px] font-mono"
                    >
                      {val >= 1000000 ? `$${(val / 1000000).toFixed(1)}M` : `$${Math.round(val / 1000)}k`}
                    </text>
                  </g>
                );
              })}

              {/* X-axis Month Labels */}
              {sCurve.map((pt, idx) => {
                const x = padding.left + (idx / Math.max(1, sCurve.length - 1)) * (chartWidth - padding.left - padding.right);
                return (
                  <text
                    key={idx}
                    x={x}
                    y={chartHeight - 12}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.5)"
                    className="text-[10px] font-mono"
                  >
                    {pt.label}
                  </text>
                );
              })}

              {/* Curves */}
              {plannedPath && (
                <path
                  d={plannedPath}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2.5"
                  strokeDasharray="6 4"
                />
              )}
              {earnedPath && (
                <path
                  d={earnedPath}
                  fill="none"
                  stroke="#34d399"
                  strokeWidth="3"
                />
              )}
              {actualPath && (
                <path
                  d={actualPath}
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="3"
                />
              )}

              {/* Data points (circles) for Earned & Actual */}
              {sCurve.map((pt, idx) => {
                const earnedCoords = getCoordinates(idx, pt.earned_value);
                const actualCoords = getCoordinates(idx, pt.actual_cost);
                return (
                  <g key={idx}>
                    {earnedCoords && (
                      <circle
                        cx={earnedCoords.x}
                        cy={earnedCoords.y}
                        r="4"
                        fill="#34d399"
                        stroke="#0a0a0c"
                        strokeWidth="2"
                      />
                    )}
                    {actualCoords && (
                      <circle
                        cx={actualCoords.x}
                        cy={actualCoords.y}
                        r="4"
                        fill="#fbbf24"
                        stroke="#0a0a0c"
                        strokeWidth="2"
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      {/* S-Curve Monthly Trajectory Data Table */}
      <div className="border border-ink-mid bg-ink/80">
        <div className="p-4 border-b border-ink-mid flex items-center justify-between">
          <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
            S-Curve Monthly Performance Register
          </h4>
          <span className="font-mono text-[10px] text-slate-light">
            {sCurve.length} Milestone Epochs
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-ink-light text-slate-light border-b border-ink-mid">
              <tr>
                <th className="p-3">Period</th>
                <th className="p-3 text-right">Planned Value (PV)</th>
                <th className="p-3 text-right">Earned Value (EV)</th>
                <th className="p-3 text-right">Actual Cost (AC)</th>
                <th className="p-3 text-right">Cost Variance (CV)</th>
                <th className="p-3 text-right">Schedule Variance (SV)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid/60 text-slate-light">
              {sCurve.map((pt, idx) => {
                const ptEv = pt.earned_value;
                const ptAc = pt.actual_cost;
                const cv = ptEv !== null && ptAc !== null ? ptEv - ptAc : null;
                const sv = ptEv !== null ? ptEv - pt.planned_value : null;

                return (
                  <tr key={idx} className="hover:bg-ink-light/40 transition-colors">
                    <td className="p-3 text-paper font-bold">{pt.label}</td>
                    <td className="p-3 text-right text-sky-400">{formatCurrency(pt.planned_value)}</td>
                    <td className="p-3 text-right text-emerald-400">
                      {ptEv !== null ? formatCurrency(ptEv) : "—"}
                    </td>
                    <td className="p-3 text-right text-amber-400">
                      {ptAc !== null ? formatCurrency(ptAc) : "—"}
                    </td>
                    <td className="p-3 text-right">
                      {cv !== null ? (
                        <span className={cv >= 0 ? "text-emerald-400" : "text-red-400 font-bold"}>
                          {formatCurrency(cv)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {sv !== null ? (
                        <span className={sv >= 0 ? "text-emerald-400" : "text-amber-400 font-bold"}>
                          {formatCurrency(sv)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
