-- ============================================================================
-- Sales Executive CRM permission gaps
-- ============================================================================
-- Migration 066 seeded Sales Executive as "full working CRM access" but
-- missed five sub-areas entirely - the nav shows every CRM page to this
-- role (no allowedRoles restriction on those sub-items), but the backend
-- 403s on all of them since no permission key was ever granted:
--
--   - Tenders & Bids: crm.view_tenders / crm.create_tenders. Discovered
--     because the first real Sales Executive user couldn't manually log a
--     tender at all - and it turns out only Executive (Admin) could
--     previously create one; Project Manager only had view_tenders.
--   - Subcontractors: crm.view_subcontractors / .create_subcontractors /
--     .update_subcontractors (no delete endpoint exists for anyone).
--   - Automations: crm_automations.read/create/update (delete withheld,
--     matching the *.delete-stays-with-Executive/PM pattern the rest of
--     this role already follows) plus crm.automations.execute to actually
--     run one.
--   - Support / Tickets (both nav pages share client_portal_tickets.py):
--     client_portal_tickets.read/create/update (delete withheld).
--   - Import & Export: crm.import / crm.export.
--
-- crm.view_accountability (Commercial Command's accountability/risk-matrix
-- widgets) is deliberately NOT granted here - that's a PM/Exec oversight
-- view (targets vs actuals), not a front-line data-entry action like the
-- above, and isn't what was reported broken.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.name = 'Sales Executive' AND r.is_deleted = false
JOIN (VALUES
    ('crm.view_tenders'),
    ('crm.create_tenders'),
    ('crm.view_subcontractors'),
    ('crm.create_subcontractors'),
    ('crm.update_subcontractors'),
    ('crm_automations.read'),
    ('crm_automations.create'),
    ('crm_automations.update'),
    ('crm.automations.execute'),
    ('client_portal_tickets.read'),
    ('client_portal_tickets.create'),
    ('client_portal_tickets.update'),
    ('crm.import'),
    ('crm.export')
) AS grant_def(permission_key) ON true
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Project Manager could view tenders but never create one either (same
-- only-Executive-can-create bug, same table) - closing it here since it's
-- the identical fix already being made to this permission.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.name = 'Project Manager' AND r.is_deleted = false
JOIN core.permissions p ON p.key = 'crm.create_tenders'
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
