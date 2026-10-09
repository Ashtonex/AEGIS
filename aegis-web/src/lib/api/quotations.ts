import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions, recordApiWrite } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";

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
  recordApiWrite();
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

export async function benchmarkRate(
  itemCode: string,
  rate: number,
  scope?: { source_type?: string; source_id?: string; rate_group?: string }
): Promise<ApiResponse<any>> {
  const query = new URLSearchParams({
    item_code: itemCode,
    rate: String(rate),
  });
  if (scope?.source_type) query.set('source_type', scope.source_type);
  if (scope?.source_id) query.set('source_id', scope.source_id);
  if (scope?.rate_group) query.set('rate_group', scope.rate_group);
  return fetchApi<ApiResponse<any>>(`/api/v1/quotations/rates/benchmark?${query.toString()}`, {
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

/** Records a reviewed CCB evaluation as the official commercial baseline - the explicit "commit" step after previewing via evaluateQuotationIntelligence. Pass overrideTargetSellingPrice + overrideReason to record a human correction to the calculated figure instead of accepting it as-is. */
export async function commitCommercialBaseline(payload: Record<string, unknown> & { overrideTargetSellingPrice?: number; overrideReason?: string }): Promise<ApiResponse<any>> {
  const { overrideTargetSellingPrice, overrideReason, ...evaluationPayload } = payload;
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/intelligence/baselines/commit', {
    method: 'POST',
    body: JSON.stringify({
      ...evaluationPayload,
      override_target_selling_price: overrideTargetSellingPrice ?? null,
      override_reason: overrideReason ?? null,
    }),
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

export async function runBoqAiAnalysis(payload: {
  quotation_id: string;
  project_scope_text?: string;
  force_refresh?: boolean;
}): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/quotations/boq/ai-analysis', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getBoqAiAnalysisHistory(quotationId?: string): Promise<ApiResponse<any[]>> {
  const qs = quotationId ? `?quotation_id=${encodeURIComponent(quotationId)}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/quotations/boq/ai-analysis${qs}`, {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function reviewBoqAiAnalysisFinding(
  findingId: string,
  decision: 'accepted' | 'rejected'
): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/quotations/boq/ai-analysis/findings/${findingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ decision }),
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


// --- BOQ WORKFLOW (deal documents -> estimations -> green light) --- //

export type BoqApprovalStatus = 'pending_review' | 'approved' | 'changes_requested' | 'rejected';

export async function decideBoqApproval(
  quotationId: string,
  decision: 'approved' | 'changes_requested' | 'rejected',
  notes?: string,
): Promise<ApiResponse<{ id: string; boq_approval: Record<string, any>; knowledge_lines: number }>> {
  return fetchApi(`/api/v1/quotations/${quotationId}/boq-approval`, {
    method: 'POST',
    body: JSON.stringify({ decision, notes: notes || undefined }),
    allowFallback: false,
  });
}

export interface PastBoqMatch {
  id: string;
  quotation_id: string;
  project_title: string | null;
  client_name: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  rate: number;
  currency: string | null;
  approved_at: string | null;
  score: number;
  same_unit: boolean;
}

export interface PastBoqResult {
  description: string;
  unit: string | null;
  matches: PastBoqMatch[];
  rate_summary: { unit: string | null; samples: number; median: number; min: number; max: number } | null;
}

export async function findSimilarPastBoqLines(
  items: Array<{ description: string; unit?: string | null }>,
  excludeQuotationId?: string | null,
  perItem = 5,
): Promise<ApiResponse<{ results: PastBoqResult[]; library: { lines: number; boqs: number } }>> {
  return fetchApi(`/api/v1/quotations/knowledge/similar`, {
    method: 'POST',
    body: JSON.stringify({ items, exclude_quotation_id: excludeQuotationId || undefined, per_item: perItem }),
    allowFallback: false,
  });
}

export async function recordClientQuotation(
  opportunityId: string,
  payload: { document_id: string; quote_amount?: number; valid_until?: string; follow_up_date?: string; notes?: string },
): Promise<ApiResponse<{ quotation_id: string; moved_to_quotation: boolean; tasks_completed: number; follow_up_date: string }>> {
  return fetchApi(`/api/v1/crm/opportunities/${opportunityId}/client-quotation`, {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getTenderActivityLog(tenderId: string): Promise<ApiResponse<Array<{ id: string; type: string; subject: string; description: string | null; created_at: string; created_by_name: string | null }>>> {
  return fetchApi(`/api/v1/tender-bids/${tenderId}/activity-log`, { cache: 'no-store', allowFallback: false });
}

// --- CASH CURVES (tender / project funding requirement) --- //

export interface CashCurveScenarioInput {
  name?: string;
  assumptions?: Record<string, unknown>;
}

export async function computeQuotationCashCurve(quotationId: string, scenarios: CashCurveScenarioInput[]): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/cash-curves/quotations/${quotationId}`, {
    method: 'POST',
    body: JSON.stringify({ scenarios }),
    allowFallback: false,
  });
}

export async function computeProjectCashCurve(projectId: string, scenarios: CashCurveScenarioInput[]): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/cash-curves/projects/${projectId}`, {
    method: 'POST',
    body: JSON.stringify({ scenarios }),
    allowFallback: false,
  });
}

export async function getSavedCashCurveScenarios(quotationId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/cash-curves/quotations/${quotationId}/scenarios`, { cache: 'no-store', allowFallback: false });
}

export async function saveCashCurveScenario(quotationId: string, name: string, assumptions: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/cash-curves/quotations/${quotationId}/scenarios`, {
    method: 'POST',
    body: JSON.stringify({ name, assumptions }),
    allowFallback: false,
  });
}

export async function deleteCashCurveScenario(scenarioId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/cash-curves/scenarios/${scenarioId}`, {
    method: 'DELETE',
    allowFallback: false,
  });
}
