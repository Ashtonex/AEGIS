import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";

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

export type ApiRequestOptions = RequestInit & {
  allowFallback?: boolean;
  timeoutMs?: number;
};

export const API_TIMEOUT_MS = 45000;
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

// Settings, CRM, and tender-bids calls were observed taking 8-45s against
// this deployment's Supabase pooler even for simple single-table reads/
// writes, which is what the 120s timeout this replaced was covering for.
// The actual causes (per-request auth doing 3-4 sequential DB/network round
// trips with no caching, and several endpoints running fully sequential
// queries with no concurrency) were fixed directly - see core/security.py's
// Redis-backed auth/permission cache and the asyncio.gather additions in
// fleet.py/data_room.py/crm_tasks.py. This budget is still above the
// default for these domains (multi-step actions like inviting a user
// legitimately take longer than a single read), just no longer sized to
// paper over multi-second round trips that shouldn't happen anymore.
const SLOW_DOMAIN_TIMEOUT_MS = 20000;
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
  "/api/v1/finance/assistant/",
];

function defaultTimeoutFor(endpoint: string): number {
  return SLOW_DOMAIN_PREFIXES.some((prefix) => endpoint.startsWith(prefix)) ? SLOW_DOMAIN_TIMEOUT_MS : API_TIMEOUT_MS;
}

const SERVER_ROUTE_ALIASES: Record<string, string> = {
  "/api/tenders": "/api/v1/public/intake/tenders",
  "/api/projects": "/api/v1/public/intake/projects",
  "/api/cms/website-content": "/api/v1/public/intake/website-content",
  "/api/cms/broadcast-feeds": "/api/v1/public/intake/broadcast-feeds",
};

function resolveServerInternalEndpoint(endpoint: string): string {
  const [pathname, search = ""] = endpoint.split("?", 2);
  const mappedPath = SERVER_ROUTE_ALIASES[pathname] ?? pathname;
  return `${resolveBackendOrigin()}${mappedPath}${search ? `?${search}` : ""}`;
}

export function resolveApiUrl(endpoint: string): string {
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

export function getErrorMessage(error: unknown): string {
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

function isTransientServiceStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isIdempotentRequest(method?: string): boolean {
  const normalized = (method || "GET").toUpperCase();
  return normalized === "GET" || normalized === "HEAD";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function getSupabaseAccessToken(timeoutMs = 2500): Promise<string | null> {
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

export async function getApiHeaders(headersInit?: HeadersInit): Promise<Headers> {
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

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `web-${crypto.randomUUID()}`;
  }

  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 18)}`;
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
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

export async function buildApiError(response: Response): Promise<ApiError> {
  let message = "The requested data could not be loaded. Please retry in a moment.";
  const isTransientServiceError = isTransientServiceStatus(response.status);
  if (response.status === 401) message = "Your session could not be verified. Please sign in again.";
  if (response.status === 403) message = "You do not have permission to access this resource.";
  if (response.status === 404) message = "Requested resource was not found.";
  if (isTransientServiceError) {
    message = "The backend service is waking up or temporarily unavailable. Please retry in a few seconds.";
  } else if (response.status >= 500) {
    message = "The service is temporarily unavailable. Please try again.";
  }

  try {
    const body = await response.text();
    if (body) {
      const parsed = JSON.parse(body) as unknown;
      const extracted = extractApiErrorMessage(parsed);
      message = isTransientServiceError ? message : extracted ?? message;
    }
  } catch {
    // Keep the status-based message when the backend did not return JSON.
  }

  return new ApiError(response.status, message);
}

export async function fetchApi<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
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
    const canRetryTransient = isIdempotentRequest(requestOptions.method);
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

    for (const backoffMs of [800, 1600]) {
      if (!canRetryTransient || !isTransientServiceStatus(response.status) || controller.signal.aborted) {
        break;
      }
      await delay(backoffMs);
      response = await fetch(url, {
        ...requestOptions,
        headers,
        signal: controller.signal
      });
    }

    if (!response.ok) {
      throw await buildApiError(response);
    }

    const data = await parseJsonResponse<T>(response);
    const apiData = data as { success?: boolean; error?: { message?: string } };
    if (apiData.success === false) {
      throw new ApiError(response.status, extractApiErrorMessage(data) || "Unknown API error");
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

export type WorkforceFoundationResponse<T> = {
  success: boolean;
  data: T;
  message: string;
  meta: { next_cursor?: string | null; queued?: boolean };
};

export async function workforceFoundation<T>(path: string, command?: { method: "POST" | "PATCH"; key: string; payload: object }): Promise<WorkforceFoundationResponse<T>> {
  const result = await fetchApi<WorkforceFoundationResponse<T>>(`/api/v1/workforce/foundation/${path}`, {
    allowFallback: false,
    cache: "no-store",
    ...(command ? { method: command.method, headers: { "Idempotency-Key": command.key }, body: JSON.stringify(command.payload) } : {}),
  });
  if (result.meta?.queued) throw new ApiError(503, "No server receipt received. Reconnect and retry this command.");
  return result;
}

export type ComplianceResponse<T> = { success: boolean; data: T; message: string; meta: { next_cursor?: string | null; queued?: boolean } };
export async function complianceFoundation<T>(path: string, command?: { key: string; payload: object }): Promise<ComplianceResponse<T>> {
  const result = await fetchApi<ComplianceResponse<T>>(`/api/v1/compliance/foundation/${path}`, {
    allowFallback: false, cache: "no-store",
    ...(command ? { method: "POST", headers: { "Idempotency-Key": command.key }, body: JSON.stringify(command.payload) } : {}),
  });
  if (result.meta?.queued) throw new ApiError(503, "No server receipt. Reconnect and retry the same command.");
  return result;
}

