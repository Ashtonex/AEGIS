-- ============================================================================
-- Task completion performance permission
-- ============================================================================
-- Recognition data (who completes tasks reliably/on time) is more sensitive
-- than plain task visibility, so it gets its own permission rather than
-- riding on crm_tasks.read_all - restricted to SUPERADMIN/Executive tier
-- only, and framed in the UI as internal recognition, not a public
-- leaderboard.
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('crm_tasks.performance.view', 'View task completion/performance metrics per user (admin recognition, not a public leaderboard)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'crm_tasks.performance.view'
WHERE r.is_deleted = false AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Managing Director')
ON CONFLICT (role_id, permission_id) DO NOTHING;
