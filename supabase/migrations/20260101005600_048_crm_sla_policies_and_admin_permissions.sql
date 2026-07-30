-- ============================================================================
-- CRM Phase 12 completeness: org-configurable SLA policies (backing the
-- crm.admin.configure permission with a real action) and the crm.admin.configure
-- / crm.campaigns.send permission keys the completion spec lists but no router
-- previously referenced.
-- ============================================================================

ALTER TABLE crm.communication_events
    ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES crm.campaigns(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS crm.sla_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    priority VARCHAR(30) NOT NULL,
    response_hours INTEGER NOT NULL DEFAULT 24 CHECK (response_hours > 0),
    resolution_hours INTEGER NOT NULL DEFAULT 72 CHECK (resolution_hours > 0),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, priority)
);

DO $$
BEGIN
    ALTER TABLE crm.sla_policies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crm.sla_policies FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Tenant Isolation Policy" ON crm.sla_policies;
    CREATE POLICY "Tenant Isolation Policy" ON crm.sla_policies
        FOR ALL USING (organization_id = get_jwt_org_id() OR current_setting('role') = 'service_role');
    DROP TRIGGER IF EXISTS trg_audit_sla_policies ON crm.sla_policies;
    CREATE TRIGGER trg_audit_sla_policies
        AFTER INSERT OR UPDATE OR DELETE ON crm.sla_policies
        FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
END $$;

INSERT INTO core.permissions (key, description) VALUES
    ('crm.admin.configure', 'Configure CRM-wide settings such as SLA policies'),
    ('crm.campaigns.send', 'Send templated outreach to a campaign''s members')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
CROSS JOIN core.permissions p
WHERE r.name = 'SUPERADMIN'
  AND p.key IN ('crm.admin.configure', 'crm.campaigns.send')
ON CONFLICT (role_id, permission_id) DO NOTHING;
