import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";

// --- DOCUMENT MANAGEMENT --- //

export async function getDocuments(params?: { category?: string; status?: string; classification?: string; search?: string; project_id?: string; tender_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.category && params.category !== 'all') search.set('category', params.category);
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  if (params?.classification && params.classification !== 'all') search.set('classification', params.classification);
  if (params?.search) search.set('search', params.search);
  if (params?.project_id) search.set('project_id', params.project_id);
  if (params?.tender_id) search.set('tender_id', params.tender_id);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/documents/${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function getDocument(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/documents/${id}`, { cache: 'no-store', allowFallback: false });
}

export async function createDocument(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/documents/', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getDocumentSignedUrl(id: string): Promise<ApiResponse<{ url: string; file_name: string | null; mime_type: string | null; expires_in: number }>> {
  return fetchApi<ApiResponse<{ url: string; file_name: string | null; mime_type: string | null; expires_in: number }>>(`/api/v1/documents/${id}/signed-url`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function updateDocumentStatus(id: string, status: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/documents/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
    allowFallback: false,
  });
}

export async function getDocumentVersions(id: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/documents/${id}/versions`, { cache: 'no-store', allowFallback: false });
}

export async function getDocumentLinks(id: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/documents/${id}/links`, { cache: 'no-store', allowFallback: false });
}

export async function linkDocument(id: string, payload: { entity_type: string; entity_id: string; link_role?: string; project_id?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/documents/${id}/links`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Every document attached to one lead/opportunity/tender/project/fleet/machinery record, regardless of uploader. */
export async function getDocumentsForEntity(entityType: string, entityId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/documents/for-entity?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function deleteDocument(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/documents/${id}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

