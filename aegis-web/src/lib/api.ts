import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "./constants";
import { resolveBackendOrigin } from "./backend-url";
import { getSupabase } from "./supabase";
import { MOCK_TENDERS, MOCK_NEWS_ARTICLES, MOCK_KNOWLEDGE_ARTICLES } from "./mockArticles";
import { MOCK_PROJECTS, getMockProjectBySlug } from "./mockProjects";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiRequestOptions = RequestInit & {
  allowFallback?: boolean;
  timeoutMs?: number;
};

const API_TIMEOUT_MS = 20000;
const BUILD_API_TIMEOUT_MS = 1000;
const OPERATIONAL_DASHBOARD_PREFIXES = [
  "/api/v1/crm/",
  "/api/v1/crm-leads/",
  "/api/v1/crm-contacts/",
  "/api/v1/crm-organizations/",
  "/api/v1/crm-activities/",
  "/api/v1/crm-communications/",
  "/api/v1/crm-automations/",
  "/api/v1/executive/",
  "/api/v1/workforce/",
  "/api/v1/fleet/",
  "/api/v1/site-operations/",
  "/api/v1/hr-records/",
  "/api/v1/compliance-items/",
  "/api/v1/hse-incidents/",
  "/api/v1/settings/",
  "/api/v1/procurement/",
  "/api/v1/notifications/",
];

const SERVER_ROUTE_ALIASES: Record<string, string> = {
  "/api/tenders": "/api/v1/public/intake/tenders",
  "/api/cms/website-content": "/api/v1/public/intake/website-content",
  "/api/cms/broadcast-feeds": "/api/v1/public/intake/broadcast-feeds",
};

function resolveServerInternalEndpoint(endpoint: string): string {
  const [pathname, search = ""] = endpoint.split("?", 2);
  const mappedPath = SERVER_ROUTE_ALIASES[pathname] ?? pathname;
  return `${resolveBackendOrigin()}${mappedPath}${search ? `?${search}` : ""}`;
}

function resolveApiUrl(endpoint: string): string {
  const isInternal = endpoint.startsWith("/api/");

  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }

  if (typeof window === "undefined") {
    return isInternal ? resolveServerInternalEndpoint(endpoint) : `${resolveBackendOrigin()}${endpoint}`;
  }

  return isInternal ? endpoint : `${API_BASE_URL || ""}${endpoint}`;
}

function isOperationalDashboardEndpoint(endpoint: string): boolean {
  return OPERATIONAL_DASHBOARD_PREFIXES.some((prefix) => endpoint.startsWith(prefix));
}

function shouldUseFallback(endpoint: string, options: ApiRequestOptions): boolean {
  if (typeof options.allowFallback === "boolean") {
    return options.allowFallback;
  }

  if (endpoint.startsWith("/api/v1/")) {
    return false;
  }

  return !isOperationalDashboardEndpoint(endpoint);
}

function buildFallbackResponse<T>(endpoint: string): T {
  const isList =
    endpoint.includes("?") ||
    endpoint.endsWith("/projects") ||
    endpoint.endsWith("/tenders") ||
    endpoint.endsWith("/articles") ||
    endpoint.endsWith("/knowledge") ||
    endpoint.endsWith("/leadership");

  if (isList) {
    let fallbackData: any = [];
    if (endpoint.includes("/tenders")) {
      fallbackData = MOCK_TENDERS;
    } else if (endpoint.includes("/articles")) {
      fallbackData = MOCK_NEWS_ARTICLES;
    } else if (endpoint.includes("/knowledge")) {
      fallbackData = MOCK_KNOWLEDGE_ARTICLES;
    } else if (endpoint.includes("/projects")) {
      fallbackData = MOCK_PROJECTS;
    }
    return {
      success: true,
      data: fallbackData,
      meta: { total: fallbackData.length, page: 1, limit: 10, size: fallbackData.length, totalPages: 1 }
    } as T;
  } else {
    // Single item fallback
    let fallbackData: any = null;
    if (endpoint.includes("/projects/")) {
      const slug = endpoint.split("/projects/").pop()?.split("?")[0] || "";
      const proj = getMockProjectBySlug(slug);
      fallbackData = proj || null;
    }
    return {
      success: true,
      data: fallbackData,
      meta: { total: fallbackData ? 1 : 0, page: 1, limit: 1, size: fallbackData ? 1 : 0, totalPages: 1 }
    } as T;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.name || "Error";
  }

  return String(error);
}

