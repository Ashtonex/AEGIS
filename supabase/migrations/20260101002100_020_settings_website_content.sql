-- Website content controls managed from ERP Settings.
-- This stores editable public-site copy without granting anonymous database access.

CREATE TABLE IF NOT EXISTS settings.website_content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    page_key VARCHAR(120) NOT NULL,
    section_key VARCHAR(120) NOT NULL,
    title VARCHAR(255),
    subtitle VARCHAR(500),
    body TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES core.users(id),
    updated_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT website_content_status_check CHECK (status IN ('draft', 'published', 'archived')),
    CONSTRAINT website_content_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
    CONSTRAINT website_content_unique_section UNIQUE (organization_id, page_key, section_key)
);

CREATE INDEX IF NOT EXISTS website_content_org_page_idx
    ON settings.website_content (organization_id, page_key, status)
    WHERE is_deleted = false;

ALTER TABLE settings.website_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings.website_content FORCE ROW LEVEL SECURITY;
REVOKE ALL ON settings.website_content FROM anon, authenticated;
CREATE POLICY "Website content service role only" ON settings.website_content FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('website_content.read', 'View managed public website content records'),
    ('website_content.update', 'Edit managed public website content records'),
    ('users.read_all', 'View tenant users and access assignments'),
    ('users.assign_role', 'Assign roles to tenant users')
ON CONFLICT (key) DO NOTHING;
