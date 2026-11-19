"use client";

import { useCallback, useState } from "react";
import { useLiveQuery } from "@/lib/live/LiveDataProvider";
import { PROJECT_OVERVIEW_TABLES, isProjectChange } from "@/lib/live/liveTables";
import {
  getExecutiveProjectDetail,
  getInternalProject,
  getProjectLifecycle,
  getProjectTeam,
  getFinanceProjectDetail,
  getDailySiteReports,
  updateInternalProject,
  setProjectBudget,
  approveProjectPreMobilisation,
  clearProjectCommercialReadiness,
  updateProjectPreMobilisationCheck,
  type ProjectTeamMember,
} from "@/lib/api";
import type { Detail, Project } from "../app/dashboard/projects/ProjectsPage";

export type ProjectWorkspaceData = {
  project: Project | null;
  detail: Detail | null;
  lifecycle: Record<string, unknown> | null;
  milestones: Record<string, unknown>[];
  team: ProjectTeamMember[];
  financeSummary: Record<string, unknown> | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateProjectFields: (patch: Partial<Project>) => Promise<boolean>;
};

type WorkspaceBundle = {
  project: Project | null;
  detail: Detail | null;
  lifecycle: Record<string, unknown> | null;
  milestones: Record<string, unknown>[];
  team: ProjectTeamMember[];
  financeSummary: Record<string, unknown> | null;
};

const NO_MILESTONES: Record<string, unknown>[] = [];
const NO_TEAM: ProjectTeamMember[] = [];

/** `prev` is the bundle on screen: a section whose request fails keeps its
 * previous value instead of going blank on a background refresh. */
async function fetchWorkspace(projectId: string, prev?: WorkspaceBundle): Promise<WorkspaceBundle> {
  // 1. Primary project record first via the canonical internal route.
  let primaryProject: Project | null = null;
  try {
    const res = await getInternalProject(projectId);
    if (res.success && res.data) primaryProject = res.data as unknown as Project;
  } catch {
    // Will try lifecycle / executive detail below
  }

  // 2. Lifecycle, team, finance summary, site reports and executive detail together.
  const [lifecycleResult, teamResult, financeResult, execResult, siteReportsResult] = await Promise.allSettled([
    getProjectLifecycle(projectId),
    getProjectTeam(projectId),
    getFinanceProjectDetail(projectId),
    getExecutiveProjectDetail(projectId),
    getDailySiteReports({ projectId }),
  ]);

  const directSiteReports = siteReportsResult.status === "fulfilled" && Array.isArray(siteReportsResult.value?.data)
    ? (siteReportsResult.value.data as Record<string, unknown>[])
    : [];

  let mergedDetail: Detail | null = null;
  let lifecycle: Record<string, unknown> | null = prev?.lifecycle ?? null;
  let milestones: Record<string, unknown>[] = prev?.milestones ?? [];
  let team: ProjectTeamMember[] = prev?.team ?? [];
  let financeSummary: Record<string, unknown> | null = prev?.financeSummary ?? null;

  if (execResult.status === "fulfilled" && execResult.value.data) {
    mergedDetail = execResult.value.data as Detail;
    if (mergedDetail.project) primaryProject = { ...(primaryProject || {}), ...mergedDetail.project };
  }

  if (lifecycleResult.status === "fulfilled" && lifecycleResult.value.data) {
    const lc = lifecycleResult.value.data;
    lifecycle = lc;
    if (Array.isArray(lc.milestones)) milestones = lc.milestones;
    if (mergedDetail) {
      mergedDetail = {
        ...mergedDetail,
        pre_mobilisation: (lc.pre_mobilisation as any) ?? mergedDetail.pre_mobilisation,
        commercial_readiness: (lc.commercial_readiness as any) ?? mergedDetail.commercial_readiness,
      };
    } else {
      // Even if executive detail was rejected or unavailable, construct full functional detail
      mergedDetail = {
        project: primaryProject || undefined,
        milestones: (lc.milestones as any) || [],
        changes: (lc.changes as any) || [],
        risks: (lc.risks as any) || [],
        pre_mobilisation: (lc.pre_mobilisation as any),
        commercial_readiness: (lc.commercial_readiness as any),
        site_reports: directSiteReports,
      };
    }
  }

  if (teamResult.status === "fulfilled" && teamResult.value.data) {
    team = teamResult.value.data || [];
    if (mergedDetail) mergedDetail.team = team;
  }

  if (financeResult.status === "fulfilled" && financeResult.value.data) {
    financeSummary = financeResult.value.data as Record<string, unknown>;
  }

  // Executive detail and lifecycle both failed this time: keep what we had.
  if (!mergedDetail && prev?.detail) mergedDetail = prev.detail;
  if (!primaryProject && prev?.project && (mergedDetail || lifecycle)) primaryProject = prev.project;

  if (!primaryProject && mergedDetail?.project) {
    primaryProject = mergedDetail.project;
  } else if (primaryProject && mergedDetail && !mergedDetail.project) {
    mergedDetail.project = primaryProject;
  }

  if (!primaryProject && !mergedDetail) {
    throw new Error("Project could not be found or you do not have permission to access it.");
  }
  return { project: primaryProject, detail: mergedDetail, lifecycle, milestones, team, financeSummary };
}

