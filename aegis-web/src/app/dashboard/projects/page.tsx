"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useSearchParams } from "next/navigation";
import { 
  AlertTriangle, 
  BriefcaseBusiness, 
  CalendarDays, 
  ChevronRight, 
  CircleAlert, 
  Loader2, 
  MapPin, 
  Package,
  RefreshCw, 
  Search, 
  ShieldCheck, 
  X,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Layers,
  Activity,
  CheckCircle2,
  AlertCircle,
  Hammer,
  Sliders,
  Plus,
  Info as InfoIcon,
  Building2,
  Calendar,
  ClipboardCheck,
  Trash2
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  ApiError, getExecutiveProjectDetail, getFinanceDepartments, getInternalProjects, getProject, updateInternalProject,
  submitProjectRegistration, decideProjectRegistration, setProjectBudget, confirmProjectDeposit, createInternalProject,
  deleteInternalProject, updateProjectIntake, commitProjectIntake, getProjectLifecycle, addProjectMilestone,
  updateProjectMilestone, getAssignableUsers, getAssignment, getProductionExpenses, addProductionExpense,
  getProductionRevenue, addProductionRevenue,
  updateProjectPreMobilisationCheck, approveProjectPreMobilisation,
  getProjectCommercialReadiness, updateProjectCommercialReadiness, clearProjectCommercialReadiness,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PROVINCES } from "@/lib/constants";
import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { AssignmentPanel } from "@/components/documents/AssignmentPanel";

const FINANCE_SIGNOFF_ROLES = new Set(["Finance Manager", "Executive (Admin)", "SUPERADMIN"]);
const COMMERCIAL_READINESS_ROLES = new Set(["Commercial Manager", "Contracts Manager", "Quantity Surveyor", "Executive (Admin)", "SUPERADMIN"]);

type Project = Record<string, unknown> & {
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
  client_name?: string;
  client?: string;
  department_id?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
};

type Department = { id: string; code: string; name: string };

type Detail = Record<string, unknown> & { 
  project?: Project; 
  viability?: Record<string, unknown>[]; 
  tests_and_checks?: Record<string, unknown>[]; 
  site_reports?: Record<string, unknown>[]; 
  material_records?: Record<string, unknown>[];
  quotations?: Record<string, unknown>[]; 
  procurement_orders?: Record<string, unknown>[]; 
  tenders?: Record<string, unknown>[]; 
  subcontractors?: Record<string, unknown>[];
  pre_mobilisation?: PreMobilisationReadiness;
  commercial_readiness?: CommercialReadiness;
};

type PreMobilisationCheck = Record<string, unknown> & {
  id: string;
  check_name?: string;
  status?: string;
  evidence_reference?: string;
  mandatory_evidence?: string;
};

type PreMobilisationReadiness = {
  checks: PreMobilisationCheck[];
  total: number;
  ready_count: number;
  missing: string[];
  evidence_missing: string[];
  ready: boolean;
};

type CommercialReadinessControl = {
  key: string;
  label: string;
  complete: boolean;
};

type CommercialReadiness = {
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

type ProjectTab = "overview" | "schedule" | "financials" | "materials";

const TAB_ROUTES: Record<ProjectTab, string> = {
  overview: "/dashboard/projects/overview",
  schedule: "/dashboard/projects/schedule",
  financials: "/dashboard/projects/financials",
  materials: "/dashboard/projects/materials",
};

function normalizeTab(value: string | null | undefined): ProjectTab {
  return value && value in TAB_ROUTES ? (value as ProjectTab) : "overview";
}

const activeStatuses = new Set(["active", "in progress", "ongoing", "live", "execution"]);
const riskStatuses = new Set(["at risk", "critical", "blocked", "delayed"]);

function text(value: unknown, fallback = "Not recorded") { 
  return typeof value === "string" && value.trim() ? value : fallback; 
}

function number(value: unknown) { 
  const parsed = typeof value === "number" ? value : Number(value); 
  return Number.isFinite(parsed) ? parsed : null; 
}

function title(project: Project) { 
  return text(project.name ?? project.project_name ?? project.project_code ?? project.id); 
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
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Contracts Manager", "Commercial Manager", "Executive Read Only", "External Auditor"]}>
      <ProjectsWorkspace />
    </RBACGuard>
  );
}

