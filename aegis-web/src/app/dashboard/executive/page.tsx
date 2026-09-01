"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, DatabaseZap, Loader2, MapPin, RefreshCw, X } from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { useAuth } from "@/lib/auth/AuthContext";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import {
  getActiveExecutiveProjects,
  getExecutiveKPIs,
  getExecutiveDataHealth,
  getExecutiveExceptions,
  getExecutiveProjectDetail,
  getExecutiveRegions,
  getExecutiveStats,
  getGuardAuditHistory,
  getCcbFindings,
  updateCcbFinding,
  getCommercialBaselineHistory,
  getModulesStatus,
  ApiError,
} from "@/lib/api";

type ApiData = Record<string, unknown>;
type SettledApiResult = PromiseSettledResult<{ data?: unknown; meta?: unknown }>;

function titleCase(value: string): string {
  return value.replace(/^\_+/, "").replace(/\./g, " ").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseJsonish(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function sourceNoticeText(value: ApiData): string {
  const source = titleCase(String(value.source || "Executive data"));
  const reason: string | null = value.reason ? displayValue(value.reason) : null;
  const status: string | null = value.status ? titleCase(String(value.status)) : null;
  return reason ? `${source}: ${reason}` : [source, status].filter(Boolean).join(": ");
}

function structuredValue(value: ApiData): string {
  const primary = value.reason ?? value.message ?? value.summary ?? value.description ?? value.detail ?? value.body;
  if (primary) return displayValue(primary);
  const visible: string[] = Object.entries(value)
    .filter(([key]) => !["id", "uuid", "metadata", "tags", "source"].includes(key))
    .map(([key, entry]) => `${titleCase(key)}: ${displayValue(entry)}`);
  return visible.length ? visible.join(" · ") : "Recorded";
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    const parsed = parseJsonish(value);
    return parsed === value ? value : displayValue(parsed);
  }
  if (Array.isArray(value)) {
    if (!value.length) return "Not recorded";
    return value
      .map((entry) => typeof entry === "object" && entry !== null ? sourceNoticeText(entry as ApiData) : displayValue(entry))
      .join(" · ");
  }
  if (typeof value === "object") return structuredValue(value as ApiData);
  return String(value);
}

function metricWithUnit(value: unknown, unit: string): string {
  const displayed = displayValue(value);
  return displayed === "Not recorded" ? displayed : `${displayed}${unit}`;
}

function currencyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : displayValue(value);
}

function statusLabel(value: unknown): string {
  const status = String(value || "").toLowerCase();
  if (status === "stale") return "needs recent records";
  if (status === "unavailable") return "unavailable";
  if (status === "no_data") return "no records yet";
  if (status === "current") return "current";
  return displayValue(value).toLowerCase();
}

function isExecutiveAttentionIssue(source: ApiData): boolean {
  const status = String(source.status || "").toLowerCase();
  const name = String(source.source || "").toLowerCase();
  if (["current", "no_data"].includes(status)) return false;
  if (name === "finance costs" && status === "stale") return false;
  return true;
}

function sourceErrorsFromMeta(meta: unknown) {
  if (!meta || typeof meta !== "object") return [];
  const sourceErrors = (meta as { source_errors?: unknown }).source_errors;
  return Array.isArray(sourceErrors) ? (sourceErrors as ApiData[]) : [];
}

function sourceWarningsFrom(result: SettledApiResult, label: string) {
  if (result.status === "rejected") {
    const reason = result.reason;
    if (reason instanceof ApiError) {
      return [`${label} could not be loaded (${reason.status}): ${reason.message}`];
    }
    return [`${label} could not be loaded.`];
  }
  const errors = sourceErrorsFromMeta(result.value.meta);
  return errors
    .filter((error) => !["current", "no_data"].includes(String(error.status)))
    .map((error) => `${label}: ${displayValue(error.source)} is ${displayValue(error.status)}.`);
}

