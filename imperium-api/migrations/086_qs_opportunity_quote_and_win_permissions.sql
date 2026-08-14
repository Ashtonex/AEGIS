-- ============================================================================
-- Grant Quantity Surveyor the two missing CRM permissions needed to run the
-- BOQ workflow end-to-end without depending on another role.
-- ============================================================================
-- QS already holds quotations.create/read/update, drawings.*, and
-- takeoff.drawing.commit - they can build and price a full BOQ once a
-- quotation exists. But they were missing the two CRM-side actions that
-- start and close that workflow:
--   - crm.opportunities.quote: create the quotation FROM an opportunity
--     (POST /crm/opportunities/{id}/create-quotation) - without this, a QS
--     could only price a quotation someone else had already created for them.
--   - crm.opportunities.close_won: mark the opportunity Won (POST
--     /crm/opportunities/{id}/mark-won) - the step that creates/links the
--     real project and flips the quotation to 'accepted'.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.name = 'Quantity Surveyor' AND r.is_deleted = false
JOIN (VALUES
    ('crm.opportunities.quote'),
    ('crm.opportunities.close_won')
) AS grant_def(permission_key) ON true
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
