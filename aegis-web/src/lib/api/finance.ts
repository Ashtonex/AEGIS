import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";
import { type SupplierPortalVendor, type VendorDocument, type SupplierComplianceDocumentStatus } from "./procurement";

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

/** General Ledger: Chart of Accounts. */
export async function getChartOfAccounts(params?: { category?: string; active_only?: boolean }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.category) search.set('category', params.category);
  if (params?.active_only) search.set('active_only', 'true');
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/gl/accounts${query}`, { cache: 'no-store', allowFallback: false });
}

export async function createChartOfAccount(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/gl/accounts', { method: 'POST', body: JSON.stringify(payload), allowFallback: false });
}

export async function updateChartOfAccount(accountId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/accounts/${accountId}`, { method: 'PATCH', body: JSON.stringify(payload), allowFallback: false });
}

export async function getAccountLedger(accountId: string, params?: { date_from?: string; date_to?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/gl/accounts/${accountId}/ledger${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getTrialBalance(params?: { as_of_date?: string; period_id?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.as_of_date) search.set('as_of_date', params.as_of_date);
  if (params?.period_id) search.set('period_id', params.period_id);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/gl/trial-balance${query}`, { cache: 'no-store', allowFallback: false });
}

/** General Ledger: Accounting Periods. */
export async function getAccountingPeriods(status?: string): Promise<ApiResponse<any[]>> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/gl/periods${query}`, { cache: 'no-store', allowFallback: false });
}

export async function createAccountingPeriod(payload: { period_start: string; period_end: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/gl/periods', { method: 'POST', body: JSON.stringify(payload), allowFallback: false });
}

export async function softCloseAccountingPeriod(periodId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/periods/${periodId}/soft-close`, { method: 'POST', allowFallback: false });
}

export async function closeAccountingPeriod(periodId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/periods/${periodId}/close`, { method: 'POST', allowFallback: false });
}

export async function reopenAccountingPeriod(periodId: string, reason: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/periods/${periodId}/reopen`, { method: 'POST', body: JSON.stringify({ reason }), allowFallback: false });
}

export async function lockAccountingPeriod(periodId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/periods/${periodId}/lock`, { method: 'POST', allowFallback: false });
}

/** General Ledger: Journal Entries. */
export async function getJournalEntries(params?: { period_id?: string; status?: string; project_id?: string; page?: number; page_size?: number }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.period_id) search.set('period_id', params.period_id);
  if (params?.status) search.set('status', params.status);
  if (params?.project_id) search.set('project_id', params.project_id);
  if (params?.page) search.set('page', String(params.page));
  if (params?.page_size) search.set('page_size', String(params.page_size));
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/gl/journals${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getJournalEntry(journalId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/journals/${journalId}`, { cache: 'no-store', allowFallback: false });
}

export async function createJournalEntry(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/gl/journals', { method: 'POST', body: JSON.stringify(payload), allowFallback: false });
}

export async function updateJournalEntry(journalId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/journals/${journalId}`, { method: 'PATCH', body: JSON.stringify(payload), allowFallback: false });
}

export async function deleteJournalEntry(journalId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/journals/${journalId}`, { method: 'DELETE', allowFallback: false });
}

export async function postJournalEntry(journalId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/journals/${journalId}/post`, { method: 'POST', allowFallback: false });
}

export async function reverseJournalEntry(journalId: string, payload: { reversal_date: string; reason: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/journals/${journalId}/reverse`, { method: 'POST', body: JSON.stringify(payload), allowFallback: false });
}

export async function getJournalAuditHistory(journalId: string): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/gl/journals/${journalId}/audit-history`, { cache: 'no-store', allowFallback: false });
}

/** GL Bridge: turns existing project cost/revenue records into human-reviewed proposed GL journals. */
export async function getGlBridgeMappings(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/finance/gl/bridge/mappings', { cache: 'no-store', allowFallback: false });
}

export async function updateGlBridgeMapping(mappingKey: string, accountId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/bridge/mappings/${encodeURIComponent(mappingKey)}`, { method: 'PATCH', body: JSON.stringify({ account_id: accountId }), allowFallback: false });
}

export async function getGlBridgeProposals(status: string = 'pending_review'): Promise<ApiResponse<any[]>> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/gl/bridge/proposals${query}`, { cache: 'no-store', allowFallback: false });
}

export async function proposeGlJournalForCostTransaction(costTransactionId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/bridge/cost-transactions/${costTransactionId}/propose`, { method: 'POST', allowFallback: false });
}

export async function syncProjectToGlBridge(projectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/bridge/projects/${projectId}/sync`, { method: 'POST', allowFallback: false });
}

export async function approveGlBridgeProposal(journalId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/bridge/proposals/${journalId}/approve`, { method: 'POST', allowFallback: false });
}

export async function rejectGlBridgeProposal(journalId: string, reason: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/bridge/proposals/${journalId}/reject`, { method: 'POST', body: JSON.stringify({ reason }), allowFallback: false });
}