function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  const rawMessage = getErrorMessage(error);
  const normalizedMessage = rawMessage.toLowerCase();
  if (normalizedMessage.includes("signal is aborted") || normalizedMessage.includes("operation was aborted") || normalizedMessage.includes("aborterror") || normalizedMessage.includes("timeouterror")) {
    return new ApiError(0, "The service took too long to respond. Please retry once the connection is ready.");
  }

  if (typeof DOMException !== "undefined" && error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new ApiError(0, "The service took too long to respond. Please retry once the connection is ready.");
  }

  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new ApiError(0, "The service took too long to respond. Please retry once the connection is ready.");
  }

  return new ApiError(0, "The service could not be reached. Please retry once the connection is ready.");
}

function timeoutReason(): Error | DOMException {
  if (typeof DOMException !== "undefined") {
    return new DOMException("API request timed out", "TimeoutError");
  }

  const error = new Error("API request timed out");
  error.name = "TimeoutError";
  return error;
}

async function getApiHeaders(headersInit?: HeadersInit): Promise<Headers> {
  const headers = new Headers(headersInit);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (process.env.NEXT_PUBLIC_BUILD_PHASE === "true") {
    return headers;
  }

  const { data: { session } } = await getSupabase().auth.getSession();
  const token = session?.access_token;

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `web-${crypto.randomUUID()}`;
  }

  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 18)}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return { success: true } as T;
  }

  const body = await response.text();
  if (!body) {
    return { success: true } as T;
  }

  return JSON.parse(body) as T;
}

