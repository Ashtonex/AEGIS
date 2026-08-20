-- ============================================================================
-- AEGIS MIGRATION 121 — TENDER AWARD -> PROJECT CONVERSION + DEPOSIT GATE
-- ============================================================================
-- Opportunities have had a full "mark won -> create real project, seed
-- budget/BOQ, refresh forecast, post department referral credit" flow since
-- crm.py's mark_opportunity_won. Tenders never got the equivalent: tender_
-- bids.py is a generic auto-CRUD router, crm.tenders.project_id has existed
-- since migration 005 but nothing has ever written to it, and the Kanban
-- dead-ends at a single combined 'Awarded/Lost' stage. This migration adds
-- the permission + trigger-event plumbing the new /tender-bids/{id}/award
-- endpoint needs (see routers/tender_bids.py).
--
-- It also adds a deposit-paid gate: today a project goes straight from
-- creation to fully spendable with no financial checkpoint, even though a
-- real contract value is attached. New 'pending_deposit' status + a Finance-
-- only confirm-deposit action close that gap for the two flows that spin up
-- a project from a won deal (opportunity mark-won, tender award). Additive
-- and nullable throughout - no backfill, no other router needs to change.
-- ============================================================================

-- 1. New stricter permission for tender award, same rationale as
--    crm.opportunities.close_won (066_role_catalog_expansion.sql): this
--    action can INSERT a real projects.projects row with a real contract
--    value, so it's held separately from ordinary tender_bids.update.
INSERT INTO core.permissions (key, description) VALUES
    ('tender_bids.award', 'Award a CRM tender - can create a real project with a real contract value, so held separately from ordinary tender updates'),
    ('projects.deposit.confirm', 'Confirm a project''s deposit has been received, moving it from pending_deposit to active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'tender_bids.award'),
    ('Finance Manager',   'tender_bids.award'),
    ('Project Manager',   'tender_bids.award'),
    ('Executive (Admin)', 'projects.deposit.confirm'),
    ('Finance Manager',   'projects.deposit.confirm')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 2. Let the tender-award flow post the same commercial-sourced referral
--    credit opportunity_won already can (crm.py's department_transfer_rules
--    lookup), via a matching trigger_event.
ALTER TABLE finance.department_transfer_rules
    DROP CONSTRAINT IF EXISTS department_transfer_rules_trigger_event_check;
ALTER TABLE finance.department_transfer_rules
    ADD CONSTRAINT department_transfer_rules_trigger_event_check
    CHECK (trigger_event IN ('opportunity_won', 'tender_won', 'progress_claim_certified', 'receipt_allocated'));

-- 3. projects.projects already tracks opportunity_id/quotation_id
--    (041_crm_completion_phases_1_6.sql) as provenance for how AEGIS learned
--    about a project. tender_id is the missing counterpart for the
--    tender-sourced path this migration enables.
ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS tender_id UUID REFERENCES crm.tenders(id);

CREATE INDEX IF NOT EXISTS projects_tender_idx
    ON projects.projects (organization_id, tender_id)
    WHERE is_deleted = false;

-- 4. Deposit-gate columns on projects.projects. deposit_reference is
--    deliberately free text rather than an FK into finance.receipt_
--    allocations - that table requires a progress_claim_id, which won't
--    exist yet for an upfront deposit taken before any work is claimed.
ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS contract_signed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS contract_signed_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS deposit_required_amount NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS deposit_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deposit_confirmed_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS deposit_reference TEXT;
