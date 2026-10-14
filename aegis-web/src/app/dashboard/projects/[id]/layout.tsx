"use client";

import React, { useMemo } from "react";
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
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { ProjectWorkspaceProvider, useProject } from "@/context/ProjectWorkspaceContext";
import { formatCurrency, formatDate } from "@/lib/utils";
import { title, text, number, type Project } from "@/lib/projects/types";

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
  const pathname = usePathname();
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";

  const currentProject = project || detail?.project || null;

  const tabs = useMemo(
    () => [
      { id: "overview", label: "Mission Control", href: `/dashboard/projects/${projectId}`, icon: Activity },
      { id: "budget", label: "Budget Planner", href: `/dashboard/projects/${projectId}/budget`, icon: FileSpreadsheet },
      { id: "financials", label: "Financials & Cash", href: `/dashboard/projects/${projectId}/financials`, icon: DollarSign },
      { id: "schedule", label: "Schedule & Gantt", href: `/dashboard/projects/${projectId}/schedule`, icon: CalendarDays },
      { id: "materials", label: "Materials & Supply", href: `/dashboard/projects/${projectId}/materials`, icon: Package },
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

  return (
    <div className="min-h-screen bg-[#07090E] text-paper">
      {/* Top Breadcrumb & Quick Controls */}
      <div className="border-b border-ink-mid/60 bg-ink/80 backdrop-blur-md px-4 py-2.5 sm:px-6">
        <div className="w-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-mono text-slate">
            <Link
              href="/dashboard/projects"
              className="inline-flex items-center gap-1.5 text-slate-light hover:text-signal transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Projects Command</span>
            </Link>
            <span>/</span>
            <span className="text-paper truncate max-w-[280px] sm:max-w-md font-medium">
              {currentProject ? title(currentProject) : "Loading Project..."}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void refetch()}
              disabled={refreshing}
              title="Refresh project telemetry"
              className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink-light/40 px-2.5 py-1 text-xs font-mono text-slate-light hover:text-paper hover:border-signal/50 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin text-signal" : ""}`} />
              <span className="hidden sm:inline">Telemetry</span>
            </button>
            <Link
              href={`/dashboard/projects/${projectId}/controls`}
              className="inline-flex items-center gap-1.5 border border-signal/60 bg-signal/10 px-2.5 py-1 text-xs font-mono uppercase tracking-wider text-signal hover:bg-signal hover:text-ink transition-colors"
            >
              <Sparkles className="h-3 w-3" />
              <span>{isActive ? "Readiness & Start Gates" : "Readiness / Fast-Track Gates"}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Hero Workspace Header: Full Width */}
      <header className="border-b border-ink-mid bg-gradient-to-b from-[#0F141C] to-[#0A0D14] px-4 py-5 sm:px-8">
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
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className={`inline-flex items-center gap-1.5 border px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider ${statusBadgeClass}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                      {statusLabel}
                    </span>
                    {currentProject.project_code && (
                      <span className="border border-ink-mid bg-ink-light/50 px-2 py-0.5 font-mono text-[11px] text-slate-light">
                        {String(currentProject.project_code)}
                      </span>
                    )}
                  </div>

                  <h1 className="mt-2 text-2xl font-bold font-display tracking-tight text-paper sm:text-3xl">
                    {title(currentProject)}
                  </h1>

                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-light">
                    {currentProject.client_name && (
                      <span className="flex items-center gap-1.5">
                        <BriefcaseBusiness className="h-3.5 w-3.5 text-signal" />
                        <span className="text-paper">{String(currentProject.client_name)}</span>
                      </span>
                    )}
                    {(currentProject.location || currentProject.region) && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-signal" />
                        <span>{text(currentProject.location || currentProject.region)}</span>
                      </span>
                    )}
                    {currentProject.project_manager && (
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-signal" />
                        <span>Lead: <strong className="text-paper font-normal">{String(currentProject.project_manager)}</strong></span>
                      </span>
                    )}
                    {Boolean(currentProject.start_date) && (
                      <span className="flex items-center gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5 text-slate" />
                        <span>Started {formatDate(String(currentProject.start_date))}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Key Metrics Strip */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="border border-ink-mid/80 bg-ink/60 px-4 py-2.5 min-w-[130px]">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Contract Value</p>
                    <p className="mt-0.5 font-mono text-base font-semibold text-paper">
                      {contractValue ? formatCurrency(contractValue) : "Unrecorded"}
                    </p>
                  </div>
                  <div className="border border-ink-mid/80 bg-ink/60 px-4 py-2.5 min-w-[120px]">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Planned End</p>
                    <p className="mt-0.5 font-mono text-sm text-paper">
                      {currentProject.planned_completion_date ? formatDate(String(currentProject.planned_completion_date)) : "No schedule"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {/* High-Resolution Sticky Tab Bar: Full Width */}
      <nav className="sticky top-0 z-30 border-b border-ink-mid bg-ink/95 backdrop-blur-md px-4 sm:px-8">
        <div className="w-full flex items-center gap-1 overflow-x-auto py-1.5 no-scrollbar">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTabId === tab.id;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={`inline-flex shrink-0 items-center gap-2 border px-3 py-2 text-xs font-mono tracking-wider transition-all ${
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

      {/* Main Content Area: Spacious, 100% Full-Width */}
      <main className="w-full px-4 py-6 sm:px-8">
        {children}
      </main>
    </div>
  );
}
