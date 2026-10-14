"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getExecutiveProjectDetail,
  getProject,
  getProjectLifecycle,
  getProjectTeam,
  getFinanceProjectDetail,
  updateInternalProject,
  setProjectBudget,
  approveProjectPreMobilisation,
  clearProjectCommercialReadiness,
  updateProjectPreMobilisationCheck,
  type ProjectTeamMember,
} from "@/lib/api";
import type { Detail, Project } from "../app/dashboard/projects/page";

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

export function useProjectWorkspace(projectId: string): ProjectWorkspaceData {
  const [project, setProject] = useState<Project | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [lifecycle, setLifecycle] = useState<Record<string, unknown> | null>(null);
  const [milestones, setMilestones] = useState<Record<string, unknown>[]>([]);
  const [team, setTeam] = useState<ProjectTeamMember[]>([]);
  const [financeSummary, setFinanceSummary] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (isBackground = false) => {
      if (!projectId) return;
      if (!isBackground) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        // 1. Fetch primary project record first for instant shell hydration
        let primaryProject: Project | null = null;
        try {
          const res = await getProject(projectId);
          if (res.success && res.data) {
            primaryProject = res.data as unknown as Project;
            setProject(primaryProject);
          }
        } catch {
          // Will try executive detail below
        }

        // 2. Fetch executive detail, lifecycle, and team concurrently
        const [execResult, lifecycleResult, teamResult, financeResult] = await Promise.allSettled([
          getExecutiveProjectDetail(projectId),
          getProjectLifecycle(projectId),
          getProjectTeam(projectId),
          getFinanceProjectDetail(projectId),
        ]);

        let mergedDetail: Detail | null = null;

        if (execResult.status === "fulfilled" && execResult.value.data) {
          mergedDetail = execResult.value.data as Detail;
          if (mergedDetail.project) {
            primaryProject = { ...(primaryProject || {}), ...mergedDetail.project };
            setProject(primaryProject);
          }
        }

        if (lifecycleResult.status === "fulfilled" && lifecycleResult.value.data) {
          const lc = lifecycleResult.value.data;
          setLifecycle(lc);
          if (Array.isArray(lc.milestones)) {
            setMilestones(lc.milestones);
          }
          if (mergedDetail) {
            mergedDetail = {
              ...mergedDetail,
              pre_mobilisation: (lc.pre_mobilisation as any) ?? mergedDetail.pre_mobilisation,
              commercial_readiness: (lc.commercial_readiness as any) ?? mergedDetail.commercial_readiness,
            };
          }
        }

        if (teamResult.status === "fulfilled" && teamResult.value.data) {
          setTeam(teamResult.value.data || []);
        }

        if (financeResult.status === "fulfilled" && financeResult.value.data) {
          setFinanceSummary(financeResult.value.data as Record<string, unknown>);
        }

        setDetail(mergedDetail);

        if (!primaryProject && !mergedDetail) {
          throw new Error("Project could not be found or you do not have permission to access it.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load project workspace data.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  const updateProjectFields = useCallback(
    async (patch: Partial<Project>): Promise<boolean> => {
      if (!projectId) return false;
      try {
        const res = await updateInternalProject(projectId, patch as any);
        if (res.success) {
          setProject((prev) => (prev ? { ...prev, ...patch } : prev));
          setDetail((prev) =>
            prev && prev.project ? { ...prev, project: { ...prev.project, ...patch } } : prev
          );
          return true;
        }
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update project.");
        return false;
      }
    },
    [projectId]
  );

  return {
    project,
    detail,
    lifecycle,
    milestones,
    team,
    financeSummary,
    loading,
    refreshing,
    error,
    refetch: () => fetchData(true),
    updateProjectFields,
  };
}
