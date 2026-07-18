"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Loader2, RefreshCw, X, TrendingUp, TrendingDown,
  Activity, Users, Truck, ShoppingCart, ShieldCheck, Flame, PieChart, BarChart
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  getAnalyticsExceptions,
  getAnalyticsProjectPerformance,
  getAnalyticsEquipmentIntelligence,
  getAnalyticsProcurement,
  getAnalyticsWorkforce
} from "@/lib/api";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function percent(value: unknown) {
  const num = Number(value);
  return `${(Number.isFinite(num) ? num : 0).toFixed(1)}%`;
}

function statusClass(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (["compliant", "on_track"].includes(normalized)) {
    return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  }
  if (["warning", "delayed"].includes(normalized)) {
    return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  }
  if (["critical", "overdue"].includes(normalized)) {
    return "border-red-500/30 bg-red-950/20 text-red-300";
  }
  return "border-slate-500/30 bg-slate-950/20 text-slate-300";
}

function loadFailureMessage(reason: unknown) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  const normalizedMessage = rawMessage.toLowerCase();
  if (
    normalizedMessage.includes("signal is aborted") ||
    normalizedMessage.includes("operation was aborted") ||
    normalizedMessage.includes("aborterror") ||
    normalizedMessage.includes("timeouterror")
  ) {
    return "The analytics feed is still synchronizing. Please retry once the connection is ready.";
  }
  return "Failed to load decision intelligence analytics.";
}

function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  return fallback;
}

export default function AnalyticsDashboard() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Finance Manager"]}>
      <AnalyticsWorkspace />
    </RBACGuard>
  );
}

