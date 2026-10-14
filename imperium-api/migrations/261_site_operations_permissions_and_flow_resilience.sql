-- ============================================================================
-- AEGIS MIGRATION 261 — SITE OPERATIONS PERMISSIONS & FLOW RESILIENCE
-- ============================================================================
-- Ensures all site operations execution roles have full permission coverage
-- to read daily reports, manage rosters, record materials, view inventory,
-- and query workforce rosters without 403 cascade failures.
-- Additive and backward-compatible.
-- ============================================================================

-- 1. Ensure required columns and tables exist
ALTER TABLE projects.daily_site_reports
    ADD COLUMN IF NOT EXISTS briefing_id      UUID REFERENCES projects.site_day_briefings(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS auto_created     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS source_freshness TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS revision         INTEGER NOT NULL DEFAULT 1;

ALTER TABLE projects.site_day_briefings
    ADD COLUMN IF NOT EXISTS daily_report_id  UUID REFERENCES projects.daily_site_reports(id) ON DELETE SET NULL;

ALTER TABLE projects.daily_report_labour
    ADD COLUMN IF NOT EXISTS attendance_id    UUID,
    ADD COLUMN IF NOT EXISTS site_worker_id   UUID,
    ADD COLUMN IF NOT EXISTS worker_kind      VARCHAR(32) DEFAULT 'employee',
    ADD COLUMN IF NOT EXISTS worker_name      VARCHAR(255);

ALTER TABLE procurement.material_requests
    ADD COLUMN IF NOT EXISTS material_description TEXT,
    ADD COLUMN IF NOT EXISTS specifications       TEXT,
    ADD COLUMN IF NOT EXISTS unit_of_measure      VARCHAR(40) DEFAULT 'each',
    ADD COLUMN IF NOT EXISTS candidate_id         UUID;

-- 2. Ensure core permissions exist
INSERT INTO core.permissions (key, description) VALUES
    ('site_operations.read',                   'Access Site Operations overview, roster, and reports'),
    ('site_operations.daily_report.read',      'View daily site reports and connected evidence'),
    ('site_operations.daily_report.create',    'Create daily site reports'),
    ('site_operations.daily_report.update',    'Edit draft daily site reports'),
    ('site_operations.daily_report.submit',    'Submit daily site reports for approval'),
    ('site_operations.material.record',        'Record and view site material consumption and items'),
    ('site_operations.material.request',       'Request materials on site'),
    ('site_operations.labour.record',          'Record labour lines on daily site reports'),
    ('site_operations.equipment.record',       'Record equipment lines on daily site reports'),
    ('site_operations.labour_register.manage', 'Open and run site day labour register'),
    ('site_operations.daily_targets.manage',   'Manage site daily targets'),
    ('workforce.read',                         'View workforce employee list and pickers')
ON CONFLICT (key) DO NOTHING;

-- 3. Comprehensive Role Permissions Grant for all site execution roles
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    -- Site Engineer
    ('Site Engineer', 'site_operations.read'),
    ('Site Engineer', 'site_operations.daily_report.read'),
    ('Site Engineer', 'site_operations.daily_report.create'),
    ('Site Engineer', 'site_operations.daily_report.update'),
    ('Site Engineer', 'site_operations.daily_report.submit'),
    ('Site Engineer', 'site_operations.material.record'),
    ('Site Engineer', 'site_operations.material.request'),
    ('Site Engineer', 'site_operations.labour.record'),
    ('Site Engineer', 'site_operations.equipment.record'),
    ('Site Engineer', 'site_operations.labour_register.manage'),
    ('Site Engineer', 'site_operations.daily_targets.manage'),
    ('Site Engineer', 'workforce.read'),
    ('Site Engineer', 'inventory_items.read'),
    ('Site Engineer', 'inventory.item.read'),

    -- Site Agent
    ('Site Agent', 'site_operations.read'),
    ('Site Agent', 'site_operations.daily_report.read'),
    ('Site Agent', 'site_operations.daily_report.create'),
    ('Site Agent', 'site_operations.daily_report.update'),
    ('Site Agent', 'site_operations.daily_report.submit'),
    ('Site Agent', 'site_operations.material.record'),
    ('Site Agent', 'site_operations.material.request'),
    ('Site Agent', 'site_operations.labour.record'),
    ('Site Agent', 'site_operations.equipment.record'),
    ('Site Agent', 'site_operations.labour_register.manage'),
    ('Site Agent', 'site_operations.daily_targets.manage'),
    ('Site Agent', 'workforce.read'),
    ('Site Agent', 'inventory_items.read'),
    ('Site Agent', 'inventory.item.read'),

    -- Site Clerk
    ('Site Clerk', 'site_operations.read'),
    ('Site Clerk', 'site_operations.daily_report.read'),
    ('Site Clerk', 'site_operations.daily_report.create'),
    ('Site Clerk', 'site_operations.daily_report.update'),
    ('Site Clerk', 'site_operations.daily_report.submit'),
    ('Site Clerk', 'site_operations.material.record'),
    ('Site Clerk', 'site_operations.material.request'),
    ('Site Clerk', 'site_operations.labour.record'),
    ('Site Clerk', 'site_operations.equipment.record'),
    ('Site Clerk', 'site_operations.labour_register.manage'),
    ('Site Clerk', 'site_operations.daily_targets.manage'),
    ('Site Clerk', 'workforce.read'),
    ('Site Clerk', 'inventory_items.read'),
    ('Site Clerk', 'inventory.item.read'),

    -- Site Manager
    ('Site Manager', 'site_operations.read'),
    ('Site Manager', 'site_operations.daily_report.read'),
    ('Site Manager', 'site_operations.daily_report.create'),
    ('Site Manager', 'site_operations.daily_report.update'),
    ('Site Manager', 'site_operations.daily_report.submit'),
    ('Site Manager', 'site_operations.material.record'),
    ('Site Manager', 'site_operations.material.request'),
    ('Site Manager', 'site_operations.labour.record'),
    ('Site Manager', 'site_operations.equipment.record'),
    ('Site Manager', 'site_operations.labour_register.manage'),
    ('Site Manager', 'site_operations.daily_targets.manage'),
    ('Site Manager', 'workforce.read'),
    ('Site Manager', 'inventory_items.read'),
    ('Site Manager', 'inventory.item.read'),

    -- FOREMAN
    ('FOREMAN', 'site_operations.read'),
    ('FOREMAN', 'site_operations.daily_report.read'),
    ('FOREMAN', 'site_operations.daily_report.create'),
    ('FOREMAN', 'site_operations.daily_report.update'),
    ('FOREMAN', 'site_operations.daily_report.submit'),
    ('FOREMAN', 'site_operations.material.record'),
    ('FOREMAN', 'site_operations.material.request'),
    ('FOREMAN', 'site_operations.labour.record'),
    ('FOREMAN', 'site_operations.equipment.record'),
    ('FOREMAN', 'site_operations.labour_register.manage'),
    ('FOREMAN', 'site_operations.daily_targets.manage'),
    ('FOREMAN', 'workforce.read'),
    ('FOREMAN', 'inventory_items.read'),
    ('FOREMAN', 'inventory.item.read'),

    -- Project Manager
    ('Project Manager', 'site_operations.read'),
    ('Project Manager', 'site_operations.daily_report.read'),
    ('Project Manager', 'site_operations.daily_report.create'),
    ('Project Manager', 'site_operations.daily_report.update'),
    ('Project Manager', 'site_operations.daily_report.submit'),
    ('Project Manager', 'site_operations.material.record'),
    ('Project Manager', 'site_operations.material.request'),
    ('Project Manager', 'site_operations.labour.record'),
    ('Project Manager', 'site_operations.equipment.record'),
    ('Project Manager', 'site_operations.labour_register.manage'),
    ('Project Manager', 'site_operations.daily_targets.manage'),
    ('Project Manager', 'workforce.read'),
    ('Project Manager', 'inventory_items.read'),
    ('Project Manager', 'inventory.item.read'),

    -- Storekeeper
    ('Storekeeper', 'site_operations.read'),
    ('Storekeeper', 'site_operations.material.record'),
    ('Storekeeper', 'site_operations.material.request'),
    ('Storekeeper', 'site_operations.daily_report.read'),
    ('Storekeeper', 'workforce.read'),

    -- Executive (Admin) & Managing Director
    ('Executive (Admin)', 'site_operations.read'),
    ('Executive (Admin)', 'site_operations.daily_report.read'),
    ('Executive (Admin)', 'site_operations.material.record'),
    ('Executive (Admin)', 'site_operations.material.request'),
    ('Executive (Admin)', 'workforce.read'),
    ('Managing Director', 'site_operations.read'),
    ('Managing Director', 'site_operations.daily_report.read'),
    ('Managing Director', 'site_operations.material.record'),
    ('Managing Director', 'site_operations.material.request'),
    ('Managing Director', 'workforce.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
