"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
  TrendingUp,
  Layers,
  Activity,
  AlertCircle,
  Plus,
  ClipboardCheck,
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFinanceDepartments } from "@/hooks/useFinanceDepartments";
import {
  ApiError, getExecutiveProjectDetail, getInternalProjects, getProject, updateInternalProject,
  createInternalProject,
  getProjectLifecycle,
  getCrmOrganizations, getCrmContacts,
} from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

// Only rendered once a project is selected, instead of shipping with the portfolio view.
function PanelLoading() {
  return <Skeleton className="h-96 w-full" />;
}
const ProjectDetail = dynamic(() => import("./ProjectDetailPanel").then((m) => m.ProjectDetail), { loading: PanelLoading });

export const FINANCE_SIGNOFF_ROLES = new Set(["Finance Manager", "Executive (Admin)", "SUPERADMIN"]);
export const COMMERCIAL_READINESS_ROLES = new Set(["Commercial Manager", "Contracts Manager", "Quantity Surveyor", "Executive (Admin)", "SUPERADMIN"]);

export type Project = Record<string, unknown> & {
  id: string;
  name?: string;
  project_name?: string;
  status?: string;
  updated_at?: string;
  created_at?: string;
  location?: string;
  contract_value?: number;
  budget?: number;
  budget_value?: number;
  project_manager?: string;
  manager?: string;
  end_date?: string;
  health?: string;
  project_code?: string;
  client_org_id?: string;
  client_id?: string;
  client_name?: string;
  client?: string;
  department_id?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
};

export type Department = { id: string; code: string; name: string };
export type ClientOrganization = { id: string; name: string; lifecycle_stage?: string; account_status?: string };
export type ClientContact = { id: string; contact_name?: string; first_name?: string; last_name?: string; email?: string; phone?: string; client_org_id?: string };

export type Detail = Record<string, unknown> & { 
  project?: Project; 
  viability?: Record<string, unknown>[]; 
  tests_and_checks?: Record<string, unknown>[]; 
  site_reports?: Record<string, unknown>[]; 
  material_records?: Record<string, unknown>[];
  quotations?: Record<string, unknown>[]; 
  procurement_orders?: Record<string, unknown>[]; 
  tenders?: Record<string, unknown>[]; 
  subcontractors?: Record<string, unknown>[];
  milestones?: Record<string, unknown>[];
  changes?: Record<string, unknown>[];
  risks?: Record<string, unknown>[];
  pre_mobilisation?: PreMobilisationReadiness;
  commercial_readiness?: CommercialReadiness;
};

export type PreMobilisationCheck = Record<string, unknown> & {
  id: string;
  check_name?: string;
  status?: string;
  evidence_reference?: string;
  mandatory_evidence?: string;
};

export type PreMobilisationReadiness = {
  checks: PreMobilisationCheck[];
  total: number;
  ready_count: number;
  missing: string[];
  evidence_missing: string[];
  ready: boolean;
};

export type CommercialReadinessControl = {
  key: string;
  label: string;
  complete: boolean;
};

export type CommercialReadiness = {
  status?: string;
  pack?: Record<string, unknown>;
  controls?: CommercialReadinessControl[];
  authority_status?: string;
  blockers?: string[];
  ready_count?: number;
  total?: number;
  ready?: boolean;
  clearance_statement?: Record<string, unknown>;
  cleared_at?: string;
  cleared_by?: string;
};

export type ProjectTab = "dashboard" | "overview" | "team" | "schedule" | "financials" | "materials" | "documents" | "assign" | "controls";
export type ProjectCommand = "workforce" | "siteReports" | "rfqs" | "variations" | "budget" | "documents" | "progress" | "controls" | "materials";

const TAB_ROUTES: Record<ProjectTab, string> = {
  dashboard: "/dashboard/projects/dashboard",
  overview: "/dashboard/projects/overview",
  team: "/dashboard/projects/team",
  schedule: "/dashboard/projects/schedule",
  financials: "/dashboard/projects/financials",
  materials: "/dashboard/projects/materials",
  documents: "/dashboard/projects/documents",
  assign: "/dashboard/projects/assign",
  controls: "/dashboard/projects/controls",
};

const PROJECT_TAB_LABELS: Record<ProjectTab, string> = {
  dashboard: "Projects Command",
  overview: "Overview",
  team: "Team",
  schedule: "Schedule",
  financials: "Financials",
  materials: "Materials",
  documents: "Documents",
  assign: "Assign",
  controls: "Controls",
};

const activeStatuses = new Set(["active", "in progress", "ongoing", "live", "execution"]);
export const riskStatuses = new Set(["at risk", "critical", "blocked", "delayed"]);

