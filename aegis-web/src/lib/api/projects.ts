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
  rfqs?: Array<{
    id: string;
    rfq_number: string;
    title: string;
    status: string;
    closing_date?: string;
    description?: string;
    created_at: string;
  }>;
  wastage_records?: Array<{
    item_code: string;
    item_name: string;
    unit_of_measure: string;
    quantity_issued: number;
    quantity_consumed: number;
    variance_quantity: number;
    wastage_percent: number;
    wastage_cost: number;
    status_flag: "balanced" | "normal" | "elevated" | "critical_loss";
  }>;
  finance_verification?: {
    contract_value: number;
    budget_amount: number;
    deposit_received_amount: number;
    total_material_exposure: number;
    deposit_coverage_percent: number;
    is_deposit_backed: boolean;
    is_within_budget: boolean;
    verdict: string;
    message: string;
  };
  summary: {
    total_site_stores: number;
    total_inventory_items: number;
    on_hand_inventory_value: number;
    open_committed_po_value: number;
    total_open_pos: number;
    total_requisitions: number;
    total_deliveries: number;
    total_rfqs?: number;
    total_wastage_cost?: number;
    average_wastage_percent?: number;
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

/**
 * Retrieves the Month-End Leadership Accountability Dossier for a project,
 * synthesizing KPIs and accountability talking points for Site Engineer, Foreman, and QS.
 */
export async function getProjectLeadershipDossier(
  projectId: string,
  month?: string
): Promise<ApiResponse<any>> {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return fetchApi<ApiResponse<any>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/leadership-dossier${query}`,
    {
      cache: "no-store",
      allowFallback: false,
    }
  );
}

// ---------------------------------------------------------------------------
// Concrete Pour Cards & QA API
// ---------------------------------------------------------------------------

export interface ConcretePourCard {
  id: string;
  pour_number: string;
  element_name: string;
  structure_level?: string | null;
  concrete_grade: string;
  design_volume_m3: number;
  actual_volume_m3?: number;
  target_slump_mm?: number;
  measured_slump_mm?: number | null;
  supplier_name?: string | null;
  status: "pre_pour_check" | "approved_for_pour" | "poured" | "curing_and_testing" | "compliant" | "condemned" | "cancelled";
  rebar_inspected: boolean;
  formwork_inspected: boolean;
  cleanliness_inspected: boolean;
  embedded_mep_inspected: boolean;
  cover_blocks_verified: boolean;
  pre_pour_approved_by?: string | null;
  pre_pour_approved_at?: string | null;
  approved_by_name?: string | null;
  created_by_name?: string | null;
  pour_started_at?: string | null;
  pour_completed_at?: string | null;
  cubes_sampled_count?: number;
  cube_sample_ids?: string | null;
  strength_7d_mpa?: number | null;
  strength_28d_mpa?: number | null;
  test_result_verdict?: "pending" | "pass" | "marginal" | "fail";
  test_certificate_ref?: string | null;
  notes?: string | null;
  created_at: string;
}

export async function listProjectPourCards(
  projectId: string,
  status?: string
): Promise<ApiResponse<ConcretePourCard[]>> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return fetchApi<ApiResponse<ConcretePourCard[]>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/pour-cards${query}`,
    { cache: "no-store", allowFallback: false }
  );
}

export async function createProjectPourCard(
  projectId: string,
  payload: {
    pour_number: string;
    element_name: string;
    structure_level?: string;
    concrete_grade: string;
    design_volume_m3: number;
    target_slump_mm?: number;
    supplier_name?: string;
    notes?: string;
  }
): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/pour-cards`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function updateProjectPourCard(
  projectId: string,
  pourId: string,
  payload: Record<string, unknown>
): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/pour-cards/${encodeURIComponent(pourId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function authorizeProjectPour(
  projectId: string,
  pourId: string
): Promise<ApiResponse<{ id: string; status: string }>> {
  return fetchApi<ApiResponse<{ id: string; status: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/pour-cards/${encodeURIComponent(pourId)}/authorize-pour`,
    {
      method: "POST",
      allowFallback: false,
    }
  );
}