function ProjectsWorkspace() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<ProjectTab>(() => normalizeTab(searchParams?.get("tab")));
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Project | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    getFinanceDepartments()
      .then((res) => setDepartments(res.data || []))
      .catch(() => setDepartments([]));
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

  useEffect(() => {
    setActiveTab(normalizeTab(searchParams?.get("tab")));
  }, [searchParams]);

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
    return { active, attention, value };
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
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-ink-mid pb-5">
        <div>
          <p className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-signal">
            <BriefcaseBusiness className="h-4 w-4" />Delivery portfolio
          </p>
          <h1 className="font-display text-3xl font-bold">Projects Command</h1>
          <p className="mt-1 text-sm text-slate-light">Live project register and delivery evidence across the ERP.</p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Registered projects" value={loading ? "..." : String(projects.length)} detail="Live project register" />
        <Metric label="Active delivery" value={loading ? "..." : String(metrics.active)} detail="Status-based count" tone="text-emerald-300" />
        <Metric label="Attention required" value={loading ? "..." : String(metrics.attention)} detail="At-risk, critical, blocked or delayed" tone={metrics.attention ? "text-amber-300" : "text-slate-light"} />
        <Metric label="Recorded portfolio value" value={metrics.value ? formatCurrency(metrics.value) : "Not recorded"} detail="Contract/budget fields where present" />
      </section>

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
          departments={departments}
          onDepartmentChange={(deptId) => {
            setSelected((prev) => (prev ? { ...prev, department_id: deptId } : prev));
            setProjects((prev) => prev.map((p) => (p.id === selected.id ? { ...p, department_id: deptId } : p)));
          }}
          onProjectUpdated={(patch) => {
            setSelected((prev) => (prev ? { ...prev, ...patch } : prev));
            setProjects((prev) => prev.map((p) => (p.id === selected.id ? { ...p, ...patch } : p)));
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
  onClose,
  onCreated,
}: {
  departments: Department[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: "", project_code: "", project_type: "", client_name: "",
    contract_value: "", start_date: "", planned_completion_date: "", department_id: "",
  });
  const [initiatedBy, setInitiatedBy] = useState<"client" | "company">("client");
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
        project_code: form.project_code || undefined,
        project_type: form.project_type || undefined,
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
              <input value={form.client_name} onChange={(e) => set("client_name", e.target.value)} placeholder="Client name" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              <input value={form.contract_value} onChange={(e) => set("contract_value", e.target.value)} type="number" placeholder="Contract value ($)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
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

function Metric({ label, value, detail, tone = "text-paper" }: { label: string; value: string; detail: string; tone?: string }) {
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

function Evidence({ label, items }: { label: string; items?: Record<string, unknown>[] }) { 
  return (
    <div className="border border-ink-mid p-3 bg-ink-light/20">
      <div className="flex justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p>
        <span className="font-mono text-xs text-paper">{items?.length ?? 0}</span>
      </div>
      <p className="mt-2 text-xs text-slate-light">
        {items?.length ? "Records are available in the ERP detail endpoint." : "No records returned."}
      </p>
    </div>
  ); 
}

function Info({ label, value }: { label: string; value: string }) { 
  return (
    <div className="border border-ink-mid p-3 bg-ink-light/20">
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p>
      <p className="mt-1 text-sm text-paper font-medium">{value}</p>
    </div>
  ); 
}

const PROJECT_CATEGORY_LABELS: Record<string, string> = {
  construction: "Construction",
  plant: "Plant",
  commercial: "Commercial",
};

const COST_CATEGORY_OPTIONS = ["labour", "equipment", "materials", "subcontract", "overhead", "other"] as const;

function ProductionIntakePanel({ project, onRefresh }: { project: Record<string, unknown>; onRefresh: () => void }) {
  const projectId = String(project.id ?? "");
  const committed = Boolean(project.intake_completed_at);
  const isActive = text(project.status as string | undefined, "").toLowerCase() === "active";

  const [category, setCategory] = useState(text(project.project_category as string | undefined, ""));
  const [investment, setInvestment] = useState(project.investment_required != null ? String(project.investment_required) : "");
  const [fundingInternal, setFundingInternal] = useState(project.funding_internal != null ? String(project.funding_internal) : "");
  const [fundingExternal, setFundingExternal] = useState(project.funding_external != null ? String(project.funding_external) : "");
  const [durationValue, setDurationValue] = useState(project.setup_duration_weeks != null ? String(project.setup_duration_weeks) : "");
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const investmentNum = number(investment);
  const totalFunding = (number(fundingInternal) ?? 0) + (number(fundingExternal) ?? 0);
  const gap = investmentNum != null ? investmentNum - totalFunding : null;
  const coveragePct = investmentNum ? (totalFunding / investmentNum) * 100 : null;
  const durationWeeks = number(durationValue);

  const targetProductionStart = useMemo(() => {
    const startRaw = project.start_date as string | undefined;
    if (!startRaw || !durationWeeks) return null;
    const start = new Date(startRaw);
    if (Number.isNaN(start.getTime())) return null;
    const target = new Date(start);
    target.setDate(target.getDate() + durationWeeks * 7);
    return target;
  }, [project.start_date, durationWeeks]);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await updateProjectIntake(projectId, {
        project_category: category || undefined,
        investment_required: investment ? Number(investment) : undefined,
        funding_internal: fundingInternal ? Number(fundingInternal) : undefined,
        funding_external: fundingExternal ? Number(fundingExternal) : undefined,
        setup_duration_weeks: durationValue ? Number(durationValue) : undefined,
      });
      setMsg("Saved.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save intake.");
    } finally {
      setSaving(false);
    }
  };

  const commit = async () => {
    if (!category || investmentNum == null) { setMsg("Set the project category and required investment before committing."); return; }
    if (!window.confirm("Commit this intake? Tasks will be generated and the questionnaire will lock.")) return;
    setCommitting(true); setMsg(null);
    try {
      const res = await commitProjectIntake(projectId);
      setMsg(`Committed - ${res.data?.tasks_created ?? 0} tasks generated.`);
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to commit intake.");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="border border-signal/30 bg-signal/5 p-4 rounded-sm space-y-4">
      <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-signal">Production Project Setup</h3>
      <p className="text-xs text-slate-light">
        This is a Company-initiated project - not commissioned by a client. Classify it, size the investment, and say how long setup will take. Nothing gets assigned to anyone until you commit - after that, this is also where you log setup spend and, once active, the revenue it brings in.
      </p>

      <fieldset disabled={committed} className="space-y-4 disabled:opacity-70">
        <div className="grid gap-3 sm:grid-cols-3">
          {(["construction", "plant", "commercial"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              className={`h-10 border font-mono text-xs uppercase tracking-wider ${category === value ? "border-signal bg-signal/20 text-signal" : "border-ink-mid bg-ink-light text-slate-light hover:text-paper"}`}
            >
              {PROJECT_CATEGORY_LABELS[value]}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Investment required ($)</label>
            <input value={investment} onChange={(e) => setInvestment(e.target.value)} type="number" min="0" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Internal funding ($)</label>
            <input value={fundingInternal} onChange={(e) => setFundingInternal(e.target.value)} type="number" min="0" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">External funding ($)</label>
            <input value={fundingExternal} onChange={(e) => setFundingExternal(e.target.value)} type="number" min="0" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Setup duration (weeks) - how long to stand this up and begin production</label>
          <input value={durationValue} onChange={(e) => setDurationValue(e.target.value)} type="number" min="1" className="h-10 w-full max-w-[200px] border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
        </div>
      </fieldset>

      <div className="grid gap-3 border-t border-ink-mid/50 pt-3 sm:grid-cols-4">
        <Info label="Total funding" value={formatCurrency(totalFunding)} />
        <Info label="Funding gap" value={gap != null ? formatCurrency(gap) : "—"} />
        <Info label="Coverage" value={coveragePct != null ? `${coveragePct.toFixed(0)}%` : "—"} />
        <Info label="Target production start" value={targetProductionStart ? formatDate(targetProductionStart.toISOString()) : "—"} />
      </div>

      {!committed && (
        <div className="flex justify-end gap-2 border-t border-ink-mid/50 pt-3">
          <button onClick={() => void save()} disabled={saving} className="h-10 border border-ink-mid bg-ink-light px-4 font-mono text-xs uppercase tracking-wider text-slate-light hover:text-paper disabled:opacity-50">
            {saving ? "Saving..." : "Save Progress"}
          </button>
          <button onClick={() => void commit()} disabled={committing || !category || investmentNum == null} className="h-10 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            {committing ? "Committing..." : "Commit - Generate Tasks"}
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-slate-light">{msg}</p>}

      <div className="border-t border-ink-mid/50 pt-4">
        <ProductionExpensesSection projectId={projectId} />
      </div>

      <div className="border-t border-ink-mid/50 pt-4">
        <ProductionRevenueSection projectId={projectId} isActive={isActive} />
      </div>
    </div>
  );
}

function ProductionExpensesSection({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ cost_category: "materials", description: "", amount: "", transaction_date: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProductionExpenses(projectId);
      setItems(res.data?.items ?? []);
      setTotal(number(res.data?.total) ?? 0);
    } catch {
      // Non-fatal - panel still usable for recording new spend.
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!form.description.trim() || !form.amount) { setError("Description and amount are required."); return; }
    setBusy(true); setError(null);
    try {
      await addProductionExpense(projectId, {
        cost_category: form.cost_category,
        description: form.description.trim(),
        amount: Number(form.amount),
        transaction_date: form.transaction_date || undefined,
      });
      setForm({ cost_category: "materials", description: "", amount: "", transaction_date: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record expense.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Setup Expenses</h4>
        <span className="font-mono text-xs text-amber-300">{formatCurrency(total)} spent</span>
      </div>
      <p className="text-xs text-slate-light">Spend incurred standing this project up - posts straight into Finance.</p>

      {loading ? (
        <p className="text-xs text-slate-light">Loading...</p>
      ) : items.length ? (
        <div className="max-h-40 overflow-y-auto border border-ink-mid/50">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-ink-mid/40">
              {items.map((item, i) => (
                <tr key={String(item.id ?? i)}>
                  <td className="p-2 text-slate-light">{formatDate(text(item.transaction_date as string, ""))}</td>
                  <td className="p-2 text-paper">{text(item.description as string)}</td>
                  <td className="p-2 text-slate-light">{text(item.cost_category as string)}</td>
                  <td className="p-2 text-right text-amber-300">{formatCurrency(number(item.amount) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-slate">No setup expenses recorded yet.</p>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <select value={form.cost_category} onChange={(e) => setForm((f) => ({ ...f, cost_category: e.target.value }))} className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper">
          {COST_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper sm:col-span-2" />
        <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} type="number" min="0" placeholder="Amount ($)" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
      </div>
      <div className="flex items-center gap-2">
        <input value={form.transaction_date} onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value }))} type="date" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
        <button onClick={() => void submit()} disabled={busy} className="h-9 border border-ink-mid bg-ink-light px-3 font-mono text-[10px] uppercase tracking-wider text-slate-light hover:text-paper disabled:opacity-50">
          {busy ? "Recording..." : "Record Expense"}
        </button>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

function ProductionRevenueSection({ projectId, isActive }: { projectId: string; isActive: boolean }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ description: "", amount: "", transaction_date: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isActive) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await getProductionRevenue(projectId);
      setItems(res.data?.items ?? []);
      setTotal(number(res.data?.total) ?? 0);
    } catch {
      // Non-fatal.
    } finally {
      setLoading(false);
    }
  }, [projectId, isActive]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!form.amount) { setError("Amount is required."); return; }
    setBusy(true); setError(null);
    try {
      await addProductionRevenue(projectId, {
        amount: Number(form.amount),
        description: form.description.trim() || undefined,
        transaction_date: form.transaction_date || undefined,
      });
      setForm({ description: "", amount: "", transaction_date: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record revenue.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">Production Revenue</h4>
        {isActive && <span className="font-mono text-xs text-emerald-300">{formatCurrency(total)} earned</span>}
      </div>

      {!isActive ? (
        <p className="border border-ink-mid/50 bg-ink-light/20 p-3 text-xs text-slate-light">
          Revenue recording unlocks once this project is active - move it to &quot;Active&quot; on the project pipeline.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-light">What this project sells, as it sells it - no client or contract behind it, straight into the cashbook.</p>
          {loading ? (
            <p className="text-xs text-slate-light">Loading...</p>
          ) : items.length ? (
            <div className="max-h-40 overflow-y-auto border border-ink-mid/50">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-ink-mid/40">
                  {items.map((item, i) => (
                    <tr key={String(item.id ?? i)}>
                      <td className="p-2 text-slate-light">{formatDate(text(item.transaction_date as string, ""))}</td>
                      <td className="p-2 text-paper">{text(item.description as string)}</td>
                      <td className="p-2 text-right text-emerald-300">{formatCurrency(number(item.amount) ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-slate">No revenue recorded yet.</p>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
            <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} type="number" min="0" placeholder="Amount ($)" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
            <input value={form.transaction_date} onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value }))} type="date" className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper" />
          </div>
          <button onClick={() => void submit()} disabled={busy} className="h-9 border border-emerald-500/40 bg-emerald-500/10 px-3 font-mono text-[10px] uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
            {busy ? "Recording..." : "Record Revenue"}
          </button>
          {error && <p className="text-xs text-red-300">{error}</p>}
        </>
      )}
    </div>
  );
}

function FieldIntakePanel({ project, isFinance, onRefresh }: { project: Record<string, unknown>; isFinance: boolean; onRefresh: () => void }) {
  const isFieldIntake = project.status === "field_intake";
  const isPendingDeposit = project.status === "pending_deposit";
  const [form, setForm] = useState({ client_name: "", contract_value: "", start_date: "", project_code: "", initial_percent_complete: "", initial_costs_incurred: "" });
  const [budgetAmount, setBudgetAmount] = useState("");
  const [depositReference, setDepositReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const projectId = String(project.id ?? "");

  const confirmDeposit = async () => {
    setBusy(true); setMsg(null);
    try {
      await confirmProjectDeposit(projectId, { deposit_reference: depositReference || undefined });
      setMsg("Deposit confirmed. Pre-mobilisation gate opened.");
      setDepositReference("");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to confirm deposit.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      await submitProjectRegistration(projectId, {
        client_name: form.client_name || undefined,
        contract_value: form.contract_value ? Number(form.contract_value) : undefined,
        start_date: form.start_date || undefined,
        project_code: form.project_code || undefined,
        initial_percent_complete: form.initial_percent_complete ? Number(form.initial_percent_complete) : undefined,
        initial_costs_incurred: form.initial_costs_incurred ? Number(form.initial_costs_incurred) : undefined,
      });
      setSubmitted(true);
      setMsg("Submitted for Finance sign-off.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to submit for registration.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true); setMsg(null);
    try {
      await decideProjectRegistration(projectId, decision, decision === "rejected" ? "Not approved" : undefined);
      setMsg(decision === "approved" ? "Project registered." : "Registration rejected.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to record decision.");
    } finally {
      setBusy(false);
    }
  };

  const submitBudget = async () => {
    if (!budgetAmount) return;
    setBusy(true); setMsg(null);
    try {
      await setProjectBudget(projectId, Number(budgetAmount));
      setMsg("Budget set.");
      setBudgetAmount("");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to set budget.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-signal/30 bg-signal/5 p-4 rounded-sm space-y-4">
      <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-signal">
        {isPendingDeposit ? "Deposit Confirmation" : "Field Intake Registration"}
      </h3>

      {isFieldIntake && !submitted && (
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={form.client_name} onChange={(e) => set("client_name", e.target.value)} placeholder="Client name" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={form.contract_value} onChange={(e) => set("contract_value", e.target.value)} type="number" placeholder="Contract value ($)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={form.start_date} onChange={(e) => set("start_date", e.target.value)} type="date" placeholder="Real start date" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={form.project_code} onChange={(e) => set("project_code", e.target.value)} placeholder="Project code (optional)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <div className="sm:col-span-2 border-t border-ink-mid/50 pt-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate">Already underway? Capture where it stands (optional)</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={form.initial_percent_complete} onChange={(e) => set("initial_percent_complete", e.target.value)} type="number" min="0" max="100" placeholder="Percent complete so far (%)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              <input value={form.initial_costs_incurred} onChange={(e) => set("initial_costs_incurred", e.target.value)} type="number" min="0" placeholder="Costs already incurred ($)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
          </div>
          <button onClick={submit} disabled={busy} className="sm:col-span-2 h-10 bg-signal font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            Submit for Finance Sign-off
          </button>
        </div>
      )}

      {isFieldIntake && submitted && (
        <p className="text-xs text-slate-light">Awaiting Finance sign-off.</p>
      )}

      {isFieldIntake && isFinance && (
        <div className="flex gap-3 border-t border-ink-mid/50 pt-3">
          <button onClick={() => decide("approved")} disabled={busy} className="h-9 border border-emerald-500/40 bg-emerald-950/20 px-3 font-mono text-xs uppercase text-emerald-300 disabled:opacity-50">
            Approve & Register
          </button>
          <button onClick={() => decide("rejected")} disabled={busy} className="h-9 border border-red-500/40 bg-red-950/20 px-3 font-mono text-xs uppercase text-red-300 disabled:opacity-50">
            Reject
          </button>
        </div>
      )}

      {isPendingDeposit && (
        <div className="border-t border-ink-mid/50 pt-3">
          <p className="mb-2 text-xs text-slate-light">
            This project was created from a won deal and is pending deposit confirmation. Once Finance confirms receipt, it moves into the pre-mobilisation readiness gate before active delivery.
          </p>
          {isFinance ? (
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Deposit Reference (EFT/receipt number)</label>
                <input value={depositReference} onChange={(e) => setDepositReference(e.target.value)} placeholder="Optional reference" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
              <button onClick={confirmDeposit} disabled={busy} className="h-10 bg-emerald-500 px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
                Confirm Deposit Received
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-300">Awaiting Finance deposit confirmation.</p>
          )}
        </div>
      )}

      {!isFieldIntake && !isPendingDeposit && isFinance && (
        <div className="flex items-end gap-3 border-t border-ink-mid/50 pt-3">
          <div className="flex-1">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Set Execution Budget ($)</label>
            <input value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} type="number" placeholder="Total budget ceiling" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <button onClick={submitBudget} disabled={busy || !budgetAmount} className="h-10 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            Set Budget
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-slate-light">{msg}</p>}
    </div>
  );
}

function CommercialReadinessPanel({
  project,
  readiness,
  canManage,
  onRefresh,
}: {
  project: Project;
  readiness?: CommercialReadiness;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const projectId = String(project.id ?? "");
  const [current, setCurrent] = useState<CommercialReadiness | undefined>(readiness);
  const [controls, setControls] = useState<Record<string, boolean>>({});
  const [authorityStatus, setAuthorityStatus] = useState("");
  const [statement, setStatement] = useState({
    authority_relied_upon: "",
    approved_contract_value: "",
    approved_commercial_baseline: "",
    expected_margin: "",
    mobilisation_budget: "",
    peak_working_capital_requirement: "",
    payment_and_retention_conditions: "",
    major_commercial_risks: "",
    outstanding_conditions: "",
    temporary_controls: "",
    named_risk_owners: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setCurrent(readiness);
  }, [readiness]);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const control of current?.controls ?? []) {
      next[control.key] = Boolean(control.complete);
    }
    setControls(next);
    setAuthorityStatus(String(current?.authority_status ?? current?.pack?.authority_status ?? ""));
  }, [current]);

  const refreshCommercial = async () => {
    if (!projectId) return;
    try {
      const res = await getProjectCommercialReadiness(projectId);
      setCurrent(res.data as CommercialReadiness);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Commercial readiness is unavailable.");
    }
  };

  const save = async () => {
    setBusy("save"); setMsg(null);
    try {
      const res = await updateProjectCommercialReadiness(projectId, {
        readiness_pack: controls,
        authority_status: authorityStatus || undefined,
      });
      setCurrent(res.data as CommercialReadiness);
      setMsg("Commercial readiness saved.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save Commercial readiness.");
    } finally {
      setBusy(null);
    }
  };

  const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
  const numberOrUndefined = (value: string) => value ? Number(value) : undefined;

  const clear = async () => {
    if (!statement.authority_relied_upon.trim()) {
      setMsg("Authority relied upon is required.");
      return;
    }
    setBusy("clear"); setMsg(null);
    try {
      const res = await clearProjectCommercialReadiness(projectId, {
        authority_relied_upon: statement.authority_relied_upon,
        approved_contract_value: numberOrUndefined(statement.approved_contract_value),
        approved_commercial_baseline: statement.approved_commercial_baseline || undefined,
        expected_margin: numberOrUndefined(statement.expected_margin),
        mobilisation_budget: numberOrUndefined(statement.mobilisation_budget),
        peak_working_capital_requirement: numberOrUndefined(statement.peak_working_capital_requirement),
        payment_and_retention_conditions: statement.payment_and_retention_conditions || undefined,
        major_commercial_risks: lines(statement.major_commercial_risks),
        outstanding_conditions: lines(statement.outstanding_conditions),
        temporary_controls: lines(statement.temporary_controls),
        named_risk_owners: lines(statement.named_risk_owners),
      });
      setCurrent(res.data as CommercialReadiness);
      setMsg("Commercial readiness cleared.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to clear Commercial readiness.");
    } finally {
      setBusy(null);
    }
  };

  const controlsList = current?.controls ?? [];
  const blockers = current?.blockers ?? [];
  const clearedAt = text(current?.cleared_at, "");

  return (
    <section className="border border-cyan-500/30 bg-cyan-950/10 p-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-cyan-300">
            <BriefcaseBusiness className="h-4 w-4" />Commercial Readiness Pack
          </h3>
          <p className="mt-1 text-xs text-slate-light">
            Contract, baseline, cash-flow, valuation, variation and claims controls must be cleared before mobilisation.
          </p>
        </div>
        <button onClick={() => void refreshCommercial()} disabled={busy === "load"} className="h-8 border border-cyan-500/40 px-2 font-mono text-[10px] uppercase tracking-wider text-cyan-300 disabled:opacity-50">
          Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <span className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${current?.status === "cleared" ? "border-emerald-500/40 text-emerald-300" : blockers.length ? "border-red-500/40 text-red-300" : "border-cyan-500/40 text-cyan-300"}`}>
          {current?.status ?? "not_started"}
        </span>
        <span className="border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-light">
          {current?.ready_count ?? 0}/{current?.total ?? controlsList.length} controls ready
        </span>
        {clearedAt ? <span className="border border-emerald-500/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-emerald-300">Cleared {formatDate(clearedAt)}</span> : null}
      </div>

      {blockers.length ? (
        <div className="mb-4 border border-red-500/30 bg-red-950/20 p-3">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-red-200"><AlertCircle className="h-4 w-4" />Mobilisation blockers</p>
          <ul className="space-y-1 text-xs text-red-100">
            {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {controlsList.map((control) => (
          <label key={control.key} className="flex items-start gap-3 border border-ink-mid bg-ink/60 p-3 text-sm text-paper">
            <input
              type="checkbox"
              checked={Boolean(controls[control.key])}
              disabled={!canManage || current?.status === "cleared"}
              onChange={(e) => setControls((prev) => ({ ...prev, [control.key]: e.target.checked }))}
              className="mt-1 h-4 w-4 accent-cyan-400"
            />
            <span>
              <span className="block font-medium">{control.label}</span>
              <span className="mt-1 block text-xs text-slate-light">{controls[control.key] ? "Complete" : "Open"}</span>
            </span>
          </label>
        ))}
      </div>

      {canManage && current?.status !== "cleared" ? (
        <div className="mt-4 grid gap-3 border-t border-ink-mid/60 pt-4 md:grid-cols-2">
          <select value={authorityStatus} onChange={(e) => setAuthorityStatus(e.target.value)} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper">
            <option value="">Authority status</option>
            <option value="fully_executed">Fully executed contract</option>
            <option value="awarded_subject_to_conditions">Awarded subject to conditions</option>
            <option value="letter_of_intent_only">Letter of intent only</option>
            <option value="purchase_order_only">Purchase order only</option>
            <option value="verbal_instruction">Verbal instruction</option>
            <option value="commercially_unacceptable">Commercially unacceptable</option>
          </select>
          <button onClick={() => void save()} disabled={busy === "save"} className="h-10 border border-cyan-500/40 px-3 font-mono text-xs font-bold uppercase text-cyan-300 disabled:opacity-50">
            {busy === "save" ? "Saving..." : "Save Commercial Pack"}
          </button>
          <input value={statement.authority_relied_upon} onChange={(e) => setStatement((prev) => ({ ...prev, authority_relied_upon: e.target.value }))} placeholder="Authority relied upon" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper md:col-span-2" />
          <input value={statement.approved_contract_value} onChange={(e) => setStatement((prev) => ({ ...prev, approved_contract_value: e.target.value }))} type="number" min="0" placeholder="Approved contract value" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={statement.approved_commercial_baseline} onChange={(e) => setStatement((prev) => ({ ...prev, approved_commercial_baseline: e.target.value }))} placeholder="Approved baseline reference" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={statement.expected_margin} onChange={(e) => setStatement((prev) => ({ ...prev, expected_margin: e.target.value }))} type="number" placeholder="Expected margin %" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={statement.mobilisation_budget} onChange={(e) => setStatement((prev) => ({ ...prev, mobilisation_budget: e.target.value }))} type="number" min="0" placeholder="Mobilisation budget" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input value={statement.peak_working_capital_requirement} onChange={(e) => setStatement((prev) => ({ ...prev, peak_working_capital_requirement: e.target.value }))} type="number" placeholder="Peak working capital requirement" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper md:col-span-2" />
          <textarea value={statement.payment_and_retention_conditions} onChange={(e) => setStatement((prev) => ({ ...prev, payment_and_retention_conditions: e.target.value }))} placeholder="Payment and retention conditions" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper md:col-span-2" />
          <textarea value={statement.major_commercial_risks} onChange={(e) => setStatement((prev) => ({ ...prev, major_commercial_risks: e.target.value }))} placeholder="Major commercial risks, one per line" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
          <textarea value={statement.outstanding_conditions} onChange={(e) => setStatement((prev) => ({ ...prev, outstanding_conditions: e.target.value }))} placeholder="Outstanding conditions, one per line" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
          <textarea value={statement.temporary_controls} onChange={(e) => setStatement((prev) => ({ ...prev, temporary_controls: e.target.value }))} placeholder="Temporary controls, one per line" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
          <textarea value={statement.named_risk_owners} onChange={(e) => setStatement((prev) => ({ ...prev, named_risk_owners: e.target.value }))} placeholder="Named risk owners, one per line" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
          <button onClick={() => void clear()} disabled={busy === "clear" || !current?.ready} className="h-10 bg-emerald-500 px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50 md:col-span-2">
            {busy === "clear" ? "Clearing..." : "Clear Commercial Readiness"}
          </button>
        </div>
      ) : null}

      {!canManage && current?.status !== "cleared" ? (
        <p className="mt-3 text-xs text-slate-light">Commercial clearance is waiting on Commercial, Contracts or Quantity Surveying.</p>
      ) : null}
      {msg ? <p className="mt-3 text-xs text-slate-light">{msg}</p> : null}
    </section>
  );
}

function PreMobilisationPanel({
  project,
  readiness,
  isApprover,
  onRefresh,
}: {
  project: Project;
  readiness?: PreMobilisationReadiness;
  isApprover: boolean;
  onRefresh: () => void;
}) {
  const checks = useMemo(() => readiness?.checks ?? [], [readiness?.checks]);
  const [formById, setFormById] = useState<Record<string, { status: string; evidence_reference: string }>>({});
  const [approval, setApproval] = useState({ mobilisation_date: "", mobilisation_budget: "", conditions: "", residual_risk_notes: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const approvedAt = text(project.mobilisation_approved_at as string | undefined, "");
  const projectId = String(project.id ?? "");

  useEffect(() => {
    const next: Record<string, { status: string; evidence_reference: string }> = {};
    for (const check of checks) {
      next[String(check.id)] = {
        status: text(check.status, "incomplete"),
        evidence_reference: text(check.evidence_reference, ""),
      };
    }
    setFormById(next);
  }, [checks]);

  const updateCheck = async (checkId: string) => {
    const form = formById[checkId];
    if (!form) return;
    setBusy(checkId); setMsg(null);
    try {
      await updateProjectPreMobilisationCheck(projectId, checkId, {
        status: form.status,
        evidence_reference: form.evidence_reference || undefined,
      });
      setMsg("Readiness check updated.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to update readiness check.");
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!approval.mobilisation_date) {
      setMsg("Approved mobilisation date is required.");
      return;
    }
    setBusy("approve"); setMsg(null);
    try {
      await approveProjectPreMobilisation(projectId, {
        mobilisation_date: approval.mobilisation_date,
        mobilisation_budget: approval.mobilisation_budget ? Number(approval.mobilisation_budget) : undefined,
        conditions: approval.conditions || undefined,
        residual_risk_notes: approval.residual_risk_notes || undefined,
      });
      setMsg("Mobilisation authorised. Project is now active.");
      onRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to authorise mobilisation.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border border-amber-500/30 bg-amber-950/10 p-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-amber-300">
            <ClipboardCheck className="h-4 w-4" />Pre-Mobilisation Readiness Gate
          </h3>
          <p className="mt-1 text-xs text-slate-light">
            Mobilisation is blocked until all required gates have evidence and the final authorisation is issued.
          </p>
        </div>
        <span className={`w-fit border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${readiness?.ready ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}`}>
          {readiness?.ready ? "Ready for approval" : `${readiness?.ready_count ?? 0}/${readiness?.total ?? 0} ready`}
        </span>
      </div>

      {approvedAt ? (
        <div className="mb-4 border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs text-emerald-200">
          Authorised {formatDate(approvedAt)} under {text(project.mobilisation_authorisation_number as string | undefined, "mobilisation order")}.
        </div>
      ) : null}

      <div className="space-y-3">
        {checks.length === 0 ? (
          <p className="text-xs text-slate-light">No readiness checks have been opened yet. Confirm the project deposit or refresh the lifecycle record.</p>
        ) : checks.map((check) => {
          const checkId = String(check.id);
          const form = formById[checkId] ?? { status: text(check.status, "incomplete"), evidence_reference: text(check.evidence_reference, "") };
          return (
            <div key={checkId} className="grid gap-3 border border-ink-mid bg-ink/60 p-3 lg:grid-cols-[minmax(0,1.4fr)_180px_minmax(0,1.4fr)_auto] lg:items-center">
              <div>
                <p className="text-sm font-medium text-paper">{text(check.check_name, "Readiness check")}</p>
                <p className="mt-1 text-xs text-slate-light">{text(check.mandatory_evidence, "Evidence required")}</p>
              </div>
              <select
                value={form.status}
                onChange={(e) => setFormById((prev) => ({ ...prev, [checkId]: { ...form, status: e.target.value } }))}
                className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper"
              >
                <option value="incomplete">Incomplete</option>
                <option value="complete">Complete</option>
                <option value="complete_with_conditions">Complete with conditions</option>
                <option value="not_applicable">Not applicable</option>
              </select>
              <input
                value={form.evidence_reference}
                onChange={(e) => setFormById((prev) => ({ ...prev, [checkId]: { ...form, evidence_reference: e.target.value } }))}
                placeholder="Document, register or approval reference"
                className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-paper"
              />
              <button onClick={() => void updateCheck(checkId)} disabled={busy === checkId} className="h-9 border border-signal/40 px-3 font-mono text-[10px] uppercase tracking-wider text-signal disabled:opacity-50">
                {busy === checkId ? "Saving" : "Save"}
              </button>
            </div>
          );
        })}
      </div>

      {isApprover && !approvedAt ? (
        <div className="mt-4 grid gap-3 border-t border-ink-mid/60 pt-4 md:grid-cols-2">
          <input type="date" value={approval.mobilisation_date} onChange={(e) => setApproval((prev) => ({ ...prev, mobilisation_date: e.target.value }))} className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input type="number" min="0" value={approval.mobilisation_budget} onChange={(e) => setApproval((prev) => ({ ...prev, mobilisation_budget: e.target.value }))} placeholder="Mobilisation budget (optional)" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <textarea value={approval.conditions} onChange={(e) => setApproval((prev) => ({ ...prev, conditions: e.target.value }))} placeholder="Conditions to close after mobilisation" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper md:col-span-2" />
          <textarea value={approval.residual_risk_notes} onChange={(e) => setApproval((prev) => ({ ...prev, residual_risk_notes: e.target.value }))} placeholder="Residual risk accepted by executive" className="min-h-20 border border-ink-mid bg-ink-light p-3 text-sm text-paper md:col-span-2" />
          <button onClick={() => void approve()} disabled={busy === "approve" || !readiness?.ready} className="h-10 bg-emerald-500 px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50 md:col-span-2">
            {busy === "approve" ? "Authorising..." : "Authorise Mobilisation"}
          </button>
        </div>
      ) : null}

      {msg ? <p className="mt-3 text-xs text-slate-light">{msg}</p> : null}
    </section>
  );
}

interface GanttMilestone {
  id: string;
  name: string;
  status: 'not_started' | 'in_progress' | 'complete' | 'blocked' | 'cancelled';
  weight: number | null;
  ownerName: string | null;
  baselineWeek: number | null; // weeks since project start_date, 1-indexed
  forecastWeek: number | null;
  actualWeek: number | null;
}

const NEXT_MILESTONE_STATUS: Record<GanttMilestone["status"], GanttMilestone["status"]> = {
  not_started: "in_progress",
  in_progress: "complete",
  complete: "not_started",
  blocked: "in_progress",
  cancelled: "not_started",
};

/** A point marker for a single milestone date on the 16-week Gantt axis - a
 * milestone is a date, not a duration, so it's plotted as a dot, not a bar.
 * `row` stacks multiple dots vertically within a row (comparison mode). */
function MilestoneMarker({ week, colorClass, label, row }: { week: number | null; colorClass: string; label: string; row?: number }) {
  if (!week) return null;
  const clamped = Math.min(Math.max(week, 1), 16);
  const leftPct = ((clamped - 0.5) / 16) * 100;
  const topStyle = row == null ? { top: "50%" } : { top: `${8 + row * 12}px` };
  return (
    <div
      className={`absolute z-10 h-2.5 w-2.5 cursor-help rounded-full border-2 group ${colorClass}`}
      style={{ left: `${leftPct}%`, ...topStyle, transform: "translate(-50%, -50%)" }}
      title={label}
    >
      <span className="pointer-events-none absolute -top-6 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-sm bg-ink/90 px-1.5 py-0.5 font-mono text-[8px] text-paper opacity-0 transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}

function AddMilestoneForm({ projectId, onClose, onAdded }: { projectId: string; onClose: () => void; onAdded: () => void }) {
  const [users, setUsers] = useState<{ id: string; full_name: string; email: string }[]>([]);
  const [form, setForm] = useState({ name: "", status: "not_started", baseline_date: "", forecast_date: "", weight: "", owner_id: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAssignableUsers().then((res) => setUsers(res.data ?? [])).catch(() => setUsers([]));
  }, []);

  const submit = async () => {
    if (!form.name.trim()) { setError("Milestone name is required."); return; }
    setBusy(true); setError(null);
    try {
      await addProjectMilestone(projectId, {
        name: form.name.trim(),
        status: form.status,
        baseline_date: form.baseline_date || undefined,
        forecast_date: form.forecast_date || undefined,
        weight: form.weight ? Number(form.weight) : undefined,
        owner_id: form.owner_id || undefined,
      });
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add milestone.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-signal/30 bg-signal/5 p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Milestone name *" className="h-9 border border-ink-mid bg-ink-light px-3 text-xs text-paper sm:col-span-2" />
        <div>
          <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Baseline date</label>
          <input value={form.baseline_date} onChange={(e) => setForm((f) => ({ ...f, baseline_date: e.target.value }))} type="date" className="h-9 w-full border border-ink-mid bg-ink-light px-3 text-xs text-paper" />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Forecast date</label>
          <input value={form.forecast_date} onChange={(e) => setForm((f) => ({ ...f, forecast_date: e.target.value }))} type="date" className="h-9 w-full border border-ink-mid bg-ink-light px-3 text-xs text-paper" />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Weight (% of programme)</label>
          <input value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} type="number" min="0" max="100" className="h-9 w-full border border-ink-mid bg-ink-light px-3 text-xs text-paper" />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[9px] uppercase text-slate">Owner</label>
          <select value={form.owner_id} onChange={(e) => setForm((f) => ({ ...f, owner_id: e.target.value }))} className="h-9 w-full border border-ink-mid bg-ink-light px-3 text-xs text-paper">
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="h-9 border border-ink-mid px-3 font-mono text-[10px] uppercase text-slate-light hover:text-paper">Cancel</button>
        <button onClick={() => void submit()} disabled={busy} className="h-9 bg-signal px-3 font-mono text-[10px] font-bold uppercase text-ink disabled:opacity-50">
          {busy ? "Adding..." : "Add Milestone"}
        </button>
      </div>
    </div>
  );
}

function ProjectDetail({
  project,
  detail,
  loading,
  error,
  onClose,
  departments,
  onDepartmentChange,
  onProjectUpdated,
  onRefresh,
  onDeleted,
}: {
  project: Project;
  detail: Detail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  departments: Department[];
  onDepartmentChange: (departmentId: string) => void;
  onProjectUpdated: (patch: Partial<Project>) => void;
  onRefresh: () => void;
  onDeleted: () => void;
}) {
  const { role } = useAuth();
  const source = detail?.project ?? project;

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    if (!window.confirm(`Delete "${title(project)}"? If it has no linked activity anywhere it will be permanently wiped; otherwise it will be archived instead.`)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteInternalProject(project.id);
      if (!res.success) throw new Error("Project could not be deleted.");
      if (res.data?.wiped) {
        window.alert(`"${title(project)}" was permanently deleted.`);
      } else {
        const blockers = (res.data?.blocked_by ?? []).map((b) => `${b.table} (${b.count})`).join(", ");
        window.alert(`"${title(project)}" has linked records - archived instead of deleted.${blockers ? `\n\nLinked: ${blockers}` : ""}`);
      }
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Project could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }, [project, onDeleted]);

  const [departmentSaving, setDepartmentSaving] = useState(false);
  const [departmentError, setDepartmentError] = useState<string | null>(null);

  const handleDepartmentSelect = useCallback(async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const deptId = event.target.value;
    setDepartmentSaving(true);
    setDepartmentError(null);
    try {
      await updateInternalProject(project.id, { department_id: deptId || null });
      onDepartmentChange(deptId);
    } catch (err) {
      setDepartmentError("Failed to update department.");
    } finally {
      setDepartmentSaving(false);
    }
  }, [project.id, onDepartmentChange]);
  const viability = detail?.viability?.[0];

  // Region/coordinates live on projects.project_profiles, not projects.projects, so they
  // arrive either on `viability` (executive detail endpoint) or directly on `source`
  // (plain project-record fallback) depending on which lookup succeeded in openProject().
  const currentRegion = text((viability?.region ?? (source as Project).region) as string | undefined, "");
  const currentLat = (viability?.latitude ?? (source as Project).latitude) as number | string | undefined;
  const currentLong = (viability?.longitude ?? (source as Project).longitude) as number | string | undefined;

  const [regionSaving, setRegionSaving] = useState(false);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [regionOverride, setRegionOverride] = useState<string | null>(null);

  const handleRegionSelect = useCallback(async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const region = event.target.value;
    setRegionSaving(true);
    setRegionError(null);
    try {
      const response = await updateInternalProject(project.id, { region: region || null });
      const saved = response.data && typeof response.data === "object" ? response.data as Partial<Project> : {};
      setRegionOverride(region);
      onProjectUpdated({ region: (saved.region as string | undefined) ?? region });
    } catch (err) {
      setRegionError("Failed to update region.");
    } finally {
      setRegionSaving(false);
    }
  }, [project.id, onProjectUpdated]);

  const [coords, setCoords] = useState({ latitude: "", longitude: "" });
  const [coordsSaving, setCoordsSaving] = useState(false);
  const [coordsError, setCoordsError] = useState<string | null>(null);
  const [coordsDirty, setCoordsDirty] = useState(false);

  useEffect(() => {
    if (coordsDirty) return;
    setCoords({
      latitude: currentLat !== undefined && currentLat !== null ? String(currentLat) : "",
      longitude: currentLong !== undefined && currentLong !== null ? String(currentLong) : "",
    });
  }, [currentLat, currentLong, coordsDirty]);

  const saveCoords = useCallback(async () => {
    const lat = coords.latitude.trim();
    const long = coords.longitude.trim();
    const latNum = lat ? Number(lat) : null;
    const longNum = long ? Number(long) : null;
    if ((lat && !Number.isFinite(latNum)) || (long && !Number.isFinite(longNum))) {
      setCoordsError("Latitude/longitude must be numbers.");
      return;
    }
    setCoordsSaving(true);
    setCoordsError(null);
    try {
      const response = await updateInternalProject(project.id, { latitude: latNum, longitude: longNum });
      const saved = response.data && typeof response.data === "object" ? response.data as Partial<Project> : {};
      onProjectUpdated({
        latitude: saved.latitude ?? latNum ?? undefined,
        longitude: saved.longitude ?? longNum ?? undefined,
      });
      setCoordsDirty(false);
    } catch (err) {
      setCoordsError("Failed to update coordinates.");
    } finally {
      setCoordsSaving(false);
    }
  }, [coords, project.id, onProjectUpdated]);

  const [activeTab, setActiveTab] = useState<"overview" | "schedule" | "financials" | "materials" | "documents" | "assign">("overview");

  // Source-backed financial parameters. Missing finance fields must not be replaced with generated values.
  const contractVal = useMemo(() => {
    const apiVal = number(source.contract_value ?? source.budget ?? source.budget_value);
    if (apiVal && apiVal > 0) return apiVal;
    return 0;
  }, [source]);

  const budgetedCost = useMemo(() => {
    return number(viability?.budget_amount ?? source.budget_amount ?? source.budgeted_cost ?? source.budget_cost) ?? 0;
  }, [source, viability]);

  const initialOverrunPercent = 0;

  // Financial Sliders State
  const [overrunSlider, setOverrunSlider] = useState(0);
  const [overheadSlider, setOverheadSlider] = useState(0);

  useEffect(() => {
    setOverrunSlider(initialOverrunPercent);
    setOverheadSlider(number(source.overhead_pct ?? viability?.overhead_pct) ?? 0);
  }, [source, viability, initialOverrunPercent]);

  const forecastCost = useMemo(() => {
    return number(viability?.forecast_cost ?? source.forecast_cost ?? source.forecast_final_cost ?? source.estimate_at_completion) ?? 0;
  }, [source, viability]);

  const actualCost = useMemo(() => {
    return number(source.actual_cost ?? source.actual_cost_to_date ?? source.cost_to_date) ?? 0;
  }, [source]);

  const committedCost = useMemo(() => {
    return number(source.committed_cost ?? source.commitments ?? source.purchase_commitments) ?? 0;
  }, [source]);

  const hasFinanceEvidence = contractVal > 0 || budgetedCost > 0 || forecastCost > 0 || actualCost > 0 || committedCost > 0;

  // Margin calculation formulas
  const budgetedGrossProfit = contractVal - budgetedCost;
  const budgetedGrossMarginPct = contractVal > 0 ? (budgetedGrossProfit / contractVal) * 100 : 0;

  const forecastGrossProfit = contractVal - forecastCost;
  const forecastGrossMarginPct = contractVal > 0 ? (forecastGrossProfit / contractVal) * 100 : 0;

  const marginSlippage = forecastGrossMarginPct - budgetedGrossMarginPct;

  const forecastNetProfit = forecastGrossProfit - (contractVal * (overheadSlider / 100));
  const forecastNetMarginPct = contractVal > 0 ? (forecastNetProfit / contractVal) * 100 : 0;

  const markupPct = budgetedCost > 0 ? ((contractVal - budgetedCost) / budgetedCost) * 100 : 0;
  const costOverrunPct = budgetedCost > 0 ? ((forecastCost - budgetedCost) / budgetedCost) * 100 : 0;

  // ----------------------------------------------------
  // GANTT SCHEDULE & FILTER STATE
  // ----------------------------------------------------
  const [scheduleTimelineFilter, setScheduleTimelineFilter] = useState<"comparison" | "baseline" | "forecast" | "actual">("comparison");
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState<"all" | "complete" | "in_progress" | "blocked" | "not_started">("all");

  // Real milestones, fetched from the lifecycle endpoint - no fabricated
  // schedule data or placeholder owners. Empty until someone actually logs one.
  const [rawMilestones, setRawMilestones] = useState<Record<string, unknown>[]>([]);
  const [milestonesLoading, setMilestonesLoading] = useState(true);

  const loadMilestones = useCallback(async () => {
    if (!project.id) return;
    setMilestonesLoading(true);
    try {
      const res = await getProjectLifecycle(project.id);
      setRawMilestones(res.data?.milestones ?? []);
    } catch {
      setRawMilestones([]);
    } finally {
      setMilestonesLoading(false);
    }
  }, [project.id]);

  useEffect(() => { void loadMilestones(); }, [loadMilestones]);

  const startDateMs = useMemo(() => {
    const raw = (source as Record<string, unknown>).start_date as string | undefined;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }, [source]);

  const dateToWeek = useCallback((value: unknown): number | null => {
    if (!value || !startDateMs) return null;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return null;
    return Math.max(1, Math.floor((d.getTime() - startDateMs) / (7 * 24 * 3600 * 1000)) + 1);
  }, [startDateMs]);

  const milestones: GanttMilestone[] = useMemo(() => {
    return rawMilestones.map((m) => ({
      id: String(m.id),
      name: text(m.name as string | undefined, "Untitled milestone"),
      status: (["not_started", "in_progress", "complete", "blocked", "cancelled"].includes(String(m.status))
        ? m.status
        : "not_started") as GanttMilestone["status"],
      weight: number(m.weight),
      ownerName: text(m.owner_name as string | undefined, "") || null,
      baselineWeek: dateToWeek(m.baseline_date),
      forecastWeek: dateToWeek(m.forecast_date),
      actualWeek: dateToWeek(m.actual_date),
    }));
  }, [rawMilestones, dateToWeek]);

  const filteredMilestones = useMemo(() => {
    return milestones.filter(m => {
      if (scheduleStatusFilter === "all") return true;
      return m.status === scheduleStatusFilter;
    });
  }, [milestones, scheduleStatusFilter]);

  const [showAddMilestone, setShowAddMilestone] = useState(false);

  const progressMilestone = useCallback(async (m: GanttMilestone) => {
    const nextStatus = NEXT_MILESTONE_STATUS[m.status];
    try {
      await updateProjectMilestone(project.id, m.id, {
        status: nextStatus,
        actual_date: nextStatus === "complete" ? new Date().toISOString().slice(0, 10) : undefined,
      });
      await loadMilestones();
    } catch {
      // Non-fatal - the row simply keeps its current status on failure.
    }
  }, [project.id, loadMilestones]);

  // Read-only "who's responsible" summary on Overview - full editing lives on
  // the Assigned To tab (AssignmentPanel), this just makes it visible without
  // switching tabs.
  const [projectAssignment, setProjectAssignment] = useState<{ assigned_to_user_id: string | null; assigned_to_team_id: string | null; assigned_user_name: string | null; assigned_team_name: string | null } | null>(null);
  useEffect(() => {
    if (!project.id) return;
    getAssignment("project", project.id).then((res) => setProjectAssignment(res.data ?? null)).catch(() => setProjectAssignment(null));
  }, [project.id]);

  // ----------------------------------------------------
  // SOURCE-BACKED MATERIAL CONSUMPTION
  // ----------------------------------------------------
  const materialRecords = useMemo(() => detail?.material_records ?? [], [detail]);
  const materialSummary = useMemo(() => {
    return materialRecords.reduce((acc, row) => {
      const name = text(row.item_name ?? row.item_code ?? row.item_id, "Unclassified material");
      const quantity = number(row.quantity_used) ?? 0;
      const wastage = number(row.wastage_quantity) ?? 0;
      const unitCost = number(row.unit_cost) ?? 0;
      const key = `${name}::${text(row.unit_of_measure, "")}`;
      const existing = acc.get(key) ?? {
        key,
        name,
        unit: text(row.unit_of_measure, "units"),
        quantity: 0,
        wastage: 0,
        cost: 0,
        records: 0,
      };
      existing.quantity += quantity;
      existing.wastage += wastage;
      existing.cost += quantity * unitCost;
      existing.records += 1;
      acc.set(key, existing);
      return acc;
    }, new Map<string, { key: string; name: string; unit: string; quantity: number; wastage: number; cost: number; records: number }>());
  }, [materialRecords]);
  const materialSummaryRows = Array.from(materialSummary.values()).sort((a, b) => b.cost - a.cost);
  const materialTotalCost = materialSummaryRows.reduce((sum, row) => sum + row.cost, 0);
  const materialTotalWastage = materialSummaryRows.reduce((sum, row) => sum + row.wastage, 0);

  // ----------------------------------------------------
  // FINANCIAL WATERFALL CHART PARAMS (SVG)
  // ----------------------------------------------------
  const chartMaxVal = Math.max(contractVal, budgetedCost, forecastCost, actualCost, committedCost, 1);
  const chartHeight = 160;
  const chartScale = chartHeight / (chartMaxVal || 1);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm transition-all duration-300">
      <aside className="h-full w-full max-w-4xl overflow-y-auto border-l border-ink-mid bg-ink p-5 shadow-2xl transition-all duration-500 ease-dxl sm:p-6 lg:max-w-5xl">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-ink-mid pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal flex items-center gap-1.5 animate-pulse-signal">
              <Activity className="h-3 w-3" />Live Project Command Portal
            </p>
            <h2 className="mt-1 text-2xl font-bold text-paper font-display">{title(source)}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-light">
              <MapPin className="h-3.5 w-3.5 text-signal" />{text(source.location)}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate">Department</span>
              <select
                value={(source.department_id as string | undefined) ?? ""}
                onChange={handleDepartmentSelect}
                disabled={departmentSaving}
                className="h-7 border border-ink-mid bg-ink-light px-2 text-xs text-paper disabled:opacity-50"
              >
                <option value="">Unassigned</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              {departmentSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-signal" />}
              {departmentError && <span className="text-[10px] text-red-300">{departmentError}</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate">Region</span>
                <select
                  value={regionOverride ?? currentRegion}
                  onChange={handleRegionSelect}
                  disabled={regionSaving}
                  className="h-7 border border-ink-mid bg-ink-light px-2 text-xs text-paper disabled:opacity-50"
                >
                  <option value="">Unassigned</option>
                  {PROVINCES.map((province) => (
                    <option key={province} value={province}>{province}</option>
                  ))}
                </select>
                {regionSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-signal" />}
                {regionError && <span className="text-[10px] text-red-300">{regionError}</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate">Coordinates</span>
                <input
                  value={coords.latitude}
                  onChange={(event) => { setCoords((prev) => ({ ...prev, latitude: event.target.value })); setCoordsDirty(true); }}
                  placeholder="Latitude"
                  inputMode="decimal"
                  className="h-7 w-24 border border-ink-mid bg-ink-light px-2 text-xs text-paper placeholder:text-slate"
                />
                <input
                  value={coords.longitude}
                  onChange={(event) => { setCoords((prev) => ({ ...prev, longitude: event.target.value })); setCoordsDirty(true); }}
                  placeholder="Longitude"
                  inputMode="decimal"
                  className="h-7 w-24 border border-ink-mid bg-ink-light px-2 text-xs text-paper placeholder:text-slate"
                />
                <button
                  onClick={() => void saveCoords()}
                  disabled={coordsSaving || !coordsDirty}
                  className="h-7 border border-ink-mid bg-ink-light px-2 font-mono text-[10px] uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-40"
                >
                  Save
                </button>
                {coordsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-signal" />}
                {coordsError && <span className="text-[10px] text-red-300">{coordsError}</span>}
              </div>
            </div>
          </div>
          <button
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="border border-red-500/30 bg-red-950/20 p-2 text-red-300 hover:border-red-400 hover:bg-red-950/40 disabled:opacity-40"
            aria-label="Delete project"
            title="Delete project"
          >
            {deleting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
          </button>
          <button
            onClick={onClose}
            className="border border-ink-mid bg-ink-light p-2 text-slate-light hover:border-signal hover:text-paper"
            aria-label="Close project detail"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {deleteError && <p className="mt-2 text-xs text-red-300">{deleteError}</p>}

        {/* Tab Navigation */}
        <nav className="my-4 flex border-b border-ink-mid">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "overview" 
                ? "border-signal text-signal bg-ink-light/40 font-bold" 
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Overview & Evidence
          </button>
          <button
            onClick={() => setActiveTab("schedule")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "schedule" 
                ? "border-signal text-signal bg-ink-light/40 font-bold" 
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Schedule Gantt
          </button>
          <button
            onClick={() => setActiveTab("financials")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "financials" 
                ? "border-signal text-signal bg-ink-light/40 font-bold" 
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Budget Variance & Margins
          </button>
          <button
            onClick={() => setActiveTab("materials")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "materials" 
                ? "border-signal text-signal bg-ink-light/40 font-bold" 
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Material Consumption
          </button>
          <button
            onClick={() => setActiveTab("documents")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "documents"
                ? "border-signal text-signal bg-ink-light/40 font-bold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Documents
          </button>
          <button
            onClick={() => setActiveTab("assign")}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "assign"
                ? "border-signal text-signal bg-ink-light/40 font-bold"
                : "border-transparent text-slate hover:text-paper"
            }`}
          >
            Assigned To
          </button>
        </nav>

        {loading ? (
          <div className="flex h-60 items-center justify-center gap-3 text-slate-light">
            <Loader2 className="h-5 w-5 animate-spin text-signal" />Loading project evidence
          </div>
        ) : error ? (
          <div className="mt-5 border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-100 flex gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />{error}
          </div>
        ) : (
          <div className="py-2 space-y-6">
            
            {/* ---------------------------------------------------- */}
            {/* OVERVIEW & EVIDENCE TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "overview" && (
              <div className="space-y-6 animate-fade-in">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Info label="Status" value={text(source.status)} />
                  {text(viability?.initiated_by as string | undefined ?? (source as Record<string, unknown>).initiated_by, "client") === "company" ? (
                    <Info
                      label="Project Category"
                      value={
                        PROJECT_CATEGORY_LABELS[String(viability?.project_category ?? (source as Record<string, unknown>).project_category ?? "")]
                        ?? "Production (uncategorized)"
                      }
                    />
                  ) : (
                    <Info label="Contract Value" value={formatCurrency(contractVal)} />
                  )}
                  <Info label="Project Manager" value={text(viability?.delivery_manager ?? source.project_manager ?? source.manager)} />
                  <Info label="Programme End" value={formatDate(text(viability?.planned_end_date ?? source.end_date, ""))} />
                </div>

                <p className="font-mono text-[10px] uppercase tracking-wider text-slate-light">
                  Responsible: {projectAssignment && (projectAssignment.assigned_team_name || projectAssignment.assigned_user_name) ? (
                    <>
                      <span className="text-paper">{projectAssignment.assigned_team_name || projectAssignment.assigned_user_name}</span>
                      {projectAssignment.assigned_to_team_id ? " (team)" : ""}
                    </>
                  ) : (
                    <span className="text-slate">Unassigned - see the Assigned To tab</span>
                  )}
                </p>

                {text(viability?.initiated_by as string | undefined ?? (source as Project & { initiated_by?: string }).initiated_by, "client") === "company" && (
                  <ProductionIntakePanel
                    project={{
                      id: project.id,
                      status: source.status,
                      start_date: (source as Record<string, unknown>).start_date,
                      project_category: viability?.project_category ?? (source as Record<string, unknown>).project_category,
                      investment_required: viability?.investment_required ?? (source as Record<string, unknown>).investment_required,
                      funding_internal: viability?.funding_internal ?? (source as Record<string, unknown>).funding_internal,
                      funding_external: viability?.funding_external ?? (source as Record<string, unknown>).funding_external,
                      setup_duration_weeks: viability?.setup_duration_weeks ?? (source as Record<string, unknown>).setup_duration_weeks,
                      intake_completed_at: viability?.intake_completed_at ?? (source as Record<string, unknown>).intake_completed_at,
                    }}
                    onRefresh={onRefresh}
                  />
                )}

                {(source.status === "field_intake" || source.status === "pending_deposit" || FINANCE_SIGNOFF_ROLES.has(role ?? "")) && (
                  <FieldIntakePanel
                    project={source}
                    isFinance={FINANCE_SIGNOFF_ROLES.has(role ?? "")}
                    onRefresh={onRefresh}
                  />
                )}

                {(source.status === "pending_deposit" || source.status === "pre_mobilisation" || detail?.commercial_readiness || source.commercial_cleared_at) ? (
                  <CommercialReadinessPanel
                    project={source}
                    readiness={detail?.commercial_readiness}
                    canManage={COMMERCIAL_READINESS_ROLES.has(role ?? "")}
                    onRefresh={onRefresh}
                  />
                ) : null}

                {(source.status === "pre_mobilisation" || detail?.pre_mobilisation?.checks?.length || source.mobilisation_approved_at) ? (
                  <PreMobilisationPanel
                    project={source}
                    readiness={detail?.pre_mobilisation}
                    isApprover={FINANCE_SIGNOFF_ROLES.has(role ?? "")}
                    onRefresh={onRefresh}
                  />
                ) : null}

                <section>
                  <h3 className="mb-3 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-signal">
                    <ShieldCheck className="h-4 w-4" />ERP System Evidence Logs
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Evidence label="Viability records" items={detail?.viability} />
                    <Evidence label="Tests and checks" items={detail?.tests_and_checks} />
                    <Evidence label="Site reports" items={detail?.site_reports} />
                    <Evidence label="Quotations" items={detail?.quotations} />
                    <Evidence label="Procurement orders" items={detail?.procurement_orders} />
                    <Evidence label="Tender records" items={detail?.tenders} />
                    <Evidence label="Subcontractor records" items={detail?.subcontractors} />
                  </div>
                </section>

                <div className="border-l-2 border-signal/50 bg-ink-light/20 p-4 rounded-r-md">
                  <h4 className="font-mono text-xs uppercase text-paper font-semibold flex items-center gap-1.5">
                    <InfoIcon className="h-3.5 w-3.5 text-signal" />Data Assurance Statement
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-light">
                    These modules represent system-of-record entries automatically audited from active database transactions. 
                    Any modifications to contract values, site reports, or purchase records are tracked via core audit triggers.
                  </p>
                </div>
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* SCHEDULE GANTT TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "schedule" && (
              <div className="space-y-5 animate-fade-in">
                
                {/* Gantt Timeline Filters */}
                <div className="flex flex-wrap items-center justify-between gap-4 bg-ink-light/35 border border-ink-mid p-3.5">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="font-mono text-[10px] text-slate uppercase mr-2 flex items-center gap-1">
                      <Sliders className="h-3 w-3" />Timeline View:
                    </span>
                    <button
                      onClick={() => setScheduleTimelineFilter("comparison")}
                      className={`px-3 py-1 font-mono text-[10px] uppercase border transition-all ${
                        scheduleTimelineFilter === "comparison" 
                          ? "border-signal text-signal bg-signal/10" 
                          : "border-ink-mid text-slate hover:text-paper"
                      }`}
                    >
                      Compare Timelines
                    </button>
                    <button
                      onClick={() => setScheduleTimelineFilter("baseline")}
                      className={`px-3 py-1 font-mono text-[10px] uppercase border transition-all ${
                        scheduleTimelineFilter === "baseline" 
                          ? "border-slate text-slate-light bg-slate/10" 
                          : "border-ink-mid text-slate hover:text-paper"
                      }`}
                    >
                      Baseline
                    </button>
                    <button
                      onClick={() => setScheduleTimelineFilter("forecast")}
                      className={`px-3 py-1 font-mono text-[10px] uppercase border transition-all ${
                        scheduleTimelineFilter === "forecast" 
                          ? "border-signal/70 text-amber-300 bg-signal/5" 
                          : "border-ink-mid text-slate hover:text-paper"
                      }`}
                    >
                      Forecast
                    </button>
                    <button
                      onClick={() => setScheduleTimelineFilter("actual")}
                      className={`px-3 py-1 font-mono text-[10px] uppercase border transition-all ${
                        scheduleTimelineFilter === "actual" 
                          ? "border-emerald-600/70 text-emerald-300 bg-emerald-500/5" 
                          : "border-ink-mid text-slate hover:text-paper"
                      }`}
                    >
                      Actual
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-slate uppercase">Status Filter:</span>
                    <select
                      value={scheduleStatusFilter}
                      onChange={(e) => setScheduleStatusFilter(e.target.value as any)}
                      className="border border-ink-mid bg-ink-light px-2 py-1 font-mono text-[11px] text-paper focus:outline-none focus:border-signal"
                    >
                      <option value="all">All milestones</option>
                      <option value="complete">Complete</option>
                      <option value="in_progress">In Progress</option>
                      <option value="blocked">Blocked / Delayed</option>
                      <option value="not_started">Not Started</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowAddMilestone((v) => !v)}
                      className="flex items-center gap-1 border border-signal/40 bg-signal/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-signal hover:bg-signal/20"
                    >
                      <Plus className="h-3 w-3" />Add Milestone
                    </button>
                  </div>
                </div>

                {showAddMilestone && (
                  <AddMilestoneForm
                    projectId={project.id}
                    onClose={() => setShowAddMilestone(false)}
                    onAdded={() => { setShowAddMilestone(false); void loadMilestones(); }}
                  />
                )}

                {milestonesLoading ? (
                  <div className="flex h-32 items-center justify-center gap-3 border border-ink-mid bg-ink-light/20 text-sm text-slate-light">
                    <Loader2 className="h-4 w-4 animate-spin text-signal" />Loading milestones
                  </div>
                ) : filteredMilestones.length === 0 ? (
                  <div className="flex h-32 flex-col items-center justify-center gap-1 border border-dashed border-ink-mid bg-ink-light/10 text-center">
                    <p className="text-sm text-slate-light">No milestones logged yet.</p>
                    <p className="text-xs text-slate">Use &quot;Add Milestone&quot; above to record real schedule dates and a real owner.</p>
                  </div>
                ) : (
                  <>
                    {!startDateMs && (
                      <p className="border border-amber-500/30 bg-amber-950/10 p-2 text-xs text-amber-200">
                        This project has no start date set, so milestones are listed below without a week position on the timeline.
                      </p>
                    )}
                    {/* Timeline Axis Labels */}
                    <div className="border border-ink-mid bg-ink-light/20 overflow-x-auto">
                      <div className="min-w-[800px]">
                        <div
                          className="grid border-b border-ink-mid py-2 font-mono text-[10px] font-semibold text-slate uppercase bg-ink-light/40"
                          style={{ display: "grid", gridTemplateColumns: "260px repeat(16, minmax(0, 1fr))" }}
                        >
                          <div className="pl-4">Project Milestones</div>
                          {Array.from({ length: 16 }, (_, i) => (
                            <div key={i} className="text-center border-l border-ink-mid/30">W{i + 1}</div>
                          ))}
                        </div>

                        {/* Gantt Rows - real milestones plotted as point markers (a milestone is a date, not a duration) */}
                        <div className="divide-y divide-ink-mid/60">
                          {filteredMilestones.map((m) => (
                            <div
                              key={m.id}
                              className="grid py-3 hover:bg-ink-light/10 transition-colors items-center"
                              style={{ display: "grid", gridTemplateColumns: "260px repeat(16, minmax(0, 1fr))" }}
                            >
                              {/* Milestone Information */}
                              <div className="pl-4 pr-3">
                                <p className="text-xs font-semibold text-paper leading-tight">{m.name}</p>
                                <div className="mt-1 flex items-center gap-2 font-mono text-[9px]">
                                  <button
                                    type="button"
                                    onClick={() => void progressMilestone(m)}
                                    title="Click to progress status"
                                    className={`border px-1 py-0.5 hover:brightness-110 ${
                                    m.status === 'complete' ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300' :
                                    m.status === 'in_progress' ? 'border-sky-500/30 bg-sky-950/20 text-sky-300' :
                                    m.status === 'blocked' ? 'border-red-500/40 bg-red-950/30 text-red-300' :
                                    'border-slate/40 bg-slate-950/10 text-slate-400'
                                  }`}>
                                    {m.status.replace('_', ' ')}
                                  </button>
                                  {m.weight != null && <span className="text-slate">{m.weight}% weight</span>}
                                  <span className="text-slate-light">• {m.ownerName ?? "Unassigned"}</span>
                                </div>
                              </div>

                              {/* Timeline Grid Row */}
                              <div className="col-span-16 grid grid-cols-16 h-10 relative items-center">
                                {Array.from({ length: 16 }, (_, i) => (
                                  <div key={i} className="h-full border-l border-ink-mid/10 absolute top-0" style={{ left: `${(i / 16) * 100}%` }} />
                                ))}

                                {scheduleTimelineFilter === "baseline" && (
                                  <MilestoneMarker week={m.baselineWeek} colorClass="bg-slate-400 border-slate-300" label={m.baselineWeek ? `Baseline: W${m.baselineWeek}` : "No baseline date"} />
                                )}
                                {scheduleTimelineFilter === "forecast" && (
                                  <MilestoneMarker week={m.forecastWeek} colorClass="bg-signal border-signal" label={m.forecastWeek ? `Forecast: W${m.forecastWeek}` : "No forecast date"} />
                                )}
                                {scheduleTimelineFilter === "actual" && (
                                  <MilestoneMarker
                                    week={m.actualWeek}
                                    colorClass={m.status === 'blocked' ? "bg-red-500 border-red-400 animate-pulse" : "bg-emerald-500 border-emerald-400"}
                                    label={m.actualWeek ? `Actual: W${m.actualWeek}` : "Not yet actualized"}
                                  />
                                )}
                                {scheduleTimelineFilter === "comparison" && (
                                  <>
                                    <MilestoneMarker week={m.baselineWeek} colorClass="bg-slate-400 border-slate-300" label={m.baselineWeek ? `Baseline: W${m.baselineWeek}` : "No baseline date"} row={0} />
                                    <MilestoneMarker week={m.forecastWeek} colorClass="bg-signal border-signal" label={m.forecastWeek ? `Forecast: W${m.forecastWeek}` : "No forecast date"} row={1} />
                                    <MilestoneMarker
                                      week={m.actualWeek}
                                      colorClass={m.status === 'blocked' ? "bg-red-500 border-red-400" : "bg-emerald-500 border-emerald-400"}
                                      label={m.actualWeek ? `Actual: W${m.actualWeek}` : "Not yet actualized"}
                                      row={2}
                                    />
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Gantt Legend */}
                <div className="flex gap-6 font-mono text-[9px] text-slate-light border-t border-ink-mid pt-3 justify-end">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-4 h-2 bg-slate/40 border border-slate/30 rounded-sm"></span>
                    <span>Baseline Schedule</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-4 h-2 bg-signal/30 border border-signal/50 rounded-sm"></span>
                    <span>Forecast Plan</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-4 h-2 bg-emerald-600/30 border border-emerald-500/50 rounded-sm"></span>
                    <span>Actual / Progress</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-4 h-2 bg-red-500/20 border border-red-500/40 rounded-sm"></span>
                    <span>Slippage / Blocked</span>
                  </div>
                </div>

              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* BUDGET VARIANCE & MARGINS TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "financials" && (
              <div className="space-y-6 animate-fade-in">
                {!hasFinanceEvidence && (
                  <div className="border border-amber-500/25 bg-amber-500/10 p-4 rounded-sm text-amber-100">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5" />
                      <div>
                        <p className="font-mono text-xs uppercase tracking-widest text-amber-300">Finance evidence not recorded</p>
                        <p className="mt-1 text-sm text-slate-light">
                          Contract value, budgeted cost, commitments, actual cost and forecast cost are shown only when returned by the project or finance services. No fallback financial figures are generated.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                 
                {/* Variance Cards */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="border border-ink-mid bg-ink-light/20 p-3.5">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-slate">Planned Budgeted Cost</p>
                    <p className="mt-1 font-mono text-lg font-bold text-slate-light">{formatCurrency(budgetedCost)}</p>
                  </div>
                  <div className="border border-ink-mid bg-ink-light/20 p-3.5">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-slate">Actual Cost to Date</p>
                    <p className="mt-1 font-mono text-lg font-bold text-paper">{formatCurrency(actualCost)}</p>
                    <span className="text-[10px] text-slate-light font-mono">Source-backed finance value</span>
                  </div>
                  <div className="border border-ink-mid bg-ink-light/20 p-3.5">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-slate">Forecast cost (EAC)</p>
                    <p className="mt-1 font-mono text-lg font-bold text-signal">{formatCurrency(forecastCost)}</p>
                    <span className={`text-[10px] font-mono flex items-center gap-0.5 ${costOverrunPct > 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {costOverrunPct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {costOverrunPct.toFixed(2)}% overrun
                    </span>
                  </div>
                  <div className="border border-ink-mid bg-ink-light/20 p-3.5">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-slate">Budget Variance</p>
                    <p className={`mt-1 font-mono text-lg font-bold ${forecastCost - budgetedCost > 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {formatCurrency(budgetedCost - forecastCost)}
                    </p>
                    <span className="text-[10px] text-slate-light font-mono">Forecast vs Baseline</span>
                  </div>
                </div>

                {/* Margins Calculations Panel */}
                <div className="border border-ink-mid bg-ink-light/10 p-5 rounded-sm">
                  <h3 className="mb-4 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-signal border-b border-ink-mid pb-2">
                    <DollarSign className="h-4 w-4" />Margin Calculations & Profitability Matrix
                  </h3>
                  
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    
                    {/* Budget Gross profit */}
                    <div className="border border-slate-700/30 bg-ink-light/35 p-4 relative group">
                      <span className="absolute top-2 right-2 text-slate-light cursor-help" title="Planned revenue minus planned baseline costs.">
                        <InfoIcon className="h-3.5 w-3.5" />
                      </span>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Budgeted Gross Margin</p>
                      <p className="mt-2 text-2xl font-bold font-mono text-paper">{budgetedGrossMarginPct.toFixed(2)}%</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Profit: {formatCurrency(budgetedGrossProfit)}
                      </p>
                    </div>

                    {/* Forecast Gross profit */}
                    <div className="border border-slate-700/30 bg-ink-light/35 p-4 relative">
                      <span className="absolute top-2 right-2 text-slate-light cursor-help" title="Recorded contract value minus active forecast cost-at-completion (EAC).">
                        <InfoIcon className="h-3.5 w-3.5" />
                      </span>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Forecast Gross Margin</p>
                      <p className="mt-2 text-2xl font-bold font-mono text-signal">{forecastGrossMarginPct.toFixed(2)}%</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Profit: {formatCurrency(forecastGrossProfit)}
                      </p>
                    </div>

                    {/* Margin Slippage */}
                    <div className={`border border-slate-700/30 bg-ink-light/35 p-4 relative ${
                      marginSlippage < 0 ? "border-red-500/20 bg-red-950/5" : "border-emerald-500/20 bg-emerald-950/5"
                    }`}>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Margin Slippage</p>
                      <p className={`mt-2 text-2xl font-bold font-mono ${marginSlippage < 0 ? "text-red-400" : "text-emerald-400"}`}>
                        {marginSlippage.toFixed(2)}%
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Forecast vs Baseline %
                      </p>
                    </div>

                    {/* Net profit margin */}
                    <div className="border border-slate-700/30 bg-ink-light/35 p-4 relative">
                      <span className="absolute top-2 right-2 text-slate-light cursor-help" title="Forecast gross margin minus recorded operational overheads.">
                        <InfoIcon className="h-3.5 w-3.5" />
                      </span>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Forecast Net Margin</p>
                      <p className="mt-2 text-2xl font-bold font-mono text-sky-400">{forecastNetMarginPct.toFixed(2)}%</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Net Profit: {formatCurrency(forecastNetProfit)}
                      </p>
                    </div>

                    {/* Markup percentage */}
                    <div className="border border-slate-700/30 bg-ink-light/35 p-4 relative">
                      <span className="absolute top-2 right-2 text-slate-light cursor-help" title="The price markup percentage applied to budgeted cost.">
                        <InfoIcon className="h-3.5 w-3.5" />
                      </span>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Budgeted Markup</p>
                      <p className="mt-2 text-2xl font-bold font-mono text-paper">{markupPct.toFixed(2)}%</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Markup on baseline cost
                      </p>
                    </div>

                    {/* Cost overrun percentage */}
                    <div className={`border border-slate-700/30 bg-ink-light/35 p-4 relative ${
                      costOverrunPct > 0 ? "border-amber-500/20" : ""
                    }`}>
                      <span className="absolute top-2 right-2 text-slate-light cursor-help" title="Percentage growth in cost between baseline and current forecast.">
                        <InfoIcon className="h-3.5 w-3.5" />
                      </span>
                      <p className="font-mono text-[9px] uppercase text-slate tracking-wider">Cost Overrun Factor</p>
                      <p className={`mt-2 text-2xl font-bold font-mono ${costOverrunPct > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                        {costOverrunPct.toFixed(2)}%
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-slate-light">
                        Budget Growth rate
                      </p>
                    </div>

                  </div>
                </div>

                {/* Dynamic Parameter Adjustment Sliders */}
                <div className="grid gap-4 md:grid-cols-2 border border-ink-mid bg-ink-light/20 p-5">
                  <div>
                    <h4 className="font-mono text-xs font-semibold uppercase text-paper flex items-center gap-1.5">
                      <Sliders className="h-4 w-4 text-signal" />Forecast cost variance
                    </h4>
                    <p className="text-[11px] text-slate-light mt-1">
                      Read-only until finance exposes a controlled forecast scenario workflow.
                    </p>
                    <div className="mt-4 flex items-center gap-4">
                      <input 
                        type="range" 
                        min="-10" 
                        max="30" 
                        value={overrunSlider} 
                        disabled
                        readOnly
                        className="w-full h-1 bg-ink-mid rounded-lg appearance-none cursor-not-allowed accent-signal opacity-50"
                      />
                      <span className="font-mono text-sm font-semibold text-signal w-12 text-right">
                        {overrunSlider > 0 ? `+${overrunSlider}` : overrunSlider}%
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-mono text-xs font-semibold uppercase text-paper flex items-center gap-1.5">
                      <Sliders className="h-4 w-4 text-sky-400" />Recorded overhead %
                    </h4>
                    <p className="text-[11px] text-slate-light mt-1">
                      Read-only value from project/finance services. Scenario editing requires a finance API workflow.
                    </p>
                    <div className="mt-4 flex items-center gap-4">
                      <input 
                        type="range" 
                        min="0" 
                        max="15" 
                        step="0.5"
                        value={overheadSlider} 
                        disabled
                        readOnly
                        className="w-full h-1 bg-ink-mid rounded-lg appearance-none cursor-not-allowed accent-sky-400 opacity-50"
                      />
                      <span className="font-mono text-sm font-semibold text-sky-400 w-12 text-right">
                        {overheadSlider}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* SVG Variance Bar Chart */}
                <div className="border border-ink-mid bg-ink-light/10 p-5">
                  <h4 className="font-mono text-xs font-semibold uppercase text-slate tracking-wider mb-4">
                    Visual Budget Cost Variance Breakdown
                  </h4>
                  <div className="flex justify-center items-center">
                    <svg className="w-full max-w-lg" viewBox="0 0 500 240" fill="none" xmlns="http://www.w3.org/2000/svg">
                      
                      {/* Gridlines */}
                      <line x1="40" y1="20" x2="480" y2="20" stroke="#1E3A5F" strokeWidth="1" strokeDasharray="3 3" />
                      <line x1="40" y1="60" x2="480" y2="60" stroke="#1E3A5F" strokeWidth="1" strokeDasharray="3 3" />
                      <line x1="40" y1="100" x2="480" y2="100" stroke="#1E3A5F" strokeWidth="1" strokeDasharray="3 3" />
                      <line x1="40" y1="140" x2="480" y2="140" stroke="#1E3A5F" strokeWidth="1" strokeDasharray="3 3" />
                      <line x1="40" y1="180" x2="480" y2="180" stroke="#1E3A5F" strokeWidth="1" />

                      {/* Bar 1: Baseline Budget */}
                      <rect 
                        x="50" 
                        y={180 - (budgetedCost * chartScale)} 
                        width="60" 
                        height={budgetedCost * chartScale} 
                        fill="#1E3A5F" 
                        stroke="#4A5568" 
                        strokeWidth="1" 
                        className="transition-all duration-500 ease-dxl hover:fill-[#1e3a5f]/80"
                      />
                      <text x="80" y="195" fill="#718096" fontSize="9" fontFamily="monospace" textAnchor="middle">Baseline</text>
                      <text x="80" y={170 - (budgetedCost * chartScale)} fill="#CBD5E1" fontSize="9" fontFamily="monospace" textAnchor="middle">
                        ${(budgetedCost / 1000000).toFixed(2)}M
                      </text>

                      {/* Bar 2: Committed POs */}
                      <rect 
                        x="160" 
                        y={180 - (committedCost * chartScale)} 
                        width="60" 
                        height={committedCost * chartScale} 
                        fill="#0C6E96" 
                        stroke="#0a7ea6" 
                        strokeWidth="1" 
                        className="transition-all duration-500 ease-dxl"
                      />
                      <text x="190" y="195" fill="#718096" fontSize="9" fontFamily="monospace" textAnchor="middle">Committed</text>
                      <text x="190" y={170 - (committedCost * chartScale)} fill="#CBD5E1" fontSize="9" fontFamily="monospace" textAnchor="middle">
                        ${(committedCost / 1000000).toFixed(2)}M
                      </text>

                      {/* Bar 3: Actual spent */}
                      <rect 
                        x="270" 
                        y={180 - (actualCost * chartScale)} 
                        width="60" 
                        height={actualCost * chartScale} 
                        fill="#EEEDE8" 
                        stroke="#cbd5e1" 
                        strokeWidth="1" 
                        className="transition-all duration-500 ease-dxl"
                      />
                      <text x="300" y="195" fill="#718096" fontSize="9" fontFamily="monospace" textAnchor="middle">Actual spent</text>
                      <text x="300" y={170 - (actualCost * chartScale)} fill="#EEEDE8" fontSize="9" fontFamily="monospace" textAnchor="middle">
                        ${(actualCost / 1000000).toFixed(2)}M
                      </text>

                      {/* Bar 4: Forecast Cost */}
                      <rect 
                        x="380" 
                        y={180 - (forecastCost * chartScale)} 
                        width="60" 
                        height={forecastCost * chartScale} 
                        fill={forecastCost > budgetedCost ? "#9B2C2C" : "#C8960C"} 
                        stroke={forecastCost > budgetedCost ? "#E53E3E" : "#FF6A2B"} 
                        strokeWidth="1" 
                        className="transition-all duration-500 ease-dxl"
                      />
                      <text x="410" y="195" fill="#718096" fontSize="9" fontFamily="monospace" textAnchor="middle">Forecast</text>
                      <text x="410" y={170 - (forecastCost * chartScale)} fill={forecastCost > budgetedCost ? "#FC8181" : "#D4AF37"} fontSize="9" fontFamily="monospace" textAnchor="middle">
                        ${(forecastCost / 1000000).toFixed(2)}M
                      </text>

                      {/* Y-axis ticks */}
                      <text x="35" y="23" fill="#4A5568" fontSize="8" fontFamily="monospace" textAnchor="end">${((chartMaxVal * 1.0) / 1000000).toFixed(1)}M</text>
                      <text x="35" y="103" fill="#4A5568" fontSize="8" fontFamily="monospace" textAnchor="end">${((chartMaxVal * 0.5) / 1000000).toFixed(1)}M</text>
                      <text x="35" y="183" fill="#4A5568" fontSize="8" fontFamily="monospace" textAnchor="end">$0.0M</text>
                    </svg>
                  </div>
                </div>

              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* MATERIAL CONSUMPTION TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "materials" && (
              <div className="space-y-6 animate-fade-in">
                <div className="border border-ink-mid bg-ink-light/20 p-5 rounded-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Material evidence</p>
                      <h3 className="mt-1 font-display text-xl font-semibold text-paper">Daily site report material consumption</h3>
                      <p className="mt-2 max-w-2xl text-sm text-slate-light">
                        This panel reads material lines attached to daily site reports. It does not generate target quantities or accept browser-only material logs.
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-right font-mono text-[10px] uppercase tracking-wider text-slate-light">
                      <div className="border border-ink-mid bg-ink p-3">
                        <p>Records</p>
                        <p className="mt-1 text-lg font-bold text-paper">{materialRecords.length}</p>
                      </div>
                      <div className="border border-ink-mid bg-ink p-3">
                        <p>Wastage</p>
                        <p className="mt-1 text-lg font-bold text-amber-300">{materialTotalWastage.toLocaleString()}</p>
                      </div>
                      <div className="border border-ink-mid bg-ink p-3">
                        <p>Cost</p>
                        <p className="mt-1 text-lg font-bold text-signal">{formatCurrency(materialTotalCost)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {materialRecords.length === 0 ? (
                  <div className="flex min-h-56 flex-col items-center justify-center border border-dashed border-ink-mid/60 bg-ink-light/10 p-8 text-center">
                    <Package className="h-8 w-8 text-slate" />
                    <p className="mt-3 font-mono text-xs uppercase tracking-widest text-slate-light">No material evidence recorded</p>
                    <p className="mt-2 max-w-xl text-sm text-slate">
                      Material consumption appears here after daily site report material lines are saved through Site Operations and returned by the project detail API.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
                    <div className="border border-ink-mid bg-ink-light/20 p-4 rounded-sm">
                      <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-paper">Material summary by item</h4>
                      <div className="mt-4 space-y-3">
                        {materialSummaryRows.map((row) => (
                          <div key={row.key} className="border border-ink-mid bg-ink p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-mono text-xs font-semibold uppercase text-paper">{row.name}</p>
                                <p className="mt-1 font-mono text-[10px] text-slate-light">{row.records} report line{row.records === 1 ? "" : "s"}</p>
                              </div>
                              <p className="font-mono text-xs font-bold text-signal">{formatCurrency(row.cost)}</p>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] text-slate-light">
                              <span>Used: <strong className="text-paper">{row.quantity.toLocaleString()} {row.unit}</strong></span>
                              <span>Wastage: <strong className="text-amber-300">{row.wastage.toLocaleString()} {row.unit}</strong></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border border-ink-mid bg-ink-light/10 p-4 rounded-sm">
                      <h4 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-slate">Source material line history</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-left font-mono text-[10px]">
                          <thead>
                            <tr className="border-b border-ink-mid/70 text-slate">
                              <th className="pb-2">Report date</th>
                              <th className="pb-2">Material</th>
                              <th className="pb-2 text-right">Quantity</th>
                              <th className="pb-2 text-right">Wastage</th>
                              <th className="pb-2 text-right">Unit cost</th>
                              <th className="pb-2">Work package</th>
                              <th className="pb-2">Store</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-ink-mid/30">
                            {materialRecords.map((row) => {
                              const unit = text(row.unit_of_measure, "units");
                              const quantity = number(row.quantity_used) ?? 0;
                              const wastage = number(row.wastage_quantity) ?? 0;
                              const unitCost = number(row.unit_cost) ?? 0;
                              return (
                                <tr key={String(row.id)} className="hover:bg-ink-light/20">
                                  <td className="py-2 text-slate-light">{formatDate(text(row.report_date, ""))}</td>
                                  <td className="py-2 font-semibold text-paper">{text(row.item_name ?? row.item_code ?? row.item_id)}</td>
                                  <td className="py-2 text-right text-paper">{quantity.toLocaleString()} {unit}</td>
                                  <td className="py-2 text-right text-amber-300">{wastage.toLocaleString()} {unit}</td>
                                  <td className="py-2 text-right text-slate-light">{formatCurrency(unitCost)}</td>
                                  <td className="py-2 text-slate-light">{text(row.work_package)}</td>
                                  <td className="py-2 text-slate-light">{text(row.store_name)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* DOCUMENTS TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "documents" && (
              <div className="animate-fade-in">
                <EntityDocumentsPanel entityType="project" entityId={project.id} />
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* ASSIGNED TO TAB */}
            {/* ---------------------------------------------------- */}
            {activeTab === "assign" && (
              <div className="max-w-md animate-fade-in">
                <AssignmentPanel entityType="project" entityId={project.id} />
              </div>
            )}

          </div>
        )}
      </aside>
    </div>
  );
}

