import { ApiResponse } from "@/types/api";
import { fetchApi } from "./core";

// --- PAYROLL SETUP (/api/v1/payroll) --- //
// Pay codes, employee pay codes, settings, month locks and year-to-date
// totals. Payroll runs themselves stay on /api/v1/payroll-runs (banking.ts).

const BASE = "/api/v1/payroll";

export type PayrollSettings = {
  base_currency: string;
  split_tax_method: "base_tables" | "separate_tables";
  nssa_reduces_taxable: boolean;
};

export async function getPayrollSettings(): Promise<ApiResponse<PayrollSettings>> {
  return fetchApi<ApiResponse<PayrollSettings>>(`${BASE}/settings`, { cache: "no-store", allowFallback: false });
}

export async function updatePayrollSettings(payload: Partial<PayrollSettings>): Promise<ApiResponse<PayrollSettings>> {
  return fetchApi<ApiResponse<PayrollSettings>>(`${BASE}/settings`, {
    method: "PUT",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getPayElements(includeInactive = false): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`${BASE}/elements${includeInactive ? "?include_inactive=true" : ""}`, {
    cache: "no-store",
    allowFallback: false,
  });
}

export async function createPayElement(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${BASE}/elements`, { method: "POST", body: JSON.stringify(payload), allowFallback: false });
}

export async function updatePayElement(elementId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${BASE}/elements/${elementId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getEmployeePayElements(params?: { employee_id?: string; include_ended?: boolean }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.employee_id) search.set("employee_id", params.employee_id);
  if (params?.include_ended) search.set("include_ended", "true");
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`${BASE}/employee-elements${query}`, { cache: "no-store", allowFallback: false });
}

export async function assignEmployeePayElement(payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${BASE}/employee-elements`, {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function updateEmployeePayElement(assignmentId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${BASE}/employee-elements/${assignmentId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getPayrollPeriods(year: number): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`${BASE}/periods?year=${year}`, { cache: "no-store", allowFallback: false });
}

/** month is YYYY-MM */
export async function closePayrollPeriod(month: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${BASE}/periods/${month}/close`, { method: "POST", allowFallback: false });
}

export async function reopenPayrollPeriod(month: string, reason: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${BASE}/periods/${month}/reopen`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    allowFallback: false,
  });
}

export async function getPayrollYtd(year: number, employeeId?: string): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams({ year: String(year) });
  if (employeeId) search.set("employee_id", employeeId);
  return fetchApi<ApiResponse<any[]>>(`${BASE}/ytd?${search.toString()}`, { cache: "no-store", allowFallback: false });
}
