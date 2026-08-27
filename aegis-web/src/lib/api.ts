import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "./constants";
import { resolveBackendOrigin } from "./backend-url";
import { getSupabase, getCachedAccessToken } from "./supabase";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function isPermissionDenied(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

// A 403 means the action was refused, not that anything is broken - showing
// a generic "check your connection and retry" message on a permission
// failure sends people chasing a network problem that doesn't exist.
export function describeActionError(error: unknown, deniedMessage: string, fallbackMessage: string): string {
  return isPermissionDenied(error) ? deniedMessage : fallbackMessage;
}

type ApiRequestOptions = RequestInit & {
  allowFallback?: boolean;
  timeoutMs?: number;
};

const API_TIMEOUT_MS = 45000;
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

// Settings, CRM, and tender-bids calls have been observed taking 8-45s
// against this deployment's Supabase pooler even for simple single-table
// reads/writes, and multi-step actions (e.g. inviting a user) can exceed
// that. The default API_TIMEOUT_MS then fires on a request that actually
// succeeded server-side, surfacing a false "timed out" error. Give every
// call into these domains a generous budget by default instead of relying
// on each call site to opt in individually.
const SLOW_DOMAIN_TIMEOUT_MS = 120000;
const SLOW_DOMAIN_PREFIXES = [
  "/api/v1/settings/",
  "/api/v1/crm/",
  "/api/v1/crm-leads/",
  "/api/v1/crm-contacts/",
  "/api/v1/crm-organizations/",
  "/api/v1/crm-activities/",
  "/api/v1/crm-communications/",
  "/api/v1/crm-automations/",
  "/api/v1/crm-lifecycle/",
  "/api/v1/tender-bids/",
];

function defaultTimeoutFor(endpoint: string): number {
  return SLOW_DOMAIN_PREFIXES.some((prefix) => endpoint.startsWith(prefix)) ? SLOW_DOMAIN_TIMEOUT_MS : API_TIMEOUT_MS;
}

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
    // No fallback content: a failed/empty public-content fetch should
    // surface as a genuine empty state, never fabricated placeholder
    // tenders/articles/projects a real visitor could mistake for the truth.
    const fallbackData: any[] = [];
    return {
      success: true,
      data: fallbackData,
      meta: { total: 0, page: 1, limit: 10, size: 0, totalPages: 1 }
    } as T;
  } else {
    return {
      success: true,
      data: null,
      meta: { total: 0, page: 1, limit: 1, size: 0, totalPages: 1 }
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

function readCachedSupabaseAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) {
        continue;
      }

      const value = window.localStorage.getItem(key);
      if (!value) {
        continue;
      }

      const parsed = JSON.parse(value) as {
        access_token?: unknown;
        expires_at?: unknown;
        currentSession?: { access_token?: unknown; expires_at?: unknown };
      };
      const accessToken = parsed.access_token ?? parsed.currentSession?.access_token;
      const expiresAt = parsed.expires_at ?? parsed.currentSession?.expires_at;
      if (typeof accessToken === "string" && accessToken.length > 0) {
        // expires_at is a unix-seconds timestamp. Treat a token within 30s of
        // expiry as already stale rather than let it go out and bounce back
        // as a 401 - Supabase's own getSession() would have refreshed it.
        if (typeof expiresAt === "number" && expiresAt <= Date.now() / 1000 + 30) {
          continue;
        }
        return accessToken;
      }
    }
  } catch {
    return null;
  }

  return null;
}

// Coalesces concurrent fallback lookups into a single in-flight call. Pages
// with many initial fetches (Settings: overview, notifications, profile,
// auth/me, ...) all land here at once during the brief cold-load window
// before AuthContext has populated the cache above. Each one independently
// calling getSupabase().auth.getSession() was exactly the concurrent-call
// pattern that made the GoTrue client redundantly re-announce SIGNED_IN -
// which reset AuthContext's isLoading, remounted the whole dashboard shell,
// and caused every one of those fetches to fire again, sustaining the loop
// indefinitely instead of settling after one cycle. Sharing one promise
// across all callers means only one getSession() call ever goes out for a
// given cold-load burst.
let inFlightAccessTokenLookup: Promise<string | null> | null = null;

