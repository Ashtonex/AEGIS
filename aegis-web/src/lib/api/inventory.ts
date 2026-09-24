import { ApiResponse, PaginatedResponse, EnquiryPayload, TenderInterestPayload, JobApplicationPayload, SupplierRegistrationPayload } from "@/types/api";
import { Project, Tender, Article, JobPosition, LeadershipProfile } from "@/types/website";
import { API_BASE_URL } from "../constants";
import { resolveBackendOrigin } from "../backend-url";
import { getSupabase, getCachedAccessToken } from "../supabase";
import { PROJECTS_DOSSIERS, getProjectDossier } from "../projectsDossiers";
import { fetchApi, ApiError, isPermissionDenied, describeActionError, resolveApiUrl, getApiHeaders, buildApiError, getErrorMessage, API_TIMEOUT_MS, parseJsonResponse, getSupabaseAccessToken, createIdempotencyKey, type ApiRequestOptions } from "./core";
import { bearerHeaders, EXECUTIVE_READ_TIMEOUT_MS } from "./website";

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

/** Bank Reconciliation (Phase 4): matches an uploaded bank statement CSV against finance.cashbook_transactions. */
export async function uploadBankStatementImport(params: { cashAccountId: string; file: File; columnMapping: Record<string, string> }): Promise<ApiResponse<any>> {
  const form = new FormData();
  form.set("cash_account_id", params.cashAccountId);
  form.set("column_mapping", JSON.stringify(params.columnMapping));
  form.set("file", params.file);
  const headers = new Headers();
  const token = await getSupabaseAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(resolveApiUrl("/api/v1/bank-transactions/reconciliation/imports"), {
    method: "POST",
    headers,
    body: form,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.detail || "Failed to upload bank statement.");
  return data;
}

export async function getBankStatementImports(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>("/api/v1/bank-transactions/reconciliation/imports", { cache: "no-store", allowFallback: false });
}

export async function getBankStatementImport(importId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/bank-transactions/reconciliation/imports/${importId}`, { cache: "no-store", allowFallback: false });
}

export async function runBankStatementMatching(importId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/bank-transactions/reconciliation/imports/${importId}/run-matching`, { method: "POST", allowFallback: false });
}

export async function getBankStatementLines(importId: string, matchStatus?: string): Promise<ApiResponse<any[]>> {
  const query = matchStatus ? `?match_status=${encodeURIComponent(matchStatus)}` : "";
  return fetchApi<ApiResponse<any[]>>(`/api/v1/bank-transactions/reconciliation/imports/${importId}/lines${query}`, { cache: "no-store", allowFallback: false });
}

export async function confirmBankStatementMatch(lineId: string, cashbookTransactionId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/bank-transactions/reconciliation/lines/${lineId}/confirm`, { method: "POST", body: JSON.stringify({ cashbook_transaction_id: cashbookTransactionId }), allowFallback: false });
}

export async function rejectBankStatementMatch(lineId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/bank-transactions/reconciliation/lines/${lineId}/reject`, { method: "POST", allowFallback: false });
}

export async function reopenBankStatementMatch(lineId: string, reason: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/bank-transactions/reconciliation/lines/${lineId}/reopen`, { method: "POST", body: JSON.stringify({ reason }), allowFallback: false });
}

export type BankStatementLineFilter = {
  cash_account_id?: string;
  import_id?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  direction?: "in" | "out";
  tag_status?: "untagged" | "tagged" | "no_project";
  project_id?: string;
  category?: string;
  match_status?: string;
  unallocated_cash?: boolean;
};

export type BankStatementLineTags = {
  project_id?: string | null;
  counterparty_name?: string | null;
  category?: string | null;
  notes?: string | null;
};

function compactQuery(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}

export async function searchBankStatementLines(filter: BankStatementLineFilter, page = 1, pageSize = 100): Promise<ApiResponse<any[]>> {
  const { unallocated_cash, ...rest } = filter;
  const query = compactQuery({ ...rest, unallocated_cash: unallocated_cash ? "true" : undefined, page, page_size: pageSize });
  return fetchApi<ApiResponse<any[]>>(`/api/v1/bank-transactions/reconciliation/statement-lines?${query}`, { cache: "no-store", allowFallback: false });
}

export async function tagBankStatementLines(target: { line_ids: string[] } | { filter: BankStatementLineFilter }, tags: BankStatementLineTags): Promise<ApiResponse<{ updated: number }>> {
  return fetchApi<ApiResponse<{ updated: number }>>("/api/v1/bank-transactions/reconciliation/statement-lines/tag", {
    method: "POST",
    body: JSON.stringify({ ...target, ...tags }),
    allowFallback: false,
  });
}

export async function getBankStatementAllocationSummary(cashAccountId?: string): Promise<ApiResponse<any>> {
  const query = compactQuery({ cash_account_id: cashAccountId });
  return fetchApi<ApiResponse<any>>(`/api/v1/bank-transactions/reconciliation/allocation-summary${query ? `?${query}` : ""}`, { cache: "no-store", allowFallback: false });
}

export type BankLineAllocation = {
  id?: string;
  project_id?: string | null;
  project_name?: string | null;
  category?: string | null;
  amount: number;
  description?: string | null;
  allocation_date?: string | null;
};

export async function getProjectMoneyWorkspace(projectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/bank-transactions/reconciliation/projects/${projectId}/workspace`, { cache: "no-store", allowFallback: false });
}

export async function getBankLineAllocations(lineId: string): Promise<ApiResponse<BankLineAllocation[]>> {
  return fetchApi<ApiResponse<BankLineAllocation[]>>(`/api/v1/bank-transactions/reconciliation/lines/${lineId}/allocations`, { cache: "no-store", allowFallback: false });
}

export async function saveBankLineAllocations(lineId: string, allocations: BankLineAllocation[]): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/bank-transactions/reconciliation/lines/${lineId}/allocations`, {
    method: "PUT",
    body: JSON.stringify({
      allocations: allocations.map((a) => ({
        id: a.id || undefined,
        project_id: a.project_id || null,
        category: a.category || null,
        amount: Number(a.amount),
        description: a.description || null,
        allocation_date: a.allocation_date || null,
      })),
    }),
    allowFallback: false,
  });
}

export async function getBankWorkbookStatus(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/bank-transactions/reconciliation/workbook", { cache: "no-store", allowFallback: false });
}

export async function publishBankWorkbook(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/bank-transactions/reconciliation/workbook/publish", { method: "POST", allowFallback: false });
}

export async function getBankBooksAudit(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>("/api/v1/bank-transactions/reconciliation/audit", { cache: "no-store", allowFallback: false });
}

export async function createCashbookEntryFromBankLine(lineId: string, payload: { transaction_type: string; project_id?: string | null; description?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/bank-transactions/reconciliation/lines/${lineId}/create-cashbook-entry`, { method: "POST", body: JSON.stringify(payload), allowFallback: false });
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