export async function getProjectGlLedger(projectId: string, params?: { date_from?: string; date_to?: string }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/gl/bridge/projects/${projectId}/ledger${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getProjectGlReconciliation(projectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/gl/bridge/projects/${projectId}/reconciliation`, { cache: 'no-store', allowFallback: false });
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

export async function getVatNetPosition(params?: { period_start?: string; period_end?: string }): Promise<ApiResponse<any>> {
  const search = new URLSearchParams();
  if (params?.period_start) search.set('period_start', params.period_start);
  if (params?.period_end) search.set('period_end', params.period_end);
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/statutory/vat/net-position${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getStatutoryProfile(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/statutory/profile', { cache: 'no-store', allowFallback: false });
}

export async function updateStatutoryProfile(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/statutory/profile', {
    method: 'PUT', body: JSON.stringify(payload), allowFallback: false,
  });
}

export async function getFiscalComplianceSummary(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/statutory/fiscal-compliance/summary', { cache: 'no-store', allowFallback: false });
}

export async function getTaxCalendar(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/finance/statutory/tax-calendar', { cache: 'no-store', allowFallback: false });
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
  evidence_quality: "A" | "B" | "C" | "D" | "E";
  document_id?: string;
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
  evidence_quality: "A" | "B" | "C" | "D" | "E";
  document_id?: string;
}): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/financial-performance/historical/cost-activities', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function setHistoricalReconciliationBaseline(payload: {
  project_id: string;
  category: "revenue" | "cost";
  expected_amount: number;
  source_description?: string;
}): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/financial-performance/historical/reconciliation-baseline', {
    method: 'PUT',
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getHistoricalReconciliation(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/financial-performance/historical/reconciliation', { cache: 'no-store', allowFallback: false });
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

/** Core GL-sourced financial statements (Phase 11A) - additive alongside getFinanceStatements' operational-table department P&L, never replacing it. */
export async function getIncomeStatement(periodStart: string, periodEnd: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/financial-statements/income-statement?period_start=${periodStart}&period_end=${periodEnd}`, { cache: 'no-store', allowFallback: false });
}

export async function getBalanceSheet(asOfDate: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/financial-statements/balance-sheet?as_of_date=${asOfDate}`, { cache: 'no-store', allowFallback: false });
}

export async function getCashMovementStatement(periodStart: string, periodEnd: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/financial-statements/cash-movement?period_start=${periodStart}&period_end=${periodEnd}`, { cache: 'no-store', allowFallback: false });
}

export async function getArAging(asOfDate?: string): Promise<ApiResponse<any>> {
  const query = asOfDate ? `?as_of_date=${asOfDate}` : '';
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/financial-statements/ar-aging${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getApAging(asOfDate?: string): Promise<ApiResponse<any>> {
  const query = asOfDate ? `?as_of_date=${asOfDate}` : '';
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/financial-statements/ap-aging${query}`, { cache: 'no-store', allowFallback: false });
}

/** Management Accounts pack lifecycle + Project Portfolio/Health (Phase 11B). */
export async function createManagementAccountsPack(periodStart: string, periodEnd: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/management-accounts/packs', {
    method: 'POST',
    body: JSON.stringify({ period_start: periodStart, period_end: periodEnd }),
    allowFallback: false,
  });
}

export async function getManagementAccountsPacks(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/finance/management-accounts/packs', { cache: 'no-store', allowFallback: false });
}

export async function getManagementAccountsPack(packId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/management-accounts/packs/${packId}`, { cache: 'no-store', allowFallback: false });
}

export async function recomputeManagementAccountsPack(packId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/management-accounts/packs/${packId}/recompute`, { method: 'POST', allowFallback: false });
}

export async function submitManagementAccountsPackForReview(packId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/management-accounts/packs/${packId}/submit-review`, { method: 'POST', allowFallback: false });
}

export async function approveManagementAccountsPack(packId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/management-accounts/packs/${packId}/approve`, { method: 'POST', allowFallback: false });
}

export async function lockManagementAccountsPack(packId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/management-accounts/packs/${packId}/lock`, { method: 'POST', allowFallback: false });
}

export async function reopenManagementAccountsPack(packId: string, reason: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/management-accounts/packs/${packId}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
    allowFallback: false,
  });
}

export async function exportManagementAccountsPackPdf(packId: string): Promise<Blob> {
  const url = resolveApiUrl(`/api/v1/finance/management-accounts/packs/${packId}/export-pdf`);
  const headers = await getApiHeaders();
  const response = await fetch(url, { method: 'GET', headers });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return response.blob();
}

export async function getProjectPortfolio(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/finance/management-accounts/portfolio', { cache: 'no-store', allowFallback: false });
}