// ---------------------------------------------------------------------------
// Mobile Snag & Defect Management API
// ---------------------------------------------------------------------------

export interface SiteSnag {
  id: string;
  snag_number: string;
  title: string;
  description?: string | null;
  location_zone: string;
  severity: "cosmetic" | "minor" | "major" | "critical_safety";
  status: "open" | "rectified" | "reinspected" | "closed" | "disputed";
  subcontractor_id?: string | null;
  subcontractor_name?: string | null;
  trade?: string | null;
  due_date?: string | null;
  photo_url?: string | null;
  rectified_photo_url?: string | null;
  rectified_at?: string | null;
  rectified_by_name?: string | null;
  closed_at?: string | null;
  closed_by_name?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export async function listProjectSnags(
  projectId: string,
  status?: string,
  severity?: string
): Promise<ApiResponse<SiteSnag[]>> {
  const params = new URLSearchParams();
  if (status) params.append("status", status);
  if (severity) params.append("severity", severity);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchApi<ApiResponse<SiteSnag[]>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/snags${qs}`,
    { cache: "no-store", allowFallback: false }
  );
}

export async function createProjectSnag(
  projectId: string,
  payload: {
    snag_number: string;
    title: string;
    description?: string;
    location_zone: string;
    severity?: string;
    trade?: string;
    subcontractor_id?: string;
    due_date?: string;
    photo_url?: string;
  }
): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/snags`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function updateProjectSnag(
  projectId: string,
  snagId: string,
  payload: Record<string, unknown>
): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/snags/${encodeURIComponent(snagId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function signOffProjectSnag(
  projectId: string,
  snagId: string
): Promise<ApiResponse<{ id: string; status: string }>> {
  return fetchApi<ApiResponse<{ id: string; status: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/snags/${encodeURIComponent(snagId)}/sign-off`,
    {
      method: "POST",
      allowFallback: false,
    }
  );
}

// ---------------------------------------------------------------------------
// Subcontractor Packages, Certificates & Commercial Controls API
// ---------------------------------------------------------------------------

export interface SubcontractPackageItem {
  id: string;
  package_number: string;
  title: string;
  subcontractor_id: string;
  subcontractor_name: string;
  subcontractor_email?: string | null;
  subcontractor_phone?: string | null;
  trade: string;
  award_value: number;
  retention_percentage: number;
  retention_cap?: number;
  status: "draft" | "awarded" | "active" | "practical_completion" | "final_account" | "terminated";
  start_date?: string | null;
  completion_date?: string | null;
  scope_description?: string | null;
  total_certified_gross: number;
  total_retention_held: number;
  total_contra_deducted: number;
  total_net_payable: number;
  certificates_count: number;
  created_at: string;
}

export interface SubcontractCertificateItem {
  id: string;
  certificate_number: string;
  valuation_date: string;
  period_start?: string | null;
  period_end?: string | null;
  claimed_amount: number;
  certified_gross_amount: number;
  retention_deducted: number;
  contra_charges_deducted: number;
  previous_certified_gross: number;
  net_payable_amount: number;
  status: "draft" | "under_review" | "certified" | "approved" | "posted_to_finance" | "paid" | "rejected";
  qs_assessor_name?: string | null;
  manager_approver_name?: string | null;
  certified_at?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface SubcontractBackChargeItem {
  id: string;
  package_id: string;
  subcontractor_id: string;
  subcontractor_name?: string;
  package_number?: string;
  package_title?: string;
  charge_number: string;
  title: string;
  reason_category: "defective_work_rectification" | "plant_hire_recovery" | "material_usage_recovery" | "site_cleaning_penalty" | "safety_non_compliance";
  amount: number;
  evidence_reference?: string | null;
  status: "pending" | "approved" | "applied_to_certificate" | "disputed" | "waived";
  approver_name?: string | null;
  created_at: string;
}

export async function listSubcontractPackages(
  projectId: string
): Promise<ApiResponse<SubcontractPackageItem[]>> {
  return fetchApi<ApiResponse<SubcontractPackageItem[]>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/subcontracts`,
    { cache: "no-store", allowFallback: false }
  );
}

export async function createSubcontractPackage(
  projectId: string,
  payload: {
    package_number: string;
    title: string;
    subcontractor_id: string;
    trade: string;
    award_value: number;
    retention_percentage?: number;
    retention_cap?: number;
    start_date?: string;
    completion_date?: string;
    scope_description?: string;
  }
): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/subcontracts`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function updateSubcontractPackage(
  projectId: string,
  packageId: string,
  payload: Record<string, unknown>
): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/subcontracts/${encodeURIComponent(packageId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function listSubcontractCertificates(
  projectId: string,
  packageId: string
): Promise<ApiResponse<SubcontractCertificateItem[]>> {
  return fetchApi<ApiResponse<SubcontractCertificateItem[]>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/subcontracts/${encodeURIComponent(packageId)}/certificates`,
    { cache: "no-store", allowFallback: false }
  );
}

export async function createSubcontractCertificate(
  projectId: string,
  packageId: string,
  payload: {
    certificate_number: string;
    valuation_date: string;
    period_start?: string;
    period_end?: string;
    claimed_amount: number;
    certified_gross_amount: number;
    notes?: string;
  }
): Promise<ApiResponse<{ id: string; gross: number; retention_deducted: number; contra_charges_deducted: number; net_payable: number }>> {
  return fetchApi<ApiResponse<{ id: string; gross: number; retention_deducted: number; contra_charges_deducted: number; net_payable: number }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/subcontracts/${encodeURIComponent(packageId)}/certificates`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function postCertificateToFinance(
  projectId: string,
  packageId: string,
  certId: string
): Promise<ApiResponse<{ id: string; status: string }>> {
  return fetchApi<ApiResponse<{ id: string; status: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/subcontracts/${encodeURIComponent(packageId)}/certificates/${encodeURIComponent(certId)}/post-to-finance`,
    {
      method: "POST",
      allowFallback: false,
    }
  );
}

export async function listSubcontractBackCharges(
  projectId: string,
  packageId?: string
): Promise<ApiResponse<SubcontractBackChargeItem[]>> {
  const query = packageId ? `?package_id=${encodeURIComponent(packageId)}` : "";
  return fetchApi<ApiResponse<SubcontractBackChargeItem[]>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/back-charges${query}`,
    { cache: "no-store", allowFallback: false }
  );
}

export async function createSubcontractBackCharge(
  projectId: string,
  payload: {
    package_id: string;
    subcontractor_id: string;
    charge_number: string;
    title: string;
    reason_category: string;
    amount: number;
    evidence_reference?: string;
  }
): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/back-charges`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function updateSubcontractBackCharge(
  projectId: string,
  chargeId: string,
  payload: Record<string, unknown>
): Promise<ApiResponse<{ id: string }>> {
  return fetchApi<ApiResponse<{ id: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/back-charges/${encodeURIComponent(chargeId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

// ---------------------------------------------------------------------------
// Plant, Fleet & Equipment Analytics API
// ---------------------------------------------------------------------------

export interface ProjectPlantAsset {
  assignment_id: string;
  assignment_status: string;
  starts_at?: string | null;
  ends_at?: string | null;
  fleet_id: string;
  asset_code: string;
  vehicle_registration?: string | null;
  make?: string | null;
  model?: string | null;
  ownership_type: string;
  asset_category: string;
  operational_status: string;
  hourly_charge_rate: number;
  benchmark_litres_per_hour: number;
  current_meter_reading: number;
  operating_hours: number;
  idle_hours: number;
  breakdown_hours: number;
  weather_hours: number;
  standing_hours: number;
  utilization_rate: number;
  fuel_litres: number;
  fuel_cost: number;
  burn_rate: number;
  burn_variance: number;
  output_quantity: number;
  output_unit: string;
  productivity: number;
  operating_cost: number;
}

export interface ProjectPlantShiftLog {
  id: string;
  fleet_id: string;
  occurred_on?: string | null;
  asset_code: string;
  make?: string | null;
  model?: string | null;
  operating_hours: number;
  idle_hours: number;
  breakdown_downtime_hours: number;
  output_quantity: number;
  output_unit?: string | null;
  work_performed?: string | null;
  approval_status: string;
}

export interface ProjectPlantAnalytics {
  kpis: {
    total_assigned_assets: number;
    owned_assets_count: number;
    hired_assets_count: number;
    total_operating_hours: number;
    total_idle_hours: number;
    total_breakdown_hours: number;
    total_weather_downtime_hours: number;
    overall_utilization_rate: number;
    total_fuel_consumed_litres: number;
    total_fuel_cost: number;
    average_burn_rate: number;
    total_plant_operating_cost: number;
  };
  plant_inventory: ProjectPlantAsset[];
  recent_shift_logs: ProjectPlantShiftLog[];
}

export async function getProjectPlantAnalytics(
  projectId: string
): Promise<ApiResponse<ProjectPlantAnalytics>> {
  return fetchApi<ApiResponse<ProjectPlantAnalytics>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/plant/analytics`,
    { cache: "no-store", allowFallback: false }
  );
}

export async function recordProjectPlantShiftLog(
  projectId: string,
  payload: {
    fleet_id: string;
    occurred_on?: string;
    operating_hours: number;
    idle_hours?: number;
    breakdown_downtime_hours?: number;
    weather_downtime_hours?: number;
    output_quantity?: number;
    output_unit?: string;
    fuel_litres?: number;
    work_performed?: string;
  }
): Promise<ApiResponse<{ utilization_id: string; fuel_transaction_id?: string; message: string }>> {
  return fetchApi<ApiResponse<{ utilization_id: string; fuel_transaction_id?: string; message: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/plant/quick-log`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

// ---------------------------------------------------------------------------
// Contractual Delays & Extension of Time (EOT) Claims API
// ---------------------------------------------------------------------------

export interface ContractualDelayItem {
  id: string;
  event_number: string;
  title: string;
  cause_category: string;
  contract_clause_reference?: string | null;
  event_occurred_date: string;
  event_ended_date?: string | null;
  notice_required_days: number;
  notice_served_date?: string | null;
  notice_status: "draft" | "served_within_time" | "time_barred" | "acknowledged_by_client" | "disputed";
  notice_deadline: string;
  days_remaining_to_notice: number;
  is_time_barred: boolean;
  estimated_days_impact: number;
  mitigation_actions?: string | null;
  description?: string | null;
  created_at: string;
  created_by_name?: string | null;
  eot_claims_count: number;
}

export interface ExtensionOfTimeClaimItem {
  id: string;
  claim_reference: string;
  title: string;
  delay_event_id?: string | null;
  delay_event_number?: string | null;
  delay_cause_category?: string | null;
  days_requested: number;
  impacted_milestone_id?: string | null;
  impacted_milestone_name?: string | null;
  milestone_is_critical: boolean;
  is_critical_path_impact: boolean;
  prolongation_cost_claimed: number;
  submission_date: string;
  status: "draft" | "submitted" | "under_review" | "determined" | "rejected" | "disputed";
  days_granted: number;
  prolongation_cost_approved: number;
  determination_date?: string | null;
  determination_notes?: string | null;
  engineer_representative_name?: string | null;
  revised_contractual_completion_date?: string | null;
  created_at: string;
  created_by_name?: string | null;
}

export async function listProjectDelays(
  projectId: string
): Promise<ApiResponse<ContractualDelayItem[]>> {
  return fetchApi<ApiResponse<ContractualDelayItem[]>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/delays`,
    { cache: "no-store", allowFallback: false }
  );
}

export async function createProjectDelay(
  projectId: string,
  payload: {
    event_number: string;
    title: string;
    cause_category: string;
    contract_clause_reference?: string;
    event_occurred_date: string;
    event_ended_date?: string;
    notice_required_days?: number;
    notice_served_date?: string;
    notice_status?: string;
    estimated_days_impact?: number;
    mitigation_actions?: string;
    description?: string;
  }
): Promise<ApiResponse<{ id: string; notice_status: string; notice_deadline: string }>> {
  return fetchApi<ApiResponse<{ id: string; notice_status: string; notice_deadline: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/delays`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function listProjectEotClaims(
  projectId: string
): Promise<ApiResponse<ExtensionOfTimeClaimItem[]>> {
  return fetchApi<ApiResponse<ExtensionOfTimeClaimItem[]>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/eot-claims`,
    { cache: "no-store", allowFallback: false }
  );
}

export async function createProjectEotClaim(
  projectId: string,
  payload: {
    claim_reference: string;
    title: string;
    delay_event_id?: string;
    days_requested: number;
    impacted_milestone_id?: string;
    is_critical_path_impact?: boolean;
    prolongation_cost_claimed?: number;
    submission_date?: string;
  }
): Promise<ApiResponse<{ id: string; is_critical_path_impact: boolean }>> {
  return fetchApi<ApiResponse<{ id: string; is_critical_path_impact: boolean }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/eot-claims`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function determineProjectEotClaim(
  projectId: string,
  claimId: string,
  payload: {
    days_granted: number;
    prolongation_cost_approved: number;
    determination_date?: string;
    determination_notes?: string;
    engineer_representative_name?: string;
    revised_contractual_completion_date?: string;
    status?: string;
  }
): Promise<ApiResponse<{ id: string; status: string; days_granted: number; prolongation_cost_approved: number }>> {
  return fetchApi<ApiResponse<{ id: string; status: string; days_granted: number; prolongation_cost_approved: number }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/eot-claims/${encodeURIComponent(claimId)}/determine`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export interface ProjectMilestoneItem {
  id: string;
  name: string;
  target_date?: string | null;
  status?: string | null;
  is_critical?: boolean;
}

export async function listProjectMilestones(
  projectId: string
): Promise<ApiResponse<ProjectMilestoneItem[]>> {
  const res = await fetchApi<ApiResponse<{ milestones: ProjectMilestoneItem[] }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/lifecycle`,
    { cache: "no-store", allowFallback: false }
  );
  return {
    ...res,
    data: res.data?.milestones || [],
  };
}

// ---------------------------------------------------------------------------
// Controlled Drawings Register API
// ---------------------------------------------------------------------------

export interface ControlledDrawingItem {
  id: string;
  drawing_number: string;
  title: string;
  discipline: string;
  current_revision: string;
  ifc_status: string;
  date_received: string;
  file_url?: string | null;
  superseded_history?: Array<{
    revision: string;
    superseded_date: string;
    date_received?: string | null;
    file_url?: string | null;
  }>;
  distribution_list?: unknown[];
  created_at: string;
  created_by_name?: string | null;
}

export interface ProgressPhotoDiaryItem {
  id: string;
  photo_url: string;
  caption: string;
  element_tag: string;
  captured_date: string;
  weather_condition?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  created_at: string;
  uploaded_by_name?: string | null;
}

export interface ProjectProgressPackData {
  report_generated_at: string;
  project: {
    id: string;
    name: string;
    code: string;
    status: string;
    client_name?: string | null;
    project_manager_name?: string | null;
    contract_value: number;
    start_date?: string | null;
    target_completion_date?: string | null;
    revised_contractual_completion_date?: string | null;
  };
  executive_summary: {
    schedule_progress_pct: number;
    total_milestones: number;
    completed_milestones: number;
    critical_path_milestones: number;
    pour_cards_total: number;
    pour_cards_compliant: number;
    total_concrete_volume_m3: number;
    snags_open: number;
    snags_closed: number;
    plant_total_deployed: number;
    plant_utilization_rate: number;
    fuel_consumed_litres: number;
    subcontract_committed: number;
    subcontract_certified: number;
    subcontract_retention_held: number;
    delays_notified: number;
    delays_time_barred: number;
    eot_days_requested: number;
    eot_days_granted: number;
    prolongation_claimed: number;
    prolongation_approved: number;
    drawings_total: number;
    drawings_ifc: number;
    progress_photos_count: number;
  };
  plant_metrics: {
    total_assigned_assets: number;
    owned_assets_count: number;
    hired_assets_count: number;
    total_operating_hours: number;
    total_idle_hours: number;
    total_breakdown_hours: number;
    overall_utilization_rate: number;
    total_fuel_consumed_litres: number;
    total_fuel_cost: number;
    average_burn_rate: number;
    total_plant_operating_cost: number;
  };
  milestones: Array<{
    id: string;
    name: string;
    target_date?: string | null;
    status: string;
    is_critical: boolean;
    total_float: number;
  }>;
  drawings: ControlledDrawingItem[];
  delays: Array<{
    id: string;
    event_number: string;
    title: string;
    cause_category: string;
    contract_clause_reference?: string | null;
    event_occurred_date: string;
    is_time_barred: boolean;
    notice_status: string;
  }>;
  eot_claims: Array<{
    id: string;
    claim_reference: string;
    title: string;
    days_requested: number;
    days_granted: number;
    prolongation_cost_claimed: number;
    prolongation_cost_approved: number;
    status: string;
  }>;
  recent_photos: ProgressPhotoDiaryItem[];
}

export async function listProjectControlledDrawings(
  projectId: string
): Promise<ApiResponse<ControlledDrawingItem[]>> {
  return fetchApi<ApiResponse<ControlledDrawingItem[]>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/drawings`,
    { cache: "no-store", allowFallback: false }
  );
}

export async function recordProjectControlledDrawing(
  projectId: string,
  payload: {
    drawing_number: string;
    title: string;
    discipline: string;
    current_revision?: string;
    ifc_status?: string;
    date_received?: string;
    file_url?: string;
  }
): Promise<ApiResponse<{ id: string; action: string; superseded_revisions: number }>> {
  return fetchApi<ApiResponse<{ id: string; action: string; superseded_revisions: number }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/drawings`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function listProjectProgressPhotos(
  projectId: string
): Promise<ApiResponse<ProgressPhotoDiaryItem[]>> {
  return fetchApi<ApiResponse<ProgressPhotoDiaryItem[]>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/photos`,
    { cache: "no-store", allowFallback: false }
  );
}

export async function recordProjectProgressPhoto(
  projectId: string,
  payload: {
    photo_url: string;
    caption: string;
    element_tag: string;
    captured_date?: string;
    weather_condition?: string;
    gps_lat?: number;
    gps_lng?: number;
  }
): Promise<ApiResponse<{ id: string; message: string }>> {
  return fetchApi<ApiResponse<{ id: string; message: string }>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/photos`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      allowFallback: false,
    }
  );
}

export async function getProjectProgressPack(
  projectId: string
): Promise<ApiResponse<ProjectProgressPackData>> {
  return fetchApi<ApiResponse<ProjectProgressPackData>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/progress-pack`,
    { cache: "no-store", allowFallback: false }
  );
}

export interface ProjectEvmData {
  project_id: string;
  as_of_date: string;
  kpis: {
    budget_at_completion: number;
    planned_value: number;
    earned_value: number;
    actual_cost: number;
    cost_variance: number;
    schedule_variance: number;
    cost_performance_index: number;
    schedule_performance_index: number;
    estimate_at_completion: number;
    variance_at_completion: number;
    to_complete_performance_index: number;
    physical_progress_pct: number;
    planned_progress_pct: number;
    cost_status: "under_budget" | "cost_overrun";
    schedule_status: "ahead_of_schedule" | "delayed";
  };
  s_curve: Array<{
    date: string;
    label: string;
    planned_value: number;
    earned_value: number | null;
    actual_cost: number | null;
  }>;
}

export async function getProjectEvmAnalytics(
  projectId: string
): Promise<ApiResponse<ProjectEvmData>> {
  return fetchApi<ApiResponse<ProjectEvmData>>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/evm-analytics`,
    { cache: "no-store", allowFallback: false }
  );
}






