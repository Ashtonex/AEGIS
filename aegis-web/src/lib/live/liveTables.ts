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

/** Everything that puts an item into (or takes one out of) the executive
 * pending-approvals queue: every source in routers/executive.py
 * _PENDING_APPROVAL_SOURCES, plus the approval engine's steps/decisions. */
export const APPROVAL_TABLES = [
  "core.approval_instances",
  "core.approval_steps",
  "core.approval_decisions",
  "crm.subcontractors",
  "finance.company_budgets",
  "finance.journal_entries",
  "finance.management_accounts_packs",
  "finance.payroll_runs",
  "finance.supplier_payment_batches",
  "finance.variations",
  "finance.vendor_payment_requests",
  "finance.progress_claims",
  "fleet.maintenance_work_orders",
  "fleet.plant_requests",
  "hr.leave_requests",
  "procurement.purchase_orders",
  "procurement.purchase_requisitions",
  "procurement.supplier_invoices",
] as const;

/** Supplier payments: payables, batches (held payments needing a second
 * person), their items and the payable events behind them. */
export const SUPPLIER_PAYMENT_TABLES = [
  "finance.payable_events",
  "finance.supplier_payment_batches",
  "finance.supplier_payment_items",
  "procurement.supplier_invoices",
  "finance.payments",
] as const;

export const PAYROLL_TABLES = ["finance.payroll_runs", "finance.payroll_items"] as const;

/** What the finance overview and its action inbox summarise. */
export const FINANCE_OVERVIEW_TABLES = [
  ...SUPPLIER_PAYMENT_TABLES,
  "finance.progress_claims",
  "finance.variations",
  "finance.budgets",
  "finance.project_budgets",
  "finance.cost_transactions",
  "finance.commitments",
  "finance.journal_entries",
  "finance.payroll_runs",
  "finance.vendor_payment_requests",
  "finance.client_payment_requests",
] as const;
