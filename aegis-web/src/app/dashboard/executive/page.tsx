"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, DatabaseZap, Loader2, MapPin, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  getActiveExecutiveProjects,
  getExecutiveKPIs,
  getExecutiveDataHealth,
  getExecutiveExceptions,
  getExecutiveProjectDetail,
  getExecutiveRegions,
  getExecutiveStats,
  getModulesStatus,
} from "@/lib/api";

type ApiData = Record<string, unknown>;

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function greetingForNow(date: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Africa/Harare" }).format(date));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function ExecutiveCommandCentre() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
  const userRole = String(session?.user?.app_metadata?.role || "User");

  const loadDashboard = async () => {
    setRefreshing(true);
    const [kpiResult, statsResult, moduleResult, regionResult, projectResult, healthResult, exceptionResult] = await Promise.allSettled([
      getExecutiveKPIs(), getExecutiveStats(), getModulesStatus(), getExecutiveRegions(), getActiveExecutiveProjects(), getExecutiveDataHealth(), getExecutiveExceptions(),
    ]);
    if (kpiResult.status === "fulfilled") setKpis(kpiResult.value.data || {});
    if (statsResult.status === "fulfilled") setStats(statsResult.value.data || {});
    if (moduleResult.status === "fulfilled") setModules(moduleResult.value.data || []);
    if (regionResult.status === "fulfilled") setRegions(regionResult.value.data || []);
    if (projectResult.status === "fulfilled") setActiveProjects(projectResult.value.data || []);
    if (healthResult.status === "fulfilled") setDataHealth(healthResult.value.data || []);
    if (exceptionResult.status === "fulfilled") setExceptions(exceptionResult.value.data || []);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { if (session) void loadDashboard(); }, [session]);
  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const metricCards = useMemo(() => [
    { key: "cash_runway", label: "Cash Runway", value: `${displayValue(kpis.cash_survival_days)} days`, source: "Latest executive KPI snapshot" },
    { key: "revenue", label: "Revenue (YTD)", value: displayValue(kpis.revenue), source: "Latest executive KPI snapshot" },
    { key: "margin", label: "Gross Profit Margin", value: displayValue(kpis.margin), source: "Latest executive KPI snapshot" },
    { key: "active_projects", label: "Active Projects", value: String(activeProjects.length), source: "Live projects with an active delivery status" },
    { key: "pipeline", label: "Pipeline Value", value: displayValue(kpis.pipeline), source: "Latest executive KPI snapshot" },
    { key: "concentration", label: "Top Client Concentration", value: `${displayValue(kpis.revenue_concentration_percent)}%`, source: "Latest executive KPI snapshot" },
    { key: "safety", label: "Safety Incidents (YTD)", value: displayValue(stats.safety_incidents), source: "Live HSE incident records" },
    { key: "documented", label: "Documented Processes", value: `${displayValue(kpis.documented_workflow_percent ?? kpis.documented_percent)}%`, source: "Latest executive KPI snapshot" },
  ], [activeProjects.length, kpis, stats]);

  const openProject = async (project: ApiData) => {
    setSelectedProject(project);
    setProjectDetail(null);
    setDetailLoading(true);
    try {
      const response = await getExecutiveProjectDetail(String(project.id));
      setProjectDetail(response.data || {});
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) return <div className="h-full flex items-center justify-center"><Loader2 className="w-7 h-7 text-signal animate-spin" /></div>;

  const selectedCard = metricCards.find((card) => card.key === selectedMetric);
  return <div className="h-full overflow-y-auto p-6 space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-display text-4xl text-paper">{greetingForNow(currentTime)}, {displayName}.</h1><p className="text-sm text-slate-light">{userRole} · Live ERP view</p></div>
      <button onClick={() => void loadDashboard()} disabled={refreshing} title="Refresh executive data" className="p-2 border border-ink-mid rounded-sm text-slate-light hover:text-paper hover:border-signal disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /></button>
    </header>

    <DataConfidence sources={dataHealth} />

    <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
      {metricCards.map((card) => <button key={card.key} onClick={() => setSelectedMetric(card.key)} className="min-h-24 text-left bg-ink-light border border-ink-mid rounded-sm p-3 hover:border-signal focus-visible:outline focus-visible:outline-signal">
        <p className="font-mono text-[9px] tracking-widest text-slate uppercase">{card.label}</p><p className="font-mono text-xl text-paper mt-3 break-words">{card.value}</p>
      </button>)}
    </section>

    <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <ModuleGateway modules={modules} />

      <RegionalFootprint regions={regions} />
    </section>

    <OperationalControlLedger stats={stats} />
    <ExecutiveExceptions exceptions={exceptions} onProject={openProject} />

    {selectedCard && <Modal title={selectedCard.label} onClose={() => setSelectedMetric(null)}><p className="text-sm text-slate-light">{selectedCard.source}</p><p className="font-mono text-3xl text-paper mt-4">{selectedCard.value}</p>{selectedCard.key === "active_projects" ? <ProjectList projects={activeProjects} onSelect={openProject} /> : <MetricFields data={selectedCard.key === "safety" ? stats : kpis} />}</Modal>}
    {selectedProject && <Modal title={String(selectedProject.name || "Project detail")} onClose={() => setSelectedProject(null)} wide>{detailLoading ? <Loader2 className="w-6 h-6 text-signal animate-spin"/> : <ProjectDetail detail={projectDetail} />}</Modal>}
  </div>;
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) { return <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}><div className={`bg-ink border border-ink-light rounded-sm w-full ${wide ? "max-w-5xl" : "max-w-2xl"} max-h-[85vh] overflow-y-auto p-5`} onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4 mb-5"><h2 className="font-display text-2xl text-paper">{title}</h2><button onClick={onClose} title="Close" className="text-slate hover:text-paper"><X className="w-5 h-5" /></button></div>{children}</div></div>; }
function MetricFields({ data }: { data: ApiData }) { return <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2">{Object.entries(data).map(([key, value]) => <div key={key} className="border border-ink-mid p-3"><p className="text-xs text-slate-light">{titleCase(key)}</p><p className="font-mono text-sm text-paper mt-1">{displayValue(value)}</p></div>)}</div>; }
function ProjectList({ projects, onSelect }: { projects: ApiData[]; onSelect: (project: ApiData) => void }) { if (!projects.length) return <p className="text-slate-light mt-6">No active project records were found.</p>; return <div className="mt-5 space-y-2">{projects.map((project) => <button key={String(project.id)} onClick={() => void onSelect(project)} className="w-full flex justify-between gap-3 text-left border border-ink-mid p-3 hover:border-signal"><span className="text-paper">{displayValue(project.name)}</span><span className="font-mono text-xs text-slate-light">{displayValue(project.status)}</span></button>)}</div>; }
function ProjectDetail({ detail }: { detail: ApiData | null }) { if (!detail) return <p className="text-slate-light">Project detail is unavailable.</p>; const project = (detail.project || {}) as ApiData; const related = Object.entries(detail).filter(([key]) => key !== "project"); return <div className="space-y-5"><section><h3 className="font-mono text-xs tracking-widest text-signal uppercase mb-2">Project viability and delivery record</h3><MetricFields data={project} /></section>{related.map(([key, value]) => <section key={key}><h3 className="font-mono text-xs tracking-widest text-signal uppercase mb-2">{titleCase(key)}</h3>{Array.isArray(value) && value.length ? <div className="space-y-2">{value.map((item, index) => <MetricFields key={index} data={item as ApiData} />)}</div> : <p className="text-sm text-slate-light">No linked {titleCase(key).toLowerCase()} recorded for this project.</p>}</section>)}</div>; }
function DataConfidence({ sources }: { sources: ApiData[] }) { const issues = sources.filter((source) => !["current", "no_data"].includes(String(source.status))); if (!issues.length) return <div className="flex items-center gap-2 text-xs text-slate-light"><DatabaseZap className="w-4 h-4 text-green-500"/>Data sources are connected. Empty sources are shown as no data, not zero.</div>; return <div className="border border-amber-500/40 bg-amber-500/10 p-3 flex gap-3"><AlertTriangle className="w-5 h-5 text-amber-400 shrink-0"/><div><p className="text-sm text-paper">Some executive data needs attention</p><p className="text-xs text-slate-light mt-1">{issues.map((source) => `${displayValue(source.source)}: ${displayValue(source.status)}`).join(" · ")}</p></div></div>; }
function ExecutiveExceptions({ exceptions, onProject }: { exceptions: ApiData[]; onProject: (project: ApiData) => void }) { return <section className="bg-ink border border-ink-mid rounded-sm"><div className="p-4 border-b border-ink-mid flex justify-between gap-4"><div><h2 className="font-mono text-xs tracking-widest text-paper uppercase">Executive Exceptions</h2><p className="text-xs text-slate-light mt-1">Conditions requiring a decision or intervention, with source evidence and drill-through where a project is linked.</p></div><span className="font-mono text-[10px] text-slate">{exceptions.length} OPEN</span></div>{exceptions.length ? <div className="divide-y divide-ink-mid">{exceptions.map((item, index) => { const drillProjectId = item.project_id ?? (item.category === "Project viability" ? item.id : null); return <button key={`${String(item.category)}-${String(item.id)}-${index}`} onClick={() => drillProjectId && void onProject({ id: drillProjectId, name: item.title })} className="w-full p-4 flex flex-wrap justify-between gap-3 text-left hover:bg-ink-light disabled:hover:bg-transparent" disabled={!drillProjectId}><div><p className="font-mono text-[10px] text-signal uppercase">{displayValue(item.category)}</p><p className="text-sm text-paper mt-1">{displayValue(item.title ?? item.severity ?? item.certificate_name)}</p><p className="text-xs text-slate-light mt-1">{displayValue(item.action)}</p>{item.evidence ? <p className="mt-2 max-w-3xl break-words font-mono text-[10px] text-slate">Evidence: {displayValue(item.evidence)}</p> : null}</div><span className="font-mono text-xs text-slate-light">{displayValue(item.evidence_date ?? item.expiry_date ?? item.incident_date ?? item.viability_status)}</span></button>; })}</div> : <p className="p-4 text-sm text-slate-light">No configured executive exceptions are currently recorded.</p>}</section>; }
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
      <div className="bg-ink border border-ink-mid rounded-sm p-4 xl:col-span-1 min-h-[340px] flex flex-col justify-between">
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
    <div className="bg-ink border border-ink-mid rounded-sm p-4 xl:col-span-1 min-h-[340px] flex flex-col justify-between">
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
        <div className="border border-ink-mid bg-ink-light p-3.5 rounded-sm space-y-3">
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
  const minLat = -23.0;
  const maxLat = -15.0;
  const minLong = 24.0;
  const maxLong = 34.0;

  const validCoordsRegions = regions.filter(
    (r) =>
      typeof r.latitude === "number" &&
      typeof r.longitude === "number" &&
      r.latitude !== 0 &&
      r.longitude !== 0
  );

  return (
    <section className="bg-ink border border-ink-mid rounded-sm xl:col-span-2 min-h-[340px] flex flex-col">
      <div className="p-4 border-b border-ink-mid flex justify-between items-center">
        <div>
          <h2 className="font-mono text-xs tracking-widest text-paper uppercase">Regional Footprint</h2>
          <p className="text-xs text-slate-light mt-1">Live coverage register based on project profile location data.</p>
        </div>
        <span className="font-mono text-[10px] text-signal uppercase">Geospatial Telemetry</span>
      </div>

      {regions.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 flex-1">
          <div className="p-4 border-b lg:border-b-0 lg:border-r border-ink-mid flex flex-col justify-between">
            <div className="relative w-full aspect-square max-h-[220px] border border-ink-mid bg-ink-light/50 rounded-sm overflow-hidden flex items-center justify-center p-2">
              <div className="absolute inset-0 grid grid-cols-6 grid-rows-6 opacity-[0.03]">
                {Array.from({ length: 36 }).map((_, i) => (
                  <div key={i} className="border border-paper" />
                ))}
              </div>

              {validCoordsRegions.length > 0 ? (
                <svg className="w-full h-full relative z-10" viewBox="0 0 100 100">
                  <line x1="50" y1="0" x2="50" y2="100" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2,2" />
                  <line x1="0" y1="50" x2="100" y2="50" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2,2" />

                  {validCoordsRegions.map((region) => {
                    const lat = Number(region.latitude);
                    const long = Number(region.longitude);
                    const x = ((long - minLong) / (maxLong - minLong)) * 80 + 10;
                    const y = (1 - (lat - minLat) / (maxLat - minLat)) * 80 + 10;

                    return (
                      <g key={String(region.name)} className="group cursor-pointer">
                        <circle
                          cx={x}
                          cy={y}
                          r="4"
                          className="fill-signal/20 stroke-signal/40 animate-ping"
                          style={{ animationDuration: '3s' }}
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r="2"
                          className="fill-signal stroke-paper stroke-[0.5px]"
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

            <div className="mt-4 grid grid-cols-2 gap-2">
              {regions.slice(0, 2).map((region) => (
                <div key={String(region.name)} className="border border-ink-mid bg-ink-light p-2.5 rounded-sm">
                  <span className="font-mono text-[9px] text-slate uppercase block">Region Profile</span>
                  <h4 className="font-semibold text-xs text-paper mt-0.5 truncate">{String(region.name)}</h4>
                  <span className="text-[9px] font-mono text-slate-light block mt-1">
                    {region.latitude && region.longitude ? `${Number(region.latitude).toFixed(2)}°, ${Number(region.longitude).toFixed(2)}°` : "No Coordinates"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 flex flex-col justify-between">
            <div className="space-y-4">
              <h3 className="font-mono text-[9px] text-slate uppercase tracking-wider">Project Density Distribution</h3>
              <div className="space-y-3">
                {regions.slice(0, 4).map((region) => {
                  const active = Number(region.active_projects || 0);
                  const total = Math.max(1, Array.isArray(region.projects) ? region.projects.length : 0);
                  const pct = Math.min(100, Math.round((active / total) * 100));

                  return (
                    <div key={String(region.name)} className="space-y-1">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-paper">{String(region.name)}</span>
                        <span className="text-slate-light">{active} / {total} Active ({pct})</span>
                      </div>
                      <div className="h-1 bg-ink-light border border-ink-mid rounded-full overflow-hidden">
                        <div
                          className="h-full bg-signal transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 border-t border-ink-mid pt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="font-mono text-[9px] text-slate uppercase border-b border-ink-mid">
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
function OperationalControlLedger({ stats }: { stats: ApiData }) { const sources: Record<string, string> = { live_projects: "Projects", deployed_machinery: "Fleet", active_workforce: "HR", open_purchase_orders: "Procurement", materials_in_stock: "Inventory", safety_incidents: "HSE" }; return <section className="bg-ink border border-ink-mid rounded-sm"><div className="p-4 border-b border-ink-mid flex justify-between gap-4"><div><h2 className="font-mono text-xs tracking-widest text-paper uppercase">Operational Intelligence</h2><p className="text-xs text-slate-light mt-1">Current ERP control ledger</p></div><span className="font-mono text-[10px] text-slate">LIVE READ</span></div><div className="p-4 overflow-x-auto"><table className="w-full text-left min-w-[540px]"><thead className="font-mono text-[10px] tracking-widest text-slate uppercase border-b border-ink-mid"><tr><th className="pb-2 font-normal">Control</th><th className="pb-2 font-normal">Current Value</th><th className="pb-2 font-normal">Source</th></tr></thead><tbody>{Object.entries(stats).map(([key, value]) => <tr key={key} className="border-b border-ink-mid/60"><td className="py-3 text-sm text-paper">{titleCase(key)}</td><td className="py-3 font-mono text-sm text-paper">{displayValue(value)}</td><td className="py-3 text-xs text-slate-light">{sources[key] || "ERP"}</td></tr>)}</tbody></table>{!Object.keys(stats).length && <p className="text-sm text-slate-light py-4">No operational records are available for this organisation.</p>}</div></section>; }
