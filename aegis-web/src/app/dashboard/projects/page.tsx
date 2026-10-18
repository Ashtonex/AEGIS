"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  ChevronRight,
  CircleAlert,
  Loader2,
  RefreshCw,
  Search,
  X,
  Plus,
  DollarSign,
  Activity,
  AlertTriangle,
  HardHat,
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
export type ProjectCommand = "workforce" | "siteReports" | "rfqs" | "variations" | "budget" | "claim" | "documents" | "progress" | "controls" | "materials";

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

export default function ProjectsDashboard() {
  return <ProjectsPage initialTab="dashboard" />;
}

/** Shared Projects workspace, rendered by a real route per tab (see the
 * sibling folders here) instead of the old projects/[tab] -> redirect() ->
 * ?tab= shim. `initialTab` only matters once a project is opened
 * (ProjectDetail below) - the list view itself doesn't vary by tab. */
export function ProjectsPage({ initialTab }: { initialTab: ProjectTab }) {
  return (
    <RBACGuard>
      <ProjectsWorkspace initialTab={initialTab} />
    </RBACGuard>
  );
}

function ProjectsWorkspace({ initialTab }: { initialTab: ProjectTab }) {
  const activeTab = initialTab;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const { departments } = useFinanceDepartments();
  const [clientOrganizations, setClientOrganizations] = useState<ClientOrganization[]>([]);
  const [clientContacts, setClientContacts] = useState<ClientContact[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("kanban");
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

  const openProject = useCallback((project: Project) => {
    const refs = projectDetailRefs(project);
    for (const ref of refs) {
      if (ref) {
        router.push(`/dashboard/projects/${encodeURIComponent(project.id || ref)}`);
        return;
      }
    }
    router.push(`/dashboard/projects/${project.id}`);
  }, [router]);

  // Deep link from Tenders/Opportunities "Project Live" badges (?id=<project id>).
  useEffect(() => {
    const targetId = searchParams?.get("id");
    if (!targetId) return;
    router.replace(`/dashboard/projects/${targetId}`);
  }, [searchParams, router]);

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

  const portfolioMetrics = useMemo(() => {
    let totalValue = 0;
    let activeCount = 0;
    let riskCount = 0;
    let preMobCount = 0;

    for (const p of projects) {
      const val = number(p.contract_value ?? p.budget ?? p.budget_value) ?? 0;
      totalValue += val;
      const st = text(p.status, "planning").toLowerCase();
      if (activeStatuses.has(st)) activeCount++;
      if (riskStatuses.has(st) || riskStatuses.has(text(p.health, "").toLowerCase())) riskCount++;
      if (st.includes("mobilis") || st.includes("ready") || st.includes("planning")) preMobCount++;
    }

    return { totalValue, activeCount, riskCount, preMobCount, totalProjects: projects.length };
  }, [projects]);

  return (
    <div className="min-h-full bg-ink p-3.5 sm:p-6 pb-[max(2rem,env(safe-area-inset-bottom))] text-paper">
      <DashboardPageHeader
        eyebrow={{ label: "Delivery portfolio", icon: BriefcaseBusiness }}
        title={PROJECT_TAB_LABELS[activeTab]}
        subtitle="Live project register and delivery evidence across the ERP."
        actions={
          <div className="flex w-full sm:w-auto flex-wrap items-center gap-2">
            <div className="flex h-11 sm:h-10 border border-ink-mid bg-ink-light">
              <button
                onClick={() => setViewMode("kanban")}
                className={`px-3.5 sm:px-3 font-mono text-xs uppercase tracking-wider transition-colors min-h-[44px] sm:min-h-0 flex items-center ${viewMode === "kanban" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"}`}
              >
                Pipeline
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`px-3.5 sm:px-3 font-mono text-xs uppercase tracking-wider transition-colors min-h-[44px] sm:min-h-0 flex items-center ${viewMode === "list" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"}`}
              >
                List
              </button>
            </div>
            <button
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex h-11 sm:h-10 min-h-[44px] sm:min-h-0 flex-1 sm:flex-none items-center justify-center gap-2 border border-signal bg-signal/10 px-3.5 sm:px-3 font-mono text-xs uppercase tracking-wider text-signal hover:bg-signal hover:text-ink active:scale-[0.98] transition-all"
            >
              <Plus className="h-4 w-4" />New Project
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex h-11 sm:h-10 min-h-[44px] sm:min-h-0 items-center justify-center gap-2 border border-ink-mid bg-ink-light px-3.5 sm:px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-signal" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      />

      {/* Executive Portfolio Cockpit Strip */}
      <section className="mb-5 grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <div className="border border-ink-mid bg-ink/80 p-3 sm:p-4">
          <div className="flex items-center justify-between font-mono text-[11px] text-slate">
            <span>PORTFOLIO VALUE</span>
            <DollarSign className="h-4 w-4 text-signal shrink-0" />
          </div>
          <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-paper">
            {formatCurrency(portfolioMetrics.totalValue)}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-light">
            Across {portfolioMetrics.totalProjects} active projects
          </p>
        </div>

        <div className="border border-ink-mid bg-ink/80 p-3 sm:p-4">
          <div className="flex items-center justify-between font-mono text-[11px] text-slate">
            <span>ACTIVE SITES</span>
            <Activity className="h-4 w-4 text-emerald-400 shrink-0" />
          </div>
          <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-emerald-400">
            {portfolioMetrics.activeCount}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-light">
            Live site execution
          </p>
        </div>

        <div className="border border-ink-mid bg-ink/80 p-3 sm:p-4">
          <div className="flex items-center justify-between font-mono text-[11px] text-slate">
            <span>AT-RISK / DELAYED</span>
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          </div>
          <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-red-400">
            {portfolioMetrics.riskCount}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-light">
            Critical path & margin watch
          </p>
        </div>

        <div className="border border-ink-mid bg-ink/80 p-3 sm:p-4">
          <div className="flex items-center justify-between font-mono text-[11px] text-slate">
            <span>PLANNING & START</span>
            <HardHat className="h-4 w-4 text-amber-400 shrink-0" />
          </div>
          <p className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-amber-300">
            {portfolioMetrics.preMobCount}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-light">
            Ready to mobilise
          </p>
        </div>
      </section>

      {error ? (
        <section className="mb-4 flex gap-3 border border-red-500/30 bg-red-950/20 p-3.5 sm:p-4 text-sm text-red-200">
          <CircleAlert className="h-5 w-5 shrink-0" />{error}
        </section>
      ) : null}

      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex h-11 sm:h-10 w-full max-w-md items-center gap-2 border border-ink-mid bg-ink-light px-3">
            <Search className="h-4 w-4 shrink-0 text-slate" />
            <input 
              value={query} 
              onChange={(event) => setQuery(event.target.value)} 
              placeholder="Search project, client or location" 
              className="w-full bg-transparent text-base sm:text-sm outline-none placeholder:text-slate" 
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="p-1 text-slate hover:text-paper">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          <select 
            value={status} 
            onChange={(event) => setStatus(event.target.value)} 
            className="h-11 sm:h-10 border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper w-full sm:w-auto"
          >
            <option value="all">All statuses</option>
            {statuses.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
        <div className="font-mono text-xs text-slate-light">
          {filtered.length} {filtered.length === 1 ? "project" : "projects"}
        </div>
      </div>

      {viewMode === "kanban" ? (
        <ProjectPipeline
          projects={filtered}
          loading={loading}
          onSelect={(project) => void openProject(project)}
          onStatusChange={(project, nextStatus) => {
            const previousStatus = project.status;
            setError(null);
            setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, status: nextStatus } : p)));
            void updateInternalProject(project.id, { status: nextStatus }).catch((err) => {
              setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, status: previousStatus } : p)));
              setError(err instanceof Error ? err.message : "Failed to move the project.");
            });
          }}
        />
      ) : (
      <section className="border border-ink-mid bg-ink">
        <div className="flex flex-col gap-1 border-b border-ink-mid p-3.5 sm:p-4">
          <h2 className="font-mono text-sm font-bold uppercase tracking-wider">Project register</h2>
          <p className="text-xs text-slate-light">Select a project to review its schedule Gantt, budget metrics, material consumption, and ERP logs.</p>
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
                className="w-full p-3.5 sm:p-4 text-left hover:bg-ink-light/50 active:bg-ink-light/70 transition-colors flex flex-col sm:grid sm:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] gap-2.5 sm:gap-3 sm:items-center touch-manipulation"
              >
                <div className="flex items-start justify-between gap-2 sm:block">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-paper text-sm sm:text-base truncate">{title(project)}</p>
                    <p className="mt-0.5 text-xs text-slate-light truncate">
                      {text(project.client_name ?? project.client)} {project.location ? `• ${text(project.location)}` : ""}
                    </p>
                  </div>
                  <span className={`sm:hidden shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${statusTone(project.health ?? project.status)}`}>
                    {text(project.health ?? project.status, "unknown")}
                  </span>
                </div>
                <span className={`hidden sm:inline-block w-fit border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${statusTone(project.health ?? project.status)}`}>
                  {text(project.health ?? project.status, "unknown")}
                </span>
                <div className="flex items-center justify-between text-xs text-slate-light sm:block">
                  <div>
                    <span className="sm:block text-slate text-[11px] sm:text-xs">Last updated </span>
                    <span>{formatDate(text(project.updated_at ?? project.created_at, ""))}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 sm:hidden text-slate" />
                </div>
                <ChevronRight className="hidden sm:block h-5 w-5 justify-self-end text-slate" />
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
  const [activeMobileStage, setActiveMobileStage] = useState<string>("all");
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  const scrollToStage = (stage: string) => {
    setActiveMobileStage(stage);
    if (stage !== "all" && columnRefs.current[stage]) {
      columnRefs.current[stage]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center gap-3 border border-ink-mid bg-ink text-sm text-slate-light">
        <Loader2 className="h-5 w-5 animate-spin text-signal" />Loading project register
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Mobile Stage Selector Strip: Allows fast 1-tap jumping or filtering between stages on phones */}
      <div className="flex sm:hidden items-center gap-1.5 overflow-x-auto pb-1.5 no-scrollbar -mx-3.5 px-3.5">
        <button
          type="button"
          onClick={() => setActiveMobileStage("all")}
          className={`shrink-0 px-3 py-1.5 font-mono text-xs uppercase tracking-wider border min-h-[38px] flex items-center transition-all ${
            activeMobileStage === "all"
              ? "border-signal bg-signal text-ink font-bold shadow-sm"
              : "border-ink-mid bg-ink text-slate-light hover:text-paper"
          }`}
        >
          All ({projects.length})
        </button>
        {PIPELINE_STAGES.map((stage) => {
          const count = projects.filter((p) => stageOf(p) === stage).length;
          const isSelected = activeMobileStage === stage;
          return (
            <button
              key={stage}
              type="button"
              onClick={() => scrollToStage(stage)}
              className={`shrink-0 px-3 py-1.5 font-mono text-xs uppercase tracking-wider border min-h-[38px] transition-all flex items-center gap-1.5 ${
                isSelected
                  ? "border-signal bg-signal text-ink font-bold shadow-sm"
                  : "border-ink-mid bg-ink text-slate-light hover:text-paper"
              }`}
            >
              <span>{PIPELINE_STAGE_LABELS[stage] ?? stage}</span>
              <span className={`px-1 rounded text-[10px] ${isSelected ? "bg-ink text-signal font-bold" : "bg-ink-light text-slate"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Kanban Board Container with CSS Scroll Snap for Mobile */}
      <div className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory sm:snap-none -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
        {PIPELINE_STAGES.map((stage) => {
          const stageProjects = projects.filter((p) => stageOf(p) === stage);
          const stageValue = stageProjects.reduce((sum, p) => sum + (number(p.contract_value ?? p.budget ?? p.budget_value) ?? 0), 0);
          const isMobileHidden = activeMobileStage !== "all" && activeMobileStage !== stage;

          return (
            <div
              key={stage}
              ref={(el) => { columnRefs.current[stage] = el; }}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={(e) => { e.preventDefault(); setDraggedOverStage(stage); }}
              onDragLeave={() => setDraggedOverStage(null)}
              onDrop={(e) => handleDrop(e, stage)}
              className={`w-[85vw] max-w-[85vw] sm:w-auto sm:min-w-[275px] sm:max-w-[300px] flex-1 shrink-0 snap-center sm:snap-align-none border p-3 sm:p-3.5 transition-colors ${
                draggedOverStage === stage ? "border-signal bg-ink-light/40" : "border-ink-mid bg-ink"
              } ${isMobileHidden ? "hidden sm:block" : "block"}`}
            >
              <div className="mb-3 flex items-center justify-between border-b border-ink-mid pb-2">
                <div>
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                    {PIPELINE_STAGE_LABELS[stage] ?? stage}
                  </h3>
                  <span className="mt-0.5 block font-mono text-[10px] text-signal font-medium">
                    {formatCurrency(stageValue)}
                  </span>
                </div>
                <span className="rounded-full bg-ink-light px-2 py-0.5 font-mono text-[10px] text-slate font-bold">
                  {stageProjects.length}
                </span>
              </div>

              <div className="space-y-2.5">
                {stageProjects.map((project) => (
                  <div
                    key={project.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", project.id); e.dataTransfer.effectAllowed = "move"; }}
                    onClick={() => onSelect(project)}
                    className="cursor-pointer border border-ink-mid bg-ink-light/30 p-3 text-left transition-all hover:border-signal active:scale-[0.99] touch-manipulation group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-paper group-hover:text-signal transition-colors line-clamp-2">
                        {title(project)}
                      </p>
                      {project.project_code && (
                        <span className="shrink-0 border border-ink-mid/80 bg-ink/70 px-1.5 py-0.5 font-mono text-[9px] text-slate-light">
                          {String(project.project_code)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-light truncate">
                      {text(project.client_name ?? project.client)}
                    </p>

                    <div className="mt-2.5 pt-2 border-t border-ink-mid/50 flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-signal font-semibold">
                        {formatCurrency(number(project.contract_value ?? project.budget ?? project.budget_value) ?? 0)}
                      </span>

                      {/* Touch & Mobile Stage Move Selector */}
                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={stage}
                          onChange={(e) => onStatusChange(project, e.target.value)}
                          className="bg-ink border border-ink-mid hover:border-signal text-slate-light hover:text-paper font-mono text-[10px] uppercase py-1 px-1.5 outline-none cursor-pointer"
                          title="Move project to another stage"
                        >
                          <option value="" disabled>Move to...</option>
                          {PIPELINE_STAGES.map((s) => (
                            <option key={s} value={s} disabled={s === stage}>
                              {PIPELINE_STAGE_LABELS[s] ?? s}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
                {stageProjects.length === 0 && (
                  <div className="flex h-24 items-center justify-center border border-dashed border-ink-mid/60 text-[11px] font-mono uppercase text-slate">
                    No projects
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-lg border border-ink-mid bg-ink max-h-[92dvh] flex flex-col rounded-t-xl sm:rounded-none overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid p-4 sm:p-5">
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">New Project</h3>
          <button onClick={onClose} className="p-1 text-slate hover:text-paper" aria-label="Close modal">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <p className="text-xs text-slate-light">
            Manual entry, for projects that didn&apos;t come through a won tender or opportunity. Those flows already create their project automatically.
          </p>

          <div className="flex gap-2 border border-ink-mid bg-ink-light p-1">
            <button
              type="button"
              onClick={() => setInitiatedBy("client")}
              className={`flex-1 min-h-[38px] py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${initiatedBy === "client" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"}`}
            >
              Client-commissioned
            </button>
            <button
              type="button"
              onClick={() => setInitiatedBy("company")}
              className={`flex-1 min-h-[38px] py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${initiatedBy === "company" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"}`}
            >
              Company-initiated
            </button>
          </div>

          {initiatedBy === "company" && (
            <p className="border border-signal/30 bg-signal/5 p-3 text-xs text-slate-light">
              A project SNC initiates itself to produce something to sell (internal or external) - no client, no contract deadline. It stays dormant with no tasks until you complete its intake and commit it from the project detail view.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <input 
              value={form.name} 
              onChange={(e) => set("name", e.target.value)} 
              placeholder="Project name *" 
              className="h-11 sm:h-10 border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper sm:col-span-2 outline-none focus:border-signal" 
            />
            {initiatedBy === "client" && (
              <>
                <div className="flex h-11 sm:h-10 border border-ink-mid bg-ink-light p-1 sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => {
                      setClientType("organization");
                      setForm((prev) => ({ ...prev, client_org_id: "", client_name: "" }));
                    }}
                    className={`flex-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${clientType === "organization" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"}`}
                  >
                    Organisation
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClientType("individual");
                      setForm((prev) => ({ ...prev, client_org_id: "", client_name: "" }));
                    }}
                    className={`flex-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${clientType === "individual" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"}`}
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
                  className="h-11 sm:h-10 border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper outline-none focus:border-signal"
                >
                  <option value="">{clientType === "organization" ? "Link CRM organisation" : "Link CRM individual"}</option>
                  {clientType === "organization"
                    ? clientOrganizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)
                    : clientContacts.map((contact) => <option key={contact.id} value={contact.id}>{contactLabel(contact)}</option>)}
                </select>
                <input 
                  value={form.contract_value} 
                  onChange={(e) => set("contract_value", e.target.value)} 
                  type="number" 
                  placeholder="Contract value ($)" 
                  className="h-11 sm:h-10 border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper outline-none focus:border-signal" 
                />
                <input 
                  value={form.client_name} 
                  onChange={(e) => set("client_name", e.target.value)} 
                  placeholder="Client display name" 
                  className="h-11 sm:h-10 border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper sm:col-span-2 outline-none focus:border-signal" 
                />
              </>
            )}
            <input 
              value={form.project_code} 
              onChange={(e) => set("project_code", e.target.value)} 
              placeholder="Project code" 
              className="h-11 sm:h-10 border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper outline-none focus:border-signal" 
            />
            <input 
              value={form.project_type} 
              onChange={(e) => set("project_type", e.target.value)} 
              placeholder="Project type" 
              className="h-11 sm:h-10 border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper outline-none focus:border-signal" 
            />
            {initiatedBy === "client" ? (
              <>
                <div>
                  <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Start date</label>
                  <input 
                    value={form.start_date} 
                    onChange={(e) => set("start_date", e.target.value)} 
                    type="date" 
                    className="h-11 sm:h-10 w-full border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper outline-none focus:border-signal font-mono" 
                  />
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Planned completion</label>
                  <input 
                    value={form.planned_completion_date} 
                    onChange={(e) => set("planned_completion_date", e.target.value)} 
                    type="date" 
                    className="h-11 sm:h-10 w-full border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper outline-none focus:border-signal font-mono" 
                  />
                </div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <label className="mb-1 block font-mono text-[9px] uppercase text-slate">How long will it take to set up and begin production?</label>
                <div className="flex gap-2">
                  <input 
                    value={durationValue} 
                    onChange={(e) => setDurationValue(e.target.value)} 
                    type="number" 
                    min="1" 
                    placeholder="e.g. 6" 
                    className="h-11 sm:h-10 w-full border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper outline-none focus:border-signal font-mono" 
                  />
                  <select 
                    value={durationUnit} 
                    onChange={(e) => setDurationUnit(e.target.value as "weeks" | "months")} 
                    className="h-11 sm:h-10 border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper outline-none focus:border-signal"
                  >
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                  </select>
                </div>
              </div>
            )}
            <select 
              value={form.department_id} 
              onChange={(e) => set("department_id", e.target.value)} 
              className="h-11 sm:h-10 border border-ink-mid bg-ink-light px-3 text-base sm:text-sm text-paper sm:col-span-2 outline-none focus:border-signal"
            >
              <option value="">Department (optional)</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {error && <p className="mt-2 text-xs text-red-300 font-mono">{error}</p>}
        </div>

        <div className="border-t border-ink-mid bg-ink p-4 sm:p-5 flex justify-end gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button 
            type="button" 
            onClick={onClose} 
            className="h-11 sm:h-10 min-h-[44px] sm:min-h-0 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper active:bg-ink-light transition-colors"
          >
            Cancel
          </button>
          <button 
            type="button" 
            onClick={submit} 
            disabled={busy} 
            className="h-11 sm:h-10 min-h-[44px] sm:min-h-0 bg-signal px-5 font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
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

