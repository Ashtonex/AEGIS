-- ============================================================================
-- Site variance hardening: classification, proceed-at-risk evidence, and gates
-- ============================================================================

ALTER TABLE finance.variations
    ADD COLUMN IF NOT EXISTS variance_classification VARCHAR(40) NOT NULL DEFAULT 'quantity_variance',
    ADD COLUMN IF NOT EXISTS proceed_instruction_given_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS proceed_instruction_at VARCHAR(80),
    ADD COLUMN IF NOT EXISTS proceed_evidence_note TEXT,
    ADD COLUMN IF NOT EXISTS proceed_estimated_cost_exposure NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (proceed_estimated_cost_exposure >= 0),
    ADD COLUMN IF NOT EXISTS proceed_estimated_time_exposure_days INTEGER NOT NULL DEFAULT 0 CHECK (proceed_estimated_time_exposure_days >= 0),
    ADD COLUMN IF NOT EXISTS proceed_management_authorizer VARCHAR(255),
    ADD COLUMN IF NOT EXISTS proceed_management_authorized_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS formal_approval_deadline DATE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variations_classification_chk') THEN
        ALTER TABLE finance.variations
            ADD CONSTRAINT variations_classification_chk
            CHECK (variance_classification IN (
                'client_variation',
                'design_variation',
                'site_condition_variation',
                'quantity_variance',
                'internal_cost_variance',
                'emergency_variance'
            ));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variations_proceed_at_risk_required_fields_chk') THEN
        ALTER TABLE finance.variations
            ADD CONSTRAINT variations_proceed_at_risk_required_fields_chk
            CHECK (
                proceed_at_risk = false
                OR (
                    NULLIF(TRIM(COALESCE(proceed_instruction_given_by, '')), '') IS NOT NULL
                    AND NULLIF(TRIM(COALESCE(proceed_instruction_at, '')), '') IS NOT NULL
                    AND NULLIF(TRIM(COALESCE(proceed_evidence_note, '')), '') IS NOT NULL
                    AND proceed_estimated_cost_exposure > 0
                    AND proceed_estimated_time_exposure_days > 0
                    AND NULLIF(TRIM(COALESCE(proceed_management_authorizer, '')), '') IS NOT NULL
                    AND formal_approval_deadline IS NOT NULL
                )
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_variations_site_gate_status
    ON finance.variations (organization_id, execution_blocked, proceed_at_risk, qs_review_status, client_approval_status)
    WHERE source_type = 'weekly_budget_item' AND is_deleted = false;

ALTER TABLE projects.weekly_budget_items
    ADD COLUMN IF NOT EXISTS material_item_id UUID REFERENCES procurement.inventory_items(id),
    ADD COLUMN IF NOT EXISTS released_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (released_qty >= 0),
    ADD COLUMN IF NOT EXISTS consumed_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (consumed_qty >= 0);

CREATE INDEX IF NOT EXISTS idx_weekly_budget_items_material_release
    ON projects.weekly_budget_items (organization_id, material_item_id, status)
    WHERE material_item_id IS NOT NULL AND is_deleted = false;

ALTER TABLE procurement.material_requests
    ADD COLUMN IF NOT EXISTS weekly_budget_item_id UUID REFERENCES projects.weekly_budget_items(id),
    ADD COLUMN IF NOT EXISTS boq_line_item_id UUID REFERENCES finance.boq_line_items(id),
    ADD COLUMN IF NOT EXISTS variance_id UUID REFERENCES finance.variations(id),
    ADD COLUMN IF NOT EXISTS execution_gate_status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (execution_gate_status IN ('pending', 'released', 'blocked', 'proceed_at_risk'));

CREATE INDEX IF NOT EXISTS idx_material_requests_execution_gate
    ON procurement.material_requests (organization_id, execution_gate_status, engineer_review_status)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_material_requests_weekly_budget_item
    ON procurement.material_requests (organization_id, weekly_budget_item_id)
    WHERE weekly_budget_item_id IS NOT NULL AND is_deleted = false;

INSERT INTO core.permissions (key, description) VALUES
    ('finance.variation.price_entitlement', 'Price entitlement and recovery review for site-originated variances'),
    ('site_operations.weekly_budget.programme_review', 'Review weekly site budget practicality and programme impact'),
    ('site_operations.execution_gate.read', 'Read blocked execution and proceed-at-risk gates')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN (VALUES
    ('Quantity Surveyor', 'finance.variation.price_entitlement'),
    ('Quantity Surveyor', 'site_operations.execution_gate.read'),
    ('Site Agent', 'projects.weekly_budget.approve'),
    ('Site Agent', 'site_operations.weekly_budget.programme_review'),
    ('Site Agent', 'site_operations.execution_gate.read'),
    ('Project Manager', 'site_operations.execution_gate.read'),
    ('Executive (Admin)', 'site_operations.execution_gate.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

UPDATE core.roles
SET default_landing_path = CASE
    WHEN name = 'Quantity Surveyor' THEN '/portal/qs'
    WHEN name = 'Site Agent' THEN '/portal/site-agent'
    ELSE default_landing_path
END,
updated_at = NOW()
WHERE name IN ('Quantity Surveyor', 'Site Agent')
  AND is_deleted = false;
