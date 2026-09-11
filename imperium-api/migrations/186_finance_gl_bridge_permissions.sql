-- ============================================================================
-- AEGIS MIGRATION 186 — FINANCE GL BRIDGE: PERMISSIONS (PHASE 2)
-- ============================================================================
-- Permission keys for the Phase 2 GL bridge (account mappings, proposed
-- journals, approve/reject), granted to roles in this SAME migration -
-- following the exact lesson from migrations 056/081/095 that a permission
-- key must never be defined without also being granted somewhere.
--
-- Approving/rejecting a system-proposed journal is treated as at least as
-- sensitive as manually posting one (finance.journal.post from Phase 1) -
-- rubber-stamping an automated interpretation is not a lesser action than
-- authoring a journal by hand.
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('finance.gl_bridge.read',      'View GL bridge proposed journals and account mappings'),
    ('finance.gl_bridge.propose',   'Propose GL journals from cost transactions (single or bulk project sync)'),
    ('finance.gl_bridge.approve',   'Approve a proposed GL journal, posting it to the ledger'),
    ('finance.gl_bridge.reject',    'Reject a proposed GL journal'),
    ('finance.gl_bridge.configure', 'Configure GL bridge cost-category-to-account mappings')
ON CONFLICT (key) DO NOTHING;

-- SUPERADMIN: full access.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.gl_bridge.read', 'finance.gl_bridge.propose', 'finance.gl_bridge.approve',
    'finance.gl_bridge.reject', 'finance.gl_bridge.configure'
)
WHERE r.is_deleted = false AND r.name = 'SUPERADMIN'
ON CONFLICT DO NOTHING;

-- Finance Manager: owns the bridge day-to-day - proposes, reviews, configures.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.gl_bridge.read', 'finance.gl_bridge.propose', 'finance.gl_bridge.approve',
    'finance.gl_bridge.reject', 'finance.gl_bridge.configure'
)
WHERE r.is_deleted = false AND r.name = 'Finance Manager'
ON CONFLICT DO NOTHING;

-- Managing Director / Executive (Admin): can review (approve/reject) as an
-- executive override, but does not configure mappings or routinely propose.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.gl_bridge.read', 'finance.gl_bridge.approve', 'finance.gl_bridge.reject'
)
WHERE r.is_deleted = false AND r.name IN ('Managing Director', 'Executive (Admin)')
ON CONFLICT DO NOTHING;

-- Project Manager / Quantity Surveyor: read-only visibility into what has
-- been proposed/posted for their projects.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.gl_bridge.read'
WHERE r.is_deleted = false AND r.name IN ('Project Manager', 'Quantity Surveyor')
ON CONFLICT DO NOTHING;
