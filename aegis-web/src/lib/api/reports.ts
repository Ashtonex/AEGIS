import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";

// --- REPORTS --- //

export async function getAvailableReports(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/automated-reports/available', { cache: 'no-store', allowFallback: false });
}

export async function getScheduledReports(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/automated-reports/scheduled', { cache: 'no-store', allowFallback: false });
}

export async function getRecentReports(params?: { limit?: number }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.limit) search.set('limit', String(params.limit));
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/automated-reports/recent${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function generateReport(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/automated-reports/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function approveReport(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/automated-reports/${id}/approve`, {
    method: 'POST',
    allowFallback: false,
  });
}

// --- ANALYTICS --- //

export async function getAnalyticsExceptions(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/executive/exceptions', { cache: 'no-store', allowFallback: false });
}

export async function getAnalyticsProjectPerformance(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/bi-reports/projects', { cache: 'no-store', allowFallback: false });
}

export async function getAnalyticsEquipmentIntelligence(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/bi-reports/equipment', { cache: 'no-store', allowFallback: false });
}

export async function getAnalyticsProcurement(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/bi-reports/procurement', { cache: 'no-store', allowFallback: false });
}

export async function getAnalyticsWorkforce(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/bi-reports/workforce', { cache: 'no-store', allowFallback: false });
}