async function getSupabaseAccessToken(timeoutMs = 2500): Promise<string | null> {
  // AuthContext is the single subscriber to onAuthStateChange and keeps a
  // cached copy of the current token in sync with every session change.
  // Prefer it; only fall back to asking Supabase directly (e.g. before
  // AuthProvider has mounted) when it's empty.
  const cachedToken = getCachedAccessToken();
  if (cachedToken) {
    return cachedToken;
  }

  if (inFlightAccessTokenLookup) {
    return inFlightAccessTokenLookup;
  }

  inFlightAccessTokenLookup = (async () => {
    try {
      // getSession() is the authoritative fallback path: it auto-refreshes an
      // expired token instead of returning it as-is. The raw localStorage read
      // below is a further fallback for when it's slow/unavailable.
      const timeout = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), timeoutMs);
      });

      try {
        const result = await Promise.race([
          getSupabase().auth.getSession(),
          timeout,
        ]);

        // A resolved-but-empty session is ambiguous on a cold page load: the
        // SDK may not have finished rehydrating the persisted session from
        // storage yet and is reporting "no session" prematurely rather than
        // genuinely being logged out. Fall through to the cache in that case
        // too, instead of only when getSession() times out or throws -
        // otherwise every fresh page load races this and can bounce an
        // actually-logged-in user to a 401.
        if (result !== "timeout") {
          const liveToken = result.data.session?.access_token;
          if (liveToken) {
            return liveToken;
          }
        }
      } catch {
        // fall through to the cached-token fallback below
      }

      return readCachedSupabaseAccessToken();
    } finally {
      inFlightAccessTokenLookup = null;
    }
  })();

  return inFlightAccessTokenLookup;
}

