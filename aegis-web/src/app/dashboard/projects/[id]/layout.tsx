"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  DollarSign,
  Activity,
  Layers,
  MapPin,
  Package,
  ShieldCheck,
  Users,
  Clock,
  Sparkles,
  ClipboardCheck,
  RefreshCw,
  FolderOpen,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  ExternalLink,
  Award,
  Truck,
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { ProjectWorkspaceProvider, useProject } from "@/context/ProjectWorkspaceContext";
import { formatCurrency, formatDate } from "@/lib/utils";
import { title, text, number, type Project } from "@/lib/projects/types";
import { LeadershipAccountabilityModal } from "@/components/projects/LeadershipAccountabilityModal";
import { ManpowerScenarioCalculator } from "@/components/projects/ManpowerScenarioCalculator";
import { SiteEngineerSpeedDial } from "@/components/projects/SiteEngineerSpeedDial";

export default function ProjectWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  return (
    <RBACGuard>
      <ProjectWorkspaceProvider projectId={projectId}>
        <ProjectWorkspaceInner>{children}</ProjectWorkspaceInner>
      </ProjectWorkspaceProvider>
    </RBACGuard>
  );
}

function ProjectWorkspaceInner({ children }: { children: React.ReactNode }) {
  const { project, detail, loading, error, refetch, refreshing } = useProject();
  const [showLeadershipDossier, setShowLeadershipDossier] = useState(false);
  const [showManpowerSimulator, setShowManpowerSimulator] = useState(false);
  const pathname = usePathname();
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";

  const currentProject = project || detail?.project || null;

  const tabs = useMemo(
    () => [
      { id: "overview", label: "Mission Control", href: `/dashboard/projects/${projectId}`, icon: Activity },
      { id: "schedule", label: "Schedule & Gantt", href: `/dashboard/projects/${projectId}/schedule`, icon: CalendarDays },
      { id: "quality", label: "QA & Pour Cards", href: `/dashboard/projects/${projectId}/quality`, icon: Award },
      { id: "plant", label: "Plant & Fleet", href: `/dashboard/projects/${projectId}/plant`, icon: Truck },
      { id: "materials", label: "Materials & Supply", href: `/dashboard/projects/${projectId}/materials`, icon: Package },
      { id: "budget", label: "Budget Planner", href: `/dashboard/projects/${projectId}/budget`, icon: FileSpreadsheet },
      { id: "financials", label: "Financials & Cash", href: `/dashboard/projects/${projectId}/financials`, icon: DollarSign },
      { id: "site-logs", label: "Site Logs & Evidence", href: `/dashboard/projects/${projectId}/site-logs`, icon: ClipboardCheck },
      { id: "team", label: "Team & Workforce", href: `/dashboard/projects/${projectId}/team`, icon: Users },
      { id: "risks", label: "Risks & Changes", href: `/dashboard/projects/${projectId}/risks`, icon: AlertTriangle },
      { id: "documents", label: "Documents", href: `/dashboard/projects/${projectId}/documents`, icon: FolderOpen },
      { id: "controls", label: "Readiness & Start Gates", href: `/dashboard/projects/${projectId}/controls`, icon: ShieldCheck },
    ],
    [projectId]
  );

  const activeTabId = useMemo(() => {
    if (!pathname) return "overview";
    if (pathname === `/dashboard/projects/${projectId}`) return "overview";
    const segment = pathname.split(`/dashboard/projects/${projectId}/`)[1];
    return segment ? segment.split("/")[0] : "overview";
  }, [pathname, projectId]);

  const contractValue = useMemo(() => {
    if (!currentProject) return null;
    return number(currentProject.contract_value ?? currentProject.budget ?? currentProject.budget_value);
  }, [currentProject]);

  const statusLabel = text(currentProject?.status, "planning").toUpperCase();
  const isPendingDeposit = statusLabel.toLowerCase() === "pending_deposit";
  const isPreMobilisation = statusLabel.toLowerCase() === "pre_mobilisation";
  const isActive = statusLabel.toLowerCase() === "active";

  const statusBadgeClass = useMemo(() => {
    if (isActive) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
    if (isPreMobilisation) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    if (isPendingDeposit) return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    return "border-slate-500/40 bg-slate-500/10 text-slate-300";
  }, [isActive, isPreMobilisation, isPendingDeposit]);

  const activeTabRef = React.useRef<HTMLAnchorElement | null>(null);

  React.useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeTabId]);

  return (
    <div className="min-h-screen bg-[#07090E] text-paper">
      {/* Top Breadcrumb & Quick Controls */}
      <div className="border-b border-ink-mid/60 bg-ink/80 backdrop-blur-md px-3.5 py-2.5 sm:px-6">
        <div className="w-full flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs font-mono text-slate min-w-0">
            <Link
              href="/dashboard/projects"
              className="inline-flex shrink-0 items-center gap-1 text-slate-light hover:text-signal transition-colors p-1 -m-1"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden xs:inline">Projects</span>
            </Link>
            <span className="hidden xs:inline">/</span>
            <span className="text-paper truncate max-w-[140px] xs:max-w-[200px] sm:max-w-md font-medium text-xs">
              {currentProject ? title(currentProject) : "Loading Project..."}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={() => setShowLeadershipDossier(true)}
              className="inline-flex items-center justify-center gap-1.5 border border-emerald-500/50 bg-emerald-500/10 h-8 sm:h-auto px-2.5 py-1 text-xs font-mono uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200 active:scale-[0.98] transition-all"
              title="Month-End Leadership Accountability Dossier"
            >
              <Award className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Month-End Review</span>
            </button>
            <button
              onClick={() => setShowManpowerSimulator(true)}
              className="inline-flex items-center justify-center gap-1.5 border border-sky-500/50 bg-sky-500/10 h-8 sm:h-auto px-2.5 py-1 text-xs font-mono uppercase tracking-wider text-sky-300 hover:bg-sky-500/20 hover:text-sky-200 active:scale-[0.98] transition-all"
              title="Manpower & Hours Sensitivity Simulator"
            >
              <Sliders className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Manpower Sim</span>
            </button>
            <button
              onClick={() => void refetch()}
              disabled={refreshing}
              title="Refresh project telemetry"
              className="inline-flex items-center justify-center gap-1.5 border border-ink-mid bg-ink-light/40 h-8 sm:h-auto px-2.5 py-1 text-xs font-mono text-slate-light hover:text-paper hover:border-signal/50 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-signal" : ""}`} />
              <span className="hidden sm:inline">Telemetry</span>
            </button>
            <Link
              href={`/dashboard/projects/${projectId}/controls`}
              className="inline-flex items-center justify-center gap-1.5 border border-signal/60 bg-signal/10 h-8 sm:h-auto px-2.5 py-1 text-xs font-mono uppercase tracking-wider text-signal hover:bg-signal hover:text-ink active:scale-[0.98] transition-all"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{isActive ? "Readiness & Start Gates" : "Readiness / Fast-Track Gates"}</span>
              <span className="sm:hidden">Gates</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Hero Workspace Header: Full Width */}
      <header className="border-b border-ink-mid bg-gradient-to-b from-[#0F141C] to-[#0A0D14] px-3.5 py-4 sm:px-8 sm:py-5">
        <div className="w-full">
          {loading && !currentProject ? (
            <div className="animate-pulse space-y-3 py-4">
              <div className="h-4 w-32 bg-ink-light rounded" />
              <div className="h-8 w-96 bg-ink-light rounded" />
              <div className="h-4 w-64 bg-ink-light rounded" />
            </div>
          ) : error ? (
            <div className="border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-300">
              {error}
            </div>
          ) : currentProject ? (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 border px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider ${statusBadgeClass}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                      {statusLabel}
                    </span>
                    {currentProject.project_code && (
                      <span className="border border-ink-mid bg-ink-light/50 px-2 py-0.5 font-mono text-[11px] text-slate-light">
                        {String(currentProject.project_code)}
                      </span>
                    )}
                    {Boolean(currentProject.opportunity_id) && (
                      <Link
                        href="/dashboard/crm/opportunities"
                        className="inline-flex items-center gap-1 border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-300 hover:border-amber-400 hover:text-amber-200 transition-colors"
                        title="Linked to CRM Commercial Opportunity"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        <span>CRM Deal Linked</span>
                      </Link>
                    )}
                  </div>

                  <h1 className="mt-2 text-xl font-bold font-display tracking-tight text-paper sm:text-3xl break-words">
                    {title(currentProject)}
                  </h1>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-light">
                    {currentProject.client_name && (
                      <span className="flex items-center gap-1.5 truncate max-w-full">
                        <BriefcaseBusiness className="h-3.5 w-3.5 text-signal shrink-0" />
                        <span className="text-paper truncate">{String(currentProject.client_name)}</span>
                      </span>
                    )}
                    {(currentProject.location || currentProject.region) && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-signal shrink-0" />
                        <span>{text(currentProject.location || currentProject.region)}</span>
                      </span>
                    )}
                    {currentProject.project_manager && (
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-signal shrink-0" />
                        <span>Lead: <strong className="text-paper font-normal">{String(currentProject.project_manager)}</strong></span>
                      </span>
                    )}
                    {Boolean(currentProject.start_date) && (
                      <span className="flex items-center gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5 text-slate shrink-0" />
                        <span>Started {formatDate(String(currentProject.start_date))}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Key Metrics Strip: 2 columns on mobile, row on desktop */}
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
                  <div className="border border-ink-mid/80 bg-ink/60 px-3.5 py-2 sm:px-4 sm:py-2.5 min-w-0 sm:min-w-[130px]">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Contract Value</p>
                    <p className="mt-0.5 font-mono text-sm sm:text-base font-semibold text-paper truncate">
                      {contractValue ? formatCurrency(contractValue) : "Unrecorded"}
                    </p>
                  </div>
                  <div className="border border-ink-mid/80 bg-ink/60 px-3.5 py-2 sm:px-4 sm:py-2.5 min-w-0 sm:min-w-[120px]">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Planned End</p>
                    <p className="mt-0.5 font-mono text-xs sm:text-sm text-paper truncate">
                      {currentProject.planned_completion_date ? formatDate(String(currentProject.planned_completion_date)) : "No schedule"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {/* High-Resolution Sticky Tab Bar: Full Width with active tab centering */}
      <nav className="sticky top-0 z-30 border-b border-ink-mid bg-ink/95 backdrop-blur-md px-3.5 sm:px-8">
        <div className="w-full flex items-center gap-1.5 overflow-x-auto py-1.5 no-scrollbar scroll-smooth">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTabId === tab.id;
            return (
              <Link
                key={tab.id}
                ref={isSelected ? activeTabRef : undefined}
                href={tab.href}
                className={`inline-flex shrink-0 items-center gap-2 border px-3.5 py-2 text-xs font-mono tracking-wider transition-all min-h-[42px] touch-manipulation ${
                  isSelected
                    ? "border-signal bg-signal/15 text-signal font-semibold shadow-sm"
                    : "border-transparent text-slate-light hover:border-ink-mid hover:bg-ink-light/50 hover:text-paper"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isSelected ? "text-signal" : "text-slate"}`} />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Main Content Area: Spacious, 100% Full-Width with safe area */}
      <main className="w-full px-3.5 py-5 sm:px-8 sm:py-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {children}
      </main>

      {/* Leadership Accountability Dossier Modal */}
      {showLeadershipDossier && (
        <LeadershipAccountabilityModal
          projectId={projectId}
          projectName={currentProject ? title(currentProject) : "Site Project"}
          onClose={() => setShowLeadershipDossier(false)}
        />
      )}

      {/* Manpower & Working Hours Scenario Simulator Modal */}
      {showManpowerSimulator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto">
            <ManpowerScenarioCalculator
              projectName={currentProject ? title(currentProject) : "Site Project"}
              onClose={() => setShowManpowerSimulator(false)}
            />
          </div>
        </div>
      )}

      {/* Site Engineer Mobile Speed Dial FAB */}
      <SiteEngineerSpeedDial projectId={projectId} />
    </div>
  );
}
