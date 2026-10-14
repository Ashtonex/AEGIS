export type Project = Record<string, unknown> & {
  id: string;
  name?: string;
  project_name?: string;
  status?: string;
  updated_at?: string;
  created_at?: string;
  location?: string;
  contract_value?: number;
  budget?: number;
  budget_value?: number;
  project_manager?: string;
  manager?: string;
  start_date?: string;
  end_date?: string;
  planned_completion_date?: string;
  health?: string;
  project_code?: string;
  client_org_id?: string;
  client_id?: string;
  client_name?: string;
  client?: string;
  department_id?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  progress?: number;
  progress_pct?: number;
};

export type Department = { id: string; code: string; name: string };
export type ClientOrganization = { id: string; name: string; lifecycle_stage?: string; account_status?: string };
export type ClientContact = { id: string; contact_name?: string; first_name?: string; last_name?: string; email?: string; phone?: string; client_org_id?: string };

export type PreMobilisationCheck = Record<string, unknown> & {
  id: string;
  check_name?: string;
  status?: string;
  evidence_reference?: string;
  mandatory_evidence?: string;
};

export type PreMobilisationReadiness = {
  checks: PreMobilisationCheck[];
  total: number;
  ready_count: number;
  missing: string[];
  evidence_missing: string[];
  ready: boolean;
};

export type CommercialReadinessControl = {
  key: string;
  label: string;
  complete: boolean;
};

export type CommercialReadiness = {
  status?: string;
  pack?: Record<string, unknown>;
  controls?: CommercialReadinessControl[];
  authority_status?: string;
  blockers?: string[];
  ready_count?: number;
  total?: number;
  ready?: boolean;
  clearance_statement?: Record<string, unknown>;
  cleared_at?: string;
  cleared_by?: string;
};

export type Detail = Record<string, unknown> & {
  project?: Project;
  viability?: Record<string, unknown>[];
  tests_and_checks?: Record<string, unknown>[];
  site_reports?: Record<string, unknown>[];
  material_records?: Record<string, unknown>[];
  quotations?: Record<string, unknown>[];
  procurement_orders?: Record<string, unknown>[];
  tenders?: Record<string, unknown>[];
  subcontractors?: Record<string, unknown>[];
  milestones?: Record<string, unknown>[];
  changes?: Record<string, unknown>[];
  risks?: Record<string, unknown>[];
  pre_mobilisation?: PreMobilisationReadiness;
  commercial_readiness?: CommercialReadiness;
};

export function text(value: unknown, fallback = "Not recorded"): string {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str.length > 0 ? str : fallback;
}

export function number(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    const cleaned = value.replace(/[,$\s]/g, "").replace(/^\((.*)\)$/, "-$1");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function title(project: Project): string {
  return text(project.name ?? project.project_name ?? project.project_code ?? project.id);
}

export function codePrefix(value: unknown, fallback = "PRJ"): string {
  const raw = text(value, fallback).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return raw ? raw.slice(0, 18) : fallback;
}
