import { ApiResponse } from "@/types/api";
import { fetchApi } from "./core";

// --- FINANCE OPERATIONS WORKBENCH (/api/v1/finance/ops) ---
// Dashboard, payables ageing + actions, cost codes by project, draft budget
// reminders, and site payroll for hourly labour that isn't on AEGIS.

const OPS = "/api/v1/finance/ops";

function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function getFinanceOpsDashboard(params?: { department_id?: string; months?: number }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/dashboard${qs({ ...params })}`, { cache: "no-store", allowFallback: false });
}

export async function getFinancePayables(): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/payables`, { cache: "no-store", allowFallback: false });
}

export async function payFinancePayables(payload: {
  cash_account_id: string;
  payment_date: string;
  payment_method: string;
  reference?: string;
  override_reason?: string;
  items: { invoice_id: string; amount?: number }[];
}): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/payables/pay`, { method: "POST", body: JSON.stringify(payload), allowFallback: false });
}

export async function rejectFinancePayable(invoiceId: string, reason: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/payables/${invoiceId}/reject`, { method: "POST", body: JSON.stringify({ reason }), allowFallback: false });
}

export async function requestFinancePayableInvoice(invoiceId: string, message?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/payables/${invoiceId}/request-invoice`, {
    method: "POST",
    body: JSON.stringify({ message: message || null, send_email: true }),
    allowFallback: false,
  });
}

export async function getCostCodesByProject(params?: { department_id?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/cost-codes/by-project${qs({ ...params })}`, { cache: "no-store", allowFallback: false });
}

export async function getDraftBudgetReminders(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`${OPS}/budgets/draft-reminders`, { cache: "no-store", allowFallback: false });
}

export async function sendDraftBudgetReminders(budgetId?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/budgets/draft-reminders/send`, {
    method: "POST",
    body: JSON.stringify({ budget_id: budgetId || null }),
    allowFallback: false,
  });
}

export async function getSiteWorkers(params?: { project_id?: string; include_inactive?: boolean }): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`${OPS}/site-payroll/workers${qs({ ...params })}`, { cache: "no-store", allowFallback: false });
}

export async function createSiteWorker(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/site-payroll/workers`, { method: "POST", body: JSON.stringify(payload), allowFallback: false });
}

export async function updateSiteWorker(workerId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/site-payroll/workers/${workerId}`, { method: "PUT", body: JSON.stringify(payload), allowFallback: false });
}

export async function getSiteTimeEntries(params: { project_id: string; date_from: string; date_to: string }): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`${OPS}/site-payroll/time-entries${qs(params)}`, { cache: "no-store", allowFallback: false });
}

export async function saveSiteTimeEntries(payload: {
  project_id: string;
  entries: { worker_id: string; work_date: string; regular_hours: number; overtime_hours: number }[];
}): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/site-payroll/time-entries`, { method: "PUT", body: JSON.stringify(payload), allowFallback: false });
}

export async function getSitePayRuns(params?: { project_id?: string }): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`${OPS}/site-payroll/runs${qs({ ...params })}`, { cache: "no-store", allowFallback: false });
}

export async function getSitePayRun(runId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/site-payroll/runs/${runId}`, { cache: "no-store", allowFallback: false });
}

export async function createSitePayRun(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/site-payroll/runs`, { method: "POST", body: JSON.stringify(payload), allowFallback: false });
}

export async function decideSitePayRun(runId: string, payload: { action: "approve" | "pay" | "cancel"; cash_account_id?: string; payment_method?: string; reference?: string }): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/site-payroll/runs/${runId}/decision`, { method: "POST", body: JSON.stringify(payload), allowFallback: false });
}

export async function getSitePayrollSummary(): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`${OPS}/site-payroll/summary`, { cache: "no-store", allowFallback: false });
}

export async function decideDraftBudget(budgetId: string, action: "approve" | "cancel", reason?: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${OPS}/budgets/${budgetId}/decision`, {
    method: "POST",
    body: JSON.stringify({ action, reason: reason || null }),
    allowFallback: false,
  });
}
