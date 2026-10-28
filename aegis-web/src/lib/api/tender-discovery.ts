// e-GP tender discovery and intake (backend: routers/tender_discovery.py).
import { ApiResponse } from "@/types/api";
import { fetchApi } from "./core";

const BASE = "/api/v1/tender-discovery";

export type ConnectionState =
  | "not_connected"
  | "awaiting_user_login"
  | "connected_verified"
  | "session_expired"
  | "access_restricted"
  | "connection_error";

export type RelevanceBand = "strong" | "possible" | "weak";
export type Readiness = "unverified" | "requirements_missing" | "ready_for_internal_decision";
export type ReviewStatus = "new" | "deferred" | "rejected" | "imported" | "needs_dedupe_review";

export interface FieldEvidence {
  value: any;
  raw: string | null;
  source_url: string;
  section: string;
  excerpt: string | null;
  extracted_at: string;
  confidence: "high" | "medium" | "low";
  corrected?: boolean;
}

export interface SourceView {
  source_key: string;
  display_name: string;
  base_url: string;
  verified_from: string | null;
  connection_state: ConnectionState;
  state_reason: string | null;
  last_verified_at: string | null;
  last_probe_at: string | null;
  last_probe: Record<string, any>;
  verification_stale: boolean;
  enabled: boolean;
  min_request_interval_ms: number;
  max_pages_per_run: number;
  max_details_per_run: number;
  scheduled_recheck_enabled: boolean;
  scheduled_recheck_supported: boolean;
  authenticated_access: { supported: boolean; state: ConnectionState; login_url: string; reason: string };
}

export interface DiscoveryRun {
  id: string;
  status: "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
  outcome: string | null;
  filters: Record<string, string>;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  started_by_name?: string | null;
  pages_total: number | null;
  records_total: number | null;
  page_limit: number | null;
  last_page_completed: number;
  pages_fetched: number;
  pages_failed: number;
  notices_seen: number;
  notices_matched: number;
  details_fetched: number;
  details_failed: number;
  details_skipped: number;
  candidates_new: number;
  candidates_updated: number;
  changes_detected: number;
  failures: { stage: string; url: string; error: string; at: string }[];
  coverage: Record<string, any>;
  summary: string | null;
  cancel_requested: boolean;
  resumed_from_run_id: string | null;
}

export interface DiscoveryProfile {
  id: string;
  name: string;
  description: string | null;
  work_types: { key: string; label: string; weight: number; terms: string[] }[];
  category_terms: { term: string; code: string | null; weight: number }[];
  category_codes: string[];
  preferred_locations: string[];
  nearby_locations: string[];
  exclude_terms: { term: string; penalty: number }[];
  scoring: Record<string, number>;
  updated_at: string;
}

export interface ScoreReason { factor: string; points: number; detail: string }

export interface CandidateSummary {
  id: string;
  source_notice_id: string;
  notice_url: string;
  official_reference: string | null;
  title: string | null;
  procuring_entity: string | null;
  notice_status: string | null;
  board_status: string | null;
  published_at: string | null;
  closing_at: string | null;
  closing_time_specified: boolean | null;
  source_timezone: string | null;
  location_text: string | null;
  category_codes: string[];
  category_names: string[];
  relevance_score: number | null;
  relevance_band: RelevanceBand | null;
  match_reasons: ScoreReason[];
  missing_evidence: string[];
  readiness: Readiness;
  review_status: ReviewStatus;
  review_note: string | null;
  responsible_user_id: string | null;
  responsible_name: string | null;
  internal_review_date: string | null;
  tender_id: string | null;
  detail_status: "not_fetched" | "fetched" | "failed" | "restricted" | "unavailable";
  detail_error: string | null;
  extraction_confidence: "high" | "medium" | "low";
  conflict_count: number;
  question_count: number;
  pending_changes: number;
  first_seen_at: string;
  last_seen_at: string;
  last_checked_at: string | null;
}

export interface SourceChange {
  id: string;
  candidate_id: string;
  tender_id: string | null;
  field_key: string;
  change_kind: string;
  is_material: boolean;
  old_value: any;
  new_value: any;
  old_evidence: FieldEvidence | null;
  new_evidence: FieldEvidence | null;
  review_status: "pending" | "applied" | "acknowledged";
  reviewed_by_name?: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  detected_at: string;
  title?: string | null;
  official_reference?: string | null;
  tender_name?: string | null;
}

export interface CandidateDocument {
  id: string;
  label: string;
  official_url: string | null;
  access: "public" | "login_required" | "unavailable" | "manual_upload";
  document_id: string | null;
  document_title: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  extraction_status: string | null;
  extraction_error: string | null;
  restricted?: boolean;
}

export interface CandidateDetail extends CandidateSummary {
  fields: Record<string, FieldEvidence>;
  corrections: Record<string, { value: any; by: string; at: string; note?: string | null }>;
  conflicts: { field: string; values: { value: any; raw: string | null; source: string; source_url: string; excerpt: string | null }[] }[];
  unresolved_questions: string[];
  snapshots: { id: string; captured_at: string; capture_kind: string; content_hash: string; captured_by_name: string | null }[];
  changes: SourceChange[];
  documents: CandidateDocument[];
  tender: { id: string; tender_name: string; stage: string; submission_deadline: string | null; is_deleted: boolean } | null;
  possible_duplicates: { id: string; tender_name: string; bid_number: string | null; stage: string }[];
  documents_access: { login_url: string; can_read_documents: boolean };
}

