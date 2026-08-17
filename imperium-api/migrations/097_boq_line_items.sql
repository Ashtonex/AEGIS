-- ============================================================================
-- BOQ LINE ITEMS + MEASUREMENT ENTRIES — measured-quantity progress tracking
--
-- Closes the QS gap where "how much work has been completed" and "what can
-- be invoiced now" had no answer grounded in physically measured quantities
-- against the priced Bill of Quantities — progress claims were previously a
-- manually typed dollar figure with no BOQ line-item backing.
--
-- finance.boq_line_items is seeded from a won quotation's own priced BOQ
-- (finance.quotations.metadata->'items'), giving each line a persistent,
-- addressable identity for the first time (that metadata blob has none).
-- finance.boq_measurement_entries is an append-only audit trail of each
-- measurement submission/approval, mirroring the submit->approve lifecycle
-- already used by finance.variations and finance.progress_claims rather
-- than silently overwriting a quantity in place.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.boq_line_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id           UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    source_quotation_id  UUID REFERENCES finance.quotations(id),
    item_no              VARCHAR(20),
    description          TEXT NOT NULL,
    unit                 VARCHAR(20) NOT NULL DEFAULT 'item',
    contract_qty         NUMERIC(14,3) NOT NULL CHECK (contract_qty >= 0),
    rate                 NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (rate >= 0),
    contract_amount      NUMERIC(15,2) GENERATED ALWAYS AS (contract_qty * rate) STORED,
    cost_category        VARCHAR(40)
        CHECK (cost_category IS NULL OR cost_category IN ('labour', 'equipment', 'materials', 'subcontract', 'overhead', 'other')),
    qty_measured_to_date NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_measured_to_date >= 0),
    status               VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'omitted', 'superseded')),
    sort_order           INTEGER NOT NULL DEFAULT 0,
    created_by           UUID REFERENCES core.users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted           BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS boq_line_items_project_idx
    ON finance.boq_line_items (organization_id, project_id, sort_order)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS finance.boq_measurement_entries (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    boq_line_item_id     UUID NOT NULL REFERENCES finance.boq_line_items(id) ON DELETE CASCADE,
    measurement_date     DATE NOT NULL,
    qty_this_period      NUMERIC(14,3) NOT NULL CHECK (qty_this_period > 0),
    cumulative_qty_after NUMERIC(14,3) NOT NULL CHECK (cumulative_qty_after >= 0),
    measured_by          UUID REFERENCES core.users(id),
    status               VARCHAR(24) NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'approved', 'rejected')),
    approved_by          UUID REFERENCES core.users(id),
    approved_at          TIMESTAMPTZ,
    rejection_reason     TEXT,
    notes                TEXT,
    progress_claim_id    UUID REFERENCES finance.progress_claims(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS boq_measurement_entries_line_idx
    ON finance.boq_measurement_entries (organization_id, boq_line_item_id, status);

ALTER TABLE finance.boq_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.boq_line_items FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.boq_measurement_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.boq_measurement_entries FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.boq_line_items, finance.boq_measurement_entries FROM anon, authenticated;

DROP POLICY IF EXISTS "BOQ line items service role only" ON finance.boq_line_items;
CREATE POLICY "BOQ line items service role only" ON finance.boq_line_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "BOQ measurement entries service role only" ON finance.boq_measurement_entries;
CREATE POLICY "BOQ measurement entries service role only" ON finance.boq_measurement_entries FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('finance.boq_progress.read',    'View BOQ line items and measured progress'),
    ('finance.boq_progress.record',  'Submit measured quantities against BOQ line items'),
    ('finance.boq_progress.approve', 'Approve or reject submitted BOQ measurements')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)',  'finance.boq_progress.read'),
    ('Executive (Admin)',  'finance.boq_progress.record'),
    ('Executive (Admin)',  'finance.boq_progress.approve'),
    ('Finance Manager',    'finance.boq_progress.read'),
    ('Finance Manager',    'finance.boq_progress.record'),
    ('Finance Manager',    'finance.boq_progress.approve'),
    ('Project Manager',    'finance.boq_progress.read'),
    ('Project Manager',    'finance.boq_progress.record'),
    ('Project Manager',    'finance.boq_progress.approve')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
DECLARE t_name text; s_name text;
BEGIN
    FOR s_name, t_name IN
        SELECT 'finance', 'boq_line_items'
        UNION ALL VALUES
        ('finance', 'boq_measurement_entries')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, s_name, t_name, t_name, s_name, t_name
        );
    END LOOP;
END $$;
