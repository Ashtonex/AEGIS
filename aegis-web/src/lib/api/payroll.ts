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

// --- RETURNS & BANK FILES (/api/v1/payroll, phase 2) --- //

export type ExportKind = "bank" | "paye" | "nssa";
export type ExportColumn = { field: string; header?: string; value?: string };
export type ExportLayout = {
  id: string;
  kind: ExportKind;
  name: string;
  description?: string | null;
  delimiter: string;
  include_header: boolean;
  date_format: string;
  columns: ExportColumn[];
  is_builtin: boolean;
};
export type ExportField = { key: string; label: string; type: "text" | "money" | "date" };
export type ExportFields = { fields: Record<ExportKind, ExportField[]>; delimiters: string[]; date_formats: string[] };
export type ProducedFile = { export_id: string; file_name: string; content: string; rows: number; total: number; sha256: string; warnings?: string[] };

const json = (method: string, payload?: unknown) => ({
  method,
  body: payload === undefined ? undefined : JSON.stringify(payload),
  allowFallback: false as const,
});

export async function getExportFields(): Promise<ApiResponse<ExportFields>> {
  return fetchApi<ApiResponse<ExportFields>>(`${BASE}/export-fields`, { cache: "no-store", allowFallback: false });
}

export async function getExportLayouts(kind?: ExportKind): Promise<ApiResponse<ExportLayout[]>> {
  return fetchApi<ApiResponse<ExportLayout[]>>(`${BASE}/export-layouts${kind ? `?kind=${kind}` : ""}`, { cache: "no-store", allowFallback: false });
}

export async function createExportLayout(payload: Omit<ExportLayout, "id" | "is_builtin">): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`${BASE}/export-layouts`, json("POST", payload));
}

export async function updateExportLayout(layoutId: string, payload: Partial<ExportLayout>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`${BASE}/export-layouts/${layoutId}`, json("PATCH", payload));
}

export async function deleteExportLayout(layoutId: string): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`${BASE}/export-layouts/${layoutId}`, json("DELETE"));
}

export async function getPaymentAccounts(params?: { employee_id?: string; include_ended?: boolean }): Promise<ApiResponse<any[]>> {
  const search = new URLSearchParams();
  if (params?.employee_id) search.set("employee_id", params.employee_id);
  if (params?.include_ended) search.set("include_ended", "true");
  const query = search.toString() ? `?${search.toString()}` : "";
  return fetchApi<ApiResponse<any[]>>(`${BASE}/payment-accounts${query}`, { cache: "no-store", allowFallback: false });
}

export async function createPaymentAccount(payload: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`${BASE}/payment-accounts`, json("POST", payload));
}

export async function endPaymentAccount(accountId: string, reason: string): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(`${BASE}/payment-accounts/${accountId}/end`, json("POST", { reason }));
}

export async function previewBankFile(runId: string, currency: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`${BASE}/runs/${runId}/bank-file?currency=${encodeURIComponent(currency)}`, { cache: "no-store", allowFallback: false });
}

export async function produceBankFile(
  runId: string,
  payload: { currency: string; layout_id?: string; confirm_repeat?: boolean; confirm_recent_changes?: boolean },
): Promise<ApiResponse<ProducedFile>> {
  return fetchApi<ApiResponse<ProducedFile>>(`${BASE}/runs/${runId}/bank-file`, json("POST", payload));
}

/** month is YYYY-MM */
export async function previewPayrollReturn(kind: "paye" | "nssa", month: string, currency: string): Promise<ApiResponse<any>> {
  const search = new URLSearchParams({ month, currency });
  return fetchApi<ApiResponse<any>>(`${BASE}/returns/${kind}?${search.toString()}`, { cache: "no-store", allowFallback: false });
}

export async function exportPayrollReturn(
  kind: "paye" | "nssa",
  payload: { month: string; currency: string; layout_id?: string },
): Promise<ApiResponse<ProducedFile>> {
  return fetchApi<ApiResponse<ProducedFile>>(`${BASE}/returns/${kind}/export`, json("POST", payload));
}

export async function getPayrollExports(limit = 50): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`${BASE}/exports?limit=${limit}`, { cache: "no-store", allowFallback: false });
}
