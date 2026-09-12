-- ============================================================================
-- AEGIS MIGRATION 205 — PAYROLL ALLOCATION PERMISSIONS (PHASE 7A)
-- ============================================================================
-- New permission keys for the multi-project payroll allocation feature,
-- granted in this SAME migration per the lesson from migrations 056/081/095.
-- Payroll GL proposals themselves reuse the existing finance.gl_bridge.*
-- permissions (Phase 2) - no new keys needed there.
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('finance.payroll_allocation.read',   'View a payroll item''s multi-project allocation split'),
    ('finance.payroll_allocation.manage', 'Create or replace a payroll item''s multi-project allocation split')
ON CONFLICT (key) DO NOTHING;

-- SUPERADMIN: full access.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('finance.payroll_allocation.read', 'finance.payroll_allocation.manage')
WHERE r.is_deleted = false AND r.name = 'SUPERADMIN'
ON CONFLICT DO NOTHING;

-- Finance Manager: owns payroll processing day-to-day.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('finance.payroll_allocation.read', 'finance.payroll_allocation.manage')
WHERE r.is_deleted = false AND r.name = 'Finance Manager'
ON CONFLICT DO NOTHING;

-- Managing Director / Executive (Admin) / Project Manager / Quantity Surveyor: read-only visibility.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.payroll_allocation.read'
WHERE r.is_deleted = false AND r.name IN ('Managing Director', 'Executive (Admin)', 'Project Manager', 'Quantity Surveyor')
ON CONFLICT DO NOTHING;