/** Audit & Bankability Controls (Phase 12): month-end close readiness + auditor drill-down. */
export async function getCloseReadiness(periodId?: string): Promise<ApiResponse<any>> {
  const query = periodId ? `?period_id=${periodId}` : '';
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/audit/close-readiness${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getJournalDrillDown(journalId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/audit/journals/${journalId}`, { cache: 'no-store', allowFallback: false });
}

export async function getJournals(params?: { status?: string; page?: number; pageSize?: number }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.page) search.set('page', String(params.page));
  if (params?.pageSize) search.set('page_size', String(params.pageSize));
  const query = search.toString() ? `?${search.toString()}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/gl/journals${query}`, { cache: 'no-store', allowFallback: false });
}

export async function getFinancialRunway(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/executive/financial-runway', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getSafetyIndex(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/executive/hse/ltifr', {
    cache: 'no-store',
    allowFallback: false,
  });
}

export async function getPendingApprovals(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>('/api/v1/executive/approvals/pending', {
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

export async function acceptHrVendorVerificationWithGaps(subcontractorId: string, notes?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/hr/vendor-verification/${encodeURIComponent(subcontractorId)}/accept-with-gaps`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
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

export async function recordProgressClaimFiscalInvoice(claimId: string, fiscalInvoiceNumber: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/financial-performance/progress-claims/${claimId}/record-fiscal-invoice`, {
    method: 'POST',
    body: JSON.stringify({ fiscal_invoice_number: fiscalInvoiceNumber }),
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

/** Company & Department Budgeting (Phase 5A): a fresh, richer versioning layer separate from project budgets above. */
export async function getCompanyBudgets(fiscalYear?: number): Promise<ApiResponse<any[]>> {
  const query = fiscalYear ? `?fiscal_year=${fiscalYear}` : '';
  return fetchApi<ApiResponse<any[]>>(`/api/v1/finance/company-budgets${query}`, { cache: 'no-store', allowFallback: false });
}

export async function createCompanyBudget(payload: { fiscal_year: number; label: string; notes?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/company-budgets', { method: 'POST', body: JSON.stringify(payload), allowFallback: false });
}

export async function getCompanyBudget(budgetId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/${budgetId}`, { cache: 'no-store', allowFallback: false });
}

export async function replaceCompanyBudgetLines(budgetId: string, lines: Record<string, unknown>[]): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/${budgetId}/lines`, { method: 'PUT', body: JSON.stringify({ lines }), allowFallback: false });
}

export async function submitCompanyBudget(budgetId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/${budgetId}/submit`, { method: 'POST', allowFallback: false });
}

export async function startCompanyBudgetReview(budgetId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/${budgetId}/start-review`, { method: 'POST', allowFallback: false });
}

export async function approveCompanyBudget(budgetId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/${budgetId}/approve`, { method: 'POST', allowFallback: false });
}

export async function rejectCompanyBudget(budgetId: string, reason: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/${budgetId}/reject`, { method: 'POST', body: JSON.stringify({ reason }), allowFallback: false });
}

export async function cancelCompanyBudget(budgetId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/${budgetId}/cancel`, { method: 'POST', allowFallback: false });
}

export async function freezeCompanyBudget(budgetId: string, reason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/${budgetId}/freeze`, { method: 'POST', body: JSON.stringify({ reason: reason ?? null }), allowFallback: false });
}

export async function reopenCompanyBudget(budgetId: string, reason: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/${budgetId}/reopen`, { method: 'POST', body: JSON.stringify({ reason }), allowFallback: false });
}

export async function createCompanyBudgetRevision(budgetId: string, label?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/${budgetId}/revise`, { method: 'POST', body: JSON.stringify({ label: label ?? null }), allowFallback: false });
}

export async function getCompanyBudgetVariance(fiscalYear: number): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/variance/company?fiscal_year=${fiscalYear}`, { cache: 'no-store', allowFallback: false });
}

export async function getDepartmentBudgetVariance(departmentId: string, fiscalYear: number): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/finance/company-budgets/variance/department/${departmentId}?fiscal_year=${fiscalYear}`, { cache: 'no-store', allowFallback: false });
}

/** Cash Position Command Centre (Phase 6A): multi-horizon Committed/Probable cash forecast, built from zero new schema. */
export async function getCashForecast(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/cash-forecast', { cache: 'no-store', allowFallback: false });
}

export async function getCashRunway(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/cash-forecast/runway', { cache: 'no-store', allowFallback: false });
}

/** AI Financial Control Assistant (Phase 10B): read-only, tool-calling Q&A over existing finance data. Never posts/approves/deletes anything. */
export async function askFinanceAssistant(
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/assistant/ask', {
    method: 'POST',
    body: JSON.stringify({ question, history }),
    allowFallback: false,
  });
}

export async function getFinanceAssistantAuditLog(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>('/api/v1/finance/assistant/audit-log', { cache: 'no-store', allowFallback: false });
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

