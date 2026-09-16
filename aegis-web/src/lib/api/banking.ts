import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";

// --- ANALYTICS MACHINE LEARNING --- //

export async function simulateSchedule(tasks: any[], iterations = 1000): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/analytics-ml/simulate-schedule', {
    method: 'POST',
    body: JSON.stringify({ tasks, iterations }),
    allowFallback: false,
  });
}

export async function forecastMaterialRate(history: any[], forecastSteps = 3): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/analytics-ml/forecast-material-rate', {
    method: 'POST',
    body: JSON.stringify({ history, forecast_steps: forecastSteps }),
    allowFallback: false,
  });
}

// --- BANKING & PAYROLL --- //

export async function getBankAccounts(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/bank-accounts/', { cache: 'no-store', allowFallback: false });
}

export async function createBankAccount(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/bank-accounts/', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getBankTransactions(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/bank-transactions/', { cache: 'no-store', allowFallback: false });
}

export async function createBankTransaction(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/bank-transactions/', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getPayrollRuns(params?: { department_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.department_id) search.set('department_id', params.department_id);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/payroll-runs/${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getPayrollRun(runId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/payroll-runs/${runId}`, { cache: 'no-store', allowFallback: false });
}

export async function createPayrollRun(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/payroll-runs/', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function decidePayrollRun(runId: string, action: "approve" | "post" | "cancel", notes?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/payroll-runs/${runId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ action, notes }),
    allowFallback: false,
  });
}

export async function proposePayrollRunGlJournal(runId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/payroll-runs/${runId}/propose-gl`, {
    method: 'POST',
    allowFallback: false,
  });
}

export async function getPayrollItemAllocations(itemId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/payroll-runs/items/${itemId}/allocations`, { cache: 'no-store', allowFallback: false });
}

export async function putPayrollItemAllocations(
  itemId: string,
  allocations: Array<{ project_id?: string | null; department_id?: string | null; allocation_pct: number }>,
): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/payroll-runs/items/${itemId}/allocations`, {
    method: 'PUT',
    body: JSON.stringify({ allocations }),
    allowFallback: false,
  });
}