function metricDetailRows(metricKey: string, kpis: ApiData, stats: ApiData, activeProjects: ApiData[], dataHealth: ApiData[]) {
  const healthBySource = (name: string) => dataHealth.find((source) => String(source.source || "").toLowerCase().includes(name.toLowerCase()));
  const rowsByMetric: Record<string, Array<{ label: string; value: string; source: string }>> = {
    cash_runway: [
      { label: "Cash Survival Days", value: metricWithUnit(kpis.cash_survival_days, " days"), source: "executive.kpi_snapshots" },
      { label: "Snapshot Date", value: displayValue(kpis.snapshot_date), source: "executive.kpi_snapshots" },
      { label: "Open Purchase Orders", value: displayValue(stats.open_purchase_orders), source: "procurement.purchase_orders" },
      { label: "Inventory On Hand", value: displayValue(stats.materials_in_stock), source: "procurement.stock_ledger" },
      { label: "Data Health", value: statusLabel(healthBySource("Finance")?.status), source: displayValue(healthBySource("Finance")?.source || "Finance source health") },
    ],
    revenue: [
      { label: "Revenue YTD", value: currencyValue(kpis.revenue_ytd), source: "finance.progress_claims" },
      { label: "Recognised Revenue", value: displayValue(kpis.revenue), source: "finance.progress_claims" },
      { label: "Cost YTD", value: currencyValue(kpis.cost_ytd), source: "finance.cost_transactions" },
      { label: "Gross Profit YTD", value: currencyValue(kpis.gross_profit_ytd), source: "finance.progress_claims + finance.cost_transactions" },
      { label: "Finance Data Health", value: statusLabel(healthBySource("Finance")?.status), source: displayValue(healthBySource("Finance")?.source || "Finance source health") },
    ],
    margin: [
      { label: "Gross Profit Margin", value: metricWithUnit(kpis.margin_percent, "%"), source: "calculated from YTD revenue and cost" },
      { label: "Revenue YTD", value: currencyValue(kpis.revenue_ytd), source: "finance.progress_claims" },
      { label: "Cost YTD", value: currencyValue(kpis.cost_ytd), source: "finance.cost_transactions" },
      { label: "Gross Profit YTD", value: currencyValue(kpis.gross_profit_ytd), source: "derived" },
      { label: "Margin Basis", value: "Revenue less recorded cost transactions", source: "executive KPI service" },
    ],
    pipeline: [
      { label: "Opportunity Pipeline", value: currencyValue(kpis.pipeline_opportunity_value), source: "crm.opportunities" },
      { label: "Tender Pipeline", value: currencyValue(kpis.pipeline_tender_value), source: "crm.tenders" },
      { label: "Open Opportunities", value: displayValue(kpis.pipeline_opportunity_count ?? stats.open_deals), source: "crm.opportunities" },
      { label: "Open Tenders", value: displayValue(kpis.pipeline_tender_count), source: "crm.tenders" },
      { label: "Open Leads", value: displayValue(stats.open_leads), source: "crm.leads" },
      { label: "Recent CRM Activity", value: displayValue(stats.recent_activity_last_7_days), source: "crm.activities last 7 days" },
    ],
    concentration: [
      { label: "Top Client Concentration", value: metricWithUnit(kpis.revenue_concentration_percent, "%"), source: "projects.projects" },
      { label: "Top Client Contract Value", value: currencyValue(kpis.top_client_contract_value), source: "projects.projects" },
      { label: "Open Portfolio Contract Value", value: currencyValue(kpis.portfolio_contract_value), source: "projects.projects" },
      { label: "Active Projects", value: String(activeProjects.length), source: "projects.projects" },
      { label: "Project Data Health", value: statusLabel(healthBySource("Projects")?.status), source: displayValue(healthBySource("Projects")?.source || "Project source health") },
    ],
    safety: [
      { label: "Safety Incidents YTD", value: displayValue(stats.safety_incidents), source: "projects.hse_incidents" },
      { label: "Plant Serious Incidents", value: displayValue(stats.plant_serious_incidents), source: "fleet.plant_incidents" },
      { label: "Active Workforce", value: displayValue(stats.active_workforce), source: "hr.employees" },
      { label: "Live Projects", value: displayValue(stats.live_projects), source: "projects.projects" },
      { label: "Active Plant Deployments", value: displayValue(stats.plant_active_deployments), source: "fleet.plant_requests" },
    ],
    documented: [
      { label: "Documented Workflow Percent", value: metricWithUnit(kpis.documented_workflow_percent ?? kpis.documented_percent, "%"), source: "executive.kpi_snapshots or process register" },
      { label: "Snapshot Date", value: displayValue(kpis.snapshot_date), source: "executive.kpi_snapshots" },
      { label: "Documented Processes Source", value: statusLabel(healthBySource("Documents")?.status), source: displayValue(healthBySource("Documents")?.source || "Process/document source health") },
      { label: "Documented Process Notice", value: displayValue(kpis._notices), source: "executive KPI service" },
    ],
  };

  return rowsByMetric[metricKey] || [];
}

function greetingForNow(date: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Africa/Harare" }).format(date));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function ExecutiveCommandCentre() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)"]}>
      <ExecutiveCommandCentreWorkspace />
    </RBACGuard>
  );
}

