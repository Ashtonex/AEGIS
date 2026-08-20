-- ============================================================================
-- AEGIS MIGRATION 128 — PURSUIT OPERATING SYSTEM (PHASE 0: FOUNDATION)
-- ============================================================================
-- First step of the Department -> Team -> Commercial Object -> Tasks ->
-- Evidence -> Decision -> Outcome model. finance.departments (077) only
-- seeded 3 of the 5 permanent departments the pursuit model requires
-- (Commercial, Construction, Plant & Equipment) - this adds the missing
-- Corporate Control Services and Risk departments.
--
-- crm.pursuits is a new, thin "spine" table. It does NOT replace or merge
-- crm.leads/crm.opportunities/crm.tenders - each keeps its own detailed
-- stage machinery and Kanban. A pursuit row is the one place that ties a
-- Lead -> Opportunity -> Tender -> Award/Loss chain together and carries
-- fields that don't belong on any single existing table: a unified status
-- vocabulary, risk status, outcome and next action. Additive and nullable
-- throughout - existing lead/opportunity/tender routers need no changes.
-- ============================================================================

-- 1. Complete the department taxonomy.
INSERT INTO finance.departments (organization_id, code, name)
SELECT o.id, v.code, v.name
FROM core.organizations o
CROSS JOIN (VALUES
    ('corporate_control_services', 'Corporate Control Services'),
    ('risk', 'Risk')
) AS v(code, name)
WHERE o.is_deleted = false
ON CONFLICT (organization_id, code) DO NOTHING;

-- 2. The pursuit spine.
CREATE TABLE IF NOT EXISTS crm.pursuits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    lead_id         UUID REFERENCES crm.leads(id),
    opportunity_id  UUID REFERENCES crm.opportunities(id),
    tender_id       UUID REFERENCES crm.tenders(id),
    status          VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN (
                        'draft', 'active', 'under_qualification', 'bid_decision_required',
                        'pursuing', 'tender_preparation', 'awaiting_approval', 'submitted',
                        'clarification', 'negotiation', 'won', 'lost', 'withdrawn', 'closed'
                    )),
    risk_status     VARCHAR(20) CHECK (risk_status IN ('low', 'medium', 'high', 'critical')),
    outcome         TEXT,
    next_action     TEXT,
    created_by      UUID REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_crm_pursuits_org ON crm.pursuits (organization_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_crm_pursuits_lead ON crm.pursuits (lead_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_crm_pursuits_opportunity ON crm.pursuits (opportunity_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_crm_pursuits_tender ON crm.pursuits (tender_id) WHERE is_deleted = false;

DROP TRIGGER IF EXISTS trg_audit_pursuits ON crm.pursuits;
CREATE TRIGGER trg_audit_pursuits AFTER INSERT OR UPDATE OR DELETE ON crm.pursuits
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

-- 3. Permissions - same holder set as crm_tasks.read_all / crm.update_opportunities
--    (Commercial-facing roles), following the documents.create broad-grant
--    pattern used by 105/106/077.
INSERT INTO core.permissions (key, description) VALUES
    ('pursuits.read', 'View pursuit records (the Lead/Opportunity/Tender chain and its status)'),
    ('pursuits.update', 'Update pursuit status, risk status, outcome and next action')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT rp.organization_id, rp.role_id, new_p.id
FROM core.role_permissions rp
JOIN core.permissions existing_p ON existing_p.id = rp.permission_id AND existing_p.key = 'documents.create'
JOIN core.permissions new_p ON new_p.key IN ('pursuits.read', 'pursuits.update')
ON CONFLICT (role_id, permission_id) DO NOTHING;
