-- ============================================================================
-- AEGIS MIGRATION 197 — COMPANY BUDGET PERMISSIONS (PHASE 5A)
-- ============================================================================
-- New permission keys, granted in this SAME migration - the lesson from
-- migrations 056/081/095 (a key defined but never granted until a later
-- gap-fix). Deliberately fresh keys rather than reusing the existing
-- finance.budget.* keys, which an audit found are already confused on the
-- project-budget side (finance.budget.approve is seeded but never checked
-- anywhere; finance.budget.create actually gates cost-code creation).
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('finance.company_budget.read',    'View company and department budgets, lines, and variance reports'),
    ('finance.company_budget.manage',  'Create/edit a draft or revision company budget, submit it for review, cancel it'),
    ('finance.company_budget.approve', 'Open a submitted budget for review and approve it as the fiscal year baseline'),
    ('finance.company_budget.freeze',  'Freeze an approved baseline, locking it against further revision'),
    ('finance.company_budget.reopen',  'Reopen a frozen company budget back to an editable baseline')
ON CONFLICT (key) DO NOTHING;

-- SUPERADMIN: full access.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.company_budget.read', 'finance.company_budget.manage', 'finance.company_budget.approve',
    'finance.company_budget.freeze', 'finance.company_budget.reopen'
)
WHERE r.is_deleted = false AND r.name = 'SUPERADMIN'
ON CONFLICT DO NOTHING;

-- Finance Manager: owns the budget cycle day-to-day.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.company_budget.read', 'finance.company_budget.manage', 'finance.company_budget.approve',
    'finance.company_budget.freeze'
)
WHERE r.is_deleted = false AND r.name = 'Finance Manager'
ON CONFLICT DO NOTHING;

-- Managing Director / Executive (Admin): executive sign-off authority -
-- read, approve, freeze, and reopen (the most sensitive override).
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.company_budget.read', 'finance.company_budget.approve',
    'finance.company_budget.freeze', 'finance.company_budget.reopen'
)
WHERE r.is_deleted = false AND r.name IN ('Managing Director', 'Executive (Admin)')
ON CONFLICT DO NOTHING;

-- Project Manager / Quantity Surveyor: read-only visibility.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.company_budget.read'
WHERE r.is_deleted = false AND r.name IN ('Project Manager', 'Quantity Surveyor')
ON CONFLICT DO NOTHING;