function extractApiErrorMessage(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const payload = parsed as {
    detail?: unknown;
    message?: unknown;
    error?: unknown;
  };

  if (typeof payload.detail === "string") {
    return payload.detail;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (payload.error && typeof payload.error === "object") {
    const errorPayload = payload.error as { detail?: unknown; message?: unknown; code?: unknown };
    if (typeof errorPayload.detail === "string") {
      return errorPayload.detail;
    }
    if (typeof errorPayload.message === "string") {
      return errorPayload.message;
    }
    if (typeof errorPayload.code === "string") {
      return errorPayload.code;
    }
  }

  return undefined;
}

async function buildApiError(response: Response): Promise<ApiError> {
  let message = "The requested data could not be loaded.";
  if (response.status === 401) message = "Your session could not be verified. Please sign in again.";
  if (response.status === 403) message = "You do not have permission to access this resource.";
  if (response.status === 404) message = "Requested data could not be loaded.";
  if (response.status >= 500) message = "The service is temporarily unavailable. Please try again.";

  try {
    const body = await response.text();
    if (body) {
      const parsed = JSON.parse(body) as unknown;
      message = extractApiErrorMessage(parsed) ?? message;
    }
  } catch {
    // Keep the status-based message when the backend did not return JSON.
  }

  return new ApiError(response.status, message);
}

async function fetchApi<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
  const requestOptions: RequestInit = { ...options };
  delete (requestOptions as ApiRequestOptions).allowFallback;
  delete (requestOptions as ApiRequestOptions).timeoutMs;
  const allowFallback = shouldUseFallback(endpoint, options);
  const timeoutMs = process.env.NEXT_PUBLIC_BUILD_PHASE === "true"
    ? Math.min(options.timeoutMs ?? BUILD_API_TIMEOUT_MS, BUILD_API_TIMEOUT_MS)
    : options.timeoutMs ?? API_TIMEOUT_MS;

  // IMMEDIATELY RETURN MOCK DURING BUILD TO PREVENT TCP HANGS
  if (process.env.NEXT_PUBLIC_BUILD_PHASE === "true" && allowFallback) {
    return buildFallbackResponse<T>(endpoint);
  }

  const url = resolveApiUrl(endpoint);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const headers = await getApiHeaders(requestOptions.headers);

    const controller = new AbortController();
    const upstreamSignal = requestOptions.signal;
    if (upstreamSignal?.aborted) {
      controller.abort(upstreamSignal.reason ?? timeoutReason());
    } else if (upstreamSignal) {
      upstreamSignal.addEventListener("abort", () => controller.abort(upstreamSignal.reason ?? timeoutReason()), { once: true });
    }
    delete requestOptions.signal;

    timeoutId = setTimeout(() => controller.abort(timeoutReason()), timeoutMs);

    const response = await fetch(url, {
      ...requestOptions,
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      throw await buildApiError(response);
    }

    const data = await parseJsonResponse<T>(response);
    const apiData = data as { success?: boolean; error?: { message?: string } };
    if (apiData.success === false) {
      throw new ApiError(response.status, apiData.error?.message || "Unknown API error");
    }

    return data;
  } catch (error) {
    if (!allowFallback) {
      throw normalizeApiError(error);
    }

    console.warn(`[API] Fetch failed for ${url}. Returning fallback.`, getErrorMessage(error));

    // Graceful fallback during build or backend downtime
    return buildFallbackResponse<T>(endpoint);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

// --- PROJECTS ---
export async function getProjects(params?: { featured?: boolean; limit?: number; category?: string }): Promise<PaginatedResponse<Project>> {
  const searchParams = new URLSearchParams();
  if (params?.featured) searchParams.set("featured", "true");
  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.category) searchParams.set("category", params.category);
  
  return fetchApi<PaginatedResponse<Project>>(`/api/projects?${searchParams.toString()}`, {
    next: { revalidate: 3600 }
  });
}

export async function getProject(slug: string): Promise<ApiResponse<Project>> {
  return fetchApi<ApiResponse<Project>>(`/api/projects/${slug}`, {
    next: { revalidate: 3600 }
  });
}

// --- TENDERS ---
export async function getTenders(params?: { limit?: number; status?: string }): Promise<PaginatedResponse<Tender>> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.status) searchParams.set("status", params.status);

  return fetchApi<PaginatedResponse<Tender>>(`/api/tenders?${searchParams.toString()}`, {
    next: { revalidate: 300 }
  });
}

export async function submitTenderInterest(id: string, payload: TenderInterestPayload): Promise<ApiResponse<void>> {
  return fetchApi<ApiResponse<void>>(`/api/tenders/${id}/interest`, {
    method: "POST",
    headers: { "Idempotency-Key": createIdempotencyKey() },
    body: JSON.stringify(payload)
  });
}

// --- NEWS & KNOWLEDGE ---
export async function getArticles(params?: { limit?: number; category?: string }): Promise<PaginatedResponse<Article>> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.category) searchParams.set("category", params.category);

  return fetchApi<PaginatedResponse<Article>>(`/api/cms/articles?${searchParams.toString()}`, {
    next: { revalidate: 1800 }
  });
}

export async function getKnowledge(params?: { limit?: number }): Promise<PaginatedResponse<Article>> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", params.limit.toString());

  return fetchApi<PaginatedResponse<Article>>(`/api/cms/knowledge?${searchParams.toString()}`, {
    next: { revalidate: 1800 }
  });
}

// --- CAREERS ---
export async function getJobPositions(): Promise<PaginatedResponse<JobPosition>> {
  return fetchApi<PaginatedResponse<JobPosition>>(`/api/careers/positions`, {
    next: { revalidate: 900 }
  });
}

