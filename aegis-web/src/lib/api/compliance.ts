import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";

// --- COMPLIANCE --- //

export async function getComplianceObligations(params?: { authority?: string; status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.authority && params.authority !== 'all') search.set('authority', params.authority);
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/compliance-items/obligations${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function createComplianceObligation(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/compliance-items/obligations', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getComplianceEmployeeCredentials(params?: { status?: string; days_until_expiry?: number }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.days_until_expiry) search.set('days_until_expiry', String(params.days_until_expiry));
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/compliance-items/employee-credentials${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function getComplianceEquipmentCredentials(params?: { status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/compliance-items/equipment-credentials${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function createComplianceEquipmentCredential(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/compliance-items/equipment-credentials', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getComplianceCorrectiveActions(params?: { status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/compliance-items/corrective-actions${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function createComplianceCorrectiveAction(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/compliance-items/corrective-actions', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getComplianceScore(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/compliance-items/score', { cache: 'no-store', allowFallback: false });
}

export async function getComplianceDeploymentRequirements(params?: { scope?: string; active?: boolean }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.scope && params.scope !== 'all') search.set('scope', params.scope);
  if (typeof params?.active === 'boolean') search.set('active', String(params.active));
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/compliance-items/deployment-requirements${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function createComplianceDeploymentRequirement(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/compliance-items/deployment-requirements', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function updateComplianceDeploymentRequirement(id: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/compliance-items/deployment-requirements/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function archiveComplianceDeploymentRequirement(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/compliance-items/deployment-requirements/${id}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

export async function getComplianceDeploymentGateChecks(params?: { status?: string; employee_id?: string; project_id?: string; limit?: number }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  if (params?.employee_id) search.set('employee_id', params.employee_id);
  if (params?.project_id) search.set('project_id', params.project_id);
  if (params?.limit) search.set('limit', String(params.limit));
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/compliance-items/deployment-gate-checks${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function overrideComplianceDeploymentGateCheck(id: string, payload: { reason: string; override_reference?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/compliance-items/deployment-gate-checks/${id}/override`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