function AnalyticsWorkspace() {
  const [activeTab, setActiveTab] = useState<"projects" | "equipment" | "procurement" | "workforce">("projects");
  const [exceptions, setExceptions] = useState<RecordData[]>([]);
  const [projectPerformance, setProjectPerformance] = useState<RecordData[]>([]);
  const [equipmentIntel, setEquipmentIntel] = useState<RecordData[]>([]);
  const [procurementIntel, setProcurementIntel] = useState<RecordData[]>([]);
  const [workforceIntel, setWorkforceIntel] = useState<RecordData[]>([]);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [exceptionsRes, projRes, equipRes, procRes, workforceRes] = await Promise.allSettled([
        getAnalyticsExceptions(),
        getAnalyticsProjectPerformance(),
        getAnalyticsEquipmentIntelligence(),
        getAnalyticsProcurement(),
        getAnalyticsWorkforce()
      ]);

      const warnings: string[] = [];
      if (exceptionsRes.status === "fulfilled") setExceptions(exceptionsRes.value.data || []);
      else warnings.push("Active decision signals could not be loaded.");
      if (projRes.status === "fulfilled") setProjectPerformance(projRes.value.data || []);
      else warnings.push("Project performance analytics could not be loaded.");
      if (equipRes.status === "fulfilled") setEquipmentIntel(equipRes.value.data || []);
      else warnings.push("Fleet utilisation analytics could not be loaded.");
      if (procRes.status === "fulfilled") setProcurementIntel(procRes.value.data || []);
      else warnings.push("Procurement analytics could not be loaded.");
      if (workforceRes.status === "fulfilled") setWorkforceIntel(workforceRes.value.data || []);
      else warnings.push("Workforce analytics could not be loaded.");
      setSourceWarnings(warnings);
      if (exceptionsRes.status === "rejected") {
        throw new Error(loadFailureMessage(exceptionsRes.reason));
      }
    } catch (err) {
      setError(loadFailureMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center bg-ink">
        <Loader2 className="h-8 w-8 animate-spin text-signal" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-semibold text-paper tracking-tight font-display">Analytics & Decision Intelligence</h1>
        <p className="text-sm text-slate-light font-sans mt-0.5">SNC predictive metrics, automated margin erosion exceptions, and project utilization logs.</p>
      </div>
      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <div>
            <p className="font-semibold">Analytics data could not be loaded.</p>
            <p className="mt-1 text-red-100/80">{error}</p>
          </div>
        </div>
      )}
      {sourceWarnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          {sourceWarnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p>{warning}</p>
            </div>
          ))}
        </div>
      )}

      {/* Exception Alerts Panel (Top Priority) */}
      <div className="bg-ink-light border border-ink-mid p-5 rounded-sm space-y-4">
        <div className="flex justify-between items-center border-b border-ink-mid pb-3">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-signal" />
            <span className="text-sm font-semibold text-paper tracking-wider uppercase font-mono">Active Exceptions & Signals</span>
          </div>
          <span className="text-[10px] font-mono bg-red-950/20 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-sm">
            {exceptions.length} Alert Signals
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {exceptions.length === 0 ? (
            <EmptyPanel title="No active decision signals" detail="No source-backed exceptions are currently returned by the Executive Command Centre." />
          ) : exceptions.map((e) => (
            <div key={e.id} className="bg-ink border border-ink-mid p-4 rounded-sm flex items-start space-x-3 hover:border-signal/30 transition-all">
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${e.severity === 'critical' ? 'bg-red-500 animate-pulse' : 'bg-amber-400'}`} />
              <div className="space-y-1 flex-1">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-semibold text-paper">{e.title}</h3>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border capitalize ${statusClass(e.severity === 'critical' ? 'critical' : 'warning')}`}>
                    {e.severity}
                  </span>
                </div>
                <p className="text-[11px] text-slate-light">{e.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-ink-mid">
        <button
          onClick={() => setActiveTab("projects")}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "projects" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Project Margin Trends
        </button>
        <button
          onClick={() => setActiveTab("equipment")}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "equipment" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Fleet Productivity
        </button>
        <button
          onClick={() => setActiveTab("procurement")}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "procurement" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Spend & Supplier SLA
        </button>
        <button
          onClick={() => setActiveTab("workforce")}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "workforce" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Labour Allocation
        </button>
      </div>

      {/* Tab Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main analytics data */}
        <div className="lg:col-span-2 bg-ink-light border border-ink-mid rounded-sm overflow-hidden p-5">
          {activeTab === "projects" && (
            <div className="space-y-6">
              <h3 className="text-xs font-semibold text-paper font-mono uppercase tracking-wider">Project Forecast EAC vs Budget</h3>
              {projectPerformance.length === 0 ? (
                <EmptyPanel title="No project performance records" detail="Project analytics will populate when project budgets and cost transactions exist." />
              ) : (
                <div className="space-y-4">
                  {projectPerformance.map((p) => {
                    const pctVal = Math.min(100, (p.actual_cost / p.budget_value) * 100);
                    return (
                      <div key={p.id} className="space-y-1">
                        <div className="flex justify-between text-xs text-paper">
                          <span>{p.project_name}</span>
                          <span>{percent(pctVal)} spent</span>
                        </div>
                        <div className="w-full bg-ink h-3 rounded overflow-hidden">
                          <div className="bg-signal h-full" style={{ width: `${pctVal}%` }}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "equipment" && (
            <div className="space-y-6">
              <h3 className="text-xs font-semibold text-paper font-mono uppercase tracking-wider">Asset Utilisation Ratios</h3>
              {equipmentIntel.length === 0 ? <EmptyPanel title="No fleet utilisation records" detail="Equipment intelligence will populate from fleet utilisation logs." /> : <div className="space-y-4">{equipmentIntel.map((asset) => { const utilisation = Number(asset.utilisation) || 0; return <div key={String(asset.id)} className="space-y-2"><div className="flex justify-between text-xs text-slate-light font-mono"><span>{asset.asset}</span><span>{percent(utilisation)} utilisation · margin {money(asset.margin)}</span></div><div className="w-full bg-ink h-3 rounded-sm overflow-hidden"><div className={utilisation >= 75 ? "bg-emerald-500 h-full" : "bg-amber-500 h-full"} style={{ width: `${Math.min(100, utilisation)}%` }} /></div></div>; })}</div>}
            </div>
          )}

          {activeTab === "procurement" && (
            <div className="space-y-6">
              <h3 className="text-xs font-semibold text-paper font-mono uppercase tracking-wider">Supplier SLA and matching signals</h3>
              {procurementIntel.length === 0 ? <EmptyPanel title="No procurement analytics records" detail="Supplier intelligence will populate from purchase orders, GRNs and invoice matching." /> : <div className="space-y-3">{procurementIntel.map((supplier) => <div key={String(supplier.id)} className="flex items-center justify-between gap-4 border border-ink-mid bg-ink p-3 text-xs"><div><p className="font-semibold text-paper">{supplier.supplier}</p><p className="mt-1 text-slate-light">{supplier.pos_issued} POs · {supplier.quality_issues} invoice/quality issues</p></div><span className="font-mono text-slate-light">{percent(supplier.on_time_delivery_pct)} on time · {Number(supplier.avg_lead_time_days || 0).toFixed(1)}d lead</span></div>)}</div>}
            </div>
          )}

          {activeTab === "workforce" && (
            <div className="space-y-6">
              <h3 className="text-xs font-semibold text-paper font-mono uppercase tracking-wider">Labour Cost Allocation</h3>
              {workforceIntel.length === 0 ? <EmptyPanel title="No workforce analytics records" detail="Labour allocation will populate from attendance and labour cost transactions." /> : <div className="space-y-4">{workforceIntel.map((row) => { const maxCost = Math.max(...workforceIntel.map((item) => Number(item.labour_cost) || 0), 1); const width = ((Number(row.labour_cost) || 0) / maxCost) * 100; return <div key={String(row.id)} className="space-y-1"><div className="flex justify-between text-xs text-paper"><span>{row.project}</span><span className="font-mono">{money(row.labour_cost)} · attendance {percent(row.attendance_rate)} · OT {percent(row.ot_ratio)}</span></div><div className="w-full bg-ink h-3 rounded overflow-hidden"><div className="bg-purple-500 h-full" style={{ width: `${Math.min(100, width)}%` }} /></div></div>; })}</div>}
            </div>
          )}
        </div>

        {/* Right side analytics intelligence panel */}
        <div className="space-y-6">
          <div className="bg-ink-light border border-ink-mid p-5 rounded-sm space-y-4">
            <h2 className="text-sm font-semibold text-paper tracking-wider uppercase font-mono border-b border-ink-mid pb-3">Decision Signals</h2>
            <div className="space-y-4">
              {exceptions.slice(0, 2).length === 0 ? <EmptyPanel title="No decision signal narrative" detail="Narratives are generated only when source-backed exceptions exist." /> : exceptions.slice(0, 2).map((signal) => <div key={`signal-${String(signal.id)}`} className="bg-ink p-4 border border-ink-mid rounded-sm space-y-2">
                <div className="flex items-center space-x-2">
                  <Flame className="h-4 w-4 text-red-500" />
                  <span className="text-xs font-bold text-paper font-mono uppercase">{signal.category || signal.title || "Executive signal"}</span>
                </div>
                <p className="text-xs text-slate-light">
                  {signal.action || signal.desc || "Review the linked operational record for corrective action."}
                </p>
              </div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return <div className="border border-dashed border-ink-mid bg-ink p-5 text-center"><p className="text-sm font-semibold text-paper">{title}</p><p className="mt-1 text-xs text-slate-light">{detail}</p></div>;
}
