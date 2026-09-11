-- ============================================================================
-- AEGIS MIGRATION 183 — FINANCE GENERAL LEDGER: PERMISSIONS (PHASE 1)
-- ============================================================================
-- Permission keys for the new Chart of Accounts / General Ledger / Journal
-- Entries / Accounting Periods endpoints, granted to roles in this SAME
-- migration - not deferred to a later "gap fix" migration. Migrations 056,
-- 081 and 095 each had to backfill grants for permission keys that were
-- defined but never wired to a role; this migration exists specifically to
-- not repeat that.
--
-- Posting, closing and reopening are distinct, independently-grantable
-- financial actions rather than generic CRUD - e.g. a Finance Manager may
-- create and post journals but never reopen a locked period; a Managing
-- Director may reopen/lock periods and reverse journals but never creates
-- one. Collapsing these into fewer, coarser keys would reproduce exactly
-- the class of gap this migration exists to avoid.
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('finance.coa.read',      'View the Chart of Accounts'),
    ('finance.coa.write',     'Create and edit Chart of Accounts entries'),
    ('finance.gl.read',       'View the General Ledger, journals, account ledgers and trial balance'),
    ('finance.journal.create', 'Create and edit draft journal entries'),
    ('finance.journal.post',  'Post draft journal entries to the General Ledger'),
    ('finance.journal.reverse', 'Reverse posted journal entries'),
    ('finance.period.read',  'View accounting periods'),
    ('finance.period.manage', 'Create accounting periods and soft-close them'),
    ('finance.period.close', 'Close accounting periods'),
    ('finance.period.reopen', 'Reopen a closed or audited accounting period'),
    ('finance.period.lock',  'Lock an accounting period, and reopen a locked period')
ON CONFLICT (key) DO NOTHING;

-- SUPERADMIN: full access (granted explicitly, even though the role already
-- bypasses permission checks in code, so the permission-matrix contract test
-- stays accurate and grants aren't silently missing if that bypass is ever
-- narrowed).
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.coa.read', 'finance.coa.write', 'finance.gl.read',
    'finance.journal.create', 'finance.journal.post', 'finance.journal.reverse',
    'finance.period.read', 'finance.period.manage', 'finance.period.close',
    'finance.period.reopen', 'finance.period.lock'
)
WHERE r.is_deleted = false AND r.name = 'SUPERADMIN'
ON CONFLICT DO NOTHING;

-- Finance Manager: full operational control except locking a period (a
-- higher-trust, harder-to-reverse action reserved for executive authority).
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.coa.read', 'finance.coa.write', 'finance.gl.read',
    'finance.journal.create', 'finance.journal.post', 'finance.journal.reverse',
    'finance.period.read', 'finance.period.manage', 'finance.period.close', 'finance.period.reopen'
)
WHERE r.is_deleted = false AND r.name = 'Finance Manager'
ON CONFLICT DO NOTHING;

-- Managing Director / Executive (Admin): read-heavy executive oversight,
-- plus override authority to reopen/lock periods and reverse a posted
-- journal when required - but no routine journal creation or posting.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.coa.read', 'finance.gl.read', 'finance.period.read',
    'finance.period.reopen', 'finance.period.lock', 'finance.journal.reverse'
)
WHERE r.is_deleted = false AND r.name IN ('Managing Director', 'Executive (Admin)')
ON CONFLICT DO NOTHING;

-- Project Manager / Quantity Surveyor: read-only visibility into accounts
-- and the ledger (project cost/GL visibility), no posting authority.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('finance.coa.read', 'finance.gl.read')
WHERE r.is_deleted = false AND r.name IN ('Project Manager', 'Quantity Surveyor')
ON CONFLICT DO NOTHING;
