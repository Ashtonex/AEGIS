import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";

// --- CRM API CALLS --- //

export async function getCrmOpportunities(params?: { department_id?: string }) {
  const search = new URLSearchParams();
  if (params?.department_id) search.set('department_id', params.department_id);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return await fetchApi<ApiResponse<any[]>>(`/api/v1/crm/opportunities${qs}`, { cache: 'no-store' });
}

export async function createCrmOpportunity(data: { name: string, stage: string, budget?: number, probability?: number, client_org_id?: string, region?: string, latitude?: number, longitude?: number, originating_department_id?: string }): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>('/api/v1/crm/opportunities', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function getCrmTenders() {
  try {
    return await fetchApi<ApiResponse<any[]>>('/api/v1/crm/tenders', { cache: 'no-store' });
  } catch (error) {
    // Keep the board alive during rolling deploys or delayed DB migrations:
    // the legacy tender-bids list reads the same crm.tenders records without
    // naming newly-added optional columns that may not exist yet.
    try {
      return await fetchApi<ApiResponse<any[]>>('/api/v1/tender-bids/', { cache: 'no-store', allowFallback: false });
    } catch {
      throw error;
    }
  }
}

export async function getCommercialMorningBriefing(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm/commercial-briefing', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getCrmTenderSignals(params?: {
  limit?: number;
  sources?: string[];
  includeInternalPublicFeed?: boolean;
}): Promise<ApiResponse<any[]>> {
  const searchParams = new URLSearchParams();
  if (typeof params?.limit === "number") {
    searchParams.set("limit", String(params.limit));
  }
  if (typeof params?.includeInternalPublicFeed === "boolean") {
    searchParams.set("include_internal_public_feed", String(params.includeInternalPublicFeed));
  }
  if (params?.sources?.length) {
    searchParams.set("sources", params.sources.join(","));
  }

  const query = searchParams.toString();
  return await fetchApi<ApiResponse<any[]>>(
    `/api/v1/crm/tender-signals${query ? `?${query}` : ""}`,
    { cache: "no-store" }
  );
}