export async function submitJobApplication(payload: JobApplicationPayload): Promise<ApiResponse<void>> {
  return fetchApi<ApiResponse<void>>(`/api/careers/apply`, {
    method: "POST",
    headers: { "Idempotency-Key": createIdempotencyKey() },
    body: JSON.stringify(payload)
  });
}

// --- SUPPLIERS ---
export async function registerSupplier(payload: SupplierRegistrationPayload): Promise<ApiResponse<void>> {
  return fetchApi<ApiResponse<void>>(`/api/suppliers`, {
    method: "POST",
    headers: { "Idempotency-Key": createIdempotencyKey() },
    body: JSON.stringify(payload)
  });
}

// --- ENQUIRIES ---
export async function submitEnquiry(payload: EnquiryPayload): Promise<ApiResponse<void>> {
  return fetchApi<ApiResponse<void>>(`/api/enquiries`, {
    method: "POST",
    headers: { "Idempotency-Key": createIdempotencyKey() },
    body: JSON.stringify(payload)
  });
}

// --- LEADERSHIP ---
export async function getLeadership(): Promise<PaginatedResponse<LeadershipProfile>> {
  return fetchApi<PaginatedResponse<LeadershipProfile>>(`/api/cms/leadership`, {
    next: { revalidate: 3600 }
  });
}

// --- WEBSITE CONTENT ---
export async function getPublicWebsiteContent(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/cms/website-content`, {
    next: { revalidate: 60 }
  });
}

// --- BROADCAST FEEDS ---
export async function getPublicBroadcastFeeds(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/cms/broadcast-feeds`, {
    next: { revalidate: 10 }
  });
}

export async function getSettingsBroadcastFeeds(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/settings/broadcast-feeds`, {
    cache: 'no-store',
    allowFallback: false
  });
}

export async function createBroadcastFeed(payload: { title: string; description?: string; image_url: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/broadcast-feeds`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false
  });
}

// --- EXECUTIVE MODULE 07 ---
export async function getExecutiveKPIs(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/executive/kpis`, {
    cache: 'no-store',
    allowFallback: false
  });
}

export async function getModulesStatus(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/executive/modules`, {
    cache: 'no-store',
    allowFallback: false
  });
}

// --- CRM API CALLS --- //

export async function getCrmOpportunities() {
  return await fetchApi<ApiResponse<any[]>>('/api/v1/crm/opportunities', { cache: 'no-store' });
}

