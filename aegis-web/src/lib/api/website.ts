import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";

// --- PROJECTS ---
export async function getProjects(params?: { featured?: boolean; limit?: number; category?: string }): Promise<PaginatedResponse<Project>> {
  const searchParams = new URLSearchParams();
  if (params?.featured) searchParams.set("featured", "true");
  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.category) searchParams.set("category", params.category);

  try {
    const res = await fetchApi<PaginatedResponse<Project>>(`/api/projects?${searchParams.toString()}`, {
      next: { revalidate: 3600 }
    });
    if (res?.success && Array.isArray(res.data) && res.data.length > 0) {
      return res;
    }
  } catch {
    // Fall through to verified dossiers
  }

  let list = [...PROJECTS_DOSSIERS];
  if (params?.category) {
    list = list.filter((p) => p.category.toLowerCase().includes(params.category!.toLowerCase()));
  }
  if (params?.limit) {
    list = list.slice(0, params.limit);
  }
  return {
    success: true,
    data: list,
    meta: { total: list.length, page: 1, limit: params?.limit || list.length, totalPages: 1 }
  };
}

export async function getProject(slug: string): Promise<ApiResponse<Project>> {
  try {
    const res = await fetchApi<ApiResponse<Project>>(`/api/projects/${slug}`, {
      next: { revalidate: 3600 }
    });
    if (res?.success && res.data) {
      return res;
    }
  } catch {
    // Fall through to verified dossiers
  }
  const dossier = getProjectDossier(slug);
  return {
    success: !!dossier,
    data: dossier,
  };
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
export function bearerHeaders(accessToken?: string): HeadersInit | undefined {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
}

// Same rollback as SLOW_DOMAIN_TIMEOUT_MS above - was 120000 to paper over
// the pre-fix auth/query latency, now sized to the fixed baseline instead.
export const EXECUTIVE_READ_TIMEOUT_MS = 20000;

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

