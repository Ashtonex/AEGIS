-- ============================================================================
-- Migration 274: Two-step purchase order sign-off
-- ============================================================================
-- Every PO is signed off by Finance first, then by a director, before it can
-- be issued to the supplier. The director sign-off moves the PO to
-- 'approved'. SUPERADMIN can sign either step and can issue without the
-- sign-offs; that override is recorded with a reason.
--
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE procurement.purchase_orders
    ADD COLUMN IF NOT EXISTS finance_signed_off_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS finance_signed_off_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS director_signed_off_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS director_signed_off_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS signoff_override_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS signoff_override_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS signoff_override_reason TEXT;

INSERT INTO core.permissions (key, description)
VALUES
    ('procurement.po.finance_signoff', 'Give the Finance sign-off on a purchase order (first of two sign-offs before issue).'),
    ('procurement.po.director_signoff', 'Give the director sign-off on a purchase order (second sign-off; the PO can then be issued).')
ON CONFLICT (key) DO NOTHING;

-- Finance Manager: Finance sign-off, and read access to the POs it signs.
-- Executive (Admin): director sign-off.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON (
       (r.name = 'Finance Manager' AND p.key IN ('procurement.po.finance_signoff', 'procurement.po.read'))
    OR (r.name = 'Executive (Admin)' AND p.key IN ('procurement.po.director_signoff', 'procurement.po.read'))
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