export function text(value: unknown, fallback = "Not recorded") { 
  return typeof value === "string" && value.trim() ? value : fallback; 
}

export function number(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    const cleaned = value
      .replace(/[,$\s]/g, "")
      .replace(/^\((.*)\)$/, "-$1");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null; 
}

export function title(project: Project) { 
  return text(project.name ?? project.project_name ?? project.project_code ?? project.id); 
}

export function codePrefix(value: unknown, fallback = "PRJ") {
  const raw = text(value, fallback).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return raw ? raw.slice(0, 18) : fallback;
}

export function contactLabel(contact: ClientContact) {
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();
  return text(contact.contact_name ?? fullName ?? contact.email ?? contact.phone, "Unnamed contact");
}

function statusTone(status: unknown) {
  const normalized = text(status, "unknown").toLowerCase();
  if (riskStatuses.has(normalized)) return "border-red-500/30 bg-red-950/20 text-red-300";
  if (activeStatuses.has(normalized)) return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  return "border-slate-500/30 bg-slate-950/20 text-slate-300";
}

function projectDetailRefs(project: Project): string[] {
  const candidates = [project.slug, project.id, project.project_code, project.name, project.project_name]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  return Array.from(new Set(candidates));
}

const PROJECT_MODULE_CAPABILITIES = [
  { title: "WBS planning", description: "Break contracts into phases, work packages, tasks and accountable owners.", icon: Layers },
  { title: "Gantt scheduling", description: "Maintain baseline, forecast and actual milestone dates with owner tracking.", icon: CalendarDays },
  { title: "Critical path", description: "Surface blocked, delayed and dependency-sensitive work before it hits site output.", icon: Activity },
  { title: "Resource control", description: "Connect labour, plant, materials and subcontract packages to project cost codes.", icon: Package },
  { title: "Dashboards", description: "Compare progress, cost, workload, missing evidence and risk from live AEGIS records.", icon: TrendingUp },
  { title: "Approvals", description: "Gate commercial readiness, deposit confirmation and mobilisation authorisation.", icon: ShieldCheck },
  { title: "Documents", description: "Keep drawings, BOQs, contracts, instructions, certificates and revisions attached.", icon: ClipboardCheck },
  { title: "Audit trail", description: "Preserve system-of-record evidence for decisions, changes and exceptions.", icon: AlertCircle },
];

const CONSTRUCTION_WORKFLOW_STEPS = [
  "Scope",
  "Budget",
  "WBS",
  "Programme",
  "Documents",
  "Resources",
  "Mobilise",
  "Report",
  "Control",
  "Handover",
];

export default function ProjectsDashboard() {
  return <ProjectsPage initialTab="dashboard" />;
}

/** Shared Projects workspace, rendered by a real route per tab (see the
 * sibling folders here) instead of the old projects/[tab] -> redirect() ->
 * ?tab= shim. `initialTab` only matters once a project is opened
 * (ProjectDetail below) - the list view itself doesn't vary by tab. */
export function ProjectsPage({ initialTab }: { initialTab: ProjectTab }) {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Contracts Manager", "Commercial Manager", "Executive Read Only", "External Auditor"]}>
      <ProjectsWorkspace initialTab={initialTab} />
    </RBACGuard>
  );
}

