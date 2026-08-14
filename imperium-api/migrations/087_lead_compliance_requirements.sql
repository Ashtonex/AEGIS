-- ============================================================================
-- Lead compliance requirements + revenue-at-risk tracking, and a budget
-- estimate-vs-confirmed flag on leads/opportunities.
-- ============================================================================
-- Several government/regulatory bodies (ZBCA, CIFOZ, ZIMRA, NSSA, etc.) can
-- gate whether the company is even eligible to be awarded a piece of work.
-- Today there's no way to flag "this lead needs X" or check whether the org
-- currently holds a valid X - crm.leads has no compliance-related columns at
-- all, and core.compliance_items (the org's own held-certificate tracker) is
-- pure free text with no canonical list of certificate types to join against.
--
-- crm.compliance_requirement_types is that canonical list (seeded, not
-- user-invented, so "ZBCA Registration" can't get spelled three different
-- ways across different leads). crm.lead_compliance_requirements is the
-- per-lead checklist of which types are required. core.compliance_items
-- gets an optional, nullable tag back to the same canonical type so "do we
-- currently hold this" becomes a real join instead of fuzzy string matching
-- - every existing compliance_items row is untouched since the column is
-- nullable with no default requirement to backfill.
-- ============================================================================

CREATE TABLE crm.compliance_requirement_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    code            VARCHAR(40) NOT NULL,
    label           VARCHAR(160) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    is_deleted      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, code)
);

CREATE TABLE crm.lead_compliance_requirements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    lead_id             UUID NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
    requirement_type_id UUID NOT NULL REFERENCES crm.compliance_requirement_types(id),
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (lead_id, requirement_type_id)
);

CREATE INDEX idx_lead_compliance_requirements_lead ON crm.lead_compliance_requirements (organization_id, lead_id);

ALTER TABLE core.compliance_items
    ADD COLUMN IF NOT EXISTS requirement_type_id UUID REFERENCES crm.compliance_requirement_types(id);

-- Budget estimate-vs-confirmed flag. Defaults false ("this is a guess") so
-- every existing lead/opportunity row - which never had any concept of
-- confirmation - reads as "needs confirming" rather than silently implying
-- a real figure was already given.
ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS budget_confirmed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crm.opportunities ADD COLUMN IF NOT EXISTS budget_confirmed BOOLEAN NOT NULL DEFAULT false;

-- 1. RLS

ALTER TABLE crm.compliance_requirement_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.compliance_requirement_types FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_compliance_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_compliance_requirements FORCE ROW LEVEL SECURITY;

REVOKE ALL ON crm.compliance_requirement_types, crm.lead_compliance_requirements
    FROM anon, authenticated;

DROP POLICY IF EXISTS "Finance service role only" ON crm.compliance_requirement_types;
CREATE POLICY "Finance service role only" ON crm.compliance_requirement_types FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON crm.lead_compliance_requirements;
CREATE POLICY "Finance service role only" ON crm.lead_compliance_requirements FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. SEED the starter list of requirement types for every existing org.

INSERT INTO crm.compliance_requirement_types (organization_id, code, label)
SELECT o.id, type_def.code, type_def.label
FROM core.organizations o
CROSS JOIN (VALUES
    ('zbca',              'ZBCA Registration'),
    ('cifoz',             'CIFOZ Membership'),
    ('zimra_tax_clearance', 'ZIMRA Tax Clearance Certificate'),
    ('nssa',              'NSSA Compliance Certificate'),
    ('praz',              'PRAZ Supplier/Contractor Registration'),
    ('ema',                'EMA Environmental Certificate'),
    ('zinwa',              'ZINWA Water Permit'),
    ('nec_construction',   'NEC Construction Industry Compliance'),
    ('municipal_licence',  'Municipal/Council Business Licence')
) AS type_def(code, label)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM crm.compliance_requirement_types t
      WHERE t.organization_id = o.id AND t.code = type_def.code
  );
