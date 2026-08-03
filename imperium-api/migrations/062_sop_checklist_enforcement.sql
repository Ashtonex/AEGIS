-- ============================================================================
-- AEGIS MIGRATION 062 — SOP CHECKLIST ENFORCEMENT SYSTEM
-- Generalizes the drawing-revision checklist pattern into a reusable SOP
-- (Standard Operating Procedure) checklist system: named templates
-- ("Preliminary Client Meeting", "Site Visit", "Pre-Award Commercial
-- Review") attached as instances to a quotation (or project), with
-- per-item evidence and a segregation-of-duties rule - an item flagged
-- requires_independent_reviewer cannot be checked off by the same person
-- who created the checklist instance. A template flagged
-- blocks_quotation_win must have a COMPLETE instance before a linked
-- quotation can be marked won.
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance.sop_templates (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    name                    VARCHAR(255) NOT NULL,
    description             TEXT,
    applies_to              VARCHAR(24) NOT NULL DEFAULT 'quotation'
        CHECK (applies_to IN ('quotation', 'project')),
    blocks_quotation_win    BOOLEAN NOT NULL DEFAULT false,
    is_active               BOOLEAN NOT NULL DEFAULT true,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS sop_templates_org_idx
    ON compliance.sop_templates (organization_id)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS compliance.sop_template_items (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    template_id                 UUID NOT NULL REFERENCES compliance.sop_templates(id) ON DELETE CASCADE,
    item_label                  VARCHAR(500) NOT NULL,
    requires_evidence           BOOLEAN NOT NULL DEFAULT false,
    requires_independent_reviewer BOOLEAN NOT NULL DEFAULT false,
    sort_order                  INTEGER NOT NULL DEFAULT 0,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sop_template_items_template_idx
    ON compliance.sop_template_items (organization_id, template_id);

-- One instance = one attempt to complete a template against a specific
-- subject (a quotation, a project). subject_id is a loose UUID (not FK'd
-- to a specific table) since applies_to determines which table it points
-- into - matches the same tradeoff already accepted for
-- finance.commercial_guard_audits.project_id elsewhere in this schema.
CREATE TABLE IF NOT EXISTS compliance.sop_instances (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    template_id         UUID NOT NULL REFERENCES compliance.sop_templates(id) ON DELETE RESTRICT,
    subject_type        VARCHAR(24) NOT NULL CHECK (subject_type IN ('quotation', 'project')),
    subject_id          UUID NOT NULL,
    status              VARCHAR(24) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'complete')),
    completed_at        TIMESTAMPTZ,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS sop_instances_subject_idx
    ON compliance.sop_instances (organization_id, subject_type, subject_id)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS compliance.sop_instance_items (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id                 UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    instance_id                     UUID NOT NULL REFERENCES compliance.sop_instances(id) ON DELETE CASCADE,
    item_label                      VARCHAR(500) NOT NULL,
    requires_evidence                BOOLEAN NOT NULL DEFAULT false,
    requires_independent_reviewer    BOOLEAN NOT NULL DEFAULT false,
    sort_order                      INTEGER NOT NULL DEFAULT 0,
    is_checked                      BOOLEAN NOT NULL DEFAULT false,
    checked_by                      UUID REFERENCES core.users(id),
    checked_at                      TIMESTAMPTZ,
    evidence_url                    TEXT,
    evidence_note                   TEXT,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sop_instance_items_instance_idx
    ON compliance.sop_instance_items (organization_id, instance_id);

-- RLS

ALTER TABLE compliance.sop_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.sop_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.sop_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.sop_template_items FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.sop_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.sop_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.sop_instance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.sop_instance_items FORCE ROW LEVEL SECURITY;

REVOKE ALL ON compliance.sop_templates, compliance.sop_template_items,
    compliance.sop_instances, compliance.sop_instance_items FROM anon, authenticated;

DROP POLICY IF EXISTS "SOP service role only" ON compliance.sop_templates;
CREATE POLICY "SOP service role only" ON compliance.sop_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "SOP service role only" ON compliance.sop_template_items;
CREATE POLICY "SOP service role only" ON compliance.sop_template_items FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "SOP service role only" ON compliance.sop_instances;
CREATE POLICY "SOP service role only" ON compliance.sop_instances FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "SOP service role only" ON compliance.sop_instance_items;
CREATE POLICY "SOP service role only" ON compliance.sop_instance_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- PERMISSIONS

INSERT INTO core.permissions (key, description) VALUES
    ('sop_compliance.read',    'View SOP templates, instances, and completion status'),
    ('sop_compliance.create',  'Start an SOP instance and complete non-reviewer checklist items'),
    ('sop_compliance.review',  'Complete checklist items flagged as requiring an independent reviewer'),
    ('sop_compliance.manage',  'Create and edit SOP templates')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)',    'sop_compliance.read'),
    ('Executive (Admin)',    'sop_compliance.create'),
    ('Executive (Admin)',    'sop_compliance.review'),
    ('Executive (Admin)',    'sop_compliance.manage'),
    ('Quantity Surveyor',    'sop_compliance.read'),
    ('Quantity Surveyor',    'sop_compliance.create'),
    ('Quantity Surveyor',    'sop_compliance.review'),
    ('Project Manager',      'sop_compliance.read'),
    ('Project Manager',      'sop_compliance.create'),
    ('Project Manager',      'sop_compliance.review'),
    ('Site Agent',           'sop_compliance.read'),
    ('Site Agent',           'sop_compliance.create'),
    ('Finance Manager',      'sop_compliance.read'),
    ('Finance Manager',      'sop_compliance.review')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Also grant the new quotations.decide fine-grained permission (Gap A fix)
-- to the same set of senior roles - a quote's author should not be the
-- only person able to close their own deal.
INSERT INTO core.permissions (key, description) VALUES
    ('quotations.decide', 'Mark a quotation as won or lost, seeding the linked project budget on win')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)',    'quotations.decide'),
    ('Finance Manager',      'quotations.decide'),
    ('Quantity Surveyor',    'quotations.decide')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- AUDIT TRIGGERS

DO $$
DECLARE t_name text; s_name text;
BEGIN
    FOR s_name, t_name IN
        SELECT 'compliance', 'sop_templates'
        UNION ALL VALUES
        ('compliance', 'sop_template_items'),
        ('compliance', 'sop_instances'),
        ('compliance', 'sop_instance_items')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, s_name, t_name, t_name, s_name, t_name
        );
    END LOOP;
