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


export type ProjectSupplyChainResponse = {
  project_id: string;
  site_stores: Array<{
    id: string;
    name: string;
    code: string;
    store_type: string;
    site_id?: string;
    location?: string;
    is_active: boolean;
    created_at: string;
  }>;
  inventory_on_hand: Array<{
    item_id: string;
    item_code: string;
    item_name: string;
    unit_of_measure: string;
    category: string;
    store_id: string;
    store_name: string;
    on_hand_quantity: number;
    avg_unit_cost: number;
    total_value: number;
  }>;
  requisitions: Array<{
    id: string;
    requisition_number: string;
    title: string;
    status: string;
    priority: string;
    created_at: string;
    required_by_date?: string;
    site_id?: string;
    site_name?: string;
    item_count: number;
    estimated_total: number;
  }>;
  purchase_orders: Array<{
    id: string;
    po_number: string;
    status: string;
    supplier_id: string;
    supplier_name?: string;
    currency: string;
    total_amount: number;
    created_at: string;
    expected_delivery_date?: string;
    payment_terms?: string;
  }>;
  deliveries: Array<{
    id: string;
    grn_number: string;
    po_id?: string;
    po_number?: string;
    store_id: string;
    store_name?: string;
    delivery_note_number?: string;
    received_at: string;
    received_by_user_id?: string;
    inspection_status: string;
    item_count: number;
  }>;
  consumption_logs: Array<{
    id: string;
    report_id: string;
    report_date: string;
    item_id?: string;
    item_name?: string;
    item_code?: string;
    description: string;
    quantity_used: number;
    unit_of_measure?: string;
    notes?: string;
    created_at: string;
  }>;
  summary: {
    total_site_stores: number;
    total_inventory_items: number;
    on_hand_inventory_value: number;
    open_committed_po_value: number;
    total_open_pos: number;
    total_requisitions: number;
    total_deliveries: number;
  };
};

/**
 * Retrieves the complete consolidated supply chain for a project:
 * site stores, on-hand inventory, site requisitions, purchase orders, deliveries (GRNs), and consumption.
 */
export async function getProjectSupplyChain(
  projectId: string
): Promise<ApiResponse<ProjectSupplyChainResponse>> {
  return fetchApi<ApiResponse<ProjectSupplyChainResponse>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/supply-chain`,
    {
      cache: "no-store",
      allowFallback: false,
    }
  );
}