export async function createCrmTender(data: { tender_name: string, stage: string, bid_number?: string, bid_amount?: number, region?: string, latitude?: number, longitude?: number }): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>('/api/v1/crm/tenders', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateCrmOpportunity(id: string, data: Record<string, any>) {
  return await fetchApi<ApiResponse<void>>(`/api/v1/crm/opportunities/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
    allowFallback: false,
  });
}

export async function deleteCrmOpportunity(id: string): Promise<ApiResponse<void>> {
  return await fetchApi<ApiResponse<void>>(`/api/v1/crm/opportunities/${id}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

export async function findDuplicateCrmOpportunities(params: { name?: string; client_org_id?: string; client_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.client_org_id) search.set("client_org_id", params.client_org_id);
  if (params.client_id) search.set("client_id", params.client_id);
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm/opportunities/duplicates?${search.toString()}`, {
    cache: "no-store",
    allowFallback: false,
  });
}

export async function mergeCrmOpportunities(opportunityId: string, sourceOpportunityIds: string[]): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm/opportunities/${opportunityId}/merge`, {
    method: "POST",
    body: JSON.stringify({ source_opportunity_ids: sourceOpportunityIds }),
    allowFallback: false,
  });
}

export async function updateCrmTender(id: string, data: Record<string, any>) {
  return await fetchApi<ApiResponse<void>>(`/api/v1/tender-bids/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
    allowFallback: false,
  });
}

export async function getTenderEngineInsights(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/tender-bids/insights/engine', {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Award a tender: creates/links a real project and seeds its budget from any linked quotation. */
export async function awardCrmTender(tenderId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/tender-bids/${tenderId}/award`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function closeoutCrmTender(tenderId: string, payload: { status: "won" | "lost"; reason: string; next_steps: string[]; winning_contractor?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/tender-bids/${tenderId}/closeout`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function deleteCrmTender(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/tender-bids/${id}`, {
    method: 'DELETE'
  });
}

export async function getTenderRequirements(tenderId: string): Promise<ApiResponse<any[]>> {
  return await fetchApi<ApiResponse<any[]>>(`/api/v1/tender-bids/${tenderId}/requirements`, { cache: 'no-store' });
}

export async function createTenderRequirement(tenderId: string, label: string): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>(`/api/v1/tender-bids/${tenderId}/requirements`, {
    method: 'POST',
    body: JSON.stringify({ label })
  });
}

export async function toggleTenderRequirement(tenderId: string, requirementId: string, isSatisfied: boolean): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>(`/api/v1/tender-bids/${tenderId}/requirements/${requirementId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_satisfied: isSatisfied })
  });
}

export async function deleteTenderRequirement(tenderId: string, requirementId: string): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>(`/api/v1/tender-bids/${tenderId}/requirements/${requirementId}`, {
    method: 'DELETE'
  });
}

export async function convertTenderRequirementToTask(
  tenderId: string,
  requirementId: string,
  payload: { assigned_to_user_id?: string; due_date?: string; priority?: string }
): Promise<ApiResponse<{ task_id: string }>> {
  return await fetchApi<ApiResponse<{ task_id: string }>>(`/api/v1/tender-bids/${tenderId}/requirements/${requirementId}/convert-to-task`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// --- Compliance Matrix (requirements library, vault matching, readiness) --- //

export interface TenderComplianceSummary {
  applicable_count: number;
  satisfied_count: number;
  percent: number | null;
  fatal_open: number;
  critical_open: number;
  missing: number;
  expired: number;
  expiring: number;
  unverified: number;
  status: 'GREEN' | 'AMBER' | 'RED' | 'GREY';
  bid_gate_signal: 'BID' | 'REVIEW' | 'HOLD';
  is_compliance_only: true;
}

export async function getTenderComplianceSummary(tenderId: string): Promise<ApiResponse<TenderComplianceSummary>> {
  return await fetchApi<ApiResponse<TenderComplianceSummary>>(`/api/v1/tender-bids/${tenderId}/compliance-summary`, { cache: 'no-store' });
}

export async function updateTenderRequirement(tenderId: string, requirementId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>(`/api/v1/tender-bids/${tenderId}/requirements/${requirementId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export async function seedTenderRequirementsFromLibrary(tenderId: string, categories?: string[]): Promise<ApiResponse<{ created: number; skipped: number }>> {
  return await fetchApi<ApiResponse<{ created: number; skipped: number }>>(`/api/v1/tender-bids/${tenderId}/requirements/seed-from-library`, {
    method: 'POST',
    body: JSON.stringify(categories?.length ? { categories } : {})
  });
}

export async function matchTenderRequirementCredential(tenderId: string, requirementId: string): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>(`/api/v1/tender-bids/${tenderId}/requirements/${requirementId}/match-credential`, {
    method: 'POST'
  });
}

export async function getTenderRequirementsLibrary(category?: string): Promise<ApiResponse<any[]>> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : '';
  return await fetchApi<ApiResponse<any[]>>(`/api/v1/tenders/requirements-library${qs}`, { cache: 'no-store' });
}

// --- Corporate Credentials Vault --- //

export async function getCorporateCredentials(params?: { category?: string; status?: string; expiring_within_days?: number }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.category) search.set('category', params.category);
  if (params?.status) search.set('status', params.status);
  if (typeof params?.expiring_within_days === 'number') search.set('expiring_within_days', String(params.expiring_within_days));
  const qs = search.toString() ? `?${search.toString()}` : '';
  return await fetchApi<ApiResponse<any[]>>(`/api/v1/compliance/corporate-credentials${qs}`, { cache: 'no-store' });
}

export async function createCorporateCredential(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>('/api/v1/compliance/corporate-credentials', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function updateCorporateCredential(id: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>(`/api/v1/compliance/corporate-credentials/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export async function deleteCorporateCredential(id: string): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>(`/api/v1/compliance/corporate-credentials/${id}`, {
    method: 'DELETE'
  });
}

export async function getCrmLeads(params?: { department_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.department_id) search.set('department_id', params.department_id);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return await fetchApi<ApiResponse<any[]>>(`/api/v1/crm-leads/${qs}`, { cache: 'no-store' });
}

export async function updateCrmLeadStatus(leadId: string, status: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-leads/${leadId}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
    allowFallback: false,
  });
}

export async function qualifyCrmLead(leadId: string, payload?: any): Promise<ApiResponse<void>> {
  return await fetchApi<ApiResponse<void>>(`/api/v1/crm-leads/${leadId}/qualify`, {
    method: 'POST',
    body: payload ? JSON.stringify(payload) : undefined
  });
}

export async function disqualifyCrmLead(leadId: string, reason: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-leads/${leadId}/disqualify`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    allowFallback: false,
  });
}

export async function findDuplicateCrmLeads(params: { email?: string; phone?: string; company_name?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params.email) search.set("email", params.email);
  if (params.phone) search.set("phone", params.phone);
  if (params.company_name) search.set("company_name", params.company_name);
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-leads/duplicates?${search.toString()}`, {
    cache: "no-store",
    allowFallback: false,
  });
}

export async function mergeCrmLeads(leadId: string, sourceLeadIds: string[]): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-leads/${leadId}/merge`, {
    method: "POST",
    body: JSON.stringify({ source_lead_ids: sourceLeadIds }),
    allowFallback: false,
  });
}

export async function deleteCrmLead(leadId: string): Promise<ApiResponse<void>> {
  return fetchApi<ApiResponse<void>>(`/api/v1/crm-leads/${leadId}`, {
    method: "DELETE",
    allowFallback: false,
  });
}

export async function createCrmLead(data: {
  company_name?: string;
  contact_name: string;
  contact_email?: string;
  contact_phone?: string;
  sector: string;
  estimated_budget: number;
  lead_source: string;
  ai_score?: number;
  ai_rationale?: string;
  expected_close_date?: string;
  labels?: string[];
  budget_confirmed?: boolean;
  required_compliance_types?: string[];
  originating_department_id?: string;
}): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>('/api/v1/crm-leads/', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateCrmLead(leadId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-leads/${leadId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCrmComplianceRequirementTypes(): Promise<ApiResponse<{ id: string; code: string; label: string }[]>> {
  return fetchApi<ApiResponse<{ id: string; code: string; label: string }[]>>(
    '/api/v1/crm-leads/compliance-requirement-types',
    { cache: 'no-store', allowFallback: false }
  );
}

export async function getSubcontractors(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm/subcontractors`, {
    cache: 'no-store'
  });
}

export async function createSubcontractor(data: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm/subcontractors`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateSubcontractor(id: string, data: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm/subcontractors/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function getAccountabilityMetrics(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm/accountability`, {
    cache: 'no-store'
  });
}

export async function getRiskMatrices(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm/risk-matrices`, {
    cache: 'no-store'
  });
}

export async function getCrmDocuments(): Promise<ApiResponse<any[]>> {
  return await fetchApi<ApiResponse<any[]>>('/api/v1/documents/', { cache: 'no-store' });
}

export async function createCrmDocument(data: {
  title: string;
  file_name?: string | null;
  file_size_bytes?: number | null;
  category?: string | null;
  opportunity_id?: string | null;
  tender_id?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
}): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>('/api/v1/documents/', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// --- CRM ORGANIZATIONS --- //
export async function getCrmOrganizations(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm-organizations/', { cache: 'no-store' });
}

export async function createCrmOrganization(data: any): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-organizations/', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateCrmOrganization(id: string, data: any): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-organizations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function deleteCrmOrganization(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-organizations/${id}`, {
    method: 'DELETE'
  });
}

// --- CRM CONTACTS --- //
export async function getCrmContacts(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm-contacts/', { cache: 'no-store' });
}

export async function createCrmContact(data: any): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-contacts/', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateCrmContact(id: string, data: any): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-contacts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function deleteCrmContact(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-contacts/${id}`, {
    method: 'DELETE'
  });
}

export async function findDuplicateCrmContacts(params: { name?: string; email?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.email) search.set("email", params.email);
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-contacts/duplicates?${search.toString()}`, {
    cache: "no-store",
    allowFallback: false,
  });
}

export async function mergeCrmContacts(contactId: string, sourceContactIds: string[]): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-contacts/${contactId}/merge`, {
    method: "POST",
    body: JSON.stringify({ source_contact_ids: sourceContactIds }),
    allowFallback: false,
  });
}

