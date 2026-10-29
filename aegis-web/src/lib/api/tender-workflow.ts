// Tender intake workflow: initial review -> QS (backend: routers/tender_workflow.py).
import { ApiResponse } from "@/types/api";
import { fetchApi } from "./core";

const BASE = "/api/v1/tender-workflow";

export type WorkflowStatus =
  | "captured"
  | "pending_tender_review"
  | "pending_qs_verification"
  | "returned_for_correction"
  | "qs_preparation";

export type ItemStatus = "pending" | "done" | "not_applicable";
export type SiteVisitStatus = "required" | "optional" | "not_required" | "unknown";

export interface PersonRef { id: string; name: string }

export interface ReviewItem {
  id: string;
  item_key: string;
  label: string;
  guidance: string | null;
  status: ItemStatus;
  not_applicable_reason: string | null;
  notes: string | null;
  completed_by_name: string | null;
  completed_at: string | null;
  reopened_count: number;
  reopened_note: string | null;
}

export interface TenderFacts {
  id: string;
  tender_name: string;
  bid_number: string | null;
  stage: string;
  source_key: string | null;
  source_notice_id: string | null;
  source_url: string | null;
  source_reference: string | null;
  procuring_entity: string | null;
  region: string | null;
  source_published_at: string | null;
  submission_deadline: string | null;
  submission_instructions: string | null;
  clarification_deadline: string | null;
  site_visit_at: string | null;
  site_visit_mandatory: boolean;
  site_visit_status: SiteVisitStatus | null;
  site_visit_location: string | null;
  site_visit_details: string | null;
  site_visit_source: string | null;
  bond_amount: number | null;
  bid_security_currency: string | null;
  bid_security_form: string | null;
  bid_security_validity: string | null;
  bid_security_source: string | null;
  outstanding_notes: string | null;
}

export interface WorkflowEvent {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  automated: boolean;
  round: number | null;
  note: string | null;
  data: Record<string, any>;
  created_at: string;
  actor_name: string | null;
}

export interface TenderWorkflowView {
  tender: TenderFacts;
  workflow: {
    status: WorkflowStatus | null;
    status_label: string;
    round: number;
    started_at: string | null;
    primary_reviewer: PersonRef | null;
    support_reviewers: PersonRef[];
    submitted_by: PersonRef | null;
    submitted_at: string | null;
    confirmation_note: string | null;
    qs: PersonRef | null;
    qs_assigned_at: string | null;
    qs_verified_by: PersonRef | null;
    qs_verified_at: string | null;
  };
  verification: { deadline?: ItemStatus; site_visit?: ItemStatus; bid_bond?: ItemStatus; documents?: ItemStatus; qs_verified: boolean };
  items: ReviewItem[];
  documents: { id: string; title: string; file_name: string | null; file_size_bytes: number | null; created_at: string; extraction_status: string | null; uploaded_by_name: string | null }[];
  official_documents: { id: string; label: string; official_url: string | null; download_status: string | null; download_error: string | null; download_attempts: number; downloaded_at: string | null; size_bytes: number | null; document_id: string | null; published_label: string | null }[];
  source_material: Record<string, any>;
  events: WorkflowEvent[];
  deliveries: { id: string; recipient_label: string; recipient_email: string | null; address_source: string | null; status: string; attempts: number; last_error: string | null; sent_at: string | null }[];
  tasks: { id: string; title: string; status: string; priority: string; due_date: string | null; source_event: string; completed_at: string | null; assignee_name: string | null }[];
  gate: { can_submit: boolean; problems: string[] };
  permissions: { can_review: boolean; can_qs: boolean; is_admin: boolean; can_edit_details: boolean };
  review_items: { key: string; label: string; guidance: string }[];
}

export type DetailsPatch = Partial<{
  submission_deadline: string | null;
  submission_instructions: string | null;
  clarification_deadline: string | null;
  site_visit_status: SiteVisitStatus | null;
  site_visit_at: string | null;
  site_visit_location: string | null;
  site_visit_details: string | null;
  bond_amount: number | null;
  bid_security_currency: string | null;
  bid_security_form: string | null;
  bid_security_validity: string | null;
  outstanding_notes: string | null;
}>;

const json = (method: string, body?: unknown): RequestInit & { allowFallback: boolean } => ({
  method, body: body === undefined ? undefined : JSON.stringify(body), allowFallback: false,
});

export const getTenderWorkflow = (tenderId: string) =>
  fetchApi<ApiResponse<TenderWorkflowView>>(`${BASE}/tenders/${tenderId}`, { cache: "no-store", allowFallback: false });