function ExecutiveCommandCentreWorkspace() {
  const { session, role } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<ApiData>({});
  const [stats, setStats] = useState<ApiData>({});
  const [modules, setModules] = useState<ApiData[]>([]);
  const [regions, setRegions] = useState<ApiData[]>([]);
  const [activeProjects, setActiveProjects] = useState<ApiData[]>([]);
  const [dataHealth, setDataHealth] = useState<ApiData[]>([]);
  const [exceptions, setExceptions] = useState<ApiData[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<ApiData | null>(null);
  const [projectDetail, setProjectDetail] = useState<ApiData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  const userEmail = session?.user?.email || "System User";
  const displayName = userEmail.split("@")[0].replace(/\b\w/g, (letter) => letter.toUpperCase());
  const userRole = role || "User";

  const loadDashboard = useCallback(async () => {
    setRefreshing(true);
    const accessToken = session?.access_token;
    const [kpiResult, statsResult, moduleResult] = await Promise.allSettled([
      getExecutiveKPIs(accessToken),
      getExecutiveStats(accessToken),
      getModulesStatus(accessToken),
    ]);
    if (kpiResult.status === "fulfilled") setKpis(kpiResult.value.data || {});
    if (statsResult.status === "fulfilled") setStats(statsResult.value.data || {});
    if (moduleResult.status === "fulfilled") setModules(moduleResult.value.data || []);

    const [regionResult, projectResult, healthResult] = await Promise.allSettled([
      getExecutiveRegions(accessToken),
      getActiveExecutiveProjects(accessToken),
      getExecutiveDataHealth(accessToken),
    ]);
    if (regionResult.status === "fulfilled") setRegions(regionResult.value.data || []);
    if (projectResult.status === "fulfilled") setActiveProjects(projectResult.value.data || []);
    if (healthResult.status === "fulfilled") setDataHealth(healthResult.value.data || []);

    const exceptionResult = await getExecutiveExceptions(accessToken)
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason) => ({ status: "rejected" as const, reason }));
    if (exceptionResult.status === "fulfilled") setExceptions(exceptionResult.value.data || []);
    setLoadWarnings([
      ...sourceWarningsFrom(kpiResult, "Executive KPIs"),
      ...sourceWarningsFrom(statsResult, "Operational control ledger"),
      ...sourceWarningsFrom(moduleResult, "Module gateway"),
      ...sourceWarningsFrom(regionResult, "Regional footprint"),
      ...sourceWarningsFrom(projectResult, "Active projects"),
      ...sourceWarningsFrom(healthResult, "Data confidence"),
      ...sourceWarningsFrom(exceptionResult, "Executive exceptions"),
    ]);
    setLoading(false);
    setRefreshing(false);
  }, [session]);

  useEffect(() => { if (session) void loadDashboard(); }, [session, loadDashboard]);

  // loadDashboard() only shows the full-page spinner on the very first
  // mount (loading starts true and is never set back to true afterward) -
  // every subsequent call, including these, just spins the small refresh
  // icon via `refreshing` while the existing numbers stay on screen.
  useLiveTable("finance.quotations", () => { if (session) void loadDashboard(); });
  useLiveTable("crm.opportunities", () => { if (session) void loadDashboard(); });
  useLiveTable("projects.projects", () => { if (session) void loadDashboard(); });
  useLiveTable("projects.hse_incidents", () => { if (session) void loadDashboard(); });
  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const metricCards = useMemo(() => [
    { key: "cash_runway", label: "Cash Runway", value: metricWithUnit(kpis.cash_survival_days, " days"), source: "Executive KPI snapshot or treasury snapshot when available" },
    { key: "revenue", label: "Revenue (YTD)", value: displayValue(kpis.revenue), source: "Live finance progress claims and cost records" },
    { key: "margin", label: "Gross Profit Margin", value: displayValue(kpis.margin), source: "Live finance progress claims and cost records" },
    { key: "active_projects", label: "Active Projects", value: String(activeProjects.length), source: "Live open project records" },
    { key: "pipeline", label: "Pipeline Value", value: displayValue(kpis.pipeline), source: "Live CRM opportunities and tenders" },
    { key: "concentration", label: "Top Client Concentration", value: metricWithUnit(kpis.revenue_concentration_percent, "%"), source: "Live project contract values or executive KPI snapshot" },
    { key: "safety", label: "Safety Incidents (YTD)", value: displayValue(stats.safety_incidents), source: "Live HSE incident records" },
    { key: "documented", label: "Documented Processes", value: metricWithUnit(kpis.documented_workflow_percent ?? kpis.documented_percent, "%"), source: "Executive KPI snapshot or process register when available" },
  ], [activeProjects.length, kpis, stats]);

  const openProject = async (project: ApiData) => {
    setSelectedProject(project);
    setProjectDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const response = await getExecutiveProjectDetail(String(project.id), session?.access_token);
      setProjectDetail(response.data || {});
      const errors = sourceErrorsFromMeta(response.meta);
      if (errors.length) {
        setDetailError(errors.map((error) => `${displayValue(error.source)} ${statusLabel(error.status)}`).join(" · "));
      }
    } catch {
      setDetailError("Project detail could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) return <div className="h-full flex items-center justify-center"><Loader2 className="w-7 h-7 text-signal animate-spin" /></div>;

  const selectedCard = metricCards.find((card) => card.key === selectedMetric);
  return <div className="h-full min-h-0 overflow-y-auto px-4 pb-6 pt-7 sm:px-6 sm:pt-8 space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-display text-3xl leading-[1.08] tracking-normal text-paper sm:text-4xl">{greetingForNow(currentTime)}, {displayName}.</h1><p className="mt-1 text-sm text-slate-light">{userRole} · Live ERP view</p></div>
      <button onClick={() => void loadDashboard()} disabled={refreshing} title="Refresh executive data" className="p-2 border border-ink-mid rounded-sm text-slate-light hover:text-paper hover:border-signal disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /></button>
    </header>

    <DataConfidence sources={dataHealth} />
    <SourceWarnings warnings={loadWarnings} />

    <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
      {metricCards.map((card) => <button key={card.key} onClick={() => setSelectedMetric(card.key)} className="min-h-24 text-left bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_10px_20px_-14px_rgba(0,0,0,0.55)] p-3 transition-shadow hover:border-signal hover:shadow-[0_0_40px_var(--dxl-signal-ghost)] focus-visible:outline focus-visible:outline-signal">
        <p className="font-mono text-[9px] tracking-widest text-slate uppercase">{card.label}</p><p className="font-mono text-xl leading-tight text-paper mt-3 break-words">{card.value}</p>
      </button>)}
    </section>

    <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <ModuleGateway modules={modules} />

      <RegionalFootprint regions={regions} />
    </section>

    <OperationalControlLedger stats={stats} />
    <CCBCommercialGovernanceWidget />
    <CCBAutomatedFindingsPanel />
    <ExecutiveExceptions exceptions={exceptions} onProject={openProject} />

    {selectedCard && <Modal title={selectedCard.label} onClose={() => setSelectedMetric(null)}><p className="text-sm text-slate-light">{selectedCard.source}</p><p className="font-mono text-3xl text-paper mt-4">{selectedCard.value}</p>{selectedCard.key === "active_projects" ? <ProjectList projects={activeProjects} onSelect={openProject} /> : <MetricDetailGrid rows={metricDetailRows(selectedCard.key, kpis, stats, activeProjects, dataHealth)} />}</Modal>}
    {selectedProject && <Modal title={String(selectedProject.name || "Project detail")} onClose={() => setSelectedProject(null)} wide>{detailLoading ? <Loader2 className="w-6 h-6 text-signal animate-spin"/> : <><SourceWarnings warnings={detailError ? [detailError] : []} /><ProjectDetail detail={projectDetail} /></>}</Modal>}
  </div>;
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) { return <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}><div className={`bg-ink border border-ink-light rounded-lg shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)] w-full ${wide ? "max-w-5xl" : "max-w-2xl"} max-h-[85vh] overflow-y-auto p-5`} onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4 mb-5"><h2 className="font-display text-2xl text-paper">{title}</h2><button onClick={onClose} title="Close" className="text-slate hover:text-paper"><X className="w-5 h-5" /></button></div>{children}</div></div>; }
function MetricDetailGrid({ rows }: { rows: Array<{ label: string; value: string; source: string }> }) { if (!rows.length) return <p className="mt-5 text-sm text-slate-light">No drill-down fields are configured for this metric.</p>; return <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2">{rows.map((row) => <div key={`${row.label}-${row.source}`} className="border border-ink-mid p-3"><p className="text-xs text-slate-light">{row.label}</p><p className="font-mono text-sm text-paper mt-1">{row.value}</p><p className="mt-2 font-mono text-[10px] uppercase text-slate">Source: {row.source}</p></div>)}</div>; }
function MetricFields({ data }: { data: ApiData }) { return <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2">{Object.entries(data).map(([key, value]) => <div key={key} className="border border-ink-mid p-3"><p className="text-xs text-slate-light">{titleCase(key)}</p><p className="font-mono text-sm text-paper mt-1">{displayValue(value)}</p></div>)}</div>; }
function ProjectList({ projects, onSelect }: { projects: ApiData[]; onSelect: (project: ApiData) => void }) { if (!projects.length) return <p className="text-slate-light mt-6">No active project records were found.</p>; return <div className="mt-5 space-y-2">{projects.map((project) => <button key={String(project.id)} onClick={() => void onSelect(project)} className="w-full flex justify-between gap-3 text-left border border-ink-mid p-3 hover:border-signal"><span className="text-paper">{displayValue(project.name)}</span><span className="font-mono text-xs text-slate-light">{displayValue(project.status)}</span></button>)}</div>; }
function ProjectDetail({ detail }: { detail: ApiData | null }) { if (!detail) return <p className="text-slate-light">Project detail is unavailable.</p>; const project = (detail.project || {}) as ApiData; const related = Object.entries(detail).filter(([key]) => key !== "project"); return <div className="space-y-5"><section><h3 className="font-mono text-xs tracking-widest text-signal uppercase mb-2">Project viability and delivery record</h3><MetricFields data={project} /></section>{related.map(([key, value]) => <section key={key}><h3 className="font-mono text-xs tracking-widest text-signal uppercase mb-2">{titleCase(key)}</h3>{Array.isArray(value) && value.length ? <div className="space-y-2">{value.map((item, index) => <MetricFields key={index} data={item as ApiData} />)}</div> : <p className="text-sm text-slate-light">No linked {titleCase(key).toLowerCase()} recorded for this project.</p>}</section>)}</div>; }
function DataConfidence({ sources }: { sources: ApiData[] }) { const issues = sources.filter(isExecutiveAttentionIssue); const current = sources.filter((source) => String(source.status) === "current").length; const empty = sources.filter((source) => String(source.status) === "no_data").length; const summary = sources.length ? `${sources.length} executive data sources checked. ${current} current, ${empty} empty, ${issues.length} need attention.` : "Data sources are connected. Empty sources are shown as no data, not zero."; const iconClass = issues.length ? "text-amber-400" : "text-green-500"; return <div className="flex items-center gap-2 text-xs text-slate-light"><DatabaseZap className={`w-4 h-4 ${iconClass}`}/>{summary}</div>; }
function SourceWarnings({ warnings }: { warnings: string[] }) { if (!warnings.length) return null; return <div className="border border-amber-500/40 bg-amber-500/10 p-3 flex gap-3"><AlertTriangle className="w-5 h-5 text-amber-400 shrink-0"/><div><p className="text-sm text-paper">Executive view is degraded</p><div className="mt-1 space-y-1">{warnings.map((warning) => <p key={warning} className="text-xs text-slate-light">{warning}</p>)}</div></div></div>; }
function ExecutiveExceptions({ exceptions, onProject }: { exceptions: ApiData[]; onProject: (project: ApiData) => void }) { return <section className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]"><div className="p-4 border-b border-ink-mid flex justify-between gap-4"><div><h2 className="font-mono text-xs tracking-widest text-paper uppercase">Executive Exceptions</h2><p className="text-xs text-slate-light mt-1">Conditions requiring a decision or intervention, with source evidence and drill-through where a project is linked.</p></div><span className="font-mono text-[10px] text-slate">{exceptions.length} OPEN</span></div>{exceptions.length ? <div className="divide-y divide-ink-mid">{exceptions.map((item, index) => { const drillProjectId = item.project_id ?? (item.category === "Project viability" ? item.id : null); return <button key={`${String(item.category)}-${String(item.id)}-${index}`} onClick={() => drillProjectId && void onProject({ id: drillProjectId, name: item.title })} className="w-full p-4 flex flex-wrap justify-between gap-3 text-left hover:bg-ink-light disabled:hover:bg-transparent" disabled={!drillProjectId}><div><p className="font-mono text-[10px] text-signal uppercase">{displayValue(item.category)}</p><p className="text-sm text-paper mt-1">{displayValue(item.title ?? item.severity ?? item.certificate_name)}</p><p className="text-xs text-slate-light mt-1">{displayValue(item.action)}</p>{item.evidence ? <p className="mt-2 max-w-3xl break-words font-mono text-[10px] text-slate">Evidence: {displayValue(item.evidence)}</p> : null}</div><span className="font-mono text-xs text-slate-light">{displayValue(item.evidence_date ?? item.expiry_date ?? item.incident_date ?? item.viability_status)}</span></button>; })}</div> : <p className="p-4 text-sm text-slate-light">No configured executive exceptions are currently recorded.</p>}</section>; }
function ModuleGateway({ modules }: { modules: ApiData[] }) {
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    if (modules.length && !selectedId) {
      setSelectedId(String(modules[0].id));
    }
  }, [modules, selectedId]);

  const selectedModule = modules.find((m) => String(m.id) === selectedId) || modules[0];

  if (!modules.length) {
    return (
      <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-4 xl:col-span-1 min-h-[340px] flex flex-col justify-between">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-mono text-xs tracking-widest text-paper uppercase">Module Gateway</h2>
          <span className="font-mono text-[10px] text-slate">OFFLINE</span>
        </div>
        <p className="text-sm text-slate-light py-6">No module records configured.</p>
      </div>
    );
  }

  const routeMap: Record<string, string> = {
    "projects": "/dashboard/projects",
    "site-operations": "/dashboard/site-operations",
    "fleet": "/dashboard/fleet",
    "workforce": "/dashboard/workforce",
    "hr": "/dashboard/hr",
    "procurement": "/dashboard/procurement",
    "inventory": "/dashboard/inventory",
    "compliance": "/dashboard/compliance",
    "crm": "/dashboard/crm",
    "reports": "/dashboard/reports",
    "analytics": "/dashboard/analytics",
    "settings": "/dashboard/settings",
    "finance": "/dashboard/finance",
    "documents": "/dashboard/documents"
  };

  const getModuleRoute = (name: string, id: string) => {
    const key = String(id || name).toLowerCase().replace(/\s+/g, '-');
    return routeMap[key] || `/dashboard/${key}`;
  };

  const isAvailable = selectedModule ? selectedModule.available !== false : false;
  const targetRoute = selectedModule ? getModuleRoute(String(selectedModule.name), String(selectedModule.id)) : "#";

  return (
    <div className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-4 xl:col-span-1 min-h-[340px] flex flex-col justify-between">
      <div>
        <div className="flex justify-between items-center mb-4 border-b border-ink-mid pb-3">
          <h2 className="font-mono text-xs tracking-widest text-paper uppercase">Module Gateway</h2>
          <span className="font-mono text-[10px] text-green-500">CONNECTED</span>
        </div>

        <p className="text-[11px] text-slate-light mb-4 leading-relaxed">Select a command module from the dropdown to check live status and deploy configuration.</p>

        <label className="block mb-4">
          <span className="font-mono text-[9px] text-slate uppercase block mb-1.5">Select Command Module</span>
          <div className="relative">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper focus:border-signal outline-none cursor-pointer appearance-none"
            >
              {modules.map((m) => (
                <option key={String(m.id)} value={String(m.id)}>
                  {String(m.name)} ({m.available !== false ? "Online" : "Not Built"})
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
              </svg>
            </div>
          </div>
        </label>
      </div>

      {selectedModule && (
        <div className="border border-ink-mid bg-ink-light p-3.5 rounded-md space-y-3">
          <div className="flex justify-between items-start">
            <div>
              <span className="font-mono text-[9px] uppercase text-slate">Command Status</span>
              <h3 className="text-xs font-semibold text-paper mt-0.5">{String(selectedModule.name)}</h3>
            </div>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-mono uppercase font-bold ${
              isAvailable ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-slate/10 text-slate border border-slate/20"
            }`}>
              {isAvailable ? "Online" : "Not Built"}
            </span>
          </div>

          <div className="flex gap-2 items-center text-[10px] text-slate-light">
            <span className={`w-1.5 h-1.5 rounded-full ${isAvailable ? "bg-green-500 animate-pulse" : "bg-slate"}`} />
            <span>{isAvailable ? "Route mapping operational." : "Under construction."}</span>
          </div>

          {isAvailable ? (
            <a
              href={targetRoute}
              className="w-full inline-flex items-center justify-center gap-2 border border-signal/50 bg-signal/5 px-3 py-1.5 font-mono text-[9px] uppercase text-signal hover:bg-signal/15 transition-all duration-300 rounded-sm"
            >
              Open Module
            </a>
          ) : (
            <button
              disabled
              className="w-full inline-flex items-center justify-center gap-2 border border-ink-mid bg-ink px-3 py-1.5 font-mono text-[9px] uppercase text-slate disabled:opacity-40 rounded-sm"
            >
              Module Offline
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RegionalFootprint({ regions }: { regions: ApiData[] }) {
  const [selectedName, setSelectedName] = useState("");
  const minLat = -23.0;
  const maxLat = -15.0;
  const minLong = 24.0;
  const maxLong = 34.0;
  const coordinateValue = (value: unknown) => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const validCoordsRegions = regions.filter(
    (r) => {
      const lat = coordinateValue(r.latitude);
      const long = coordinateValue(r.longitude);
      return lat !== null && long !== null && lat !== 0 && long !== 0;
    }
  );
  const selectedRegion = regions.find((region) => String(region.name) === selectedName) || validCoordsRegions[0] || regions[0];
  const selectedProjects = Array.isArray(selectedRegion?.projects) ? selectedRegion.projects as ApiData[] : [];
  const selectedCrm = Array.isArray(selectedRegion?.crm_records) ? selectedRegion.crm_records as ApiData[] : [];

  return (
    <section className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] xl:col-span-2 min-h-[340px] max-h-[760px] overflow-hidden flex flex-col">
      <div className="shrink-0 p-4 border-b border-ink-mid flex justify-between items-center">
        <div>
          <h2 className="font-mono text-xs tracking-widest text-paper uppercase">Regional Footprint</h2>
          <p className="text-xs text-slate-light mt-1">Live coverage register based on project profile location data.</p>
        </div>
        <span className="font-mono text-[10px] text-signal uppercase">Geospatial Telemetry</span>
      </div>

      {regions.length ? (
        <div className="grid min-h-0 grid-cols-1 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden flex-1">
          <div className="min-h-0 p-4 border-b lg:border-b-0 lg:border-r border-ink-mid flex flex-col lg:overflow-hidden">
            <div className="relative w-full aspect-[4/3] max-h-[240px] shrink-0 border border-ink-mid bg-ink-light/50 rounded-md overflow-hidden flex items-center justify-center p-2">
              {validCoordsRegions.length > 0 ? (
                <svg className="w-full h-full relative z-10" viewBox="0 0 100 100">
                  <line x1="50" y1="0" x2="50" y2="100" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2,2" />
                  <line x1="0" y1="50" x2="100" y2="50" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2,2" />

                  {validCoordsRegions.map((region) => {
                    const lat = coordinateValue(region.latitude) ?? 0;
                    const long = coordinateValue(region.longitude) ?? 0;
                    const x = ((long - minLong) / (maxLong - minLong)) * 80 + 10;
                    const y = (1 - (lat - minLat) / (maxLat - minLat)) * 80 + 10;

                    return (
                      <g key={String(region.name)} className="group cursor-pointer" onClick={() => setSelectedName(String(region.name))}>
                        <circle
                          cx={x}
                          cy={y}
                          r={String(region.name) === String(selectedRegion?.name) ? "5" : "4"}
                          className="fill-signal/20 stroke-signal/40 animate-ping"
                          style={{ animationDuration: '3s' }}
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r={String(region.name) === String(selectedRegion?.name) ? "3" : "2"}
                          className={String(region.name) === String(selectedRegion?.name) ? "fill-paper stroke-signal stroke-[0.8px]" : "fill-signal stroke-paper stroke-[0.5px]"}
                        />
                        <title>{`${String(region.name)} (${lat.toFixed(4)}, ${long.toFixed(4)})`}</title>
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <div className="text-center p-4">
                  <p className="text-[11px] font-mono text-slate uppercase">No coordinates configured</p>
                  <p className="text-[10px] text-slate-light mt-1">Latitude & longitude map will render once assigned.</p>
                </div>
              )}

              {validCoordsRegions.length > 0 && (
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-signal/5 to-transparent pointer-events-none animate-[pulse_4s_infinite]" />
              )}
            </div>

            <div className="mt-4 grid max-h-44 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {regions.map((region) => (
                <button key={String(region.name)} type="button" onClick={() => setSelectedName(String(region.name))} className={`border bg-ink-light p-2.5 rounded-md text-left ${String(region.name) === String(selectedRegion?.name) ? "border-signal" : "border-ink-mid hover:border-signal/50"}`}>
                  <span className="font-mono text-[9px] text-slate uppercase block">Region Profile</span>
                  <h4 className="font-semibold text-xs text-paper mt-0.5 truncate">{String(region.name)}</h4>
                  <span className="text-[9px] font-mono text-slate-light block mt-1">
                    {region.latitude && region.longitude ? `${Number(region.latitude).toFixed(2)}°, ${Number(region.longitude).toFixed(2)}°` : "No Coordinates"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 p-4 flex flex-col lg:overflow-y-auto">
            <div className="min-h-0 space-y-4">
              <h3 className="font-mono text-[9px] text-slate uppercase tracking-wider">Project Density Distribution</h3>
              <div className="max-h-40 space-y-3 overflow-y-auto pr-1">
                {regions.map((region) => {
                  const active = Number(region.active_projects || 0);
                  const total = Math.max(1, Array.isArray(region.projects) ? region.projects.length : 0);
                  const pct = Math.min(100, Math.round((active / total) * 100));

                  return (
                    <button key={String(region.name)} type="button" onClick={() => setSelectedName(String(region.name))} className="w-full space-y-1 text-left">
                      <div className="flex min-w-0 justify-between gap-3 text-xs font-mono">
                        <span className="min-w-0 truncate text-paper">{String(region.name)}</span>
                        <span className="shrink-0 text-slate-light">{active} / {total} Active ({pct})</span>
                      </div>
                      <div className="h-1 bg-ink-light border border-ink-mid rounded-full overflow-hidden">
                        <div
                          className="h-full bg-signal transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
              {selectedRegion ? (
                <div className="mt-4 border border-ink-mid bg-ink-light p-3">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <h4 className="min-w-0 truncate font-mono text-xs uppercase text-paper">{String(selectedRegion.name)}</h4>
                    <span className="shrink-0 font-mono text-[10px] text-slate-light">{selectedProjects.length} projects · {selectedCrm.length} CRM</span>
                  </div>
                  <div className="mt-3 max-h-32 space-y-2 overflow-y-auto pr-1">
                    {[...selectedProjects, ...selectedCrm].length ? [...selectedProjects, ...selectedCrm].map((record) => (
                      <div key={`${String(record.source_type)}-${String(record.id)}`} className="border border-ink-mid/60 bg-ink px-2 py-1.5">
                        <p className="truncate text-xs font-semibold text-paper">{displayValue(record.name)}</p>
                        <p className="font-mono text-[10px] uppercase text-slate-light">{displayValue(record.source_type)} · {displayValue(record.status)}</p>
                      </div>
                    )) : <p className="text-xs text-slate-light">No project or CRM records pinned to this province yet.</p>}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 min-h-0 border-t border-ink-mid pt-4">
              <div className="max-h-36 overflow-auto pr-1">
                <table className="w-full min-w-[360px] text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-ink font-mono text-[9px] text-slate uppercase border-b border-ink-mid">
                  <tr>
                    <th className="pb-2 font-normal">Region</th>
                    <th className="pb-2 font-normal text-right">Active</th>
                    <th className="pb-2 font-normal text-right">Portfolio</th>
                  </tr>
                  </thead>
                  <tbody>
                  {regions.map((region) => (
                    <tr key={String(region.name)} className="border-b border-ink-mid/40">
                      <td className="py-2 text-paper font-medium">{String(region.name)}</td>
                      <td className="py-2 text-right font-mono text-paper">{String(region.active_projects)}</td>
                      <td className="py-2 text-right font-mono text-slate-light">
                        {Array.isArray(region.projects) ? region.projects.length : 0}
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-center items-center text-center p-8">
          <MapPin className="w-8 h-8 text-slate animate-pulse" />
          <p className="text-paper mt-3 font-mono text-xs">No regional project data recorded.</p>
          <p className="text-xs text-slate-light mt-1">Assign region, province, and coordinates in each project profile.</p>
        </div>
      )}
    </section>
  );
}
function OperationalControlLedger({ stats }: { stats: ApiData }) { const sources: Record<string, string> = { live_projects: "Projects", deployed_machinery: "Fleet", active_workforce: "HR", open_purchase_orders: "Procurement", materials_in_stock: "Inventory", safety_incidents: "HSE", open_deals: "CRM", open_pipeline_value: "CRM", open_leads: "CRM", recent_activity_last_7_days: "CRM", plant_open_requests: "Plant & Equipment", plant_dispatch_queue: "Plant & Equipment", plant_active_deployments: "Plant & Equipment", plant_closure_queue: "Plant & Equipment", plant_serious_incidents: "Plant & Equipment", plant_contribution_margin: "Plant & Equipment" }; return <section className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]"><div className="p-4 border-b border-ink-mid flex justify-between gap-4"><div><h2 className="font-mono text-xs tracking-widest text-paper uppercase">Operational Intelligence</h2><p className="text-xs text-slate-light mt-1">Current ERP control ledger</p></div><span className="font-mono text-[10px] text-slate">LIVE READ</span></div><div className="p-4 overflow-x-auto"><table className="w-full text-left min-w-[540px]"><thead className="font-mono text-[10px] tracking-widest text-slate uppercase border-b border-ink-mid"><tr><th className="pb-2 font-normal">Control</th><th className="pb-2 font-normal">Current Value</th><th className="pb-2 font-normal">Source</th></tr></thead><tbody>{Object.entries(stats).map(([key, value]) => <tr key={key} className="border-b border-ink-mid/60"><td className="py-3 text-sm text-paper">{titleCase(key)}</td><td className="py-3 font-mono text-sm text-paper">{displayValue(value)}</td><td className="py-3 text-xs text-slate-light">{sources[key] || "ERP"}</td></tr>)}</tbody></table>{!Object.keys(stats).length && <p className="text-sm text-slate-light py-4">No operational records are available for this organisation.</p>}</div></section>; }

function CCBCommercialGovernanceWidget() {
  const [audits, setAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await getGuardAuditHistory();
        if (res.success && Array.isArray(res.data)) setAudits(res.data);
      } catch {
        // Fallback
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <section className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-4 mt-6">
      <div className="flex justify-between items-center border-b border-ink-mid pb-3">
        <div>
          <h2 className="font-mono text-xs tracking-widest text-paper uppercase">CCB Commercial Governance & MD Control</h2>
          <p className="text-xs text-slate-light mt-1">Live Commercial Control Brain Exception Log & Rate Outlier Interceptions</p>
        </div>
        <Link href="/dashboard/quotations/ccb" className="font-mono text-xs text-signal hover:underline">Open CCB Portal →</Link>
      </div>
      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading CCB telemetry...</div>
        ) : audits.length === 0 ? (
          <p className="text-xs text-slate py-4">No active commercial exception flags recorded across organization baselines.</p>
        ) : (
          audits.slice(0, 4).map((audit) => (
            <div key={audit.id} className="flex justify-between items-center border border-ink-mid bg-ink-light p-3 text-xs rounded-md">
              <div>
                <p className="font-semibold text-paper">{audit.item_description}</p>
                <p className="text-slate-light mt-0.5">{audit.requester_name} | {audit.anomaly_reason}</p>
              </div>
              <span className={`font-mono text-[10px] uppercase px-2 py-0.5 border ${audit.status === "FLAGGED" ? "border-red-500/40 text-red-300 bg-red-950/20" : "border-emerald-500/40 text-emerald-300"}`}>
                {audit.status}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

const CCB_FINDING_CHECK_TYPE_LABELS: Record<string, string> = {
  budget_boq_overrun: "Budget Overrun",
  requisition_budget_breach: "Requisition Breach",
  variance_stale_approval: "Approval Overdue",
};

const CCB_FINDING_SEVERITY_CLASSES: Record<string, string> = {
  critical: "border-red-500/40 text-red-300 bg-red-950/20",
  high: "border-amber-500/40 text-amber-300 bg-amber-950/20",
  medium: "border-slate/40 text-slate-light bg-ink-light",
  low: "border-emerald-500/40 text-emerald-300 bg-emerald-950/20",
};

const CCB_FINDING_STATUS_CLASSES: Record<string, string> = {
  open: "border-red-500/40 text-red-300",
  acknowledged: "border-amber-500/40 text-amber-300",
  resolved: "border-emerald-500/40 text-emerald-300",
};

function daysAgoLabel(iso: unknown) {
  if (typeof iso !== "string" || !iso) return "unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// Automated, open/resolved-lifecycle CCB findings from background checks
// (budget-vs-BOQ overrun, requisition budget breaches, stale variance
// approvals) - deliberately a separate panel from CCBCommercialGovernanceWidget
// above, which shows point-in-time audits a person manually triggered.
// Conflating "a person ran a check" with "the system found this on its own"
// would lose the exact distinction that makes the automation valuable.
function CCBAutomatedFindingsPanel() {
  const [findings, setFindings] = useState<any[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const loadFindings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCcbFindings();
      if (res.success && Array.isArray(res.data)) setFindings(res.data);
      const counts = (res.meta as Record<string, unknown> | undefined)?.status_counts;
      if (counts && typeof counts === "object") setStatusCounts(counts as Record<string, number>);
    } catch {
      // Fallback: leave prior findings in place rather than clearing on a transient error.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFindings();
  }, [loadFindings]);

  const visibleFindings = useMemo(
    () => findings.filter((finding) => showResolved || finding.status !== "resolved"),
    [findings, showResolved]
  );

  const handleAction = useCallback(async (id: string, action: "acknowledge" | "resolve") => {
    setActioningId(id);
    try {
      await updateCcbFinding(id, action);
      await loadFindings();
    } catch {
      // Leave the row as-is; the next manual refresh or background sweep will reconcile it.
    } finally {
      setActioningId(null);
    }
  }, [loadFindings]);

  const openCount = statusCounts.open || 0;
  const acknowledgedCount = statusCounts.acknowledged || 0;

  return (
    <section className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-4 mt-6">
      <div className="flex justify-between items-center border-b border-ink-mid pb-3">
        <div>
          <h2 className="font-mono text-xs tracking-widest text-paper uppercase">CCB Automated Findings</h2>
          <p className="text-xs text-slate-light mt-1">Background checks running continuously against live budget, requisition, and approval data - no one had to click Run Audit.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-slate">{openCount} OPEN · {acknowledgedCount} ACK</span>
          <button
            onClick={() => setShowResolved((value) => !value)}
            className="font-mono text-[10px] text-signal hover:underline"
          >
            {showResolved ? "Hide resolved" : "Show resolved"}
          </button>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading CCB findings...</div>
        ) : visibleFindings.length === 0 ? (
          <p className="text-xs text-slate py-4">No open automated findings. The background checks run daily (and in real time for requisitions) and will surface anything here the moment they detect it.</p>
        ) : (
          visibleFindings.map((finding) => (
            <div key={String(finding.id)} className="border border-ink-mid bg-ink-light p-3 rounded-md">
              <div className="flex flex-wrap justify-between items-start gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[10px] uppercase text-signal">
                      {CCB_FINDING_CHECK_TYPE_LABELS[String(finding.check_type)] || String(finding.check_type)}
                    </span>
                    <span className={`font-mono text-[10px] uppercase px-2 py-0.5 border rounded ${CCB_FINDING_SEVERITY_CLASSES[String(finding.severity)] || CCB_FINDING_SEVERITY_CLASSES.medium}`}>
                      {String(finding.severity)}
                    </span>
                    <span className={`font-mono text-[10px] uppercase px-2 py-0.5 border rounded ${CCB_FINDING_STATUS_CLASSES[String(finding.status)] || ""}`}>
                      {String(finding.status)}
                    </span>
                  </div>
                  <p className="font-semibold text-paper text-sm mt-1.5">{String(finding.project_title || "Project")}</p>
                  <p className="text-slate-light text-xs mt-1 break-words">{String(finding.summary)}</p>
                  <p className="text-slate text-[10px] mt-1.5 font-mono">
                    First detected {daysAgoLabel(finding.first_detected_at)} · Last seen {daysAgoLabel(finding.last_seen_at)}
                    {finding.status === "resolved" && finding.resolved_by_name ? ` · Resolved by ${String(finding.resolved_by_name)}` : ""}
                  </p>
                </div>
                {finding.status !== "resolved" && (
                  <div className="flex gap-2 shrink-0">
                    {finding.status === "open" && (
                      <button
                        onClick={() => void handleAction(String(finding.id), "acknowledge")}
                        disabled={actioningId === String(finding.id)}
                        className="font-mono text-[10px] uppercase border border-ink-mid px-2 py-1 text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"
                      >
                        Acknowledge
                      </button>
                    )}
                    <button
                      onClick={() => void handleAction(String(finding.id), "resolve")}
                      disabled={actioningId === String(finding.id)}
                      className="font-mono text-[10px] uppercase border border-emerald-500/40 px-2 py-1 text-emerald-300 hover:bg-emerald-950/20 disabled:opacity-50"
                    >
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
