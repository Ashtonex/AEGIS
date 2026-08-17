-- ============================================================================
-- Tender requirements checklist
-- ============================================================================
-- Tenders often come with a list of specific requirements (site visit,
-- registration on a supplier portal, particular certifications, etc.) that
-- need tracking as the tender moves through Tender Identified -> Bid Prep.
-- This is deliberately freeform (user-typed text + a checkbox), not a fixed
-- catalog like crm.lead_compliance_requirements (087) - tender requirements
-- vary too much per-tender to be worth a canonical type table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm.tender_requirements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    tender_id       UUID NOT NULL REFERENCES crm.tenders(id) ON DELETE CASCADE,
    label           VARCHAR(255) NOT NULL,
    is_satisfied    BOOLEAN NOT NULL DEFAULT false,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_by      UUID REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_tender_requirements_tender
    ON crm.tender_requirements (organization_id, tender_id) WHERE is_deleted = false;
