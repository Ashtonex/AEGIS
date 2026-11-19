// Table lists shared by more than one live screen. Pages may also pass their
// own `tables: [...]` inline. Every name, here or inline, must be relayed by
// imperium-api/core/realtime.py (TABLE_PERMISSION_MAP) and have a
// live_change_notify trigger; imperium-api/tests/test_live_table_contract.py
// checks both.

import type { LiveChange } from "./LiveDataProvider";

export const TENDER_DISCOVERY_TABLES = ["crm.tender_candidates", "crm.tender_discovery_runs"] as const;

/** What the project shell and overview show: the record, its plan, team,
 * site reports and money summary. */
export const PROJECT_OVERVIEW_TABLES = [
  "projects.projects",
  "projects.project_milestones",
  "projects.project_changes",
  "projects.project_risks",
  "projects.project_checks",
  "projects.project_profiles",
  "projects.daily_site_reports",
  "projects.site_role_assignments",
  "hr.project_allocations",
  "finance.cost_transactions",
  "finance.project_budgets",
  "finance.variations",
  "finance.progress_claims",
  "finance.commitments",
] as const;

export const PROJECT_SCHEDULE_TABLES = [
  "projects.project_milestones",
  "projects.milestone_dependencies",
  "projects.site_daily_targets",
  "projects.daily_site_reports",
  "projects.site_day_briefings",
] as const;

export const PROJECT_TEAM_TABLES = [
  "hr.project_allocations",
  "projects.site_role_assignments",
  "projects.site_day_attendance",
  "finance.site_workers",
] as const;

export const PROJECT_QUALITY_TABLES = ["projects.concrete_pour_cards", "projects.site_snags", "projects.project_checks"] as const;

export const PROJECT_MATERIALS_TABLES = [
  "procurement.purchase_requisitions",
  "procurement.purchase_orders",
  "procurement.goods_received_notes",
  "procurement.stock_ledger",
  "projects.weekly_budgets",
  "projects.weekly_budget_items",
] as const;

export const PROJECT_PLANT_TABLES = [
  "fleet.plant_requests",
  "fleet.fleet_assignments",
  "fleet.utilization_logs",
  "fleet.fuel_transactions",
] as const;

export const PROJECT_FINANCIAL_TABLES = [
  "finance.cost_transactions",
  "finance.project_budgets",
  "finance.variations",
  "finance.progress_claims",
  "finance.retention_ledger",
  "finance.project_money_entries",
  "finance.project_forecasts",
  "finance.boq_line_items",
  "finance.commitments",
  "projects.subcontract_packages",
  "projects.subcontractor_certificates",
  "projects.subcontractor_back_charges",
] as const;

export const PROJECT_RISK_TABLES = [
  "projects.project_risks",
  "projects.contractual_delay_events",
  "projects.extension_of_time_claims",
  "projects.project_changes",
] as const;

export const PROJECT_SITE_LOG_TABLES = ["projects.daily_site_reports", "projects.progress_photo_diary"] as const;

/** True when a change belongs to this project: a row carrying its
 * project_id, or the project record itself. */
export function isProjectChange(change: LiveChange, projectId: string): boolean {
  if (!projectId) return false;
  if (change.table === "projects.projects") return change.id === projectId;
  return change.project_id === projectId;
}