export async function createCrmOpportunity(data: { name: string, stage: string, budget?: number, probability?: number }): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>('/api/v1/crm/opportunities', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function getCrmTenders() {
  return await fetchApi<ApiResponse<any[]>>('/api/v1/crm/tenders', { cache: 'no-store' });
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

export async function createCrmTender(data: { tender_name: string, stage: string, bid_amount?: number }): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>('/api/v1/crm/tenders', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateCrmOpportunity(id: string, data: Record<string, any>) {
  return await fetchApi<ApiResponse<void>>(`/api/v1/crm/opportunities/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function updateCrmTender(id: string, data: Record<string, any>) {
  return await fetchApi<ApiResponse<void>>(`/api/v1/tender-bids/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function getCrmLeads(): Promise<ApiResponse<any[]>> {
  return await fetchApi<ApiResponse<any[]>>('/api/v1/crm-leads/', { cache: 'no-store' });
}

export async function qualifyCrmLead(leadId: string, payload?: any): Promise<ApiResponse<void>> {
  return await fetchApi<ApiResponse<void>>(`/api/v1/crm-leads/${leadId}/qualify`, {
    method: 'POST',
    body: payload ? JSON.stringify(payload) : undefined
  });
}

export async function createCrmLead(data: {
  company_name: string;
  contact_name: string;
  contact_email?: string;
  contact_phone?: string;
  sector: string;
  estimated_budget: number;
  lead_source: string;
  ai_score?: number;
  ai_rationale?: string;
}): Promise<ApiResponse<any>> {
  return await fetchApi<ApiResponse<any>>('/api/v1/crm-leads/', {
    method: 'POST',
    body: JSON.stringify(data)
  });
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

// --- CRM ACTIVITIES --- //
export async function getCrmActivities(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/crm-activities/', { cache: 'no-store' });
}

export async function createCrmActivity(data: {
  type: string;
  subject?: string;
  notes?: string;
  description?: string | null;
  activity_date?: string;
  status?: string;
  contact_id?: string | null;
  lead_id?: string | null;
  opportunity_id?: string | null;
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

export async function getUsers(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/users/', {
    cache: 'no-store',
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

// --- PROCUREMENT CONTROL TOWER --- //

export async function getProcurementRequisitions(params?: { status?: string; project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== "all") search.set("status", params.status);
  if (params?.project_id) search.set("project_id", params.project_id);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/procurement/requisitions${query}`, { cache: "no-store", allowFallback: false });
}

export async function createProcurementRequisition(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/procurement/requisitions", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function submitProcurementRequisition(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/requisitions/${id}/submit`, {
    method: "POST",
    allowFallback: false,
  });
}

export async function approveProcurementRequisition(id: string, decision: "approved" | "rejected", reason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/procurement/requisitions/${id}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, reason }),
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

export async function recordGoodsReceived(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/procurement/goods-received", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getProcurementSuppliers(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>("/api/v1/procurement/suppliers", { cache: "no-store", allowFallback: false });
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

export async function getExecutiveStats(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/executive/stats`, {
    cache: 'no-store',
    allowFallback: false
  });
}

export async function getExecutiveRegions(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/executive/regions`, { cache: 'no-store', allowFallback: false });
}

export async function getActiveExecutiveProjects(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/executive/projects/active`, { cache: 'no-store', allowFallback: false });
}

export async function getExecutiveProjectDetail(projectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/executive/projects/${encodeURIComponent(projectId)}/detail`, { cache: 'no-store', allowFallback: false });
}

/** Internal project register. Operational screens must not fall back to website demo data. */
export async function getInternalProjects(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/projects/`, { cache: 'no-store', allowFallback: false });
}

export async function getExecutiveDataHealth(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/executive/data-health`, { cache: 'no-store', allowFallback: false });
}

export async function getExecutiveExceptions(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/executive/exceptions`, { cache: 'no-store', allowFallback: false });
}

export async function getPortalAccess(portal: "executive" | "employee" | "foreman" | "client" | "supplier", accessToken?: string): Promise<ApiResponse<{ portal: string; destination: string }>> {
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
    company_name?: string;
  };
  tickets: ClientPortalTicket[];
  messages?: PortalCommunicationMessage[];
  modules: Array<{ key: string; label: string; status: "active" | "pending" }>;
}

export async function getClientPortalWorkspace(): Promise<ApiResponse<ClientPortalWorkspace>> {
  return fetchApi<ApiResponse<ClientPortalWorkspace>>(`/api/v1/portals/client/workspace`, {
    cache: 'no-store',
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

export async function getMyProfile(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/profile/me', { cache: 'no-store' });
}

export async function updateMyProfile(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/profile/me', { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function getWebsiteEnquiries(): Promise<ApiResponse<any[]>> {
  return await fetchApi<ApiResponse<any[]>>('/api/v1/website-enquiries/', { cache: 'no-store' });
}

export async function getWorkforce(): Promise<ApiResponse<any[]>> {
  return await fetchApi<ApiResponse<any[]>>('/api/v1/workforce/', { cache: 'no-store' });
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

export async function setSettingsRolePermission(roleId: string, permissionKey: string, enabled: boolean): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/roles/${roleId}/permissions`, {
    method: 'PATCH',
    body: JSON.stringify({ permission_key: permissionKey, enabled }),
    allowFallback: false,
  });
}

export async function createSettingsManagedAccount(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/settings/managed-accounts`, {
    method: 'POST',
    body: JSON.stringify(payload),
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

// --- EQUIPMENT INTELLIGENCE --- //

/** Equipment asset register. No fallback — live operational data only. */
export async function getEquipmentAssets(params?: { status?: string; project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  if (params?.project_id) search.set('project_id', params.project_id);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/fleet/${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getEquipmentAsset(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/fleet/${id}`, { cache: 'no-store', allowFallback: false });
}

export async function getAssetInspections(assetId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/fleet/${assetId}/inspections`, { cache: 'no-store', allowFallback: false });
}

export async function recordAssetInspection(assetId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  const outcomeMap: Record<string, string> = {
    minor_defects: 'conditional',
    major_defects: 'fail',
  };
  const outcome = typeof payload.outcome === 'string' ? payload.outcome : 'pass';
  const normalized = {
    fleet_id: assetId,
    inspection_type: 'pre_start',
    inspected_at: payload.inspection_date ? `${payload.inspection_date}T00:00:00` : undefined,
    outcome: outcomeMap[outcome] ?? outcome,
    odometer_km: payload.odometer_km,
    engine_hours: payload.engine_hours,
    checklist: {},
    notes: payload.notes,
  };
  return fetchApi<ApiResponse<any>>(`/api/v1/fleet/${assetId}/inspections`, {
    method: 'POST',
    body: JSON.stringify(normalized),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function recordAssetMeterReading(assetId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  const normalized = {
    occurred_on: payload.reading_date ?? payload.occurred_on ?? new Date().toISOString().slice(0, 10),
    operating_hours: payload.engine_hours ?? 0,
    idle_hours: payload.idle_hours ?? 0,
    distance_km: payload.distance_km ?? 0,
    odometer_km: payload.odometer_km,
    engine_hours: payload.engine_hours,
    fuel_litres: payload.fuel_litres,
    notes: payload.notes ?? (payload.recorded_by ? `Recorded by ${payload.recorded_by}` : undefined),
  };
  return fetchApi<ApiResponse<any>>(`/api/v1/fleet/${assetId}/meter-readings`, {
    method: 'POST',
    body: JSON.stringify(normalized),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function recordAssetDefect(assetId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  const normalized = {
    fleet_id: assetId,
    title: payload.title,
    severity: payload.severity,
    description: payload.description,
    defect_reference: payload.defect_reference,
  };
  return fetchApi<ApiResponse<any>>(`/api/v1/fleet/${assetId}/defects`, {
    method: 'POST',
    body: JSON.stringify(normalized),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

// --- SYSTEM HEALTH PING --- //
export async function pingEndpoint(route: string): Promise<boolean> {
  const url = resolveApiUrl(route);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const headers = await getApiHeaders();

    const response = await fetch(url, {
      cache: "no-store",
      headers,
      signal: controller.signal
    });

    return response.ok;
  } catch (error) {
    console.warn(`[API] Ping failed for ${url}.`, getErrorMessage(error));
    return false;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

// --- FINANCE & COST CONTROL ---

/** Organisation-wide financial summary across all active projects. */
export async function getFinanceProjectSummaries(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/financial-performance/projects', {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Full financial detail for a single project: budget vs actual, commitments, transactions, variations, claims. */
export async function getFinanceProjectDetail(projectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/financial-performance/projects/${projectId}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Cost code register. */
export async function getFinanceCostCodes(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/financial-performance/cost-codes', {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Create a new cost code. */
export async function createFinanceCostCode(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/financial-performance/cost-codes', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Variation register, optionally filtered by project or status. */
export async function getFinanceVariations(params?: { project_id?: string; status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.project_id) search.set('project_id', params.project_id);
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/financial-performance/variations${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Create a new variation order. */
export async function createFinanceVariation(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/financial-performance/variations', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Progress claims register, optionally filtered by project. */
export async function getFinanceProgressClaims(params?: { project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.project_id) search.set('project_id', params.project_id);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/financial-performance/progress-claims${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Budget register with budget lines, optionally filtered by project. */
export async function getFinanceBudgets(params?: { project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.project_id) search.set('project_id', params.project_id);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/budgets/${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

// --- INVENTORY & MATERIALS CONTROL ---

/** Stock levels across all stores. Optionally filtered by store or reorder threshold. */
export async function getInventoryStockLevels(params?: { store_id?: string; below_reorder?: boolean }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.store_id) search.set('store_id', params.store_id);
  if (params?.below_reorder) search.set('below_reorder', 'true');
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/inventory/stock-levels${qs}`, { cache: 'no-store', allowFallback: false });
}

/** Full item catalogue (master items, not per-store balances). */
export async function getInventoryCatalogue(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/inventory-items/', { cache: 'no-store', allowFallback: false });
}

/** Stores / warehouses / yards registered in the platform. */
export async function getInventoryStores(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/site-operations/stores', { cache: 'no-store', allowFallback: false });
}

/** Stock movement ledger. Filterable by store, type, or limit. */
export async function getStockMovements(params?: { store_id?: string; movement_type?: string; limit?: number }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.store_id) search.set('store_id', params.store_id);
  if (params?.movement_type) search.set('movement_type', params.movement_type);
  if (params?.limit) search.set('limit', String(params.limit));
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/inventory/movements${qs}`, { cache: 'no-store', allowFallback: false });
}

/** Post a stock receipt (goods inward). */
export async function receiveStock(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/inventory/receive', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Issue stock from a store against a project / work package. */
export async function issueStock(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/inventory/issue', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Add a new item to the master catalogue. */
export async function addInventoryItem(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/inventory-items/', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Register a new store / warehouse / yard. */
export async function addInventoryStore(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/site-operations/stores', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}


export async function getFinanceCashAccounts(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>("/api/v1/financial-performance/cash-accounts", { cache: "no-store", allowFallback: false });
}

export async function createFinanceCashAccount(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/financial-performance/cash-accounts", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getFinanceCashbook(params?: { cash_account_id?: string; project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.cash_account_id) search.set("cash_account_id", params.cash_account_id);
  if (params?.project_id) search.set("project_id", params.project_id);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/financial-performance/cashbook${query}`, { cache: "no-store", allowFallback: false });
}