export const updateReviewItem = (tenderId: string, key: string, body: { status?: ItemStatus; not_applicable_reason?: string | null; notes?: string | null }) =>
  fetchApi<ApiResponse<ReviewItem>>(`${BASE}/tenders/${tenderId}/items/${key}`, json("PATCH", body));

export const updateTenderDetails = (tenderId: string, body: DetailsPatch) =>
  fetchApi<ApiResponse<TenderWorkflowView>>(`${BASE}/tenders/${tenderId}/details`, json("PATCH", body));

export const submitTenderReview = (tenderId: string, body: { confirm: boolean; note?: string }) =>
  fetchApi<ApiResponse<TenderWorkflowView>>(`${BASE}/tenders/${tenderId}/submit-review`, json("POST", body));

export const recordQsDecision = (tenderId: string, body: { decision: "verified" | "return"; notes?: string; reopen_items?: string[] }) =>
  fetchApi<ApiResponse<TenderWorkflowView>>(`${BASE}/tenders/${tenderId}/qs-decision`, json("POST", body));

export const reassignTender = (tenderId: string, body: { role: "primary_reviewer" | "qs"; user_id: string }) =>
  fetchApi<ApiResponse<TenderWorkflowView>>(`${BASE}/tenders/${tenderId}/reassign`, json("POST", body));

export const startTenderWorkflow = (tenderId: string, sendEmail = false) =>
  fetchApi<ApiResponse<TenderWorkflowView>>(`${BASE}/tenders/${tenderId}/start?send_email=${sendEmail}`, json("POST"));

export const collectTenderMaterial = (tenderId: string) =>
  fetchApi<ApiResponse<{ queued: boolean }>>(`${BASE}/tenders/${tenderId}/collect`, json("POST"));

// ---- admin ----

export interface AutomationSettings {
  schedule_enabled: boolean;
  schedule_interval_minutes: number;
  last_scheduled_run_at: string | null;
  auto_import_enabled: boolean;
  auto_import_bands: string[];
  collect_documents: boolean;
  workflow_enabled: boolean;
  review_due_days: number;
  reviewers: { id: string; name: string; active: boolean }[];
  qs: { id: string; name: string; active: boolean }[];
  qs_assignment_rule: "round_robin" | "least_loaded" | "fixed";
  qs_fixed_user_id: string | null;
  notify_enabled: boolean;
  notify_users: { id: string; name: string; active: boolean; company: boolean; private: boolean }[];
  notify_extra_emails: string[];
  resolved_recipients: { label: string; email: string | null; source: string | null; status: string }[];
  updated_at: string | null;
}

export interface AutomationOverview {
  sources: Record<string, any>[];
  runs: Record<string, any>[];
  settings: AutomationSettings;
  counts: Record<string, number>;
  new_tenders: Record<string, any>[];
  upcoming: { id: string; tender_name: string; kind: "deadline" | "site_visit"; at: string; detail: string | null; review_workflow_status: string | null }[];
  email_problems: Record<string, any>[];
  overdue_tasks: Record<string, any>[];
  blocked_handovers: Record<string, any>[];
  collection_problems: Record<string, any>[];
  warnings: string[];
  permissions: { is_admin: boolean };
}

export const getAutomationOverview = () =>
  fetchApi<ApiResponse<AutomationOverview>>(`${BASE}/admin/overview`, { cache: "no-store", allowFallback: false });

export const saveAutomationSettings = (body: Partial<{
  schedule_enabled: boolean; schedule_interval_minutes: number; auto_import_enabled: boolean; auto_import_bands: string[];
  collect_documents: boolean; workflow_enabled: boolean; review_due_days: number; review_user_ids: string[]; qs_user_ids: string[];
  qs_assignment_rule: string; qs_fixed_user_id: string | null; notify_enabled: boolean;
  notify_users: { user_id: string; company: boolean; private: boolean }[]; notify_extra_emails: string[];
}>) => fetchApi<ApiResponse<AutomationSettings>>(`${BASE}/admin/settings`, json("PUT", body));

export const retryDelivery = (deliveryId: string) =>
  fetchApi<ApiResponse<{ claimed: number; sent: number; failed: number }>>(`${BASE}/admin/deliveries/${deliveryId}/retry`, json("POST"));

export const runAutomationNow = () =>
  fetchApi<ApiResponse<{ run_id: string }>>(`${BASE}/admin/run-now`, json("POST"));

export const STATUS_STEPS: { key: WorkflowStatus; label: string }[] = [
  { key: "captured", label: "Tender Captured" },
  { key: "pending_tender_review", label: "Pending Tender Review" },
  { key: "pending_qs_verification", label: "Pending QS Verification" },
  { key: "qs_preparation", label: "QS Preparation" },
];
