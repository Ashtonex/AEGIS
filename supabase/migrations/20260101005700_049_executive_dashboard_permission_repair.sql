-- ============================================================================
-- Executive dashboard permission repair
-- ============================================================================
-- The frontend allows the "Executive (Admin)" role into /dashboard/executive,
-- but backend executive endpoints enforce the database permission
-- executive.view_dashboard. Existing production databases may have the role
-- without this permission link, causing every executive API request to return
-- 403 and the page to appear fully degraded.

INSERT INTO core.permissions (key, description)
VALUES ('executive.view_dashboard', 'View the Executive Command Centre KPIs and modules')
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'core'
          AND table_name = 'role_permissions'
          AND column_name = 'organization_id'
    ) THEN
        INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
        SELECT r.organization_id, r.id, p.id
        FROM core.roles r
        JOIN core.permissions p ON p.key = 'executive.view_dashboard'
        WHERE r.is_deleted = false
          AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Managing Director')
        ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO core.role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM core.roles r
        JOIN core.permissions p ON p.key = 'executive.view_dashboard'
        WHERE r.is_deleted = false
          AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Managing Director')
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
