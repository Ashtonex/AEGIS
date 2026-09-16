import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";

// ----------------------------------------------------------------------------
// SNC Financial Data Room & Bankability Engine
// ----------------------------------------------------------------------------

export async function getDataRoomTree(): Promise<ApiResponse<{
  folders: any[];
  standard_sections: any[];
  readiness: { score_pct: number; verified_items: number; total_items: number; in_progress_items: number };
}>> {
  return fetchApi('/api/v1/finance/data-room/tree', { cache: 'no-store', allowFallback: false });
}

export async function getDataRoomDocuments(params?: {
  folder_path?: string;
  section_code?: string;
  audit_code?: string;
  project_id?: string;
  search?: string;
  verification_status?: string;
}): Promise<ApiResponse<any[]>> {
  const query = new URLSearchParams();
  if (params?.folder_path) query.set('folder_path', params.folder_path);
  if (params?.section_code) query.set('section_code', params.section_code);
  if (params?.audit_code) query.set('audit_code', params.audit_code);
  if (params?.project_id) query.set('project_id', params.project_id);
  if (params?.search) query.set('search', params.search);
  if (params?.verification_status) query.set('verification_status', params.verification_status);

  const qs = query.toString();
  return fetchApi(`/api/v1/finance/data-room/documents${qs ? `?${qs}` : ''}`, { cache: 'no-store', allowFallback: false });
}

export async function classifyDataRoomUpload(payload: {
  title: string;
  file_name?: string;
  project_id?: string;
  document_date?: string;
}): Promise<ApiResponse<{
  suggested_folder_path: string;
  section_code: string;
  project_id: string | null;
  project_name: string | null;
  project_code: string | null;
  fiscal_year: number;
  audit_code: string | null;
  audit_subitem: string | null;
  category: string;
}>> {
  return fetchApi('/api/v1/finance/data-room/classify', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function issueDataRoomUploadPath(payload: {
  file_name: string;
}): Promise<ApiResponse<{ storage_path: string }>> {
  return fetchApi('/api/v1/finance/data-room/upload-path', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function uploadDataRoomDocument(payload: Record<string, unknown>): Promise<ApiResponse<{ id: string; folder_path: string }>> {
  return fetchApi('/api/v1/finance/data-room/upload', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function createDataRoomFolder(payload: {
  folder_name: string;
  parent_path?: string;
  section_code?: string;
  project_id?: string;
}): Promise<ApiResponse<{ folder_path: string }>> {
  return fetchApi('/api/v1/finance/data-room/create-folder', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getDataRoomDocumentSignedUrl(id: string): Promise<ApiResponse<{
  url: string;
  file_name: string;
  mime_type: string;
  expires_in: number;
}>> {
  return fetchApi(`/api/v1/finance/data-room/documents/${id}/signed-url`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function updateDataRoomDocumentStatus(id: string, payload: {
  verification_status: string;
  audit_notes?: string;
}): Promise<ApiResponse<any>> {
  return fetchApi(`/api/v1/finance/data-room/documents/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function deleteDataRoomDocument(id: string): Promise<ApiResponse<any>> {
  return fetchApi(`/api/v1/finance/data-room/documents/${id}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

export async function getBankabilityMatrix(): Promise<ApiResponse<{
  categories: any[];
  overall_readiness_pct: number;
  total_items: number;
  verified_items: number;
}>> {
  return fetchApi('/api/v1/finance/data-room/bankability-matrix', { cache: 'no-store', allowFallback: false });
}

export async function verifyBankabilityItem(id: string, payload: {
  status: string;
  notes?: string;
}): Promise<ApiResponse<any>> {
  return fetchApi(`/api/v1/finance/data-room/bankability-matrix/${id}/verify`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export function getDataRoomExportUrl(folderPath?: string, projectId?: string): string {
  const query = new URLSearchParams();
  if (folderPath) query.set('folder_path', folderPath);
  if (projectId) query.set('project_id', projectId);
  const qs = query.toString();
  return `/api/v1/finance/data-room/export${qs ? `?${qs}` : ''}`;
}

export async function getDataRoomSharePointStatus(): Promise<ApiResponse<{
  connected: boolean;
  sync_enabled: boolean;
  root_web_url: string | null;
  last_synced_at: string | null;
}>> {
  return fetchApi('/api/v1/finance/data-room/sharepoint-status', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function syncDataRoomFromSharePoint(): Promise<ApiResponse<{
  folders_created: number;
  documents_imported: number;
}>> {
  return fetchApi('/api/v1/finance/data-room/sync-from-sharepoint', {
    method: 'POST',
    allowFallback: false,
  });
}

/** SharePoint-backed counterpart to uploadDataRoomDocument: pushes the file
 * straight to the org's connected SharePoint site instead of Supabase
 * Storage. Only call this when getDataRoomSharePointStatus() reports
 * connected && sync_enabled. */
export async function uploadDataRoomDocumentToSharePoint(params: {
  file: File;
  title: string;
  folder_path?: string;
  project_id?: string;
  fiscal_year?: number;
  document_date?: string;
  amount?: number;
}): Promise<ApiResponse<{ id: string; folder_path: string; provider: string; web_url: string }>> {
  const formData = new FormData();
  formData.append('file', params.file);
  formData.append('title', params.title);
  if (params.folder_path) formData.append('folder_path', params.folder_path);
  if (params.project_id) formData.append('project_id', params.project_id);
  if (params.fiscal_year != null) formData.append('fiscal_year', String(params.fiscal_year));
  if (params.document_date) formData.append('document_date', params.document_date);
  if (params.amount != null) formData.append('amount', String(params.amount));

  const url = resolveApiUrl('/api/v1/finance/data-room/upload-to-sharepoint');
  const headers = await getApiHeaders();
  headers.delete('Content-Type'); // let the browser set the multipart boundary
  const response = await fetch(url, { method: 'POST', headers, body: formData });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body?.detail || body?.message || 'SharePoint upload failed.');
  return body;
}
