import { ApiResponse } from "@/types/api";
import { fetchApi } from "./core";

// The structured site day (migration 252): labour register, PPE, toolbox
// talk and safety open the day and start everyone's timers; daily reports
// and material requests stay locked until then. Weekly budgets break into
// daily targets for the engineers. HR accepts the hours of project hires.

const SITE = "/api/v1/site-operations";
const HIRES = "/api/v1/hr/project-hires";

function post<T = any>(path: string, payload?: unknown, method = "POST"): Promise<ApiResponse<T>> {
  return fetchApi<ApiResponse<T>>(path, {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getSiteDay(params: { projectId: string; date?: string; shift?: string }): Promise<ApiResponse<any>> {
  const search = new URLSearchParams({ project_id: params.projectId });
  if (params.date) search.set("date", params.date);
  if (params.shift) search.set("shift", params.shift);
  return fetchApi<ApiResponse<any>>(`${SITE}/day?${search.toString()}`, { cache: "no-store", allowFallback: false });
}

export const openSiteDay = (payload: { project_id: string; briefing_date?: string; shift?: string }) => post(`${SITE}/day/open`, payload);
export const updateSiteDay = (briefingId: string, payload: Record<string, unknown>) => post(`${SITE}/day/${briefingId}`, payload, "PATCH");
export const startSiteDay = (briefingId: string) => post(`${SITE}/day/${briefingId}/start`);
export const closeSiteDay = (briefingId: string) => post(`${SITE}/day/${briefingId}/close`);
export const addSiteDayAttendance = (briefingId: string, payload: { site_worker_id?: string; employee_id?: string; ppe_ok: boolean }) =>
  post(`${SITE}/day/${briefingId}/attendance`, payload);
export const updateSiteDayAttendance = (attendanceId: string, payload: { ppe_ok?: boolean; notes?: string }) =>
  post(`${SITE}/day/attendance/${attendanceId}`, payload, "PATCH");
export const removeSiteDayAttendance = (attendanceId: string) => post(`${SITE}/day/attendance/${attendanceId}`, undefined, "DELETE");
export const clockOutSiteDayAttendance = (attendanceId: string) => post(`${SITE}/day/attendance/${attendanceId}/clock-out`);
export const registerProjectHire = (payload: Record<string, unknown>) => post(`${SITE}/day/project-hires`, payload);

export const generateDailyTargets = (budgetId: string, payload: { working_days: number[]; replace_open?: boolean; notify?: boolean }) =>
  post(`${SITE}/weekly-budgets/${budgetId}/daily-targets`, payload);
export async function getDailyTargets(params: { projectId: string; dateFrom: string; dateTo: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams({ project_id: params.projectId, date_from: params.dateFrom, date_to: params.dateTo });
  return fetchApi<ApiResponse<any[]>>(`${SITE}/daily-targets?${search.toString()}`, { cache: "no-store", allowFallback: false });
}
export const updateDailyTarget = (targetId: string, payload: { achieved_qty?: number; status?: string; notes?: string }) =>
  post(`${SITE}/daily-targets/${targetId}`, payload, "PATCH");
export const notifyDailyTargets = (payload: { project_id: string; target_date: string }) => post(`${SITE}/daily-targets/notify`, payload);

export async function getProjectHires(params?: { status?: string; projectId?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.projectId) search.set("project_id", params.projectId);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`${HIRES}${query}`, { cache: "no-store", allowFallback: false });
}
export const verifyProjectHire = (workerId: string) => post(`${HIRES}/${workerId}/verify`);
export const setProjectHireStatus = (workerId: string, payload: { status: "active" | "inactive"; reason?: string }) =>
  post(`${HIRES}/${workerId}/status`, payload);
export const updateProjectHire = (workerId: string, payload: Record<string, unknown>) => post(`${HIRES}/${workerId}`, payload, "PATCH");
export async function getProjectHireHours(status = "pending"): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`${HIRES}/hours?status=${encodeURIComponent(status)}`, { cache: "no-store", allowFallback: false });
}
export const decideProjectHireHours = (payload: { attendance_ids: string[]; decision: "accepted" | "rejected"; reason?: string }) =>
  post(`${HIRES}/hours/decision`, payload);
