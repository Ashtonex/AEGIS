import type { ApiResponse } from "@/types/api";
import { fetchApi } from "./core";

const BASE = "/api/v1/integrations/microsoft/project-workspaces";

export type ChannelStatus = "not_linked" | "needs_permission" | "ready" | "failed";

export interface ProjectWorkspace {
  project_id: string;
  folder_name: string | null;
  folder_web_url: string | null;
  folders_ready_at: string | null;
  channel_status: ChannelStatus;
  channel_name: string | null;
  channel_web_url: string | null;
  tabs_installed: string[];
  diary_web_url: string | null;
  diary_published_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
}

export interface ProjectWorkspaceState {
  enabled: boolean;
  team_linked: boolean;
  workspace: ProjectWorkspace | null;
}

export interface ProjectWorkspaceRow {
  project_id: string;
  project_code: string | null;
  name: string;
  status: string;
  folder_web_url: string | null;
  folders_ready_at: string | null;
  channel_status: ChannelStatus | null;
  channel_web_url: string | null;
  diary_web_url: string | null;
  diary_published_at: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
  files_copied: number;
  files_failed: number;
}

export interface ProjectWorkspacesOverview {
  enabled: boolean;
  sharepoint_ready: boolean;
  team_id: string | null;
  team_name: string | null;
  granted_permissions: string[];
  permissions_error: string | null;
  teams_permissions_needed: string[];
  teams_permissions_missing: string[];
  projects: ProjectWorkspaceRow[];
}

export function getProjectWorkspace(projectId: string) {
  return fetchApi<ApiResponse<ProjectWorkspaceState>>(`${BASE}/${encodeURIComponent(projectId)}`, {
    cache: "no-store",
    allowFallback: false,
  });
}

export function syncProjectWorkspace(projectId: string) {
  return fetchApi<ApiResponse<ProjectWorkspace>>(`${BASE}/${encodeURIComponent(projectId)}/sync`, {
    method: "POST",
    allowFallback: false,
  });
}

export function getProjectWorkspacesOverview() {
  return fetchApi<ApiResponse<ProjectWorkspacesOverview>>(BASE, { cache: "no-store", allowFallback: false });
}

export function updateProjectWorkspaceSettings(payload: { enabled?: boolean; team?: string; team_name?: string }) {
  return fetchApi<ApiResponse<Record<string, unknown>>>(`${BASE}/settings`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}