export async function postFinanceCashbookTransaction(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/financial-performance/cashbook", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function allocateFinanceReceipt(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/financial-performance/receipts/allocate", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getFinanceSupplierPayments(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>("/api/v1/financial-performance/supplier-payments", { cache: "no-store", allowFallback: false });
}

export async function postFinanceSupplierPaymentBatch(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/financial-performance/supplier-payments", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getFinancePayrollProfiles(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>("/api/v1/financial-performance/payroll/profiles", { cache: "no-store", allowFallback: false });
}

export async function upsertFinancePayrollProfile(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/financial-performance/payroll/profiles", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getFinancePayrollRuns(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>("/api/v1/financial-performance/payroll/runs", { cache: "no-store", allowFallback: false });
}

export async function getFinancePayrollRunItems(runId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/financial-performance/payroll/runs/${runId}/items`, { cache: "no-store", allowFallback: false });
}

export async function createFinancePayrollRun(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/financial-performance/payroll/runs", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function decideFinancePayrollRun(runId: string, decision: "approved" | "cancelled"): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/financial-performance/payroll/runs/${runId}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision }),
    allowFallback: false,
  });
}

export async function postFinancePayrollRun(runId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/financial-performance/payroll/runs/${runId}/post`, {
    method: "POST",
    allowFallback: false,
  });
}
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

