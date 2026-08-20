-- Portal roles are intentionally created without ERP permissions. Access to a
-- client or supplier portal requires a matching identity mapping below.
INSERT INTO core.roles (organization_id, name, description)
SELECT o.id, role_def.name, role_def.description
FROM core.organizations o
CROSS JOIN (VALUES
    ('EMPLOYEE', 'Internal employee portal access'),
    ('CLIENT', 'Restricted client portal access'),
    ('SUPPLIER', 'Restricted supplier and subcontractor portal access')
) AS role_def(name, description)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM core.roles r
      WHERE r.organization_id = o.id AND r.name = role_def.name AND r.is_deleted = false
  );

CREATE TABLE IF NOT EXISTS crm.client_portal_access (
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES crm.contacts(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, organization_id),
    UNIQUE (organization_id, contact_id)
);

CREATE TABLE IF NOT EXISTS crm.supplier_portal_access (
    user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    subcontractor_id UUID NOT NULL REFERENCES crm.subcontractors(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, organization_id),
    UNIQUE (organization_id, subcontractor_id)
);

ALTER TABLE crm.client_portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.client_portal_access FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.supplier_portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.supplier_portal_access FORCE ROW LEVEL SECURITY;

CREATE POLICY "Client portal access owner read" ON crm.client_portal_access
    FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Supplier portal access owner read" ON crm.supplier_portal_access
    FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
