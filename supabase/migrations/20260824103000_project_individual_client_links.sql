-- Projects can be commissioned by either a CRM organization or an individual
-- CRM contact. Organization clients use client_org_id; individual clients use
-- client_id. Only one should be selected for a project at a time.

ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES crm.contacts(id);

CREATE INDEX IF NOT EXISTS idx_projects_client_contact
    ON projects.projects (organization_id, client_id)
    WHERE is_deleted = false AND client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_client_organization
    ON projects.projects (organization_id, client_org_id)
    WHERE is_deleted = false AND client_org_id IS NOT NULL;