// --- DOCUMENT MANAGEMENT --- //

export async function getDocuments(params?: { category?: string; status?: string; classification?: string; search?: string; project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.category && params.category !== 'all') search.set('category', params.category);
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  if (params?.classification && params.classification !== 'all') search.set('classification', params.classification);
  if (params?.search) search.set('search', params.search);
  if (params?.project_id) search.set('project_id', params.project_id);
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

// --- QUOTATIONS --- //

export async function getQuotations(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/quotations/', { cache: 'no-store', allowFallback: false });
}

export async function getQuotation(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/quotations/${id}`, { cache: 'no-store', allowFallback: false });
}

export async function createQuotation(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function updateQuotation(id: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/quotations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

// --- QUOTATION INTELLIGENCE ENGINE --- //

export async function evaluateQuotationIntelligence(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/intelligence/evaluate', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}
export async function generateAutonomousQuote(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/intelligence/generate-quote', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getConstructionAssemblies(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/quotations/assemblies', { cache: 'no-store', allowFallback: false });
}

export async function calculateAssemblyBreakdown(assemblyCode: string, quantity: number): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/assemblies/calculate', {
    method: 'POST',
    body: JSON.stringify({ assembly_code: assemblyCode, quantity }),
    allowFallback: false,
  });
}

export async function benchmarkRate(itemCode: string, rate: number): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/quotations/rates/benchmark?item_code=${encodeURIComponent(itemCode)}&rate=${rate}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function generateSpendForecast(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/spend-forecast', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function auditSiteRequest(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/guard/audit', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function watchDocumentRevision(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/documents/watch', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCommercialBaselineHistory(params: { quotationId?: string; projectId?: string } = {}): Promise<ApiResponse<any[]>> {
  const query = new URLSearchParams();
  if (params.quotationId) query.set('quotation_id', params.quotationId);
  if (params.projectId) query.set('project_id', params.projectId);
  const qs = query.toString();
  return fetchApi<ApiResponse<any[]>>(`/api/v1/quotations/intelligence/baselines${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getGuardAuditHistory(projectId?: string): Promise<ApiResponse<any[]>> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/quotations/guard/audits${qs}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function saveCcbOverride(payload: {
  quotation_id: string;
  flag_title: string;
  approver_role: string;
  baseline_id?: string | null;
  notes?: string;
}): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/intelligence/override', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function simulateCcbScenario(payload: {
  base_payload: Record<string, unknown>;
  material_price_hike_pct?: number;
  subcontractor_rate_hike_pct?: number;
  productivity_change_pct?: number;
}): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/intelligence/simulate-scenario', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getRecommendedSubcontractors(category = 'Concrete & Structure'): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/quotations/intelligence/subcontractors/recommended?category=${encodeURIComponent(category)}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function forecastInflationImpact(payload: {
  base_cost: number;
  duration_weeks: number;
  currency?: string;
}): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/intelligence/inflation-forecast', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function classifyBoqDescription(description: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/intelligence/classify-description', {
    method: 'POST',
    body: JSON.stringify({ description }),
    allowFallback: false,
  });
}

export async function getDocumentChangeHistory(projectId?: string): Promise<ApiResponse<any[]>> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/quotations/documents/changes${qs}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function exportCcbControlFilePdf(payload: Record<string, unknown>): Promise<Blob> {
  const url = resolveApiUrl('/api/v1/quotations/intelligence/export-pdf');
  const headers = await getApiHeaders();
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return response.blob();
}

export async function createCustomAssembly(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/assemblies', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function deleteCustomAssembly(assemblyId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/quotations/assemblies/${assemblyId}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

export async function listRateBenchmarks(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/quotations/rates/benchmarks', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createRateBenchmark(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/rates/benchmarks', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function deleteRateBenchmark(benchmarkId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/quotations/rates/benchmarks/${benchmarkId}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

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

export async function getPayrollRuns(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/payroll-runs/', { cache: 'no-store', allowFallback: false });
}

export async function createPayrollRun(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/payroll-runs/', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}



