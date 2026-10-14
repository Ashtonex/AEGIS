import { ApiResponse } from "@/types/api";
import { fetchApi } from "./core";

/**
 * Canonical authenticated internal project retrieval by ID or project code.
 * Requires `projects.read` permission. Scoped to authorized tenant projects.
 */
export async function getInternalProject(projectId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
    cache: "no-store",
    allowFallback: false,
  });
}

export type EligibleQuotationSummary = {
  id: string;
  reference_number?: string;
  client_name: string;
  quote_amount: number;
  status: string;
  created_at: string;
  project_title?: string;
  has_approved_boq: boolean;
  is_directly_linked: boolean;
  match_reasons: string[];
  category_estimates: Record<string, number>;
  items_count: number;
};

/**
 * Lists eligible quotations for linking or importing into the given project.
 * Includes explicit lineage matches (project_id, quotation_id, opportunity_id, tender_id, client_org_id, client_name)
 * and all approved/won quotations in the tenant for explicit manual selection.
 */
export async function getEligibleQuotationsForProject(
  projectId: string
): Promise<ApiResponse<{
  matched_quotations: EligibleQuotationSummary[];
  all_eligible_quotations: EligibleQuotationSummary[];
}>> {
  return fetchApi<ApiResponse<{
    matched_quotations: EligibleQuotationSummary[];
    all_eligible_quotations: EligibleQuotationSummary[];
  }>>(`/api/v1/projects/${encodeURIComponent(projectId)}/budget/eligible-quotations`, {
    cache: "no-store",
    allowFallback: false,
  });
}

/**
 * Explicitly links an internal project to a quotation.
 */
export async function linkProjectToQuotation(
  projectId: string,
  quotationId: string
): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/budget/link-quotation`,
    {
      method: "POST",
      body: JSON.stringify({ quotation_id: quotationId }),
      allowFallback: false,
    }
  );
}