export interface DiscoveryOverview {
  source: SourceView;
  profile: DiscoveryProfile;
  runs: DiscoveryRun[];
  active_run: DiscoveryRun | null;
  counts: { review_status: ReviewStatus; relevance_band: RelevanceBand | null; n: number }[];
  pending_changes: number;
  configured_credentials: number;
  limitations: { key: string; title: string; detail: string }[];
  permissions: { run: boolean; import: boolean; configure: boolean };
}

export interface ImportResult {
  candidate_id: string;
  status: "imported" | "linked_existing" | "already_imported" | "needs_dedupe_review" | "failed";
  tender_id?: string;
  tender_url?: string;
  message: string;
  possible_duplicates?: { id: string; tender_name: string; bid_number: string | null; url: string }[];
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const noStore = { cache: "no-store" as const, allowFallback: false };

export const getDiscoveryOverview = () => fetchApi<ApiResponse<DiscoveryOverview>>(`${BASE}/overview`, noStore);

export const verifyEgpConnection = () =>
  fetchApi<ApiResponse<{ connection_state: ConnectionState; state_reason: string; source: SourceView }>>(
    `${BASE}/connection/verify`, { method: "POST", allowFallback: false, timeoutMs: 90000 });

export const updateEgpConnectorSettings = (body: Partial<Pick<SourceView, "min_request_interval_ms" | "max_pages_per_run" | "max_details_per_run" | "scheduled_recheck_enabled" | "enabled">>) =>
  fetchApi<ApiResponse<SourceView>>(`${BASE}/connection/settings`, { method: "PUT", body: JSON.stringify(body), allowFallback: false });

export const updateDiscoveryProfile = (id: string, body: Partial<DiscoveryProfile>) =>
  fetchApi<ApiResponse<DiscoveryProfile>>(`${BASE}/profiles/${id}`, { method: "PUT", body: JSON.stringify(body), allowFallback: false });

export const startDiscoveryRun = (body: { profile_id?: string; filters?: Record<string, string>; page_limit?: number }) =>
  fetchApi<ApiResponse<DiscoveryRun>>(`${BASE}/runs`, { ...json(body), allowFallback: false });

export const getDiscoveryRun = (id: string) => fetchApi<ApiResponse<DiscoveryRun>>(`${BASE}/runs/${id}`, noStore);
export const resumeDiscoveryRun = (id: string) => fetchApi<ApiResponse<DiscoveryRun>>(`${BASE}/runs/${id}/resume`, { method: "POST", allowFallback: false });
export const cancelDiscoveryRun = (id: string) => fetchApi<ApiResponse<any>>(`${BASE}/runs/${id}/cancel`, { method: "POST", allowFallback: false });

export const listDiscoveryCandidates = (params: Record<string, string | number | boolean | undefined>) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") qs.set(k, String(v)); });
  return fetchApi<ApiResponse<CandidateSummary[]>>(`${BASE}/candidates?${qs.toString()}`, noStore);
};

export const getDiscoveryCandidate = (id: string) => fetchApi<ApiResponse<CandidateDetail>>(`${BASE}/candidates/${id}`, noStore);

export const reviewDiscoveryCandidate = (id: string, body: {
  corrections?: Record<string, any>;
  correction_notes?: Record<string, string>;
  responsible_user_id?: string | null;
  internal_review_date?: string | null;
  review_status?: "new" | "deferred" | "rejected";
  review_note?: string | null;
}) => fetchApi<ApiResponse<any>>(`${BASE}/candidates/${id}`, { method: "PATCH", body: JSON.stringify(body), allowFallback: false });

export const importDiscoveryCandidates = (body: {
  items: { candidate_id: string; link_to_tender_id?: string; create_new?: boolean }[];
  responsible_user_id?: string | null;
  internal_review_date?: string | null;
}) => fetchApi<ApiResponse<ImportResult[]>>(`${BASE}/candidates/import`, { ...json(body), allowFallback: false, timeoutMs: 60000 });

export const recheckDiscoveryCandidate = (id: string) =>
  fetchApi<ApiResponse<{ detail_status: string; changes_detected: number; error: string | null }>>(
    `${BASE}/candidates/${id}/recheck`, { method: "POST", allowFallback: false, timeoutMs: 90000 });

export const listSourceChanges = (status: "pending" | "applied" | "acknowledged" | "all" = "pending") =>
  fetchApi<ApiResponse<SourceChange[]>>(`${BASE}/changes?status=${status}`, noStore);

export const decideSourceChange = (id: string, action: "apply" | "acknowledge", note?: string) =>
  fetchApi<ApiResponse<{ applied: string[]; kept: string[] }>>(`${BASE}/changes/${id}/decision`, { ...json({ action, note }), allowFallback: false });

export const attachDiscoveryDocument = (candidateId: string, body: { document_id: string; candidate_document_id?: string; label?: string }) =>
  fetchApi<ApiResponse<{ extraction_status: string }>>(`${BASE}/candidates/${candidateId}/documents`, { ...json(body), allowFallback: false });

export const getTenderEgpSource = (tenderId: string) =>
  fetchApi<ApiResponse<{ tender: Record<string, any>; candidate: Record<string, any> | null }>>(`${BASE}/tenders/${tenderId}/source`, noStore);
