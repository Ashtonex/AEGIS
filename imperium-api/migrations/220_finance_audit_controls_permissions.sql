-- ============================================================================
-- AEGIS MIGRATION 220 — AUDIT & BANKABILITY CONTROLS PERMISSIONS (PHASE 12)
-- ============================================================================
-- Two additive grant sets, no existing grant touched:
--
-- 1. A new key, finance.audit.read, for the month-end close readiness view
--    and the auditor drill-down workspace (app/services/finance/
--    close_readiness.py, routers/audit_controls.py) - kept distinct from
--    finance.gl.read since "can see the audit trail and readiness posture"
--    is a different concern from "can see full GL operational detail,"
--    even though today's grant lists for the two overlap heavily.
--
-- 2. finance.gl.read / finance.coa.read / finance.period.read granted to
--    External Auditor and Internal Auditor (migrations 143 and 050) - both
--    roles already have broad operational finance read access
--    (finance.cost.read, finance.budget.read, financial_performance.read,
--    data-room read/verify/export from migration 178) but could not see
--    the General Ledger, journals, chart of accounts, or accounting
--    periods at all until now. Every existing grant from migration 183
--    for every other role is untouched (same ON CONFLICT DO NOTHING,
--    per-role INSERT block pattern).
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('finance.audit.read', 'View month-end close readiness and the auditor drill-down workspace (journal + audit history + source evidence)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.audit.read'
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Finance Manager', 'Managing Director', 'Executive (Admin)', 'External Auditor', 'Internal Auditor')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('finance.gl.read', 'finance.coa.read', 'finance.period.read')
WHERE r.is_deleted = false AND r.name IN ('External Auditor', 'Internal Auditor')
ON CONFLICT DO NOTHING;