export function useProjectWorkspace(projectId: string): ProjectWorkspaceData {
  // Live: the project shell and overview refresh in place when anyone
  // changes this project - its record, milestones, changes, risks, team,
  // site reports or money - without a reload. Changes to other projects
  // are ignored, and the server only sends events for projects this user
  // may see.
  // Routes may use the project code (e.g. /dashboard/projects/EHTRW) while
  // events carry the UUID, so match on the loaded record's id once known.
  const [resolvedId, setResolvedId] = useState<string>(projectId);
  const query = useLiveQuery<WorkspaceBundle>(
    projectId ? `project-workspace:${projectId}` : null,
    async (previous) => {
      const result = await fetchWorkspace(projectId, previous);
      const id = (result.project as { id?: string } | null)?.id;
      if (id) setResolvedId(String(id));
      return result;
    },
    { tables: PROJECT_OVERVIEW_TABLES, match: (change) => isProjectChange(change, resolvedId) },
  );
  const { mutate } = query;
  const [updateError, setUpdateError] = useState<string | null>(null);
  const bundle = query.data;
  const project = bundle?.project ?? null;
  const detail = bundle?.detail ?? null;
  const loading = query.isLoading && bundle === undefined;
  const refreshing = query.isValidating && bundle !== undefined;
  const loadError = query.error && bundle === undefined
    ? (query.error instanceof Error ? query.error.message : "Failed to load project workspace data.")
    : null;
  const error = updateError ?? loadError;

  const updateProjectFields = useCallback(
    async (patch: Partial<Project>): Promise<boolean> => {
      if (!projectId) return false;
      try {
        const res = await updateInternalProject(projectId, patch as any);
        if (res.success) {
          setUpdateError(null);
          // Show the edit at once; the live refresh then confirms it.
          void mutate(
            (prev) =>
              prev
                ? {
                    ...prev,
                    project: prev.project ? { ...prev.project, ...patch } : prev.project,
                    detail: prev.detail && prev.detail.project
                      ? { ...prev.detail, project: { ...prev.detail.project, ...patch } }
                      : prev.detail,
                  }
                : prev,
            { revalidate: false },
          );
          return true;
        }
        return false;
      } catch (err) {
        setUpdateError(err instanceof Error ? err.message : "Failed to update project.");
        return false;
      }
    },
    [projectId, mutate]
  );

  return {
    project,
    detail,
    lifecycle: bundle?.lifecycle ?? null,
    milestones: bundle?.milestones ?? NO_MILESTONES,
    team: bundle?.team ?? NO_TEAM,
    financeSummary: bundle?.financeSummary ?? null,
    loading,
    refreshing,
    error,
    refetch: async () => {
      await mutate();
    },
    updateProjectFields,
  };
}