END $$;

-- SEED DEFAULT TEMPLATES (one org - matches the seeding pattern used
-- elsewhere for org-scoped defaults; safe to re-run, guarded by name check)

DO $$
DECLARE
    org_row RECORD;
    tmpl_id UUID;
BEGIN
    FOR org_row IN SELECT id FROM core.organizations WHERE is_deleted = false LOOP
        IF NOT EXISTS (
            SELECT 1 FROM compliance.sop_templates
            WHERE organization_id = org_row.id AND name = 'Preliminary Client Meeting' AND is_deleted = false
        ) THEN
            INSERT INTO compliance.sop_templates (organization_id, name, description, applies_to, blocks_quotation_win)
            VALUES (org_row.id, 'Preliminary Client Meeting', 'Confirms scope was discussed directly with the client before pricing.', 'quotation', true)
            RETURNING id INTO tmpl_id;

            INSERT INTO compliance.sop_template_items (organization_id, template_id, item_label, requires_evidence, requires_independent_reviewer, sort_order) VALUES
                (org_row.id, tmpl_id, 'Preliminary meeting held with client and scope discussed', true, false, 0),
                (org_row.id, tmpl_id, 'Meeting notes/minutes reviewed and confirmed by a second reviewer', false, true, 1);
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM compliance.sop_templates
            WHERE organization_id = org_row.id AND name = 'Site Visit' AND is_deleted = false
        ) THEN
            INSERT INTO compliance.sop_templates (organization_id, name, description, applies_to, blocks_quotation_win)
            VALUES (org_row.id, 'Site Visit', 'Confirms the site was physically inspected before finalising a quotation.', 'quotation', true)
            RETURNING id INTO tmpl_id;

            INSERT INTO compliance.sop_template_items (organization_id, template_id, item_label, requires_evidence, requires_independent_reviewer, sort_order) VALUES
                (org_row.id, tmpl_id, 'Site visit conducted and site conditions documented', true, false, 0),
                (org_row.id, tmpl_id, 'Site visit findings reviewed and confirmed by a second reviewer', false, true, 1);
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM compliance.sop_templates
            WHERE organization_id = org_row.id AND name = 'Pre-Award Commercial Review' AND is_deleted = false
        ) THEN
            INSERT INTO compliance.sop_templates (organization_id, name, description, applies_to, blocks_quotation_win)
            VALUES (org_row.id, 'Pre-Award Commercial Review', 'Independent commercial sign-off before a quotation is accepted as won.', 'quotation', true)
            RETURNING id INTO tmpl_id;

            INSERT INTO compliance.sop_template_items (organization_id, template_id, item_label, requires_evidence, requires_independent_reviewer, sort_order) VALUES
                (org_row.id, tmpl_id, 'Margin and rate sanity independently reviewed against CCB output', false, true, 0),
                (org_row.id, tmpl_id, 'Approved by an authorised commercial reviewer', false, true, 1);
        END IF;
    END LOOP;
END $$;
