import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";

// --- PROCUREMENT CONTROL TOWER --- //

export async function getProcurementRequisitions(params?: { status?: string; project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== "all") search.set("status", params.status);
  if (params?.project_id) search.set("project_id", params.project_id);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/procurement/requisitions${query}`, { cache: "no-store", allowFallback: false });
}

export async function getMaterialRequests(params?: { is_price_confirmed?: boolean; project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.is_price_confirmed !== undefined) search.set("is_price_confirmed", String(params.is_price_confirmed));
  if (params?.project_id) search.set("project_id", params.project_id);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/procurement/material-requests${query}`, { cache: "no-store", allowFallback: false });
}

export async function confirmMaterialRequestPrice(id: string, unitCost: number): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/material-requests/${id}/price`, {
    method: "PATCH",
    body: JSON.stringify({ unit_cost: unitCost }),
    allowFallback: false,
  });
}

export async function createProcurementRequisition(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/procurement/requisitions", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function submitProcurementRequisition(id: string, overrideReason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/requisitions/${id}/submit`, {
    method: "POST",
    body: JSON.stringify({ override_reason: overrideReason }),
    allowFallback: false,
  });
}

export async function approveProcurementRequisition(id: string, decision: "approved" | "rejected", reason?: string, overrideReason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/requisitions/${id}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, reason, override_reason: overrideReason }),
    allowFallback: false,
  });
}

export async function getProcurementRfqs(params?: { status?: string; project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== "all") search.set("status", params.status);
  if (params?.project_id) search.set("project_id", params.project_id);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/procurement/rfqs${query}`, { cache: "no-store", allowFallback: false });
}

export async function createProcurementRfq(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/procurement/rfqs", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function recordProcurementRfqResponse(rfqId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/rfqs/${rfqId}/responses`, {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function decideProcurementRfqResponse(rfqId: string, responseId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/rfqs/${rfqId}/responses/${responseId}/decision`, {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function createPurchaseOrderFromRfq(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/procurement/purchase-orders/from-rfq", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function createPurchaseOrderFromRequisition(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/procurement/purchase-orders", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getProcurementOrders(params?: { status?: string; supplier_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== "all") search.set("status", params.status);
  if (params?.supplier_id) search.set("supplier_id", params.supplier_id);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/procurement/purchase-orders${query}`, { cache: "no-store", allowFallback: false });
}

export async function issuePurchaseOrder(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/purchase-orders/${id}/issue`, {
    method: "POST",
    body: JSON.stringify({}),
    allowFallback: false,
  });
}

export async function approvePurchaseOrder(id: string, decision: "approved" | "rejected", reason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/purchase-orders/${id}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, reason }),
    allowFallback: false,
  });
}

export async function recordGoodsReceived(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/procurement/goods-received", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function createSupplierRecord(payload: Record<string, unknown>): Promise<ApiResponse<{ id: string; temporary_password?: string }>> {
  return fetchApi<ApiResponse<{ id: string; temporary_password?: string }>>("/api/v1/supplier-records/", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function updateSupplierRecord(id: string, payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`/api/v1/supplier-records/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function issueSupplierPortalLogin(id: string): Promise<ApiResponse<{ id: string; email: string; temporary_password: string; portal_path: string }>> {
  return fetchApi<ApiResponse<{ id: string; email: string; temporary_password: string; portal_path: string }>>(`/api/v1/supplier-records/${encodeURIComponent(id)}/portal-login`, {
    method: "POST",
    allowFallback: false,
  });
}

export async function getSupplierComplianceDocuments(id: string): Promise<ApiResponse<VendorDocument[]>> {
  return fetchApi<ApiResponse<VendorDocument[]>>(`/api/v1/supplier-records/${encodeURIComponent(id)}/documents`, {
    cache: "no-store",
    allowFallback: false,
  });
}

export async function recordSupplierComplianceDocument(id: string, payload: {
  document_id: string;
  document_type: SupplierComplianceDocumentType;
}): Promise<ApiResponse<VendorDocument[]>> {
  return fetchApi<ApiResponse<VendorDocument[]>>(`/api/v1/supplier-records/${encodeURIComponent(id)}/documents`, {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getSupplierComplianceDocumentSignedUrl(
  supplierId: string,
  documentId: string
): Promise<ApiResponse<{ url: string; file_name: string | null; mime_type: string | null; expires_in: number }>> {
  return fetchApi<ApiResponse<{ url: string; file_name: string | null; mime_type: string | null; expires_in: number }>>(`/api/v1/supplier-records/${encodeURIComponent(supplierId)}/documents/${encodeURIComponent(documentId)}/signed-url`, {
    cache: "no-store",
    allowFallback: false,
  });
}

export async function decideSupplierComplianceDocument(
  supplierId: string,
  documentId: string,
  payload: { status: SupplierComplianceDocumentStatus; review_notes?: string }
): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/supplier-records/${encodeURIComponent(supplierId)}/documents/${encodeURIComponent(documentId)}/decision`, {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getProcurementSuppliers(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>("/api/v1/procurement/suppliers", { cache: "no-store", allowFallback: false });
}

/** A supplier's product catalog, derived from every stock receipt ever tagged with them. */
export async function getSupplierCatalogue(supplierId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/procurement/suppliers/${encodeURIComponent(supplierId)}/catalogue`, { cache: "no-store", allowFallback: false });
}

export async function getProcurementInvoices(params?: { status?: string; match_status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== "all") search.set("status", params.status);
  if (params?.match_status && params.match_status !== "all") search.set("match_status", params.match_status);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/procurement/invoices${query}`, { cache: "no-store", allowFallback: false });
}

export async function registerSupplierInvoice(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/procurement/invoices", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function matchSupplierInvoice(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/invoices/${id}/match`, {
    method: "POST",
    allowFallback: false,
  });
}

export async function linkProcurementDocument(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/documents/link`, {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function decideSupplierInvoicePayment(id: string, decision: "approved" | "rejected", reason?: string, approvalDocumentId?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/invoices/${id}/payment-decision`, {
    method: "POST",
    body: JSON.stringify({ decision, reason, approval_document_id: approvalDocumentId }),
    allowFallback: false,
  });
}

export async function getExecutiveStats(accessToken?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/executive/stats`, {
    cache: 'no-store',
    headers: bearerHeaders(accessToken),
    timeoutMs: EXECUTIVE_READ_TIMEOUT_MS,
    allowFallback: false
  });
}

export async function getExecutiveRegions(accessToken?: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/executive/regions`, { cache: 'no-store', headers: bearerHeaders(accessToken), timeoutMs: EXECUTIVE_READ_TIMEOUT_MS, allowFallback: false });
}

