import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";

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

