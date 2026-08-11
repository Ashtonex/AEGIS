-- ============================================================================
-- Finance write-path permission gap fix
-- ============================================================================
-- Discovered verifying Phase 3 (statutory ledger) end-to-end in production:
-- the new progress-claims write path (POST /financial-performance/progress-
-- claims, POST .../certify) and payroll posting (POST .../payroll/runs/
-- {run_id}/post) were reachable by SUPERADMIN only. Two separate gaps:
--
-- 1. financial_performance.create - the router-level gate on every POST
--    under /api/v1/financial-performance/* (see require_resource_permission
--    in main.py) - was granted only to Finance Manager, not Executive
--    (Admin), even though every finance.*.read permission on this same
--    router is granted to both roles (migration 056).
-- 2. finance.claim.create/finance.claim.certify (defined in migration 023)
--    and finance.payroll.post (migration 034) had zero role grants anywhere
--    in the migration history - the permission keys existed but nothing
--    ever wired them to a role, because no write path called them until
--    this session built one.
--
-- Certifying a claim accrues a real VAT liability and posting payroll
-- accrues real PAYE/NSSA liabilities and moves cashbook funds, so both are
-- scoped to Executive (Admin) and Finance Manager only - not Project
-- Manager, who gets claim.create (preparing a claim is a normal PM task)
-- but not certify/post, matching the read-vs-approve split already used for
-- finance.variation.read/approve.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'financial_performance.create'),
    ('Executive (Admin)', 'finance.claim.create'),
    ('Finance Manager', 'finance.claim.create'),
    ('Project Manager', 'finance.claim.create'),
    ('Executive (Admin)', 'finance.claim.certify'),
    ('Finance Manager', 'finance.claim.certify'),
    ('Executive (Admin)', 'finance.payroll.post'),
    ('Finance Manager', 'finance.payroll.post')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