export async function getActiveExecutiveProjects(accessToken?: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/executive/projects/active`, { cache: 'no-store', headers: bearerHeaders(accessToken), timeoutMs: EXECUTIVE_READ_TIMEOUT_MS, allowFallback: false });
}

export async function getExecutiveProjectDetail(projectId: string, accessToken?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/executive/projects/${encodeURIComponent(projectId)}/detail`, { cache: 'no-store', headers: bearerHeaders(accessToken), timeoutMs: EXECUTIVE_READ_TIMEOUT_MS, allowFallback: false });
}

/** Monte Carlo schedule-risk simulation for a single project. Fetched lazily
 * (only when the project detail modal opens), never for a whole list. */
export async function getProjectScheduleRisk(projectId: string, accessToken?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/executive/projects/${encodeURIComponent(projectId)}/schedule-risk`, { cache: 'no-store', headers: bearerHeaders(accessToken), timeoutMs: EXECUTIVE_READ_TIMEOUT_MS, allowFallback: false });
}

export async function getMaterialsForecastAlerts(accessToken?: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/executive/materials/forecast-alerts`, { cache: 'no-store', headers: bearerHeaders(accessToken), timeoutMs: EXECUTIVE_READ_TIMEOUT_MS, allowFallback: false });
}

/** Internal project register. Operational screens must not fall back to website demo data. */
export async function getInternalProjects(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/projects/`, { cache: 'no-store', allowFallback: false });
}

/** Create an internal project. Used for Field Intake projects started from the Stores page. */
export async function createInternalProject(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Update fields on an internal project (e.g. department assignment). */
export async function updateInternalProject(projectId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/**
 * Deletes a project. If it has any real linked activity anywhere in the
 * system (finance, procurement, HR, compliance, etc.) the backend refuses
 * the wipe and archives it instead - check `data.wiped` to tell which
 * happened, and `data.blocked_by` for what's still linked.
 */
export async function deleteInternalProject(projectId: string): Promise<ApiResponse<{ wiped: boolean; archived: boolean; blocked_by: { table: string; count: number }[] }>> {
  return fetchApi<ApiResponse<{ wiped: boolean; archived: boolean; blocked_by: { table: string; count: number }[] }>>(`/api/v1/projects/${projectId}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

/** Saves whichever production-project intake questions have been answered so far (category, investment, funding, setup duration). Callable repeatedly before commit. */
export async function updateProjectIntake(projectId: string, payload: { project_category?: string; investment_required?: number; funding_internal?: number; funding_external?: number; setup_duration_weeks?: number }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}/intake`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Finalizes a company-initiated project's intake and generates its task stack. */
export async function commitProjectIntake(projectId: string): Promise<ApiResponse<{ tasks_created: number }>> {
  return fetchApi<ApiResponse<{ tasks_created: number }>>(`/api/v1/projects/${projectId}/commit-intake`, {
    method: 'POST',
    allowFallback: false,
  });
}

/** Real schedule milestones, changes, and risks for a project - no fabricated data. */
export async function getProjectLifecycle(projectId: string): Promise<ApiResponse<{ project: Record<string, unknown>; milestones: Record<string, unknown>[]; changes: Record<string, unknown>[]; risks: Record<string, unknown>[]; pre_mobilisation?: Record<string, unknown>; commercial_readiness?: Record<string, unknown> }>> {
  return fetchApi<ApiResponse<{ project: Record<string, unknown>; milestones: Record<string, unknown>[]; changes: Record<string, unknown>[]; risks: Record<string, unknown>[]; pre_mobilisation?: Record<string, unknown>; commercial_readiness?: Record<string, unknown> }>>(`/api/v1/projects/${projectId}/lifecycle`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Adds a real schedule milestone to a project (real owner_id, not a placeholder name). */
export async function addProjectMilestone(projectId: string, payload: { name: string; status?: string; baseline_date?: string; forecast_date?: string; actual_date?: string; weight?: number; owner_id?: string; notes?: string }): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`/api/v1/projects/${projectId}/milestones`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Progresses an existing milestone (status, actual date, owner, etc). */
export async function updateProjectMilestone(projectId: string, milestoneId: string, payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`/api/v1/projects/${projectId}/milestones/${milestoneId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Lists setup-phase (and ongoing) expenses recorded against a company-initiated project. */
export async function getProductionExpenses(projectId: string): Promise<ApiResponse<{ items: Record<string, unknown>[]; total: number }>> {
  return fetchApi<ApiResponse<{ items: Record<string, unknown>[]; total: number }>>(`/api/v1/projects/${projectId}/production-expenses`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Records a setup-phase expense against a company-initiated project - posts into real Finance cost/cashbook ledgers. */
export async function addProductionExpense(projectId: string, payload: { cost_category: string; description: string; amount: number; transaction_date?: string; paid?: boolean }): Promise<ApiResponse<{ id: string; cashbook_transaction_id: string | null }>> {
  return fetchApi<ApiResponse<{ id: string; cashbook_transaction_id: string | null }>>(`/api/v1/projects/${projectId}/production-expenses`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Lists production revenue recorded against an active company-initiated project. */
export async function getProductionRevenue(projectId: string): Promise<ApiResponse<{ items: Record<string, unknown>[]; total: number }>> {
  return fetchApi<ApiResponse<{ items: Record<string, unknown>[]; total: number }>>(`/api/v1/projects/${projectId}/production-revenue`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Records revenue from what an active company-initiated project sells - posts straight into the cashbook (no client/contract behind it). */
export async function addProductionRevenue(projectId: string, payload: { amount: number; description?: string; transaction_date?: string }): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`/api/v1/projects/${projectId}/production-revenue`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Finance sign-off that a project's deposit has been received - opens the pre-mobilisation readiness gate. */
export async function confirmProjectDeposit(projectId: string, payload: { deposit_received_amount: number; deposit_reference?: string; notes?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}/confirm-deposit`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Updates one pre-mobilisation readiness gate item with its status/evidence. */
export async function updateProjectPreMobilisationCheck(projectId: string, checkId: string, payload: { status: string; evidence_reference?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}/pre-mobilisation/${checkId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Retrieves the Commercial pre-mobilisation readiness pack. */
export async function getProjectCommercialReadiness(projectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}/commercial-readiness`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Updates the Commercial readiness controls and authority status. */
export async function updateProjectCommercialReadiness(projectId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}/commercial-readiness`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Commercial clearance required before mobilisation can be authorised. */
export async function clearProjectCommercialReadiness(projectId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}/commercial-readiness/clear`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Executive approval that releases a project from pre-mobilisation into active delivery. */
export async function approveProjectPreMobilisation(projectId: string, payload: { mobilisation_date: string; mobilisation_budget?: number; conditions?: string; residual_risk_notes?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}/pre-mobilisation/approve`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Submit a Field Intake project for Finance sign-off, proposing its formal fields. */
export async function submitProjectRegistration(projectId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}/submit-registration`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Finance approves/rejects a pending Field Intake registration submission. */
export async function decideProjectRegistration(projectId: string, decision: 'approved' | 'rejected', reason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}/registration-decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
    allowFallback: false,
  });
}

export type ProjectBudgetUploadLine = {
  cost_code: string;
  description: string;
  cost_category?: 'labour' | 'equipment' | 'materials' | 'subcontract' | 'overhead' | 'other';
  quantity?: number;
  unit?: string;
  unit_rate?: number;
  amount: number;
  source_line?: number;
};

/** Save a protected master baseline or a separate execution-budget review draft. */
export async function setProjectBudget(
  projectId: string,
  totalAmount: number,
  notes?: string,
  options?: { budgetStage?: 'master' | 'execution'; lines?: ProjectBudgetUploadLine[] },
): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}/budget`, {
    method: 'POST',
    body: JSON.stringify({
      total_amount: totalAmount,
      notes,
      budget_stage: options?.budgetStage ?? 'master',
      lines: options?.lines ?? [],
    }),
    allowFallback: false,
  });
}

export async function getExecutiveDataHealth(accessToken?: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/executive/data-health`, { cache: 'no-store', headers: bearerHeaders(accessToken), timeoutMs: EXECUTIVE_READ_TIMEOUT_MS, allowFallback: false });
}

export async function getExecutiveExceptions(accessToken?: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/executive/exceptions`, { cache: 'no-store', headers: bearerHeaders(accessToken), timeoutMs: EXECUTIVE_READ_TIMEOUT_MS, allowFallback: false });
}

export type PortalAccessKey = "foreman" | "site-engineer" | "client" | "executive" | "employee" | "site-agent" | "qs" | "supplier";

export async function getPortalAccess(portal: PortalAccessKey, accessToken?: string): Promise<ApiResponse<{ portal: string; destination: string }>> {
  return fetchApi<ApiResponse<{ portal: string; destination: string }>>(`/api/v1/portals/access/${portal}`, {
    cache: 'no-store',
    allowFallback: false,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
}

export async function resolvePortalAccess(accessToken?: string): Promise<ApiResponse<{ portal: string; destination: string }>> {
  return fetchApi<ApiResponse<{ portal: string; destination: string }>>(`/api/v1/portals/resolve-access`, {
    cache: 'no-store',
    allowFallback: false,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
}

export async function completePasswordSetup(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/portals/password-setup/complete`, {
    method: 'POST',
    allowFallback: false,
  });
}

export async function getPwaConfig(): Promise<ApiResponse<{ push_enabled: boolean; vapid_public_key: string | null; app_name: string }>> {
  return fetchApi<ApiResponse<{ push_enabled: boolean; vapid_public_key: string | null; app_name: string }>>('/api/v1/pwa/config', { cache: 'no-store', allowFallback: false });
}

export async function savePushSubscription(subscription: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/pwa/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ subscription }),
    allowFallback: false,
  });
}

