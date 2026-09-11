-- ============================================================================
-- AEGIS MIGRATION 194 — BANK RECONCILIATION PERMISSIONS (PHASE 4)
-- ============================================================================
-- Permission keys for the Phase 4 reconciliation workspace, granted to
-- roles in this SAME migration - the lesson from migrations 056/081/095
-- (permission defined but never granted until a later gap-fix).
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('finance.reconciliation.read',   'View bank statement imports and reconciliation matches'),
    ('finance.reconciliation.import', 'Upload and parse a bank statement CSV, run the matching engine'),
    ('finance.reconciliation.match',  'Confirm or reject a suggested match, create a cashbook entry from an unmatched line'),
    ('finance.reconciliation.reopen', 'Reopen a previously confirmed reconciliation match')
ON CONFLICT (key) DO NOTHING;

-- SUPERADMIN: full access.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.reconciliation.read', 'finance.reconciliation.import',
    'finance.reconciliation.match', 'finance.reconciliation.reopen'
)
WHERE r.is_deleted = false AND r.name = 'SUPERADMIN'
ON CONFLICT DO NOTHING;

-- Finance Manager: owns reconciliation day-to-day.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.reconciliation.read', 'finance.reconciliation.import',
    'finance.reconciliation.match', 'finance.reconciliation.reopen'
)
WHERE r.is_deleted = false AND r.name = 'Finance Manager'
ON CONFLICT DO NOTHING;

-- Managing Director / Executive (Admin): read + reopen (executive override
-- authority), matching the tiering already used for GL periods/proposals.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('finance.reconciliation.read', 'finance.reconciliation.reopen')
WHERE r.is_deleted = false AND r.name IN ('Managing Director', 'Executive (Admin)')
ON CONFLICT DO NOTHING;

-- Project Manager / Quantity Surveyor: read-only visibility.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.reconciliation.read'
WHERE r.is_deleted = false AND r.name IN ('Project Manager', 'Quantity Surveyor')
ON CONFLICT DO NOTHING;
