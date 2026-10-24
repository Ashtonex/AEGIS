-- ============================================================================
-- AEGIS MIGRATION 248 — WHO CAN ACT ON THE NEW FINANCE SCREENS
-- ============================================================================
-- Found checking the Finance rebuild (migration 247) end to end:
-- finance.supplier_payment.post was held only by "Accounts Payable / Cash
-- Officer" (no users) and SUPERADMIN, so nobody at SNC could actually pay,
-- reject or chase a supplier invoice. Decided 2026-10-04: Finance Manager
-- and Executive (Admin) both get it. Finance Manager still also approves
-- invoices for payment (procurement.invoice.approve_payment); paying an
-- unapproved one needs a written override reason that is logged.
--
-- Two new, narrow keys instead of widening existing ones, so Executives get
-- exactly what was asked for and nothing else:
--   finance.site_payroll.manage - add/edit site workers, log hours, draft a
--       site pay run. (finance.payroll.manage would also have let them edit
--       staff pay profiles and create staff payroll runs.)
--   finance.budget.remind - the "Remind now" button on draft budgets.
--       (finance.budget.create would also have let them create cost codes.)
-- Approving and paying a site pay run stays on finance.payroll.post, which
-- both roles already hold.
--
-- Additive only.
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('finance.site_payroll.manage', 'Add site workers, log their hours and draft site pay runs'),
    ('finance.budget.remind',       'Send draft project budget reminders on demand')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Finance Manager',   'finance.supplier_payment.post'),
    ('Executive (Admin)', 'finance.supplier_payment.post'),
    ('Finance Manager',   'finance.site_payroll.manage'),
    ('Executive (Admin)', 'finance.site_payroll.manage'),
    ('SUPERADMIN',        'finance.site_payroll.manage'),
    ('Finance Manager',   'finance.budget.remind'),
    ('Executive (Admin)', 'finance.budget.remind'),
    ('SUPERADMIN',        'finance.budget.remind')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
