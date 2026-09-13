-- ============================================================================
-- AEGIS MIGRATION 218 — MANAGEMENT ACCOUNTS + PORTFOLIO PERMISSIONS (PHASE 11B)
-- ============================================================================
-- Permission keys for the Management Accounts pack lifecycle and the
-- Project Portfolio Finance / Health score endpoint. Tiered exactly like
-- Phase 1's accounting-period permissions (migration 183): SUPERADMIN
-- gets everything explicitly; Finance Manager runs the pack day-to-day
-- but cannot lock or reopen it (higher-trust, harder-to-reverse actions
-- reserved to executive override authority); Managing Director/
-- Executive (Admin) get reopen/lock plus read; Commercial Manager and
-- Contracts Manager (migration 143) are real, relevant readers of the
-- portfolio/health view and of already-locked packs, without write
-- authority over the pack itself; Project Manager/Quantity Surveyor get
-- portfolio read only (they already see project-level detail elsewhere).
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('finance.pack.read', 'View Management Accounts packs'),
    ('finance.pack.manage', 'Create, recompute (while draft), submit for review, and approve Management Accounts packs'),
    ('finance.pack.reopen', 'Reopen an approved or locked Management Accounts pack back to draft, with a reason'),
    ('finance.pack.lock', 'Lock an approved Management Accounts pack as final'),
    ('finance.portfolio.read', 'View the Project Portfolio Finance table and per-project Financial Health factors')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.pack.read', 'finance.pack.manage', 'finance.pack.reopen', 'finance.pack.lock', 'finance.portfolio.read'
)
WHERE r.is_deleted = false AND r.name = 'SUPERADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('finance.pack.read', 'finance.pack.manage', 'finance.portfolio.read')
WHERE r.is_deleted = false AND r.name = 'Finance Manager'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('finance.pack.read', 'finance.pack.reopen', 'finance.pack.lock', 'finance.portfolio.read')
WHERE r.is_deleted = false AND r.name IN ('Managing Director', 'Executive (Admin)')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('finance.pack.read', 'finance.portfolio.read')
WHERE r.is_deleted = false AND r.name IN ('Commercial Manager', 'Contracts Manager')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.portfolio.read'
WHERE r.is_deleted = false AND r.name IN ('Project Manager', 'Quantity Surveyor')
ON CONFLICT DO NOTHING;
