-- ============================================================================
-- Quotation source linking (tender/lead) + Sales Executive Quotations access
-- ============================================================================
-- finance.quotations could only be linked to a project or an opportunity -
-- there was no way to tie an estimate directly to the tender or lead it was
-- built for, so a "needs BOQ" queue (tenders/opportunities/leads without an
-- estimate yet) had no way to anti-join against quotations for tenders or
-- leads specifically. Adds the missing FK columns plus indexes for all three
-- source types (opportunity_id had none either, despite being used in joins
-- already).
--
-- Also grants Sales Executive (the role that actually logs tenders, per
-- migration 085) access to the Quotations & Estimates module, which it never
-- had - so the person who identifies a tender can also kick off its BOQ.
-- ============================================================================

ALTER TABLE finance.quotations
    ADD COLUMN IF NOT EXISTS tender_id UUID REFERENCES crm.tenders(id),
    ADD COLUMN IF NOT EXISTS lead_id   UUID REFERENCES crm.leads(id);

CREATE INDEX IF NOT EXISTS idx_quotations_tender_id
    ON finance.quotations (organization_id, tender_id) WHERE is_deleted = false AND tender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotations_lead_id
    ON finance.quotations (organization_id, lead_id) WHERE is_deleted = false AND lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotations_opportunity_id
    ON finance.quotations (organization_id, opportunity_id) WHERE is_deleted = false AND opportunity_id IS NOT NULL;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.name = 'Sales Executive' AND r.is_deleted = false
JOIN (VALUES
    ('quotations.read'),
    ('quotations.create')
) AS grant_def(permission_key) ON true
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
