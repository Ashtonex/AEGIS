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
// leftSiteAt (ISO) is required by the server when the day is closed on a
// later calendar day than the shift ran, so overnight hours aren't booked.
export const closeSiteDay = (briefingId: string, leftSiteAt?: string) =>
  post(`${SITE}/day/${briefingId}/close`, leftSiteAt ? { left_site_at: leftSiteAt } : undefined);
export const addSiteDayAttendance = (briefingId: string, payload: { site_worker_id?: string; employee_id?: string; ppe_ok: boolean }) =>
  post(`${SITE}/day/${briefingId}/attendance`, payload);
export const addSiteDayAttendanceBatch = (briefingId: string, payload: { items: Array<{ site_worker_id?: string; employee_id?: string; ppe_ok: boolean }> }) =>
  post(`${SITE}/day/${briefingId}/attendance/batch`, payload);
export const updateSiteDayAttendance = (attendanceId: string, payload: { ppe_ok?: boolean; notes?: string }) =>
  post(`${SITE}/day/attendance/${attendanceId}`, payload, "PATCH");
export const removeSiteDayAttendance = (attendanceId: string) => post(`${SITE}/day/attendance/${attendanceId}`, undefined, "DELETE");
export const clockOutSiteDayAttendance = (attendanceId: string, leftSiteAt?: string) =>
  post(`${SITE}/day/attendance/${attendanceId}/clock-out`, leftSiteAt ? { left_site_at: leftSiteAt } : undefined);
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
export const getOrCreateDailyReport = (briefingId: string) =>
  post<{ daily_report_id: string; report_id: string }>(`${SITE}/day/${briefingId}/daily-report`);


// Day close (migration 298): the day's material and plant usage must be on
// the daily report before the day closes. Saturday: count the site stores
// and confirm the week's material usage.
export async function getDayUsageReconciliation(briefingId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${SITE}/day/${briefingId}/usage-reconciliation`, { cache: "no-store", allowFallback: false });
}
export const reconcileDayUsage = (
  briefingId: string,
  payload: {
    materials: Array<{ item_id: string; store_id?: string | null; quantity_used: number; wastage_quantity?: number; unit_cost?: number | null; consumes_stock: boolean; work_package?: string | null; notes?: string | null }>;
    no_materials_used: boolean;
    plant: Array<{ fleet_id: string; operator_employee_id?: string | null; operating_hours: number; idle_hours?: number; fuel_litres?: number; notes?: string | null }>;
    no_plant_used: boolean;
  },
) => post(`${SITE}/day/${briefingId}/usage-reconciliation`, payload);

export async function getWeeklyReconciliation(projectId: string, weekEnding?: string): Promise<ApiResponse<any>> {
  const search = new URLSearchParams({ project_id: projectId });
  if (weekEnding) search.set("week_ending", weekEnding);
  return fetchApi<ApiResponse<any>>(`${SITE}/weekly-reconciliation?${search.toString()}`, { cache: "no-store", allowFallback: false });
}
export const confirmWeeklyMaterialUsage = (payload: {
  project_id: string; week_ending: string; notes?: string | null;
  lines: Array<{ item_id: string; store_id: string; unrecorded_usage_qty: number; notes?: string | null }>;
}) => post(`${SITE}/weekly-reconciliation/materials`, payload);
export const completeWeeklyStoresCount = (payload: {
  project_id: string; week_ending: string; notes?: string | null;
  lines: Array<{ item_id: string; store_id: string; counted_qty: number; notes?: string | null }>;
}) => post(`${SITE}/weekly-reconciliation/stores`, payload);

// Variations logged from site land in the project's variation register.
export async function getSiteVariations(projectId: string): Promise<ApiResponse<any[]> & { totals?: any }> {
  return fetchApi<ApiResponse<any[]> & { totals?: any }>(`${SITE}/variations?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store", allowFallback: false });
}
export const logSiteVariation = (payload: Record<string, unknown>) => post(`${SITE}/variations`, payload);

// Labour hours set by hand stay over register syncs.
export const setDailyReportLabourHours = (reportId: string, payload: { regular_hours: number; overtime_hours: number; line_ids?: string[] }) =>
  post(`${SITE}/daily-reports/${reportId}/labour/set-hours`, payload);
export const resetDailyReportLabourHours = (reportId: string) => post(`${SITE}/daily-reports/${reportId}/labour/reset-hours`);

export const requestSiteMaterialsBatch = (payload: Record<string, unknown>) => post(`${SITE}/material-requests/batch`, payload);
