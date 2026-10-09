import { fetchApi } from "./core";

// --- PERFORMANCE (/api/v1/hr/performance): weekly graded scorecards ---

const PERF = "/api/v1/hr/performance";
type Resp<T> = { success: boolean; data: T; message?: string };

export type PerformanceAreaKey = "delivery" | "reliability" | "records" | "responsiveness" | "output";

export type PerformanceComponent = {
  score: number | null;
  weight: number;
  label: string;
  target: string;
  metrics: Record<string, unknown>;
};

export type Scorecard = {
  id: string;
  employee_id: string;
  employee_name: string;
  job_title: string | null;
  department: string | null;
  user_id: string | null;
  manager_name: string | null;
  manager_user_id: string | null;
  week_start: string;
  week_end: string;
  mode: "shadow" | "live";
  score: number | string | null;
  grade: string | null;
  final_score: number | null;
  final_grade: string | null;
  components: Record<PerformanceAreaKey, PerformanceComponent>;
  went_well: string[];
  to_improve: string[];
  next_focus: { title: string; due_date: string }[];
  standing: string;
  standing_label: string;
  assisted_period_id: string | null;
  emailed_at: string | null;
  email_status: string | null;
  override_score: number | string | null;
  override_reason: string | null;
  override_at: string | null;
  dispute_note: string | null;
  disputed_at: string | null;
  dispute_status: "open" | "upheld" | "rejected" | null;
  dispute_resolution: string | null;
  trend?: (number | null)[];
  access?: "manage" | "read" | "manager" | "self";
  assisted_period?: AssistedPeriod | null;
};

export type AssistedPeriod = {
  id: string;
  employee_id: string;
  employee_name?: string;
  job_title?: string | null;
  supervisor_name?: string | null;
  supervisor_user_id?: string | null;
  opened_week_end: string;
  first_week_end: string;
  last_week_end: string;
  status: "active" | "passed" | "escalated" | "cancelled";
  targets: string | null;
  supervisor_notes: string | null;
  outcome_note: string | null;
};

export type PerformanceSettings = {
  par_score: number;
  mode: "shadow" | "live";
  live_from: string | null;
  digest_recipients: string;
  default_digest_recipients: string[];
  can_manage: boolean;
  can_read_all: boolean;
  weights: Record<PerformanceAreaKey, number>;
  labels: Record<PerformanceAreaKey, string>;
  targets: Record<PerformanceAreaKey, string>;
  latest_complete_week_end: string;
};

export type ScoredWeek = { week_end: string; mode: string; people: number; emailed: number; average: number | string | null; not_graded: number };

const read = { cache: "no-store" as const, allowFallback: false };
const send = (method: string, payload?: unknown) => ({ method, allowFallback: false, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });

export const getPerformanceSettings = () => fetchApi<Resp<PerformanceSettings>>(`${PERF}/settings`, read);
export const updatePerformanceSettings = (payload: Partial<Pick<PerformanceSettings, "par_score" | "mode" | "live_from" | "digest_recipients">>) =>
  fetchApi<Resp<PerformanceSettings>>(`${PERF}/settings`, send("PUT", payload));
export const getScoredWeeks = () => fetchApi<Resp<ScoredWeek[]>>(`${PERF}/weeks`, read);
export const computePerformanceWeek = (weekEnd: string) =>
  fetchApi<Resp<{ week_end: string; mode: string; people: number }>>(`${PERF}/weeks/${weekEnd}/compute`, { ...send("POST"), timeoutMs: 120000 });
export const sendPerformanceDigest = (weekEnd: string) =>
  fetchApi<Resp<{ sent: string[]; failed: string[] }>>(`${PERF}/weeks/${weekEnd}/send-digest`, { ...send("POST"), timeoutMs: 60000 });
export const getScorecards = (weekEnd?: string) =>
  fetchApi<Resp<{ week_end: string | null; scope?: "all" | "team"; cards: Scorecard[] }>>(`${PERF}/scorecards${weekEnd ? `?week_end=${weekEnd}` : ""}`, read);
export const getScorecard = (id: string) => fetchApi<Resp<Scorecard>>(`${PERF}/scorecards/${id}`, read);
export const getScorecardEmail = (id: string) => fetchApi<Resp<{ subject: string; html: string; to: string | null }>>(`${PERF}/scorecards/${id}/email`, read);
export const overrideScorecard = (id: string, score: number | null, reason: string) =>
  fetchApi<Resp<{ id: string }>>(`${PERF}/scorecards/${id}/override`, send("POST", { score, reason }));
export const disputeScorecard = (id: string, note: string) => fetchApi<Resp<{ id: string }>>(`${PERF}/scorecards/${id}/dispute`, send("POST", { note }));
export const resolveScorecardDispute = (id: string, decision: "upheld" | "rejected", resolution: string, score?: number | null) =>
  fetchApi<Resp<{ id: string }>>(`${PERF}/scorecards/${id}/dispute/resolve`, send("POST", { decision, resolution, score: score ?? null }));
export const getMyScorecards = () => fetchApi<Resp<{ linked: boolean; par_score?: number; cards: Scorecard[] }>>(`${PERF}/me`, read);
export const getAssistedPeriods = () => fetchApi<Resp<AssistedPeriod[]>>(`${PERF}/assisted`, read);
export const updateAssistedPeriod = (id: string, payload: Partial<Pick<AssistedPeriod, "targets" | "supervisor_notes" | "status" | "outcome_note">>) =>
  fetchApi<Resp<{ id: string }>>(`${PERF}/assisted/${id}`, send("PATCH", payload));