export async function attachCrmContactDocument(contactId: string, documentId: string, linkRole?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-contacts/${contactId}/documents`, {
    method: "POST",
    body: JSON.stringify({ document_id: documentId, ...(linkRole ? { link_role: linkRole } : {}) }),
    allowFallback: false,
  });
}

export async function getCrmContactDocuments(contactId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-contacts/${contactId}/documents`, {
    cache: "no-store",
    allowFallback: false,
  });
}

export async function attachCrmLeadDocument(leadId: string, documentId: string, linkRole?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-leads/${leadId}/documents`, {
    method: "POST",
    body: JSON.stringify({ document_id: documentId, ...(linkRole ? { link_role: linkRole } : {}) }),
    allowFallback: false,
  });
}

export async function getCrmLeadDocuments(leadId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-leads/${leadId}/documents`, {
    cache: "no-store",
    allowFallback: false,
  });
}

// --- CRM ACTIVITIES --- //
export interface CrmActivity {
  id: string;
  type: string;
  subject: string;
  description?: string | null;
  activity_date: string;
  status?: string;
  contact_id?: string | null;
  lead_id?: string | null;
  opportunity_id?: string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  contact_name?: string | null;
  lead_company?: string | null;
  opportunity_name?: string | null;
  created_by?: string | null;
  created_at?: string;
}