async function getApiHeaders(headersInit?: HeadersInit): Promise<Headers> {
  const headers = new Headers(headersInit);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (process.env.AEGIS_BUILD_PHASE === "true") {
    return headers;
  }

  if (headers.has("Authorization")) {
    return headers;
  }

  const token = await getSupabaseAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

async function ensureAuthorizationHeader(headers: Headers, timeoutMs?: number): Promise<boolean> {
  if (headers.has("Authorization") || process.env.AEGIS_BUILD_PHASE === "true") {
    return headers.has("Authorization");
  }

  const token = await getSupabaseAccessToken(timeoutMs);
  if (!token) {
    return false;
  }

  headers.set("Authorization", `Bearer ${token}`);
  return true;
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

  // Compliance deployment-gate blocks (core.compliance.validate_employee_deployment)
  // return a structured 409 detail object rather than a plain string, so the
  // missing licence/training/paperwork requirements would otherwise be
  // silently dropped in favour of a generic "could not be loaded" message.
  if (payload.detail && typeof payload.detail === "object") {
    const detail = payload.detail as {
      message?: unknown;
      missing_requirements?: unknown;
    };
    if (typeof detail.message === "string") {
      const missing = Array.isArray(detail.missing_requirements) ? detail.missing_requirements : [];
      const reasons = missing
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const entry = item as { certification_name?: unknown; requirement?: unknown; reason?: unknown };
          const label = typeof entry.certification_name === "string" ? entry.certification_name : (typeof entry.requirement === "string" ? entry.requirement : null);
          const reason = typeof entry.reason === "string" ? entry.reason : null;
          return label ? (reason ? `${label} (${reason})` : label) : reason;
        })
        .filter((value): value is string => Boolean(value));
      return reasons.length ? `${detail.message} Missing: ${reasons.join(", ")}.` : detail.message;
    }
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
  let message = "The requested data could not be loaded. Please retry in a moment.";
  if (response.status === 401) message = "Your session could not be verified. Please sign in again.";
  if (response.status === 403) message = "You do not have permission to access this resource.";
  if (response.status === 404) message = "Requested resource was not found.";
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    message = "The backend service is waking up or temporarily unavailable. Please retry in a few seconds.";
  } else if (response.status >= 500) {
    message = "The service is temporarily unavailable. Please try again.";
  }

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
  const timeoutMs = process.env.AEGIS_BUILD_PHASE === "true"
    ? Math.min(options.timeoutMs ?? BUILD_API_TIMEOUT_MS, BUILD_API_TIMEOUT_MS)
    : options.timeoutMs ?? defaultTimeoutFor(endpoint);

  // IMMEDIATELY RETURN MOCK DURING BUILD TO PREVENT TCP HANGS
  if (process.env.AEGIS_BUILD_PHASE === "true" && allowFallback) {
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

    let sentAuthorization = headers.has("Authorization");
    let response = await fetch(url, {
      ...requestOptions,
      headers,
      signal: controller.signal
    });

    if (response.status === 401 && !sentAuthorization) {
      const retryHeaders = new Headers(headers);
      sentAuthorization = await ensureAuthorizationHeader(retryHeaders, 10000);
      if (sentAuthorization && !controller.signal.aborted) {
        response = await fetch(url, {
          ...requestOptions,
          headers: retryHeaders,
          signal: controller.signal
        });
      }
    }

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

// Same live-attempt-then-mock-fallback pattern as the list functions above -
// today there's no CMS backend so this always resolves via the mock data
// fallback, but the moment one exists these start returning real content
// without needing the detail pages touched again.
export async function getArticleBySlug(slug: string): Promise<ApiResponse<Article | null>> {
  return fetchApi<ApiResponse<Article | null>>(`/api/cms/articles/${encodeURIComponent(slug)}`, {
    next: { revalidate: 1800 }
  });
}

export async function getKnowledgeBySlug(slug: string): Promise<ApiResponse<Article | null>> {
  return fetchApi<ApiResponse<Article | null>>(`/api/cms/knowledge/${encodeURIComponent(slug)}`, {
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

// --- PUBLIC METRICS ---
export interface PublicMetricsSummary {
  projects_delivered: number;
  contract_value_usd: number;
  fleet_assets_deployed: number;
  safety_incidents_logged: number;
}

export async function getPublicMetricsSummary(): Promise<ApiResponse<PublicMetricsSummary>> {
  return fetchApi<ApiResponse<PublicMetricsSummary>>(`/api/v1/metrics`, {
    next: { revalidate: 300 },
    // These numbers are shown publicly as fact - never let a network hiccup
    // silently fall back to fabricated placeholder data.
    allowFallback: false
  });
}

// --- NEWSLETTER ---
export async function subscribeNewsletter(email: string): Promise<ApiResponse<void>> {
  return fetchApi<ApiResponse<void>>(`/api/cms/newsletter`, {
    method: "POST",
    headers: { "Idempotency-Key": createIdempotencyKey() },
    body: JSON.stringify({ email }),
    // A POST must never silently report success via mock fallback data.
    allowFallback: false
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
function bearerHeaders(accessToken?: string): HeadersInit | undefined {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
}

const EXECUTIVE_READ_TIMEOUT_MS = 120000;

export async function getExecutiveKPIs(accessToken?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/executive/kpis`, {
    cache: 'no-store',
    headers: bearerHeaders(accessToken),
    timeoutMs: EXECUTIVE_READ_TIMEOUT_MS,
    allowFallback: false
  });
}

export async function getModulesStatus(accessToken?: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/executive/modules`, {
    cache: 'no-store',
    headers: bearerHeaders(accessToken),
    timeoutMs: EXECUTIVE_READ_TIMEOUT_MS,
    allowFallback: false
  });
}

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
  return await fetchApi<ApiResponse<any[]>>('/api/v1/crm/tenders', { cache: 'no-store' });
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

/** Award a tender: creates/links a real project and seeds its budget from any linked quotation. */
export async function awardCrmTender(tenderId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/tender-bids/${tenderId}/award`, {
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
export async function confirmProjectDeposit(projectId: string, payload: { deposit_reference?: string; notes?: string }): Promise<ApiResponse<any>> {
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

/** Finance sets an ad-hoc execution budget ceiling on a project with no quotation-derived budget. */
export async function setProjectBudget(projectId: string, totalAmount: number, notes?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${projectId}/budget`, {
    method: 'POST',
    body: JSON.stringify({ total_amount: totalAmount, notes }),
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
    inspection_type: payload.inspection_type ?? 'pre_start',
    inspected_at: payload.inspection_date ? `${payload.inspection_date}T00:00:00` : undefined,
    outcome: outcomeMap[outcome] ?? outcome,
    severity: payload.severity,
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
    expected_consumption_litres: payload.expected_consumption_litres,
    actual_consumption_litres: payload.actual_consumption_litres,
    storage_tank: payload.storage_tank,
    receipt_reference: payload.receipt_reference,
    cost_centre: payload.cost_centre,
    receiver_signature: payload.receiver_signature,
    tank_balance_after: payload.tank_balance_after,
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
    title: payload.title ?? (payload.description ? String(payload.description).slice(0, 80) : "Asset defect"),
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

/** Register a new asset in the fleet register (routers/fleet.py AssetPayload). Fleet
 * and Equipment are two dashboard views over the same fleet.fleet table, distinguished
 * by vehicle_type/asset_code, not separate registers - so this single endpoint backs
 * both createFleetAsset and createEquipmentAsset below. */
export async function createFleetAsset(payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>('/api/v1/fleet/', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function updateFleetAsset(assetId: string, payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`/api/v1/fleet/${assetId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export const createEquipmentAsset = createFleetAsset;
export const updateEquipmentAsset = updateFleetAsset;

/** Deploy an asset: assign a project, operator/driver, dispatch window, and route.
 * The backend runs the operator through validate_employee_deployment (license,
 * training, medical, employment-status checks) when status is dispatched/active and
 * returns 409 with the missing requirements if the operator isn't cleared - see
 * extractApiErrorMessage above for how that surfaces to the UI. */
export async function createFleetAssignment(payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>('/api/v1/fleet/assignments', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export const createEquipmentAssignment = createFleetAssignment;

export async function getFleetAssignments(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/fleet/assignments', { cache: 'no-store', allowFallback: false });
}

export async function getFleetOperatorProfiles(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/fleet/operator-profiles', { cache: 'no-store', allowFallback: false });
}

export async function createFleetOperatorProfile(payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>('/api/v1/fleet/operator-profiles', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function getExternalPlantHireAgreements(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/fleet/external-hire-agreements', { cache: 'no-store', allowFallback: false });
}

export async function createExternalPlantHireAgreement(payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>('/api/v1/fleet/external-hire-agreements', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function getPlantLifecycleSummary(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/fleet/plant/summary', { cache: 'no-store', allowFallback: false });
}

export async function getPlantRequests(params?: { status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status && params.status !== "all") search.set("status_filter", params.status);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/fleet/plant/requests${query}`, { cache: 'no-store', allowFallback: false });
}

export async function createPlantRequest(payload: Record<string, unknown>): Promise<ApiResponse<{ id: string; request_number: string }>> {
  return fetchApi<ApiResponse<{ id: string; request_number: string }>>('/api/v1/fleet/plant/requests', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function updatePlantRequestStatus(plantRequestId: string, payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`/api/v1/fleet/plant/requests/${plantRequestId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function reservePlantAsset(plantRequestId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/fleet/plant/requests/${plantRequestId}/reserve`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function dispatchPlantAsset(plantRequestId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/fleet/plant/requests/${plantRequestId}/dispatch`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function recordPlantIncident(plantRequestId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/fleet/plant/requests/${plantRequestId}/incidents`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function createPlantOffHire(plantRequestId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/fleet/plant/requests/${plantRequestId}/off-hire`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function createPlantReturnInspection(plantRequestId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/fleet/plant/requests/${plantRequestId}/return-inspections`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function closePlantFinancials(plantRequestId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/fleet/plant/requests/${plantRequestId}/financial-close`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function createFleetWorkOrder(payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>('/api/v1/fleet/work-orders', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Idempotency-Key': `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    allowFallback: false,
  });
}

export async function decideFleetWorkOrder(workOrderId: string, payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`/api/v1/fleet/work-orders/${workOrderId}/decision`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export const createEquipmentWorkOrder = createFleetWorkOrder;
export const decideEquipmentWorkOrder = decideFleetWorkOrder;

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

/** The organisation's finance departments (Construction, Plant & Equipment, Commercial). */
export async function getFinanceDepartments(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/finance/departments/', {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Internal department-transfer register, optionally filtered. */
export async function getFinanceTransfers(params?: { department_id?: string; transfer_type?: string; project_id?: string; status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.department_id) search.set('department_id', params.department_id);
  if (params?.transfer_type) search.set('transfer_type', params.transfer_type);
  if (params?.project_id) search.set('project_id', params.project_id);
  if (params?.status) search.set('status', params.status);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/transfers/${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getFinanceTransfer(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/transfers/${id}`, { cache: 'no-store', allowFallback: false });
}

export async function createFinanceTransfer(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/transfers/', { method: 'POST', body: JSON.stringify(payload), allowFallback: false });
}

export async function reverseFinanceTransfer(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/transfers/${id}/reverse`, { method: 'POST', allowFallback: false });
}

export async function getFinanceTransferSummary(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/finance/transfers/summary', { cache: 'no-store', allowFallback: false });
}

export async function getFinanceTransferRules(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/finance/transfers/rules', { cache: 'no-store', allowFallback: false });
}

export async function saveFinanceTransferRule(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/transfers/rules', { method: 'POST', body: JSON.stringify(payload), allowFallback: false });
}

/** Revenue and cost per department, plus a consolidated whole-business total. */
export async function getFinanceDepartmentPnl(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/financial-performance/departments/pnl', { cache: 'no-store', allowFallback: false });
}

// --- STATUTORY (ZIMRA/VAT/PAYE/NSSA) ---

export async function getFinanceRateTables(params?: { tax_type?: string; currency?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.tax_type) search.set('tax_type', params.tax_type);
  if (params?.currency) search.set('currency', params.currency);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/statutory/rate-tables${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getFinanceActiveRateTable(taxType: string, currency = 'USD'): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/statutory/rate-tables/active?tax_type=${encodeURIComponent(taxType)}&currency=${encodeURIComponent(currency)}`, {
    cache: 'no-store', allowFallback: false,
  });
}

export async function createFinanceRateTable(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/statutory/rate-tables', {
    method: 'POST', body: JSON.stringify(payload), allowFallback: false,
  });
}

export async function deactivateFinanceRateTable(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/statutory/rate-tables/${id}/deactivate`, {
    method: 'POST', allowFallback: false,
  });
}

export async function getFinanceStatutoryLiabilities(params?: { authority?: string; liability_type?: string; status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.authority) search.set('authority', params.authority);
  if (params?.liability_type) search.set('liability_type', params.liability_type);
  if (params?.status) search.set('status', params.status);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/statutory/liabilities${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getFinanceStatutoryLiability(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/statutory/liabilities/${id}`, { cache: 'no-store', allowFallback: false });
}

export async function fileFinanceStatutoryLiability(id: string, filingReference?: string): Promise<ApiResponse<any>> {
  const search = new URLSearchParams();
  if (filingReference) search.set('filing_reference', filingReference);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/statutory/liabilities/${id}/file${query}`, { method: 'POST', allowFallback: false });
}

export async function settleFinanceStatutoryLiability(id: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/statutory/liabilities/${id}/settle`, {
    method: 'POST', body: JSON.stringify(payload), allowFallback: false,
  });
}

export async function getFinanceStatutorySummary(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/finance/statutory/summary', { cache: 'no-store', allowFallback: false });
}

export async function recomputeFinanceStatutory(payload: { period_start: string; period_end: string; currency?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/statutory/recompute', {
    method: 'POST', body: JSON.stringify(payload), allowFallback: false,
  });
}

/** Organisation-wide financial summary across all active projects, optionally scoped to a department. */
export async function getFinanceProjectSummaries(params?: { department_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.department_id) search.set('department_id', params.department_id);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/financial-performance/projects${query}`, {
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

/** Cost code register, optionally scoped to a department. */
export async function getFinanceCostCodes(params?: { department_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.department_id) search.set('department_id', params.department_id);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/financial-performance/cost-codes${query}`, {
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

/** Variation register, optionally filtered by project, status, or department. */
export async function getFinanceVariations(params?: { project_id?: string; status?: string; department_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.project_id) search.set('project_id', params.project_id);
  if (params?.status && params.status !== 'all') search.set('status', params.status);
  if (params?.department_id) search.set('department_id', params.department_id);
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

/** Approve or reject a variation (including client-submitted ones from the client portal). */
export async function decideFinanceVariation(variationId: string, decision: "approve" | "reject", rejectionReason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/financial-performance/variations/${variationId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, rejection_reason: rejectionReason }),
    allowFallback: false,
  });
}

// ---------------------------------------------------------------------------
// Finance historical backfill - pre-AEGIS project revenue/cost entry,
// driven through the same lifecycles the live system uses (see
// imperium-api/routers/financial_performance.py historical/* endpoints).
// ---------------------------------------------------------------------------

export interface HistoricalProjectCreatePayload {
  name: string;
  department_id: string;
  project_code?: string;
  project_type?: string;
  start_date?: string;
  client_org_id?: string;
  new_client_name?: string;
  new_contact_name?: string;
  new_contact_email?: string;
}

export async function createHistoricalProject(payload: HistoricalProjectCreatePayload): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/financial-performance/historical/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function createHistoricalRevenue(payload: {
  project_id: string;
  amount: number;
  historical_date: string;
  description?: string;
}): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/financial-performance/historical/revenue', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function createHistoricalCostActivity(payload: {
  project_id: string;
  cost_category: "labour" | "equipment" | "materials" | "subcontract" | "overhead" | "other";
  description: string;
  amount: number;
  historical_date: string;
  paid?: boolean;
}): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/financial-performance/historical/cost-activities', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export interface FinancialStatementParams {
  period?: "day" | "week" | "month" | "quarter" | "year";
  anchor_date?: string;
  date_from?: string;
  date_to?: string;
  department_id?: string;
}

export async function getFinanceStatements(params?: FinancialStatementParams): Promise<ApiResponse<any>> {
  const search = new URLSearchParams();
  if (params?.period) search.set('period', params.period);
  if (params?.anchor_date) search.set('anchor_date', params.anchor_date);
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  if (params?.department_id) search.set('department_id', params.department_id);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any>>(`/api/v1/financial-performance/statements${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getFinancialRunway(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/executive/financial-runway', {
    cache: 'no-store',
    allowFallback: false,
  });
}

// ---------------------------------------------------------------------------
// Internal staff: HR vendor verification queue, Finance payment-request queues
// ---------------------------------------------------------------------------

export async function getHrVendorVerificationQueue(stage?: string): Promise<ApiResponse<any[]>> {
  const query = stage ? `?stage=${stage}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/hr/vendor-verification/queue${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export interface HrVendorVerificationDetail {
  vendor: SupplierPortalVendor & Record<string, any>;
  filled_fields: Array<{ key: string; label: string; value: any }>;
  documents: VendorDocument[];
}

export async function getHrVendorVerificationDetail(subcontractorId: string): Promise<ApiResponse<HrVendorVerificationDetail>> {
  return fetchApi<ApiResponse<HrVendorVerificationDetail>>(`/api/v1/hr/vendor-verification/${encodeURIComponent(subcontractorId)}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function decideHrVendorVerification(subcontractorId: string, decision: "approve" | "reject", notes?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/hr/vendor-verification/${subcontractorId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, notes }),
    allowFallback: false,
  });
}

export async function runHrVendorSystemCheck(subcontractorId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/hr/vendor-verification/${subcontractorId}/run-system-check`, {
    method: 'POST',
    allowFallback: false,
  });
}

export async function getHrVendorVerificationDocuments(subcontractorId: string): Promise<ApiResponse<VendorDocument[]>> {
  return fetchApi<ApiResponse<VendorDocument[]>>(`/api/v1/hr/vendor-verification/${encodeURIComponent(subcontractorId)}/documents`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getHrVendorVerificationDocumentSignedUrl(
  subcontractorId: string,
  documentId: string
): Promise<ApiResponse<{ url: string; file_name: string | null; mime_type: string | null; expires_in: number }>> {
  return fetchApi<ApiResponse<{ url: string; file_name: string | null; mime_type: string | null; expires_in: number }>>(`/api/v1/hr/vendor-verification/${encodeURIComponent(subcontractorId)}/documents/${encodeURIComponent(documentId)}/signed-url`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function decideHrVendorVerificationDocument(
  subcontractorId: string,
  documentId: string,
  payload: { status: SupplierComplianceDocumentStatus; review_notes?: string }
): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/hr/vendor-verification/${encodeURIComponent(subcontractorId)}/documents/${encodeURIComponent(documentId)}/decision`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getFinanceVendorPaymentRequests(status?: string): Promise<ApiResponse<any[]>> {
  const query = status ? `?status=${status}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/payments/vendor-requests${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function clearFinanceVendorPaymentRequest(id: string, receiptDocumentId: string, notes?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/payments/vendor-requests/${id}/clear`, {
    method: 'POST',
    body: JSON.stringify({ receipt_document_id: receiptDocumentId, notes }),
    allowFallback: false,
  });
}

export async function getFinanceClientPaymentRequests(params?: { project_id?: string; status?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.project_id) search.set('project_id', params.project_id);
  if (params?.status) search.set('status', params.status);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/financial-performance/client-payment-requests${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function createFinanceClientPaymentRequest(payload: {
  project_id: string;
  progress_claim_id?: string;
  title: string;
  description?: string;
  amount: number;
  currency?: string;
  due_date?: string;
}): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/financial-performance/client-payment-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function clearFinanceClientPaymentRequest(id: string, receiptDocumentId: string, notes?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/financial-performance/client-payment-requests/${id}/clear`, {
    method: 'POST',
    body: JSON.stringify({ receipt_document_id: receiptDocumentId, notes }),
    allowFallback: false,
  });
}

/** Progress claims register, optionally filtered by project or department. */
export async function getFinanceProgressClaims(params?: { project_id?: string; department_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.project_id) search.set('project_id', params.project_id);
  if (params?.department_id) search.set('department_id', params.department_id);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/financial-performance/progress-claims${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Submit a new progress claim (draft/submitted). */
export async function createFinanceProgressClaim(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/financial-performance/progress-claims', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Certify a submitted progress claim - accrues output VAT if a rate is configured. */
export async function certifyFinanceProgressClaim(claimId: string, certifiedAmount?: number): Promise<ApiResponse<any>> {
  const search = new URLSearchParams();
  if (certifiedAmount !== undefined) search.set('certified_amount', String(certifiedAmount));
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any>>(`/api/v1/financial-performance/progress-claims/${claimId}/certify${query}`, {
    method: 'POST',
    allowFallback: false,
  });
}

/** Budget register with budget lines, optionally filtered by project or department. */
export async function getFinanceBudgets(params?: { project_id?: string; department_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.project_id) search.set('project_id', params.project_id);
  if (params?.department_id) search.set('department_id', params.department_id);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/budgets/${query}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

// --- BOQ PROGRESS (measured-quantity earned value) ---

/** Priced BOQ line items for a project, with measured qty/% complete/earned value. */
export async function getBoqLineItems(projectId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/boq-progress/projects/${projectId}/line-items`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Submit a measured quantity against a BOQ line item, pending approval. */
export async function recordBoqMeasurement(lineItemId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/boq-progress/line-items/${lineItemId}/measurements`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Submitted/approved/rejected BOQ measurement entries for a project. */
export async function getBoqMeasurements(projectId: string, status?: string): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams({ project_id: projectId });
  if (status) search.set('status_filter', status);
  return fetchApi<ApiResponse<any[]>>(`/api/v1/boq-progress/measurements?${search.toString()}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Approve a submitted BOQ measurement, updating the line item's qty measured to date. */
export async function approveBoqMeasurement(entryId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/boq-progress/measurements/${entryId}/approve`, {
    method: 'POST',
    allowFallback: false,
  });
}

/** Reject a submitted BOQ measurement with a reason. */
export async function rejectBoqMeasurement(entryId: string, rejectionReason: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/boq-progress/measurements/${entryId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ rejection_reason: rejectionReason }),
    allowFallback: false,
  });
}

/** Value-weighted earned-value summary for a project (contract value, earned value, % complete, claimable). */
export async function getBoqProgressSummary(projectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/boq-progress/projects/${projectId}/summary`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Amount claimable now: earned value to date minus what's already been certified. */
export async function getBoqClaimableAmount(projectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/boq-progress/projects/${projectId}/claimable-amount`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

// --- FINAL ACCOUNTS (project close-out) ---

/** Snapshots current live financials into a new draft final account, with any unresolved variations/claims flagged as blockers. */
export async function prepareFinalAccount(projectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/final-accounts/projects/${projectId}/prepare`, {
    method: 'POST',
    allowFallback: false,
  });
}

/** Current/latest final account for a project, including version history. */
export async function getFinalAccount(projectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/final-accounts/projects/${projectId}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

/** Edit a draft/under-negotiation final account (e.g. negotiated retention adjustment, notes). */
export async function updateFinalAccount(finalAccountId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/final-accounts/${finalAccountId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Mark a final account as client-agreed. Requires all variations/claims resolved. */
export async function agreeFinalAccount(finalAccountId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/final-accounts/${finalAccountId}/agree`, {
    method: 'POST',
    allowFallback: false,
  });
}

/** Permanently close a final account: releases retention and locks the project's commercial position. */
export async function closeFinalAccount(finalAccountId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/final-accounts/${finalAccountId}/close`, {
    method: 'POST',
    allowFallback: false,
  });
}

/** Structured Final Cost Report data for a final account. */
export async function getFinalAccountReport(finalAccountId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/final-accounts/${finalAccountId}/report`, {
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
export async function getInventoryStores(params?: { project_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.project_id) search.set('project_id', params.project_id);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/inventory/stores${qs}`, { cache: 'no-store', allowFallback: false });
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

/** Capture a complete supplier invoice and receive every stock line together. */
export async function receiveInventoryInvoice(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/inventory/receive-invoice', {
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

/** Transfer stock from one store/site to another. */
export async function transferStock(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/inventory/transfer', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Record a stock count / adjustment (shrinkage, damage, correction). */
export async function adjustStock(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/inventory/adjustment', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

/** Add a new item to the master catalogue. */
export async function addInventoryItem(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  const body = { ...payload };
  if (body.uom && !body.unit_of_measure) body.unit_of_measure = body.uom;
  delete body.uom;
  return fetchApi<ApiResponse<any>>('/api/v1/inventory-items/', {
    method: 'POST',
    body: JSON.stringify(body),
    allowFallback: false,
  });
}

/** Update a catalogue item, including once-off / reorder policy metadata. */
export async function updateInventoryItem(itemId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  const body = { ...payload };
  if (body.uom && !body.unit_of_measure) body.unit_of_measure = body.uom;
  delete body.uom;
  return fetchApi<ApiResponse<any>>(`/api/v1/inventory-items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    allowFallback: false,
  });
}

/** Soft-delete a catalogue item. Existing stock ledger history is kept. */
export async function deleteInventoryItem(itemId: string): Promise<ApiResponse<void>> {
  return fetchApi<ApiResponse<void>>(`/api/v1/inventory-items/${itemId}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

/** Register a new store / warehouse / yard. */
export async function addInventoryStore(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/inventory/stores', {
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

/** Soft-deletes a cash account - drops out of listings/auto-pick, existing transaction history is untouched. */
export async function deleteFinanceCashAccount(cashAccountId: string): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`/api/v1/financial-performance/cash-accounts/${cashAccountId}`, {
    method: "DELETE",
    allowFallback: false,
  });
}

export async function getFinanceCashbook(params?: { cash_account_id?: string; project_id?: string; department_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.cash_account_id) search.set("cash_account_id", params.cash_account_id);
  if (params?.project_id) search.set("project_id", params.project_id);
  if (params?.department_id) search.set("department_id", params.department_id);
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

export async function getFinanceSupplierPayments(params?: { department_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.department_id) search.set("department_id", params.department_id);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/financial-performance/supplier-payments${query}`, { cache: "no-store", allowFallback: false });
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

export async function getFinancePayrollRuns(params?: { department_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.department_id) search.set("department_id", params.department_id);
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/financial-performance/payroll/runs${query}`, { cache: "no-store", allowFallback: false });
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

export async function decideFinancePayrollRun(runId: string, status: "approved" | "cancelled"): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/financial-performance/payroll/runs/${runId}/decision`, {
    method: "POST",
    body: JSON.stringify({ status }),
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

export async function getHRLeaveCalendar(params?: { date_from?: string; date_to?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  const qs = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/hr/operations/leave-calendar${qs}`, { cache: 'no-store', allowFallback: false });
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

export async function importBoqFile(
  file: File,
  context?: { source_type?: string | null; source_id?: string | null; task_id?: string | null; document_id?: string | null }
): Promise<ApiResponse<{ items: any[]; warnings: string[]; summary: Record<string, unknown>; linked?: Record<string, unknown> }>> {
  const formData = new FormData();
  formData.append("file", file);
  if (context) {
    Object.entries(context).forEach(([key, value]) => {
      if (value) formData.append(key, value);
    });
  }
  const url = resolveApiUrl("/api/v1/quotations/boq/import");
  const headers = await getApiHeaders();
  headers.delete("Content-Type"); // let the browser set the multipart boundary
  const response = await fetch(url, { method: "POST", headers, body: formData });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return parseJsonResponse<ApiResponse<{ items: any[]; warnings: string[]; summary: Record<string, unknown>; linked?: Record<string, unknown> }>>(response);
}

export async function getQuotations(params?: {
  limit?: number;
  offset?: number;
  status?: string;
  sort_by?: 'created_at' | 'client_name' | 'status' | 'quote_amount';
  sort_dir?: 'asc' | 'desc';
}): Promise<ApiResponse<any[]>> {
  const query = params
    ? '?' + new URLSearchParams(
        Object.entries(params).reduce((acc, [k, v]) => {
          if (v !== undefined && v !== null && v !== '') acc[k] = String(v);
          return acc;
        }, {} as Record<string, string>)
      ).toString()
    : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/quotations/${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getQuotation(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/quotations/${id}`, { cache: 'no-store', allowFallback: false });
}

export async function getQuotationsNeedsBoq(): Promise<ApiResponse<{ tenders: any[]; opportunities: any[] }>> {
  return fetchApi<ApiResponse<{ tenders: any[]; opportunities: any[] }>>(`/api/v1/quotations/needs-boq`, { cache: 'no-store', allowFallback: false });
}

export async function getQuotationSourceLookup(sourceType: string, sourceId: string): Promise<ApiResponse<{ source: any; existing_quotation_id: string | null }>> {
  const query = new URLSearchParams({ source_type: sourceType, source_id: sourceId }).toString();
  return fetchApi<ApiResponse<{ source: any; existing_quotation_id: string | null }>>(`/api/v1/quotations/source-lookup?${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getQuotationHistory(id: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/quotations/${id}/history`, { cache: 'no-store', allowFallback: false });
}

export async function calculateQuotation(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/calculate', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
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

export async function decideQuotation(id: string, status: 'won' | 'lost', notes?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/quotations/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ status, notes }),
    allowFallback: false,
  });
}

export async function deleteQuotation(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/quotations/${id}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}

// --- DRAWING TAKEOFF & CHANGE-CONTROL --- //

export async function createDrawingRevision(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/drawings/', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function listDrawingRevisions(params?: { project_id?: string; quotation_id?: string; drawing_name?: string }): Promise<ApiResponse<any[]>> {
  const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/drawings/${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getDrawingRevision(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/drawings/${id}`, { cache: 'no-store', allowFallback: false });
}

export async function replaceDrawingMeasurements(id: string, measurements: Array<Record<string, unknown>>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/drawings/${id}/measurements`, {
    method: 'PUT',
    body: JSON.stringify({ measurements }),
    allowFallback: false,
  });
}

export async function setDrawingChecklistItem(revisionId: string, itemId: string, checked: boolean): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/drawings/${revisionId}/checklist/${itemId}/check`, {
    method: 'POST',
    body: JSON.stringify({ checked }),
    allowFallback: false,
  });
}

export async function commitDrawingRevision(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/drawings/${id}/commit`, {
    method: 'POST',
    allowFallback: false,
  });
}

export async function getDrawingRevisionAsBoq(id: string): Promise<ApiResponse<{ items: any[] }>> {
  return fetchApi<ApiResponse<{ items: any[] }>>(`/api/v1/drawings/${id}/as-boq`, { cache: 'no-store', allowFallback: false });
}

// --- SOP CHECKLIST ENFORCEMENT --- //

export async function listSopTemplates(appliesTo?: 'quotation' | 'project'): Promise<ApiResponse<any[]>> {
  const query = appliesTo ? `?applies_to=${appliesTo}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/sop-compliance/templates${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getQuotationSopReadiness(quotationId: string): Promise<ApiResponse<{ instances: any[]; missing_required_templates: string[]; ready_to_win: boolean }>> {
  return fetchApi<ApiResponse<{ instances: any[]; missing_required_templates: string[]; ready_to_win: boolean }>>(
    `/api/v1/sop-compliance/quotations/${quotationId}/readiness`,
    { cache: 'no-store', allowFallback: false }
  );
}

export async function startSopInstance(templateId: string, subjectType: 'quotation' | 'project', subjectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/sop-compliance/instances', {
    method: 'POST',
    body: JSON.stringify({ template_id: templateId, subject_type: subjectType, subject_id: subjectId }),
    allowFallback: false,
  });
}

export async function completeSopItem(
  instanceId: string,
  itemId: string,
  checked: boolean,
  evidence?: { evidence_url?: string; evidence_note?: string }
): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/sop-compliance/instances/${instanceId}/items/${itemId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ checked, ...evidence }),
    allowFallback: false,
  });
}

export async function deleteDrawingRevision(id: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/drawings/${id}`, { method: 'DELETE', allowFallback: false });
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

export async function getCcbFindings(params?: { status?: string; check_type?: string; project_id?: string }): Promise<ApiResponse<any[]>> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.check_type) query.set('check_type', params.check_type);
  if (params?.project_id) query.set('project_id', params.project_id);
  const qs = query.toString() ? `?${query.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/ccb-findings/${qs}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function updateCcbFinding(id: string, action: 'acknowledge' | 'resolve'): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/ccb-findings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
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