function ProjectsWorkspace({ initialTab }: { initialTab: ProjectTab }) {
  const activeTab = initialTab;
  // Still needed for the ?id= deep-link below (unrelated to tab routing).
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Project | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { departments } = useFinanceDepartments();
  const [clientOrganizations, setClientOrganizations] = useState<ClientOrganization[]>([]);
  const [clientContacts, setClientContacts] = useState<ClientContact[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    getCrmOrganizations()
      .then((res) => setClientOrganizations(res.data || []))
      .catch(() => setClientOrganizations([]));
    getCrmContacts()
      .then((res) => setClientContacts(res.data || []))
      .catch(() => setClientContacts([]));
  }, []);

  const normalizeError = useCallback((value: unknown, fallback: string) => {
    if (value instanceof ApiError) {
      if (value.status === 404) return fallback;
      if (value.status === 403) return "Your current role does not have permission to view this project.";
    }

    const message = value instanceof Error ? value.message : String(value ?? "");
    if (/not found|aborted|cancelled|timed out|network error|fetch failed/i.test(message)) {
      return fallback;
    }
    return fallback;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); 
    setError(null);
    try { 
      const response = await getInternalProjects(); 
      setProjects(response.data || []); 
    } catch (err) { 
      setError(normalizeError(err, "The project register could not be loaded.")); 
    } finally { 
      setLoading(false); 
    }
  }, [normalizeError]);

  useEffect(() => {
    void load();
  }, [load]);

  const openProject = useCallback(async (project: Project) => {
    setSelected(project); 
    setDetail(null); 
    setDetailError(null); 
    setDetailLoading(true);
    const refs = projectDetailRefs(project);
    let lastError: unknown = null;
    const mergeLifecycle = async (base: Detail, ref: string): Promise<Detail> => {
      try {
        const lifecycle = await getProjectLifecycle(ref);
        const lifecycleData = (lifecycle.data ?? {}) as Detail;
        return {
          ...base,
          ...lifecycleData,
          project: (lifecycleData.project as Project | undefined) ?? base.project,
        };
      } catch {
        return base;
      }
    };
    try { 
      for (const ref of refs) {
        try {
          const response = await getExecutiveProjectDetail(ref);
          setDetail(await mergeLifecycle(response.data as Detail, ref));
          return;
        } catch (err) {
          lastError = err;
        }
      }
      for (const ref of refs) {
        try {
          const response = await getProject(ref);
          if (response.success && response.data) {
            const fallbackProject = response.data as unknown as Project;
            setDetail(await mergeLifecycle({
              project: fallbackProject,
              viability: [],
              tests_and_checks: [],
              site_reports: [],
              material_records: [],
              quotations: [],
              procurement_orders: [],
              tenders: [],
              subcontractors: []
            }, ref));
            return;
          }
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError ?? new Error("Project has no usable ERP identifier.");
    } catch (err) { 
      setDetailError(normalizeError(err, "Detailed project evidence is unavailable for this account."));
    } finally { 
      setDetailLoading(false); 
    }
  }, [normalizeError]);

  // Deep link from Tenders/Opportunities "Project Live" badges (?id=<project id>).
  useEffect(() => {
    const targetId = searchParams?.get("id");
    if (!targetId || projects.length === 0) return;
    const match = projects.find((p) => p.id === targetId);
    if (match) void openProject(match);
  }, [searchParams, projects, openProject]);

  const metrics = useMemo(() => {
    const active = projects.filter((project) => activeStatuses.has(text(project.status, "").toLowerCase())).length;
    const attention = projects.filter((project) => riskStatuses.has(text(project.health ?? project.status, "").toLowerCase())).length;
    const value = projects.reduce((sum, project) => sum + (number(project.contract_value ?? project.budget ?? project.budget_value) ?? 0), 0);
    const withClient = projects.filter((project) => text(project.client_org_id ?? project.client_id ?? project.client_name ?? project.client, "")).length;
    const withManager = projects.filter((project) => text(project.project_manager ?? project.manager, "")).length;
    const withProgrammeEnd = projects.filter((project) => text(project.end_date ?? project.planned_completion_date, "")).length;
    const withBudget = projects.filter((project) => (number(project.contract_value ?? project.budget ?? project.budget_value) ?? 0) > 0).length;
    const mobilisationQueue = projects.filter((project) => text(project.status, "").toLowerCase() === "pre_mobilisation").length;
    return { active, attention, value, withClient, withManager, withProgrammeEnd, withBudget, mobilisationQueue };
  }, [projects]);

  const filtered = useMemo(() => projects.filter((project) => {
    const searchStr = query.toLowerCase();
    const matchesQuery = [
      title(project), 
      project.client_name ?? project.client, 
      project.location, 
      project.project_code
    ].some((value) => text(value, "").toLowerCase().includes(searchStr));
    
    return matchesQuery && (status === "all" || text(project.status, "unknown").toLowerCase() === status);
  }), [projects, query, status]);

  const statuses = useMemo(() => 
    Array.from(new Set(projects.map((project) => text(project.status, "unknown").toLowerCase()))).sort(), 
    [projects]
  );

  return (
    <div className="min-h-full bg-ink p-4 text-paper sm:p-6">
      <DashboardPageHeader
        eyebrow={{ label: "Delivery portfolio", icon: BriefcaseBusiness }}
        title={PROJECT_TAB_LABELS[activeTab]}
        subtitle="Live project register and delivery evidence across the ERP."
        actions={
          <>
            <div className="flex h-10 border border-ink-mid bg-ink-light">
              <button
                onClick={() => setViewMode("list")}
                className={`px-3 font-mono text-xs uppercase tracking-wider ${viewMode === "list" ? "bg-signal text-ink" : "text-slate-light hover:text-paper"}`}
              >
                List
              </button>
              <button
                onClick={() => setViewMode("kanban")}
                className={`px-3 font-mono text-xs uppercase tracking-wider ${viewMode === "kanban" ? "bg-signal text-ink" : "text-slate-light hover:text-paper"}`}
              >
                Pipeline
              </button>
            </div>
            <button
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex h-10 items-center gap-2 border border-signal bg-signal/10 px-3 font-mono text-xs uppercase tracking-wider text-signal hover:bg-signal hover:text-ink"
            >
              <Plus className="h-4 w-4" />New Project
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </button>
          </>
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Registered projects" value={loading ? "..." : String(projects.length)} detail="Live project register" />
        <Metric label="Active delivery" value={loading ? "..." : String(metrics.active)} detail="Status-based count" tone="text-emerald-300" />
        <Metric label="Attention required" value={loading ? "..." : String(metrics.attention)} detail="At-risk, critical, blocked or delayed" tone={metrics.attention ? "text-amber-300" : "text-slate-light"} />
        <Metric label="Recorded portfolio value" value={metrics.value ? formatCurrency(metrics.value) : "Not recorded"} detail="Contract/budget fields where present" />
      </section>

      <PortfolioCommandDashboard
        projects={projects}
        loading={loading}
        metrics={metrics}
        onSelect={(project) => void openProject(project)}
      />

      {error ? (
        <section className="mb-6 flex gap-3 border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">
          <CircleAlert className="h-5 w-5 shrink-0" />{error}
        </section>
      ) : null}

      {viewMode === "kanban" ? (
        <ProjectPipeline
          projects={filtered}
          loading={loading}
          onSelect={(project) => void openProject(project)}
          onStatusChange={(project, nextStatus) => {
            setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, status: nextStatus } : p)));
            void updateInternalProject(project.id, { status: nextStatus }).catch(() => void load());
          }}
        />
      ) : (
      <section className="border border-ink-mid bg-ink">
        <div className="flex flex-col gap-3 border-b border-ink-mid p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-mono text-sm font-bold uppercase tracking-wider">Project register</h2>
            <p className="mt-1 text-xs text-slate-light">Select a project to review its schedule Gantt, budget metrics, material consumption, and ERP logs.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3">
              <Search className="h-4 w-4 text-slate" />
              <input 
                value={query} 
                onChange={(event) => setQuery(event.target.value)} 
                placeholder="Search project, client or location" 
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate" 
              />
            </label>
            <select 
              value={status} 
              onChange={(event) => setStatus(event.target.value)} 
              className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper"
            >
              <option value="all">All statuses</option>
              {statuses.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center gap-3 text-sm text-slate-light">
            <Loader2 className="h-5 w-5 animate-spin text-signal" />Loading project register
          </div>
        ) : filtered.length === 0 ? (
          <Empty />
        ) : (
          <div className="divide-y divide-ink-mid">
            {filtered.map((project) => (
              <button 
                key={project.id} 
                onClick={() => void openProject(project)} 
                className="grid w-full gap-3 p-4 text-left hover:bg-ink-light/50 md:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] md:items-center"
              >
                <div>
                  <p className="font-medium text-paper">{title(project)}</p>
                  <p className="mt-1 text-xs text-slate-light">
                    {text(project.client_name ?? project.client)} {project.location ? `• ${text(project.location)}` : ""}
                  </p>
                </div>
                <span className={`w-fit border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${statusTone(project.health ?? project.status)}`}>
                  {text(project.health ?? project.status, "unknown")}
                </span>
                <div className="text-xs text-slate-light">
                  <span className="block text-slate">Last updated</span>
                  {formatDate(text(project.updated_at ?? project.created_at, ""))}
                </div>
                <ChevronRight className="h-5 w-5 justify-self-end text-slate" />
              </button>
            ))}
          </div>
        )}
      </section>
      )}

      {isCreateOpen && (
        <CreateProjectModal
          departments={departments}
          clientOrganizations={clientOrganizations}
          clientContacts={clientContacts}
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => {
            setIsCreateOpen(false);
            void load();
          }}
        />
      )}

      {selected ? (
        <ProjectDetail
          project={selected}
          initialTab={activeTab}
          departments={departments}
          clientOrganizations={clientOrganizations}
          clientContacts={clientContacts}
          onDepartmentChange={(deptId) => {
            setSelected((prev) => (prev ? { ...prev, department_id: deptId } : prev));
            setProjects((prev) => prev.map((p) => (p.id === selected.id ? { ...p, department_id: deptId } : p)));
          }}
          onProjectUpdated={(patch) => {
            setSelected((prev) => (prev ? { ...prev, ...patch } : prev));
            setProjects((prev) => prev.map((p) => (p.id === selected.id ? { ...p, ...patch } : p)));
            setDetail((prev) => prev ? { ...prev, project: prev.project ? { ...prev.project, ...patch } : prev.project } : prev);
          }}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={() => setSelected(null)}
          onRefresh={() => openProject(selected)}
          onDeleted={() => { setSelected(null); void load(); }}
        />
      ) : null}
    </div>
  );
}