export async function getCrmActivities(params?: { start_date?: string; end_date?: string; limit?: number }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.start_date) search.set("start_date", params.start_date);
  if (params?.end_date) search.set("end_date", params.end_date);
  if (params?.limit) search.set("limit", String(params.limit));
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-activities/${query}`, { cache: 'no-store' });
}

export async function createCrmActivity(data: {
  type: string;
  subject: string;
  description?: string | null;
  activity_date?: string;
  status?: string;
  contact_id?: string | null;
  lead_id?: string | null;
  opportunity_id?: string | null;
  owner_user_id?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
}): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>('/api/v1/crm-activities/', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateCrmActivity(id: string, data: any): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-activities/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function deleteCrmActivity(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-activities/${id}`, {
    method: 'DELETE'
  });
}

// --- CRM COMMUNICATIONS --- //
export async function getCrmCommunications(params?: {
  contact_id?: string;
  recipient_user_id?: string;
  lead_id?: string;
  opportunity_id?: string;
  channel?: string;
  limit?: number;
}): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.contact_id) search.set("contact_id", params.contact_id);
  if (params?.recipient_user_id) search.set("recipient_user_id", params.recipient_user_id);
  if (params?.lead_id) search.set("lead_id", params.lead_id);
  if (params?.opportunity_id) search.set("opportunity_id", params.opportunity_id);
  if (params?.channel) search.set("channel", params.channel);
  if (params?.limit) search.set("limit", String(params.limit));
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-communications/${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export interface PortalInboxItem {
  id: string;
  item_type: string;
  item_label: string;
  title: string;
  detail?: string;
  party_name?: string;
  project_name?: string;
  status?: string;
  occurred_at?: string;
  document_count?: number;
  action_url: string;
  control_note?: string;
}

export async function getPortalInbox(limit = 100): Promise<ApiResponse<PortalInboxItem[]>> {
  return fetchApi<ApiResponse<PortalInboxItem[]>>(`/api/v1/crm-communications/portal-inbox?limit=${limit}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createCrmCommunication(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-communications/', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function updateCrmCommunication(id: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-communications/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function sendCrmWhatsAppMessage(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-communications/whatsapp/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function convertCrmCommunication(communicationId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-communications/${communicationId}/convert`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

// --- CRM INTEGRATIONS / SALES INTELLIGENCE --- //
export async function getCrmIntegrationProviders(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm-integrations/providers', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getCrmConnectedAccounts(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm-integrations/connected-accounts', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function saveCrmConnectedAccount(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-integrations/connected-accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function disconnectCrmConnectedAccount(accountId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-integrations/connected-accounts/${accountId}/disconnect`, {
    method: 'PATCH',
    allowFallback: false,
  });
}

export async function queueCrmIntegrationSync(accountId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-integrations/connected-accounts/${accountId}/sync`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCrmIntegrationSyncJobs(params?: { account_id?: string; limit?: number }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.account_id) search.set("account_id", params.account_id);
  if (params?.limit) search.set("limit", String(params.limit));
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-integrations/sync-jobs${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function syncCrmEmailEvent(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-integrations/email-events', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function sendCrmPrivateEmail(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-integrations/email/send', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function scheduleCrmCalendarEvent(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-integrations/calendar-events', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function runCrmAiScoring(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-integrations/ai/run-scoring', {
    method: 'POST',
    allowFallback: false,
  });
}

export async function getCrmAiRecommendations(params?: {
  entity_type?: "lead" | "opportunity";
  status?: "open" | "accepted" | "dismissed" | "completed" | "all";
  limit?: number;
}): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.entity_type) search.set("entity_type", params.entity_type);
  if (params?.status) search.set("status", params.status);
  if (params?.limit) search.set("limit", String(params.limit));
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-integrations/ai/recommendations${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function updateCrmAiRecommendation(id: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-integrations/ai/recommendations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

// --- CRM LIFECYCLE / CUSTOMER 360 --- //
export async function getCrmCustomer360(organizationAccountId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm/customer-360/${organizationAccountId}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getCrmLifecycleReport(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm/reports/lifecycle', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getCrmMarketingReport(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm/reports/marketing', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getCrmSalesReport(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm/reports/sales', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getCrmExecutiveCrmReport(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm/reports/executive', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getCrmCampaigns(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm/campaigns', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createCrmCampaign(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm/campaigns', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCrmSegments(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm/segments', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createCrmSegment(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm/segments', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCrmWinLossReasons(reasonType?: 'won' | 'lost'): Promise<ApiResponse<any[]>> {
  const query = reasonType ? `?reason_type=${reasonType}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm/win-loss-reasons${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createCrmWinLossReason(payload: { reason_type: 'won' | 'lost'; label: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm/win-loss-reasons', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCrmNurtureSequences(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm/nurture-sequences', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createCrmNurtureSequence(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm/nurture-sequences', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function updateCrmNurtureSequence(id: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm/nurture-sequences/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCrmSequenceSteps(sequenceId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm/nurture-sequences/${sequenceId}/steps`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createCrmSequenceStep(sequenceId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm/nurture-sequences/${sequenceId}/steps`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCrmMessageTemplates(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm/templates', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createCrmMessageTemplate(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm/templates', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCrmSupportTickets(params?: { status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-lifecycle/support/tickets${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createCrmSupportTicket(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-lifecycle/support/tickets', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function updateCrmSupportTicket(id: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-lifecycle/support/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCrmTicketComments(ticketId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-lifecycle/support/tickets/${ticketId}/comments`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createCrmTicketComment(ticketId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-lifecycle/support/tickets/${ticketId}/comments`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function escalateCrmSupportTicket(ticketId: string, payload: { escalated_to: string; reason: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-lifecycle/support/tickets/${ticketId}/escalate`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCrmTicketEscalations(ticketId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-lifecycle/support/tickets/${ticketId}/escalations`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function attachCrmTicketDocument(ticketId: string, payload: { document_id: string; link_role?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-lifecycle/support/tickets/${ticketId}/attachments`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCrmTicketAttachments(ticketId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-lifecycle/support/tickets/${ticketId}/attachments`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getCrmSupportDashboard(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-lifecycle/support/dashboard', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getCrmSlaPolicies(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm-lifecycle/support/sla-policies', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function upsertCrmSlaPolicy(payload: { priority: string; response_hours: number; resolution_hours: number }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-lifecycle/support/sla-policies', {
    method: 'PUT',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function sendCrmCampaign(campaignId: string, templateId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm/campaigns/${campaignId}/send`, {
    method: 'POST',
    body: JSON.stringify({ template_id: templateId }),
    allowFallback: false,
  });
}

export async function createCrmOpportunityQuotation(opportunityId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm/opportunities/${opportunityId}/create-quotation`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function markCrmOpportunityWon(opportunityId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm/opportunities/${opportunityId}/mark-won`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function markCrmOpportunityLost(opportunityId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm/opportunities/${opportunityId}/mark-lost`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function executeCrmAutomations(payload: Record<string, unknown>): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm-lifecycle/automations/execute', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getUsers(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/users/', {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Narrow, broadly-granted user list for assignment pickers (id/name/email only). */
export async function getAssignableUsers(): Promise<ApiResponse<{ id: string; full_name: string; email: string }[]>> {
  return fetchApi<ApiResponse<{ id: string; full_name: string; email: string }[]>>('/api/v1/users/assignable', {
    cache: 'no-store',
    allowFallback: false,
  });
}

// ─── Teams ──────────────────────────────────────────────────────────────────

export async function getTeams(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/teams/', { cache: 'no-store', allowFallback: false });
}

export async function createTeam(name: string): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>('/api/v1/teams/', {
    method: 'POST',
    body: JSON.stringify({ name }),
    allowFallback: false,
  });
}

export async function deleteTeam(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/teams/${id}`, { method: 'DELETE', allowFallback: false });
}

export async function getTeamMembers(id: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/teams/${id}/members`, { cache: 'no-store', allowFallback: false });
}

export async function addTeamMember(teamId: string, userId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/teams/${teamId}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
    allowFallback: false,
  });
}

export async function removeTeamMember(teamId: string, userId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/teams/${teamId}/members/${userId}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

// ─── Pursuits (Lead → Opportunity → Tender → Award/Loss spine) ────────────

export async function getPursuits(params?: { status?: string }): Promise<ApiResponse<any[]>> {
  const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/pursuits/${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function getPursuit(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/pursuits/${id}`, { cache: 'no-store', allowFallback: false });
}

export async function updatePursuit(id: string, payload: Record<string, any>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/pursuits/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

// ─── Assignment (lead/opportunity/tender/project/fleet/machinery → person or team) ─

export async function getAssignment(entityType: string, entityId: string): Promise<ApiResponse<{ assigned_to_user_id: string | null; assigned_to_team_id: string | null; assigned_user_name: string | null; assigned_team_name: string | null }>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/assignments/?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function setAssignment(entityType: string, entityId: string, target: { assigned_to_user_id?: string | null; assigned_to_team_id?: string | null }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/assignments/', {
    method: 'POST',
    body: JSON.stringify({ entity_type: entityType, entity_id: entityId, ...target }),
    allowFallback: false,
  });
}

// ─── CRM Tasks ──────────────────────────────────────────────────────────────

export async function getCrmTasks(params?: { assigned_to_user_id?: string; status?: string; entity_type?: string; entity_id?: string; department?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.assigned_to_user_id) search.set('assigned_to_user_id', params.assigned_to_user_id);
  if (params?.status) search.set('status', params.status);
  if (params?.entity_type) search.set('entity_type', params.entity_type);
  if (params?.entity_id) search.set('entity_id', params.entity_id);
  if (params?.department) search.set('department', params.department);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-tasks/${qs}`, { cache: 'no-store', allowFallback: false });
}

export interface TaskProgressRow {
  id: string;
  full_name?: string;
  name?: string;
  open: number;
  completed: number;
  overdue: number;
  total: number;
  pct_complete: number;
}

export async function getCrmTaskProgressSummary(): Promise<ApiResponse<{
  users: TaskProgressRow[];
  teams: TaskProgressRow[];
  overall: { open: number; completed: number; overdue: number; total: number; pct_complete: number };
}>> {
  return fetchApi('/api/v1/crm-tasks/progress-summary', { cache: 'no-store', allowFallback: false });
}

export async function backfillCrmTaskStacks(): Promise<ApiResponse<{ records_checked: number; tasks_created: number }>> {
  return fetchApi<ApiResponse<{ records_checked: number; tasks_created: number }>>('/api/v1/crm-tasks/backfill-stacks', {
    method: 'POST',
    allowFallback: false,
  });
}

export async function createCrmTask(payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>('/api/v1/crm-tasks/', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function findCrmTaskDuplicates(payload: Record<string, unknown>): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm-tasks/duplicates', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function updateCrmTask(id: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function deleteCrmTask(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-tasks/${id}`, { method: 'DELETE', allowFallback: false });
}

export async function addCrmTaskContributor(taskId: string, userId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-tasks/${taskId}/contributors`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
    allowFallback: false,
  });
}

export async function removeCrmTaskContributor(taskId: string, userId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-tasks/${taskId}/contributors/${userId}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

/** Assigns every open task linked to one entity to a team in one call. */
export async function assignTaskStack(entityType: string, entityId: string, assignedToTeamId: string): Promise<ApiResponse<{ task_count: number }>> {
  return fetchApi<ApiResponse<{ task_count: number }>>('/api/v1/crm-tasks/assign-stack', {
    method: 'POST',
    body: JSON.stringify({ entity_type: entityType, entity_id: entityId, assigned_to_team_id: assignedToTeamId }),
    allowFallback: false,
  });
}

export async function getTaskTemplates(entityType?: string): Promise<ApiResponse<any[]>> {
  const qs = entityType ? `?entity_type=${encodeURIComponent(entityType)}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-tasks/templates${qs}`, { cache: 'no-store', allowFallback: false });
}

export async function createTaskTemplate(payload: { entity_type: string; title: string; description?: string; sort_order?: number }): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>('/api/v1/crm-tasks/templates', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function deleteTaskTemplate(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-tasks/templates/${id}`, { method: 'DELETE', allowFallback: false });
}

export async function setTeamMemberLead(teamId: string, userId: string, isLead: boolean): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/teams/${teamId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_lead: isLead }),
    allowFallback: false,
  });
}

export interface SystemNotification {
  id: string;
  title: string;
  message?: string;
  notification_type?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  action_url?: string;
  metadata?: Record<string, unknown>;
  is_read: boolean;
  read_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export async function getNotifications(params?: { unread_only?: boolean; limit?: number }): Promise<ApiResponse<SystemNotification[]>> {
  const search = new URLSearchParams();
  if (params?.unread_only) search.set("unread_only", "true");
  if (params?.limit) search.set("limit", String(params.limit));
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<SystemNotification[]>>(`/api/v1/notifications/${query}`, {
    cache: "no-store",
    allowFallback: false,
  });
}

export async function getNotificationSummary(): Promise<ApiResponse<{ unread_count: number; total_count: number; latest_at?: string }>> {
  return fetchApi<ApiResponse<{ unread_count: number; total_count: number; latest_at?: string }>>(`/api/v1/notifications/summary`, {
    cache: "no-store",
    allowFallback: false,
  });
}

export async function markNotificationRead(id: string): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`/api/v1/notifications/${id}/read`, {
    method: "PATCH",
    allowFallback: false,
  });
}

export async function markAllNotificationsRead(): Promise<ApiResponse<{ count: number }>> {
  return fetchApi<ApiResponse<{ count: number }>>(`/api/v1/notifications/read-all`, {
    method: "PATCH",
    allowFallback: false,
  });
}

// --- CRM AUTOMATIONS --- //
export async function getCrmAutomations(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm-automations/', { cache: 'no-store' });
}

export async function createCrmAutomation(data: any): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/crm-automations/', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateCrmAutomation(id: string, data: any): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-automations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function deleteCrmAutomation(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/crm-automations/${id}`, {
    method: 'DELETE'
  });
}

export async function getCrmAutomationRuns(ruleId?: string): Promise<ApiResponse<any[]>> {
  const query = ruleId ? `?rule_id=${encodeURIComponent(ruleId)}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/crm-automations/runs${query}`, { cache: 'no-store' });
}

// --- CRM IMPORT / EXPORT --- //

export async function importCrmCsv(file: File, targetType: "contacts" | "leads" | "organizations"): Promise<ApiResponse<{ imported: number }>> {
  const formData = new FormData();
  formData.append("file", file);
  const url = resolveApiUrl(`/api/v1/crm-import-export/import/csv?target_type=${targetType}`);
  const headers = await getApiHeaders();
  headers.delete("Content-Type"); // let the browser set the multipart boundary
  const response = await fetch(url, { method: "POST", headers, body: formData });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body?.detail || body?.message || "CSV import failed.");
  return body;
}

export async function importCrmVCard(file: File): Promise<ApiResponse<{ imported: number }>> {
  const formData = new FormData();
  formData.append("file", file);
  const url = resolveApiUrl("/api/v1/crm-import-export/import/vcard");
  const headers = await getApiHeaders();
  headers.delete("Content-Type");
  const response = await fetch(url, { method: "POST", headers, body: formData });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body?.detail || body?.message || "vCard import failed.");
  return body;
}

export async function downloadCrmCsvExport(targetType: "contacts" | "leads" | "opportunities" | "tickets"): Promise<Blob> {
  const url = resolveApiUrl(`/api/v1/crm-import-export/export/csv?target_type=${targetType}`);
  const headers = await getApiHeaders();
  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) throw new ApiError(response.status, "CSV export failed.");
  return response.blob();
}

