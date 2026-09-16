"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertTriangle, Loader2, RefreshCw, X, TrendingUp, TrendingDown,
  Activity, Users, Truck, ShoppingCart, ShieldCheck, Flame, PieChart, BarChart
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  getAnalyticsExceptions,
  getAnalyticsProjectPerformance,
  getAnalyticsEquipmentIntelligence,
  getAnalyticsProcurement,
  getAnalyticsWorkforce
} from "@/lib/api";

// Only the active tab's panel ships to the browser, and loadData below only
// fetches that tab's one data source (plus the always-shown exceptions
// panel) instead of all 4 analytics sources on every page regardless of
// which tab is open.
function PanelLoading() {
  return <Skeleton className="h-48 w-full" />;
}
const ProjectPerformancePanel = dynamic(() => import("./AnalyticsTabPanels").then((m) => m.ProjectPerformancePanel), { loading: PanelLoading });
const EquipmentIntelPanel = dynamic(() => import("./AnalyticsTabPanels").then((m) => m.EquipmentIntelPanel), { loading: PanelLoading });
const ProcurementIntelPanel = dynamic(() => import("./AnalyticsTabPanels").then((m) => m.ProcurementIntelPanel), { loading: PanelLoading });
const WorkforceIntelPanel = dynamic(() => import("./AnalyticsTabPanels").then((m) => m.WorkforceIntelPanel), { loading: PanelLoading });

type RecordData = Record<string, any>;
type AnalyticsTab = "projects" | "equipment" | "procurement" | "workforce";

const TAB_ROUTES: Record<AnalyticsTab, string> = {
  projects: "/dashboard/analytics/projects",
  equipment: "/dashboard/analytics/equipment",
  procurement: "/dashboard/analytics/procurement",
  workforce: "/dashboard/analytics/workforce",
};

const ANALYTICS_TAB_LABELS: Record<AnalyticsTab, string> = {
  projects: "Analytics & Decision Intelligence",
  equipment: "Fleet Productivity",
  procurement: "Spend & Supplier SLA",
  workforce: "Labour Allocation",
};

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
  return <AnalyticsPage initialTab="projects" />;
}

/** Shared Analytics workspace, rendered by a real route per tab (see the
 * sibling folders here) instead of the old analytics/[tab] -> redirect() ->
 * ?tab= shim. */
export function AnalyticsPage({ initialTab }: { initialTab: AnalyticsTab }) {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Finance Manager", "Commercial Manager", "Executive Read Only"]}>
      <AnalyticsWorkspace initialTab={initialTab} />
    </RBACGuard>
  );
}

function AnalyticsWorkspace({ initialTab }: { initialTab: AnalyticsTab }) {
  const activeTab = initialTab;
  const [exceptions, setExceptions] = useState<RecordData[]>([]);
  const [projectPerformance, setProjectPerformance] = useState<RecordData[]>([]);
  const [equipmentIntel, setEquipmentIntel] = useState<RecordData[]>([]);
  const [procurementIntel, setProcurementIntel] = useState<RecordData[]>([]);
  const [workforceIntel, setWorkforceIntel] = useState<RecordData[]>([]);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only the source the active tab actually renders is fetched, alongside
  // the exceptions panel shown on every tab - previously all 4 tab sources
  // loaded on every page load regardless of which tab was open.
  const tabSourceFetchers: Record<AnalyticsTab, { label: string; run: () => Promise<{ data?: RecordData[] }>; apply: (data: RecordData[]) => void }> = {
    projects: { label: "Project performance analytics", run: getAnalyticsProjectPerformance, apply: setProjectPerformance },
    equipment: { label: "Fleet utilisation analytics", run: getAnalyticsEquipmentIntelligence, apply: setEquipmentIntel },
    procurement: { label: "Procurement analytics", run: getAnalyticsProcurement, apply: setProcurementIntel },
    workforce: { label: "Workforce analytics", run: getAnalyticsWorkforce, apply: setWorkforceIntel },
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tabSource = tabSourceFetchers[activeTab];
      const [exceptionsRes, tabRes] = await Promise.allSettled([
        getAnalyticsExceptions(),
        tabSource.run(),
      ]);

      const warnings: string[] = [];
      if (exceptionsRes.status === "fulfilled") setExceptions(exceptionsRes.value.data || []);
      else warnings.push("Active decision signals could not be loaded.");
      if (tabRes.status === "fulfilled") tabSource.apply(tabRes.value.data || []);
      else warnings.push(`${tabSource.label} could not be loaded.`);
      setSourceWarnings(warnings);
      if (exceptionsRes.status === "rejected") {
        throw new Error(loadFailureMessage(exceptionsRes.reason));
      }
    } catch (err) {
      setError(loadFailureMessage(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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
      <DashboardPageHeader
        className="mb-0 border-b-0 pb-0"
        title={ANALYTICS_TAB_LABELS[activeTab]}
        subtitle="SNC predictive metrics, automated margin erosion exceptions, and project utilization logs."
      />
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
      <div className="bg-ink-light border border-ink-mid p-5 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-4">
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
            <div key={e.id} className="bg-ink border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] flex items-start space-x-3 hover:border-signal/30 transition-all">
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

      {/* Tab Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main analytics data */}
        <div className="lg:col-span-2 bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden p-5">
          {activeTab === "projects" && <ProjectPerformancePanel data={projectPerformance} />}
          {activeTab === "equipment" && <EquipmentIntelPanel data={equipmentIntel} />}
          {activeTab === "procurement" && <ProcurementIntelPanel data={procurementIntel} />}
          {activeTab === "workforce" && <WorkforceIntelPanel data={workforceIntel} />}
        </div>

        {/* Right side analytics intelligence panel */}
        <div className="space-y-6">
          <div className="bg-ink-light border border-ink-mid p-5 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-4">
            <h2 className="text-sm font-semibold text-paper tracking-wider uppercase font-mono border-b border-ink-mid pb-3">Decision Signals</h2>
            <div className="space-y-4">
              {exceptions.slice(0, 2).length === 0 ? <EmptyPanel title="No decision signal narrative" detail="Narratives are generated only when source-backed exceptions exist." /> : exceptions.slice(0, 2).map((signal) => <div key={`signal-${String(signal.id)}`} className="bg-ink p-4 border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-2">
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
