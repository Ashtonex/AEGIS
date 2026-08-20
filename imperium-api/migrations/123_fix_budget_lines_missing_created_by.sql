-- ============================================================================
-- AEGIS MIGRATION 123 — FIX: finance.budget_lines MISSING created_by
-- ============================================================================
-- app/services/finance/project_forecast.py's seed_project_budget_from_
-- quotation() has always INSERTed created_by into finance.budget_lines, but
-- the table (023_finance_and_hr_domain.sql) never had that column - only
-- id/organization_id/budget_id/cost_code_id/cost_category/description/
-- quantity/unit_rate/amount/notes/created_at/is_deleted. Every call to this
-- function has been throwing UndefinedColumnError, silently caught by the
-- broad except in crm.py's mark_opportunity_won (and now tender_bids.py's
-- award_tender), surfacing to the user only as "Budget could not be seeded
-- automatically - confirm via Quotations > Decision instead." Found while
-- verifying the tender-award flow (migration 121) end-to-end against a real
-- linked quotation - the direct repro is in this branch's PR notes.
--
-- Fix: add the column (nullable, matching created_by's shape on sibling
-- finance tables like project_budgets/commitments/variations) rather than
-- stop writing it - knowing who seeded a budget line is genuinely useful
-- audit info and was clearly the original intent.
-- ============================================================================

ALTER TABLE finance.budget_lines
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES core.users(id);