export async function deletePushSubscription(endpoint: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/pwa/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
    allowFallback: false,
  });
}

export async function sendPushTestNotification(payload: { title?: string; message?: string; action_url?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/pwa/subscriptions/test', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export interface ClientPortalTicket {
  id: string;
  issue_description: string;
  created_at: string;
  updated_at?: string;
  contact_name?: string;
  email?: string;
  company_name?: string;
}

export interface PortalCommunicationMessage {
  id: string;
  channel: string;
  direction: "inbound" | "outbound" | "internal";
  subject?: string;
  body?: string;
  status?: string;
  started_at?: string;
  created_at?: string;
  actor_name?: string;
  actor_email?: string;
  recipient_name?: string;
  recipient_email?: string;
  contact_name?: string;
  email?: string;
  company_name?: string;
}

export interface ClientPortalWorkspace {
  client: {
    contact_id: string;
    contact_name: string;
    email?: string;
    phone?: string;
    job_title?: string;
    whatsapp_preference?: boolean;
    company_name?: string;
    company_email?: string;
    company_phone?: string;
    company_address?: string;
  };
  tickets: ClientPortalTicket[];
  messages?: PortalCommunicationMessage[];
  documents?: Array<{ id: string; title: string; category: string; file_name?: string; file_size_bytes?: number; created_at: string }>;
  modules: Array<{ key: string; label: string; status: "active" | "pending" }>;
}

export async function getClientPortalWorkspace(): Promise<ApiResponse<ClientPortalWorkspace>> {
  return fetchApi<ApiResponse<ClientPortalWorkspace>>(`/api/v1/portals/client/workspace`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function updateClientPortalProfile(payload: Partial<ClientPortalWorkspace["client"]>): Promise<ApiResponse<{ contact_id: string }>> {
  return fetchApi<ApiResponse<{ contact_id: string }>>(`/api/v1/portals/client/profile`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function createClientPortalTicket(issue_description: string): Promise<ApiResponse<ClientPortalTicket>> {
  return fetchApi<ApiResponse<ClientPortalTicket>>(`/api/v1/portals/client/tickets`, {
    method: "POST",
    body: JSON.stringify({ issue_description }),
    allowFallback: false,
  });
}

export async function createClientPortalMessage(payload: { subject?: string; body: string }): Promise<ApiResponse<PortalCommunicationMessage>> {
  return fetchApi<ApiResponse<PortalCommunicationMessage>>(`/api/v1/portals/client/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getClientPortalTickets(): Promise<ApiResponse<ClientPortalTicket[]>> {
  return fetchApi<ApiResponse<ClientPortalTicket[]>>(`/api/v1/client-portal-tickets/`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

// ---------------------------------------------------------------------------
// Supplier / Subcontractor portal
// ---------------------------------------------------------------------------

export type VendorVerificationStage = "incomplete" | "system_pending" | "system_verified" | "hr_verified" | "rejected";
export type VendorRateType = "material" | "transport" | "service";

export interface SupplierPortalVendor {
  subcontractor_id: string;
  name: string;
  registration_number?: string;
  tax_clearance_number?: string;
  nssa_number?: string;
  praz_number?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  coverage_provinces?: string[];
  preferred_contact_method?: string;
  alternate_contact_name?: string;
  alternate_contact_email?: string;
  alternate_contact_phone?: string;
  accounts_contact_email?: string;
  accounts_contact_phone?: string;
  compliance_status?: string;
  review_status?: string;
  verification_stage: VendorVerificationStage;
  system_verified_at?: string;
  system_verification_notes?: string;
  hr_verified_at?: string;
  hr_verification_notes?: string;
  linked_supplier_id?: string;
  account_type?: "supplier" | "subcontractor";
  onboarding_bypass?: {
    enabled?: boolean;
    accepted_by?: string;
    accepted_by_name?: string;
    accepted_at?: string;
    missing_items?: string[];
    notes?: string;
    message?: string;
  };
  onboarding_bypass_enabled?: boolean;
  onboarding_bypass_message?: string;
}

export interface VendorDocument {
  id: string;
  title: string;
  category: string;
  document_id?: string;
  document_type?: SupplierComplianceDocumentType;
  review_status?: SupplierComplianceDocumentStatus;
  status?: SupplierComplianceDocumentStatus;
  review_notes?: string;
  reviewed_at?: string;
  reviewed_by_name?: string;
  uploaded_by_party?: "staff" | "supplier";
  file_name?: string;
  file_size_bytes?: number;
  mime_type?: string;
  expiry_date?: string;
  created_at: string;
}

export type SupplierComplianceDocumentType = "tax_clearance" | "nssa" | "praz" | "vat" | "company_registration";
export type SupplierComplianceDocumentStatus = "pending_review" | "verified" | "rejected" | "needs_update";

export interface VendorPaymentRequest {
  id: string;
  subcontractor_id: string;
  supplier_id?: string;
  project_id?: string;
  rate_type?: VendorRateType;
  reference_description: string;
  amount: number;
  currency: string;
  status: "submitted" | "acknowledged" | "cleared" | "disputed" | "cancelled";
  cleared_by_party?: "vendor" | "finance";
  cleared_at?: string;
  submitted_at: string;
}

export interface SupplierPortalWorkspace {
  vendor: SupplierPortalVendor;
  rate_item_counts: Record<string, number>;
  documents: VendorDocument[];
  payment_requests: VendorPaymentRequest[];
  modules: Array<{ key: string; label: string; status: "active" | "pending" }>;
}

export interface VendorRateItem {
  id: string;
  subcontractor_id: string;
  rate_type: VendorRateType;
  item_code?: string;
  description: string;
  unit_of_measure: string;
  unit_price: number;
  currency: string;
  min_quantity?: number;
  lead_time_days?: number;
  route_from?: string;
  route_to?: string;
  is_active: boolean;
  created_at: string;
}

export interface SupplierPortalRfqLine {
  id?: string;
  description: string;
  qty?: number;
  uom?: string;
  work_package?: string;
  notes?: string;
  unit_price?: number;
}

export interface SupplierPortalRfqResponse {
  id: string;
  reference?: string;
  total_amount: number;
  delivery_days?: number;
  validity_days?: number;
  notes?: string;
  line_items?: SupplierPortalRfqLine[];
  status: "received" | "evaluated" | "selected" | "rejected";
  received_at: string;
  documents?: VendorDocument[];
}

export interface SupplierPortalRfq {
  id: string;
  rfq_number: string;
  title: string;
  description?: string;
  closing_date?: string;
  status: "issued";
  issued_at?: string;
  project_name?: string;
  requested_items: SupplierPortalRfqLine[];
  response?: SupplierPortalRfqResponse | null;
}

export async function getSupplierPortalWorkspace(): Promise<ApiResponse<SupplierPortalWorkspace>> {
  return fetchApi<ApiResponse<SupplierPortalWorkspace>>(`/api/v1/portals/supplier/workspace`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function updateSupplierPortalProfile(payload: Partial<SupplierPortalVendor>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`/api/v1/portals/supplier/profile`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function submitSupplierPortalProfileForReview(): Promise<ApiResponse<{ verification_stage: VendorVerificationStage; problems?: string[] }>> {
  return fetchApi<ApiResponse<{ verification_stage: VendorVerificationStage; problems?: string[] }>>(`/api/v1/portals/supplier/profile/submit-for-review`, {
    method: 'POST',
    allowFallback: false,
  });
}

export async function registerSupplierPortalDocument(payload: {
  storage_path: string;
  file_name: string;
  mime_type?: string;
  size_bytes?: number;
  category: string;
  document_type?: SupplierComplianceDocumentType;
  expiry_date?: string;
}): Promise<ApiResponse<VendorDocument>> {
  return fetchApi<ApiResponse<VendorDocument>>(`/api/v1/portals/supplier/documents`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getSupplierPortalRateItems(): Promise<ApiResponse<VendorRateItem[]>> {
  return fetchApi<ApiResponse<VendorRateItem[]>>(`/api/v1/portals/supplier/rate-items`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createSupplierPortalRateItem(payload: {
  rate_type: VendorRateType;
  item_code?: string;
  description: string;
  unit_of_measure?: string;
  unit_price: number;
  currency?: string;
  min_quantity?: number;
  lead_time_days?: number;
  route_from?: string;
  route_to?: string;
}): Promise<ApiResponse<VendorRateItem>> {
  return fetchApi<ApiResponse<VendorRateItem>>(`/api/v1/portals/supplier/rate-items`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getSupplierPortalDocumentSignedUrl(id: string): Promise<ApiResponse<{ url: string; file_name: string | null; mime_type: string | null; expires_in: number }>> {
  return fetchApi<ApiResponse<{ url: string; file_name: string | null; mime_type: string | null; expires_in: number }>>(`/api/v1/portals/supplier/documents/${id}/signed-url`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getSupplierPortalRfqs(): Promise<ApiResponse<SupplierPortalRfq[]>> {
  return fetchApi<ApiResponse<SupplierPortalRfq[]>>(`/api/v1/portals/supplier/rfqs`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function submitSupplierPortalRfqResponse(rfqId: string, payload: {
  reference?: string;
  total_amount?: number;
  delivery_days?: number;
  validity_days?: number;
  notes?: string;
  line_items?: Array<{ description: string; qty?: number; uom?: string; unit_price: number; notes?: string }>;
  quote_document_id?: string;
}): Promise<ApiResponse<{ id: string; total_amount: number }>> {
  return fetchApi<ApiResponse<{ id: string; total_amount: number }>>(`/api/v1/portals/supplier/rfqs/${rfqId}/responses`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getSupplierPortalPaymentRequests(): Promise<ApiResponse<VendorPaymentRequest[]>> {
  return fetchApi<ApiResponse<VendorPaymentRequest[]>>(`/api/v1/portals/supplier/payment-requests`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createSupplierPortalPaymentRequest(payload: {
  project_id?: string;
  rate_type?: VendorRateType;
  reference_description: string;
  amount: number;
  currency?: string;
}): Promise<ApiResponse<VendorPaymentRequest>> {
  return fetchApi<ApiResponse<VendorPaymentRequest>>(`/api/v1/portals/supplier/payment-requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function clearSupplierPortalPaymentRequest(id: string, receiptDocumentId: string, notes?: string): Promise<ApiResponse<{ id: string; status: string }>> {
  return fetchApi<ApiResponse<{ id: string; status: string }>>(`/api/v1/portals/supplier/payment-requests/${id}/clear`, {
    method: 'POST',
    body: JSON.stringify({ receipt_document_id: receiptDocumentId, notes }),
    allowFallback: false,
  });
}

// ---------------------------------------------------------------------------
// Client portal - projects, issues, variations, payment requests
// ---------------------------------------------------------------------------

export interface ClientPortalProject {
  id: string;
  name: string;
  status: string;
  project_code?: string;
  project_type?: string;
  start_date?: string;
  planned_completion_date?: string;
  actual_completion_date?: string;
}

export interface ClientProjectVariation {
  id: string;
  variation_number: string;
  project_id: string;
  title: string;
  description?: string;
  scope_impact?: string;
  cost_impact?: number;
  time_impact_days?: number;
  status: "pending" | "submitted" | "approved" | "rejected" | "cancelled" | "incorporated";
  submitted_at?: string;
  approved_at?: string;
  rejection_reason?: string;
}

export interface ClientPaymentRequest {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  amount: number;
  currency: string;
  due_date?: string;
  status: "sent" | "viewed" | "cleared" | "disputed" | "cancelled";
  cleared_by_party?: "client" | "finance";
  cleared_at?: string;
  created_at: string;
}

export interface ClientProjectDetail {
  project: ClientPortalProject;
  tickets: ClientPortalTicket[];
  variations: ClientProjectVariation[];
  payment_requests: ClientPaymentRequest[];
}

export async function getClientPortalProjects(): Promise<ApiResponse<ClientPortalProject[]>> {
  return fetchApi<ApiResponse<ClientPortalProject[]>>(`/api/v1/portals/client/projects`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getClientPortalProjectDetail(projectId: string): Promise<ApiResponse<ClientProjectDetail>> {
  return fetchApi<ApiResponse<ClientProjectDetail>>(`/api/v1/portals/client/projects/${projectId}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createClientPortalIssue(payload: { project_id: string; subject: string; description: string; evidence_document_ids?: string[] }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/portals/client/issues`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function createClientPortalAdditionalRequest(payload: { project_id: string; subject: string; description: string; evidence_document_ids?: string[] }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/portals/client/additional-requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getClientPortalVariations(projectId?: string): Promise<ApiResponse<ClientProjectVariation[]>> {
  const query = projectId ? `?project_id=${projectId}` : '';
  return fetchApi<ApiResponse<ClientProjectVariation[]>>(`/api/v1/portals/client/variations${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createClientPortalVariation(payload: {
  project_id: string;
  title: string;
  description?: string;
  scope_impact?: string;
  cost_impact?: number;
  time_impact_days?: number;
  evidence_document_ids?: string[];
}): Promise<ApiResponse<ClientProjectVariation>> {
  return fetchApi<ApiResponse<ClientProjectVariation>>(`/api/v1/portals/client/variations`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getClientPortalPaymentRequests(projectId?: string): Promise<ApiResponse<ClientPaymentRequest[]>> {
  const query = projectId ? `?project_id=${projectId}` : '';
  return fetchApi<ApiResponse<ClientPaymentRequest[]>>(`/api/v1/portals/client/payment-requests${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function clearClientPortalPaymentRequest(id: string, receiptDocumentId: string, notes?: string): Promise<ApiResponse<{ id: string; status: string }>> {
  return fetchApi<ApiResponse<{ id: string; status: string }>>(`/api/v1/portals/client/payment-requests/${id}/clear`, {
    method: 'POST',
    body: JSON.stringify({ receipt_document_id: receiptDocumentId, notes }),
    allowFallback: false,
  });
}

export async function registerClientPortalDocument(payload: {
  storage_path: string;
  file_name: string;
  mime_type?: string;
  size_bytes?: number;
  category: string;
}): Promise<ApiResponse<{ id: string; title: string; category: string; created_at: string }>> {
  return fetchApi<ApiResponse<{ id: string; title: string; category: string; created_at: string }>>(`/api/v1/portals/client/documents`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getClientPortalDocumentSignedUrl(id: string): Promise<ApiResponse<{ url: string; file_name: string | null; mime_type: string | null; expires_in: number }>> {
  return fetchApi<ApiResponse<{ url: string; file_name: string | null; mime_type: string | null; expires_in: number }>>(`/api/v1/portals/client/documents/${id}/signed-url`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getMyProfile(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/profile/me', { cache: 'no-store' });
}

export interface AuthenticatedUser {
  user_id: string;
  sub: string;
  org_id: string;
  email: string | null;
  role: string;
}

// The authoritative role assignment lives in core.user_roles, not in the
// Supabase session's app_metadata (nothing keeps that in sync once an admin
// assigns a role via Settings). Callers that need to know "what can this
// user actually do" - RBACGuard in particular - must use this, not
// session.user.app_metadata.role.
export async function getAuthMe(accessToken?: string): Promise<ApiResponse<AuthenticatedUser>> {
  return fetchApi<ApiResponse<AuthenticatedUser>>('/api/v1/auth/me', {
    cache: 'no-store',
    allowFallback: false,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
}

export async function updateMyProfile(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/profile/me', { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function completeModuleTour(moduleKey: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/profile/me/module-tours/${encodeURIComponent(moduleKey)}`, { method: 'POST' });
}

export async function getWorkforce(): Promise<ApiResponse<any[]>> {
  return await fetchApi<ApiResponse<any[]>>('/api/v1/workforce/', { cache: 'no-store', allowFallback: false });
}

/** Fleet register. This endpoint intentionally has no demo-data fallback. */
export async function getFleet(): Promise<ApiResponse<any[]>> {
  return await fetchApi<ApiResponse<any[]>>('/api/v1/fleet/', { cache: 'no-store', allowFallback: false });
}

export async function getHrRecords(): Promise<ApiResponse<any[]>> {
  return await fetchApi<ApiResponse<any[]>>('/api/v1/hr-records/leave', { cache: 'no-store' });
}

export async function getComplianceItems(): Promise<ApiResponse<any[]>> {
  return await fetchApi<ApiResponse<any[]>>('/api/v1/compliance-items/employee-credentials', { cache: 'no-store' });
}

export async function getHseIncidents(): Promise<ApiResponse<any[]>> {
  return await fetchApi<ApiResponse<any[]>>('/api/v1/hse-incidents/', { cache: 'no-store' });
}

export async function createHseIncident(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/hse-incidents/', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function updateHseIncident(id: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/hse-incidents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Daily site report vertical slice. These endpoints are server-authorized and have no mock fallback. */
export async function getSiteOperationSites(projectId?: string): Promise<ApiResponse<any[]>> {
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/site-operations/sites${query}`, { cache: 'no-store', allowFallback: false });
}

export async function createSiteOperationSite(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/site-operations/sites', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getDailySiteReports(params?: { projectId?: string; status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.projectId) search.set('project_id', params.projectId);
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/site-operations/daily-reports${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getDailySiteReport(reportId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/daily-reports/${reportId}`, { cache: 'no-store', allowFallback: false });
}

export async function getSiteOperationInventoryItems(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/site-operations/inventory-items', { cache: 'no-store', allowFallback: false });
}

export async function getSiteOperationStores(params?: { projectId?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.projectId) search.set('project_id', params.projectId);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/site-operations/stores${query}`, { cache: 'no-store', allowFallback: false });
}

export async function requestSiteMaterial(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/site-operations/material-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getSiteMaterialRequests(params?: { projectId?: string; engineerStatus?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.projectId) search.set('project_id', params.projectId);
  if (params?.engineerStatus && params.engineerStatus !== 'all') search.set('engineer_status', params.engineerStatus);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/site-operations/material-requests${query}`, { cache: 'no-store', allowFallback: false });
}

export async function decideSiteMaterialRequestEngineer(id: string, decision: "approved" | "rejected", reason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/material-requests/${id}/engineer-decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
    allowFallback: false,
  });
}

export async function getWeeklySiteBudgets(params?: { projectId?: string; status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.projectId) search.set('project_id', params.projectId);
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/site-operations/weekly-budgets${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getExecutionBudget(projectId: string): Promise<ApiResponse<{ budget: any; line_items: any[] }>> {
  return fetchApi<ApiResponse<{ budget: any; line_items: any[] }>>(`/api/v1/site-operations/projects/${projectId}/execution-budget`, { cache: 'no-store', allowFallback: false });
}

export async function createWeeklySiteBudget(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/site-operations/weekly-budgets', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getWeeklySiteBudgetItems(budgetId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/site-operations/weekly-budgets/${budgetId}/items`, { cache: 'no-store', allowFallback: false });
}

export async function getSiteVariances(params?: { projectId?: string; status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.projectId) search.set('project_id', params.projectId);
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/site-operations/variances${query}`, { cache: 'no-store', allowFallback: false });
}

export async function reviewSiteVarianceQs(id: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/variances/${id}/qs-review`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function decideSiteVarianceClient(id: string, decision: "approved" | "rejected", notes?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/variances/${id}/client-decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, notes }),
    allowFallback: false,
  });
}

export async function decideWeeklySiteBudget(id: string, decision: "approved" | "rejected", reason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/weekly-budgets/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
    allowFallback: false,
  });
}

export async function getSiteGrns(params?: { projectId?: string; engineerStatus?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.projectId) search.set('project_id', params.projectId);
  if (params?.engineerStatus && params.engineerStatus !== 'all') search.set('engineer_status', params.engineerStatus);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/site-operations/grns${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getSiteEngineerWorkspace(): Promise<ApiResponse<{ projects: any[] }>> {
  return fetchApi<ApiResponse<{ projects: any[] }>>('/api/v1/site-operations/engineer/workspace', { cache: 'no-store', allowFallback: false });
}

export async function decideSiteGrnEngineer(id: string, decision: "approved" | "rejected", reason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/grns/${id}/engineer-decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
    allowFallback: false,
  });
}

export async function createDailySiteReport(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/site-operations/daily-reports', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function updateDailySiteReport(reportId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/daily-reports/${reportId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function addDailyReportLabour(reportId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/daily-reports/${reportId}/labour`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function addDailyReportEquipment(reportId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/daily-reports/${reportId}/equipment`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function addDailyReportMaterial(reportId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/daily-reports/${reportId}/materials`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function submitDailySiteReport(reportId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/daily-reports/${reportId}/submit`, {
    method: 'POST',
    allowFallback: false,
  });
}

export async function decideDailySiteReport(reportId: string, decision: "approved" | "rejected", reason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/daily-reports/${reportId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
    allowFallback: false,
  });
}

export async function decideDailySiteReportEngineer(reportId: string, decision: "approved" | "rejected", reason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/site-operations/daily-reports/${reportId}/engineer-decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
    allowFallback: false,
  });
}

/** System settings are server-authorized and deliberately have no browser fallback. */
export async function getSettingsOverview(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/settings/overview', { cache: 'no-store', allowFallback: false });
}

export async function getSettingsAuditEvents(limit = 50): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/settings/audit-events?limit=${limit}`, { cache: 'no-store', allowFallback: false });
}

export async function updateSystemSetting(
  section: "organization" | "notifications" | "integrations",
  payload: Record<string, unknown>
): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/${section}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function assignSettingsUserRole(userId: string, roleId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/users/${userId}/roles`, {
    method: 'POST',
    body: JSON.stringify({ role_id: roleId }),
    allowFallback: false,
  });
}

export async function removeSettingsUserRole(userId: string, roleId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/users/${userId}/roles/${roleId}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

export async function getTaskPerformance(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/settings/task-performance', { cache: 'no-store', allowFallback: false });
}

export async function inviteSettingsUser(payload: { full_name: string; email: string; role_ids: string[]; no_real_email?: boolean }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/users/invite`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function setSettingsUserStatus(userId: string, isActive: boolean): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/users/${userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: isActive }),
    allowFallback: false,
  });
}

export async function setSettingsUserEmail(userId: string, email: string): Promise<ApiResponse<{ email: string }>> {
  return fetchApi<ApiResponse<{ email: string }>>(`/api/v1/settings/users/${userId}/email`, {
    method: 'PATCH',
    body: JSON.stringify({ email }),
    allowFallback: false,
  });
}

export async function deleteSettingsUser(userId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/users/${userId}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

export async function setSettingsRolePermission(roleId: string, permissionKey: string, enabled: boolean): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/roles/${roleId}/permissions`, {
    method: 'PATCH',
    body: JSON.stringify({ permission_key: permissionKey, enabled }),
    allowFallback: false,
  });
}

export async function createSettingsRole(name: string, description?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/roles`, {
    method: 'POST',
    body: JSON.stringify({ name, description: description || null }),
    allowFallback: false,
  });
}

export async function getMyPermissions(): Promise<ApiResponse<string[]>> {
  return fetchApi<ApiResponse<string[]>>(`/api/v1/auth/permissions`, { cache: 'no-store', allowFallback: false });
}

export async function createSettingsManagedAccount(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/managed-accounts`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function grantClientPortalAccess(contactId: string): Promise<ApiResponse<{ user_id: string; contact_id: string; email: string }>> {
  return fetchApi<ApiResponse<{ user_id: string; contact_id: string; email: string }>>(`/api/v1/settings/client-portal-access`, {
    method: 'POST',
    body: JSON.stringify({ contact_id: contactId }),
    allowFallback: false,
  });
}

export async function updateWebsiteContent(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/website-content`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}