const PIPELINE_STAGES = ["planning", "pending_deposit", "pre_mobilisation", "active", "on_hold", "completed", "cancelled"];

const PIPELINE_STAGE_LABELS: Record<string, string> = {
  planning: "Planning",
  pending_deposit: "Pending Deposit",
  pre_mobilisation: "Pre-Mobilisation",
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.min(100, Math.max(0, Math.round((numerator / denominator) * 100)));
}

function projectProgress(project: Project): number {
  return percent(
    number(project.progress ?? project.progress_pct ?? project.completion_percent ?? project.percent_complete) ?? 0,
    100,
  );
}

function PortfolioCommandDashboard({
  projects,
  loading,
  metrics,
  onSelect,
}: {
  projects: Project[];
  loading: boolean;
  metrics: {
    active: number;
    attention: number;
    value: number;
    withClient: number;
    withManager: number;
    withProgrammeEnd: number;
    withBudget: number;
    mobilisationQueue: number;
  };
  onSelect: (project: Project) => void;
}) {
  type HealthState = "ok" | "warn" | "gap";
  const healthRows = useMemo(() => projects.slice(0, 7).map((project) => {
    const status = text(project.status, "unknown").toLowerCase();
    const health = text(project.health ?? project.status, "unknown").toLowerCase();
    const progress = projectProgress(project);
    const value = number(project.contract_value ?? project.budget ?? project.budget_value) ?? 0;
    return {
      project,
      name: title(project),
      time: (status.includes("delayed") || health.includes("delay") || health.includes("critical") ? "warn" : "ok") as HealthState,
      cost: (value > 0 ? "ok" : "gap") as HealthState,
      workload: (text(project.project_manager ?? project.manager, "") ? "ok" : "gap") as HealthState,
      tasks: number(project.task_count ?? project.open_tasks ?? project.tasks_total) ?? 0,
      progress,
    };
  }), [projects]);

  const completed = projects.filter((project) => text(project.status, "").toLowerCase() === "completed").length;
  const blocked = projects.filter((project) => riskStatuses.has(text(project.health ?? project.status, "").toLowerCase())).length;
  const taskTotal = projects.reduce((sum, project) => sum + (number(project.task_count ?? project.open_tasks ?? project.tasks_total) ?? 0), 0);
  const dataCompleteness = percent(
    metrics.withClient + metrics.withManager + metrics.withProgrammeEnd + metrics.withBudget,
    Math.max(projects.length * 4, 1),
  );
  const avgProgress = projects.length
    ? Math.round(projects.reduce((sum, project) => sum + projectProgress(project), 0) / projects.length)
    : 0;
  const topProgress = [...projects]
    .sort((a, b) => projectProgress(b) - projectProgress(a))
    .slice(0, 5);

  return (
    <section className="mb-6 border border-ink-mid bg-ink-light/20">
      <div className="grid gap-0 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="border-b border-ink-mid p-4 xl:border-b-0 xl:border-r">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Construction system of record</p>
              <h2 className="mt-1 font-display text-2xl font-semibold text-paper">Portfolio command dashboard</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-light">
                Live project signals from AEGIS only: register fields, linked clients, responsible owners, budgets, programme dates and status. Missing values are shown as gaps instead of being filled with redacted or sample data.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-wider sm:grid-cols-4 md:min-w-[420px]">
              <div className="border border-ink-mid bg-ink p-3">
                <p className="text-slate">Data</p>
                <p className="mt-1 text-lg font-bold text-signal">{loading ? "..." : `${dataCompleteness}%`}</p>
              </div>
              <div className="border border-ink-mid bg-ink p-3">
                <p className="text-slate">Progress</p>
                <p className="mt-1 text-lg font-bold text-paper">{loading ? "..." : `${avgProgress}%`}</p>
              </div>
              <div className="border border-ink-mid bg-ink p-3">
                <p className="text-slate">Gate queue</p>
                <p className="mt-1 text-lg font-bold text-amber-300">{loading ? "..." : metrics.mobilisationQueue}</p>
              </div>
              <div className="border border-ink-mid bg-ink p-3">
                <p className="text-slate">Tasks</p>
                <p className="mt-1 text-lg font-bold text-cyan-300">{loading ? "..." : taskTotal}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
            <div className="overflow-x-auto border border-ink-mid bg-ink">
              <table className="w-full min-w-[680px] text-left font-mono text-[10px]">
                <thead>
                  <tr className="border-b border-ink-mid text-slate">
                    <th className="px-3 py-2">Project</th>
                    <th className="px-3 py-2 text-center">Time</th>
                    <th className="px-3 py-2 text-center">Cost</th>
                    <th className="px-3 py-2 text-center">Owner</th>
                    <th className="px-3 py-2 text-right">Tasks</th>
                    <th className="px-3 py-2 text-right">Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/60">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-slate-light">Loading portfolio health</td>
                    </tr>
                  ) : healthRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-slate-light">No project records returned.</td>
                    </tr>
                  ) : healthRows.map((row) => (
                    <tr key={row.project.id} className="cursor-pointer hover:bg-ink-light/40" onClick={() => onSelect(row.project)}>
                      <td className="px-3 py-2 font-sans text-xs font-semibold text-paper">{row.name}</td>
                      <td className="px-3 py-2 text-center"><HealthDot state={row.time} /></td>
                      <td className="px-3 py-2 text-center"><HealthDot state={row.cost} /></td>
                      <td className="px-3 py-2 text-center"><HealthDot state={row.workload} /></td>
                      <td className="px-3 py-2 text-right text-slate-light">{row.tasks}</td>
                      <td className="px-3 py-2 text-right text-paper">{row.progress}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border border-ink-mid bg-ink p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Portfolio status</p>
              <div className="mt-4 flex items-center justify-center">
                <div
                  className="grid h-40 w-40 place-items-center rounded-full"
                  style={{ background: `conic-gradient(#21d963 0 ${percent(metrics.active, Math.max(projects.length, 1))}%, #0ea5e9 ${percent(metrics.active, Math.max(projects.length, 1))}% ${percent(metrics.active + completed, Math.max(projects.length, 1))}%, #f59e0b ${percent(metrics.active + completed, Math.max(projects.length, 1))}% ${percent(metrics.active + completed + blocked, Math.max(projects.length, 1))}%, #27344a 0)` }}
                >
                  <div className="grid h-28 w-28 place-items-center rounded-full bg-ink text-center">
                    <span>
                      <strong className="block text-2xl text-paper">{projects.length}</strong>
                      <span className="font-mono text-[9px] uppercase text-slate">projects</span>
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center font-mono text-[9px] uppercase">
                <span className="text-emerald-300">Active {metrics.active}</span>
                <span className="text-sky-300">Done {completed}</span>
                <span className="text-amber-300">Risk {blocked}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-5">
            {topProgress.map((project) => (
              <button key={project.id} onClick={() => onSelect(project)} className="border border-ink-mid bg-ink p-3 text-left hover:border-signal">
                <p className="truncate text-xs font-semibold text-paper">{title(project)}</p>
                <div className="mt-2 h-2 bg-ink-mid">
                  <div className="h-full bg-signal" style={{ width: `${projectProgress(project)}%` }} />
                </div>
                <p className="mt-1 font-mono text-[10px] text-slate-light">{projectProgress(project)}% complete</p>
              </button>
            ))}
          </div>
        </div>

        <div className="p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {PROJECT_MODULE_CAPABILITIES.map((item) => (
              <div key={item.title} className="border border-ink-mid bg-ink p-3">
                <item.icon className="h-5 w-5 text-signal" />
                <h3 className="mt-2 text-sm font-semibold text-paper">{item.title}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-light">{item.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 border border-ink-mid bg-ink p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Construction workflow</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {CONSTRUCTION_WORKFLOW_STEPS.map((step, index) => (
                <div key={step} className="border border-ink-mid bg-ink-light/40 px-2 py-2 text-center">
                  <span className="block font-mono text-[9px] text-signal">{String(index + 1).padStart(2, "0")}</span>
                  <span className="text-[11px] font-semibold text-paper">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HealthDot({ state }: { state: "ok" | "warn" | "gap" }) {
  const cls = state === "ok" ? "bg-emerald-400" : state === "warn" ? "bg-amber-400" : "bg-slate-600";
  const label = state === "ok" ? "Recorded" : state === "warn" ? "Needs attention" : "Missing";
  return <span title={label} className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} />;
}

function ProjectPipeline({
  projects,
  loading,
  onSelect,
  onStatusChange,
}: {
  projects: Project[];
  loading: boolean;
  onSelect: (project: Project) => void;
  onStatusChange: (project: Project, nextStatus: string) => void;
}) {
  const [draggedOverStage, setDraggedOverStage] = useState<string | null>(null);

  // Projects with a status outside the known pipeline (legacy/free-text
  // values) still need a home, so they fall into 'planning' rather than
  // vanishing from the board.
  const stageOf = (project: Project) => {
    const s = text(project.status, "planning").toLowerCase();
    return PIPELINE_STAGES.includes(s) ? s : "planning";
  };

  const handleDrop = (e: DragEvent, stage: string) => {
    e.preventDefault();
    setDraggedOverStage(null);
    const projectId = e.dataTransfer.getData("text/plain");
    const project = projects.find((p) => p.id === projectId);
    if (!project || stageOf(project) === stage) return;
    onStatusChange(project, stage);
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center gap-3 border border-ink-mid bg-ink text-sm text-slate-light">
        <Loader2 className="h-5 w-5 animate-spin text-signal" />Loading project register
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {PIPELINE_STAGES.map((stage) => {
        const stageProjects = projects.filter((p) => stageOf(p) === stage);
        const stageValue = stageProjects.reduce((sum, p) => sum + (number(p.contract_value ?? p.budget ?? p.budget_value) ?? 0), 0);
        return (
          <div
            key={stage}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={(e) => { e.preventDefault(); setDraggedOverStage(stage); }}
            onDragLeave={() => setDraggedOverStage(null)}
            onDrop={(e) => handleDrop(e, stage)}
            className={`min-w-[270px] max-w-[300px] flex-1 border p-3 transition-colors ${draggedOverStage === stage ? "border-signal bg-ink-light/40" : "border-ink-mid bg-ink"}`}
          >
            <div className="mb-3 flex items-center justify-between border-b border-ink-mid pb-2">
              <div>
                <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">{PIPELINE_STAGE_LABELS[stage] ?? stage}</h3>
                <span className="mt-0.5 block font-mono text-[9px] text-signal">{formatCurrency(stageValue)}</span>
              </div>
              <span className="rounded-full bg-ink-light px-2 py-0.5 font-mono text-[10px] text-slate">{stageProjects.length}</span>
            </div>
            <div className="space-y-2">
              {stageProjects.map((project) => (
                <div
                  key={project.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", project.id); e.dataTransfer.effectAllowed = "move"; }}
                  onClick={() => onSelect(project)}
                  className="cursor-grab border border-ink-mid bg-ink-light/30 p-3 text-left transition-colors hover:border-signal active:cursor-grabbing"
                >
                  <p className="text-xs font-semibold text-paper">{title(project)}</p>
                  <p className="mt-1 text-[10px] text-slate-light">{text(project.client_name ?? project.client)}</p>
                  <p className="mt-2 font-mono text-[10px] text-signal">
                    {formatCurrency(number(project.contract_value ?? project.budget ?? project.budget_value) ?? 0)}
                  </p>
                </div>
              ))}
              {stageProjects.length === 0 && (
                <div className="flex h-20 items-center justify-center border border-dashed border-ink-mid text-[10px] uppercase text-slate">
                  No projects
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CreateProjectModal({
  departments,
  clientOrganizations,
  clientContacts,
  onClose,
  onCreated,
}: {
  departments: Department[];
  clientOrganizations: ClientOrganization[];
  clientContacts: ClientContact[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: "", project_code: "", project_type: "", client_org_id: "", client_name: "",
    contract_value: "", start_date: "", planned_completion_date: "", department_id: "",
  });
  const [initiatedBy, setInitiatedBy] = useState<"client" | "company">("client");
  const [clientType, setClientType] = useState<"organization" | "individual">("organization");
  const [durationValue, setDurationValue] = useState("");
  const [durationUnit, setDurationUnit] = useState<"weeks" | "months">("weeks");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { setError("Project name is required."); return; }
    if (initiatedBy === "company" && durationValue && Number(durationValue) <= 0) {
      setError("Setup duration must be greater than zero."); return;
    }
    setBusy(true); setError(null);
    try {
      const setupDurationWeeks = initiatedBy === "company" && durationValue
        ? Math.round(Number(durationValue) * (durationUnit === "months" ? 4.345 : 1))
        : undefined;
      await createInternalProject({
        name: form.name.trim(),
        project_code: form.project_code || codePrefix(form.name, "PRJ"),
        project_type: form.project_type || undefined,
        client_org_id: initiatedBy === "client" && clientType === "organization" ? (form.client_org_id || undefined) : undefined,
        client_id: initiatedBy === "client" && clientType === "individual" ? (form.client_org_id || undefined) : undefined,
        client_name: initiatedBy === "client" ? (form.client_name || undefined) : undefined,
        contract_value: initiatedBy === "client" && form.contract_value ? Number(form.contract_value) : undefined,
        start_date: initiatedBy === "client" ? (form.start_date || undefined) : undefined,
        planned_completion_date: initiatedBy === "client" ? (form.planned_completion_date || undefined) : undefined,
        department_id: form.department_id || undefined,
        initiated_by: initiatedBy,
        setup_duration_weeks: setupDurationWeeks,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg border border-ink-mid bg-ink p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">New Project</h3>
          <button onClick={onClose} className="text-slate hover:text-paper"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-xs text-slate-light">
          Manual entry, for projects that didn&apos;t come through a won tender or opportunity. Those flows already create their project automatically.
        </p>

        <div className="mb-4 flex gap-2 border border-ink-mid bg-ink-light p-1">
          <button
            type="button"
            onClick={() => setInitiatedBy("client")}
            className={`flex-1 py-2 font-mono text-[11px] uppercase tracking-wider ${initiatedBy === "client" ? "bg-signal text-ink" : "text-slate-light hover:text-paper"}`}
          >
            Client-commissioned
          </button>
          <button
            type="button"
            onClick={() => setInitiatedBy("company")}
            className={`flex-1 py-2 font-mono text-[11px] uppercase tracking-wider ${initiatedBy === "company" ? "bg-signal text-ink" : "text-slate-light hover:text-paper"}`}
          >
            Company-initiated production
          </button>
        </div>
        {initiatedBy === "company" && (
          <p className="mb-4 border border-signal/30 bg-signal/5 p-3 text-xs text-slate-light">
            A project SNC initiates itself to produce something to sell (internal or external) - no client, no contract deadline. It stays dormant with no tasks until you complete its intake (category, investment, funding) and commit it from the project detail view - that&apos;s also where you&apos;ll track setup expenses and, once it&apos;s active, the revenue it brings in.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Project name *" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper sm:col-span-2" />
          {initiatedBy === "client" && (
            <>
              <div className="flex h-10 border border-ink-mid bg-ink-light p-1 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => {
                    setClientType("organization");
                    setForm((prev) => ({ ...prev, client_org_id: "", client_name: "" }));
                  }}
                  className={`flex-1 font-mono text-[10px] uppercase tracking-wider ${clientType === "organization" ? "bg-signal text-ink" : "text-slate-light hover:text-paper"}`}
                >
                  Organisation
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClientType("individual");
                    setForm((prev) => ({ ...prev, client_org_id: "", client_name: "" }));
                  }}
                  className={`flex-1 font-mono text-[10px] uppercase tracking-wider ${clientType === "individual" ? "bg-signal text-ink" : "text-slate-light hover:text-paper"}`}
                >
                  Individual
                </button>
              </div>
              <select
                value={form.client_org_id}
                onChange={(e) => {
                  const clientId = e.target.value;
                  const contact = clientContacts.find((item) => item.id === clientId);
                  const clientName = clientType === "organization" ? clientOrganizations.find((org) => org.id === clientId)?.name : contact ? contactLabel(contact) : undefined;
                  setForm((prev) => ({ ...prev, client_org_id: clientId, client_name: clientName ?? prev.client_name }));
                }}
                className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper"
              >
                <option value="">{clientType === "organization" ? "Link CRM organisation" : "Link CRM individual"}</option>
                {clientType === "organization"
                  ? clientOrganizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)
                  : clientContacts.map((contact) => <option key={contact.id} value={contact.id}>{contactLabel(contact)}</option>)}
              </select>
              <input value={form.contract_value} onChange={(e) => set("contract_value", e.target.value)} type="number" placeholder="Contract value ($)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              <input value={form.client_name} onChange={(e) => set("client_name", e.target.value)} placeholder="Client display name" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper sm:col-span-2" />
            </>
          )}
          <input value={form.project_code} onChange={(e) => set("project_code", e.target.value)} placeholder="Project code" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={form.project_type} onChange={(e) => set("project_type", e.target.value)} placeholder="Project type" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          {initiatedBy === "client" ? (
            <>
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Start date</label>
                <input value={form.start_date} onChange={(e) => set("start_date", e.target.value)} type="date" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Planned completion</label>
                <input value={form.planned_completion_date} onChange={(e) => set("planned_completion_date", e.target.value)} type="date" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
            </>
          ) : (
            <div className="sm:col-span-2">
              <label className="mb-1 block font-mono text-[9px] uppercase text-slate">How long will it take to set up and begin production?</label>
              <div className="flex gap-2">
                <input value={durationValue} onChange={(e) => setDurationValue(e.target.value)} type="number" min="1" placeholder="e.g. 6" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
                <select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as "weeks" | "months")} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
                  <option value="weeks">Weeks</option>
                  <option value="months">Months</option>
                </select>
              </div>
            </div>
          )}
          <select value={form.department_id} onChange={(e) => set("department_id", e.target.value)} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper sm:col-span-2">
            <option value="">Department (optional)</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={submit} disabled={busy} className="h-10 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            {busy ? "Creating..." : "Create Project"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Metric({ label, value, detail, tone = "text-paper" }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="border border-ink-mid bg-ink p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-light">{detail}</p>
    </div>
  ); 
}

function Empty() { 
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
      <BriefcaseBusiness className="h-7 w-7 text-slate" />
      <p className="text-sm text-slate-light">No projects match the current filters.</p>
    </div>
  ); 
}

