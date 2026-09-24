import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";

// --- HR & WORKFORCE --- //

export async function getHREmployees(params?: { status?: string; department?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  if (params?.department) search.set('department', params.department);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/workforce/${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function getHREmployee(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/workforce/${id}`, { cache: 'no-store', allowFallback: false });
}

export async function getHREmployeeSkills(employeeId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/workforce/${employeeId}/skills`, { cache: 'no-store', allowFallback: false });
}

export async function getHREmployeeCertifications(employeeId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/workforce/${employeeId}/certifications`, { cache: 'no-store', allowFallback: false });
}

export async function getHRAttendance(params?: { date?: string; project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.date) search.set('date', params.date);
  if (params?.project_id) search.set('project_id', params.project_id);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/workforce/attendance${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function getWorkforceAllocations(params?: { project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.project_id) search.set('project_id', params.project_id);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/workforce/allocations${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function createWorkforceAllocation(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/workforce/allocations', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export type ProjectTeamMember = {
  allocation_id: string; employee_id: string; role_on_project?: string; allocation_percent?: number | string;
  starts_on?: string; ends_on?: string; status?: string; notes?: string; created_at?: string;
  employee_name?: string; employee_number?: string; job_title?: string; employment_type?: string; employment_status?: string;
  category_name?: string; payroll_eligible?: boolean;
  position_name?: string; trade?: string; grade?: string;
  assigned_by_email?: string; is_current?: boolean;
};

export async function getProjectTeam(projectRef: string): Promise<ApiResponse<ProjectTeamMember[]>> {
  return fetchApi<ApiResponse<ProjectTeamMember[]>>(`/api/v1/projects/${projectRef}/team`, { cache: 'no-store', allowFallback: false });
}

export type WorkforceTimeRecord = {
  id: string; employee_id: string; employee_name?: string; project_id?: string;
  project_name?: string; work_date: string; regular_hours: number | string;
  overtime_hours: number | string; description?: string; status: string;
  created_by?: string; approved_by?: string; approved_at?: string;
};

export async function getWorkforceTimesheets(date: string): Promise<ApiResponse<WorkforceTimeRecord[]>> {
  return fetchApi(`/api/v1/workforce/timesheets?date_from=${encodeURIComponent(date)}&date_to=${encodeURIComponent(date)}`, { cache: 'no-store', allowFallback: false });
}

export async function createWorkforceTimesheet(payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi('/api/v1/workforce/timesheets', { method: 'POST', body: JSON.stringify(payload), allowFallback: false });
}

export async function transitionWorkforceTimesheet(id: string, decision: 'submit' | 'approved' | 'rejected'): Promise<ApiResponse<{ id: string }>> {
  return fetchApi(`/api/v1/workforce/timesheets/${encodeURIComponent(id)}/${decision === 'submit' ? 'submit' : 'decision'}`, {
    method: 'POST', ...(decision === 'submit' ? {} : { body: JSON.stringify({ status: decision }) }), allowFallback: false,
  });
}

export async function recordHRAttendance(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/workforce/attendance', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getHRLeaveRequests(params?: { status?: string; employee_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  if (params?.employee_id) search.set('employee_id', params.employee_id);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/hr-records/leave${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function createHRLeaveRequest(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/hr-records/leave', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function approveHRLeaveRequest(id: string, decision: 'approved' | 'rejected', reason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/hr-records/leave/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
    allowFallback: false,
  });
}

export async function getMyHREmployeeRecord(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/hr-records/me', { cache: 'no-store', allowFallback: false });
}

export async function getMyHRLeaveRequests(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/hr-records/me/leave', { cache: 'no-store', allowFallback: false });
}

export async function getMyHRLeaveBalance(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/hr-records/me/leave-balance', { cache: 'no-store', allowFallback: false });
}

export async function createMyHRLeaveRequest(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/hr-records/me/leave', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getHROperationsSummary(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/hr/operations/summary', { cache: 'no-store', allowFallback: false });
}

export async function getRecruitmentAssessments(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/hr/operations/assessments', { cache: 'no-store', allowFallback: false });
}

/** Upload a Microsoft Forms "Open in Excel" export for scoring. */
export async function importRecruitmentAssessments(params: { file: File; assessment_code: string }): Promise<ApiResponse<any>> {
  const formData = new FormData();
  formData.append('file', params.file);
  formData.append('assessment_code', params.assessment_code);

  const url = resolveApiUrl('/api/v1/hr/operations/assessments/import');
  const headers = await getApiHeaders();
  headers.delete('Content-Type'); // let the browser set the multipart boundary
  const response = await fetch(url, { method: 'POST', headers, body: formData });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body?.detail || body?.message || 'Assessment import failed.');
  return body;
}

export async function getHRLeaveCalendar(params?: { date_from?: string; date_to?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/hr/operations/leave-calendar${qs}`, { cache: 'no-store', allowFallback: false });
}

