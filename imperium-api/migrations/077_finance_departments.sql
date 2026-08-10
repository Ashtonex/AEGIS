-- ============================================================================
-- AEGIS MIGRATION 077 — FINANCE DEPARTMENTS (PHASE 1: TAGGING & REPORTING)
-- ============================================================================
-- Adds a department dimension (Construction / Plant & Equipment / Commercial)
-- so revenue/cost can be viewed per-department and consolidated org-wide.
-- Purely additive: every new column is nullable, no existing write path
-- (quotations win-flow, CRM won-flow, procurement, fleet, site reports,
-- payroll, cashbook) needs to change to keep working after this migration.
--
-- Phase 1 scope only: department tagging + read-side filtering. Real
-- double-sided internal-transfer postings between departments and any
-- ZIMRA/VAT/PAYE/NSSA statutory ledger are later phases, deliberately not
-- built here.
-- ============================================================================

-- 1. DEPARTMENTS LOOKUP (org-scoped, like finance.cost_codes / core.roles)

CREATE TABLE IF NOT EXISTS finance.departments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    code                VARCHAR(40) NOT NULL,
    name                VARCHAR(120) NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, code)
);

ALTER TABLE finance.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.departments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.departments FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.departments;
CREATE POLICY "Finance service role only" ON finance.departments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed the 3 departments for every existing organization.
INSERT INTO finance.departments (organization_id, code, name)
SELECT o.id, v.code, v.name
FROM core.organizations o
CROSS JOIN (VALUES
    ('construction', 'Construction'),
    ('plant_equipment', 'Plant & Equipment'),
    ('commercial', 'Commercial')
) AS v(code, name)
WHERE o.is_deleted = false
ON CONFLICT (organization_id, code) DO NOTHING;

-- 2. DEPARTMENT TAG COLUMNS

-- Anchor: which department owns this project. Distinct from the existing
-- free-text projects.projects.project_type (a construction-taxonomy field
-- used at quotation time) - department_id answers a different question and
-- must not repurpose that column.
ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES finance.departments(id);

-- Tables that already tolerate a NULL project_id (i.e. already model money
-- movement not pinned to one project) get their own nullable department_id
-- rather than deriving one via a project join.
ALTER TABLE finance.cashbook_transactions
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES finance.departments(id);

ALTER TABLE finance.payroll_items
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES finance.departments(id);

ALTER TABLE finance.supplier_payment_items
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES finance.departments(id);

-- Cost codes have no project_id at all - a department-specific cost-code
-- register is a Phase 1 want in its own right.
ALTER TABLE finance.cost_codes
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES finance.departments(id);

CREATE INDEX IF NOT EXISTS projects_department_idx
    ON projects.projects (organization_id, department_id)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS cashbook_transactions_department_idx
    ON finance.cashbook_transactions (organization_id, department_id)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS payroll_items_department_idx
    ON finance.payroll_items (organization_id, department_id);

CREATE INDEX IF NOT EXISTS supplier_payment_items_department_idx
    ON finance.supplier_payment_items (organization_id, department_id);

CREATE INDEX IF NOT EXISTS cost_codes_department_idx
    ON finance.cost_codes (organization_id, department_id)
    WHERE is_deleted = false;

-- 3. PERMISSIONS

INSERT INTO core.permissions (key, description) VALUES
    ('finance.department.read', 'View department reference data and department-scoped finance reports')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.department.read'
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Managing Director', 'Finance Manager', 'Project Manager')
ON CONFLICT DO NOTHING;

-- 4. AUDIT TRIGGER ON THE NEW TABLE

DROP TRIGGER IF EXISTS trg_audit_departments ON finance.departments;
CREATE TRIGGER trg_audit_departments AFTER INSERT OR UPDATE OR DELETE ON finance.departments
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
