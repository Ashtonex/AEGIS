-- ============================================================================
-- CRM forward compatibility repair
--
-- 043_crm_schema_consolidation.sql was already applied in some environments and
-- removed legacy CRM columns/permission keys. Keep applied migrations immutable and
-- repair compatibility here with additive, idempotent operations only.
-- ============================================================================

ALTER TABLE crm.campaigns
    ADD COLUMN IF NOT EXISTS channel VARCHAR(80),
    ADD COLUMN IF NOT EXISTS source VARCHAR(120),
    ADD COLUMN IF NOT EXISTS starts_on DATE,
    ADD COLUMN IF NOT EXISTS ends_on DATE,
    ADD COLUMN IF NOT EXISTS type VARCHAR(100),
    ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

UPDATE crm.campaigns
SET channel = COALESCE(channel, source_channel, campaign_type),
    source = COALESCE(source, source_channel),
    starts_on = COALESCE(starts_on, start_date),
    ends_on = COALESCE(ends_on, end_date),
    type = COALESCE(type, campaign_type)
WHERE channel IS NULL
   OR source IS NULL
   OR starts_on IS NULL
   OR ends_on IS NULL
   OR type IS NULL;

ALTER TABLE crm.segments
    ADD COLUMN IF NOT EXISTS rules JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE crm.segments
SET rules = COALESCE(rules, criteria, '{}'::jsonb)
WHERE rules = '{}'::jsonb AND criteria IS NOT NULL;

ALTER TABLE crm.campaign_members
    ADD COLUMN IF NOT EXISTS member_status VARCHAR(40) NOT NULL DEFAULT 'targeted';

UPDATE crm.campaign_members
SET member_status = COALESCE(member_status, status, 'targeted')
WHERE member_status IS NULL OR member_status = 'targeted';

INSERT INTO core.permissions (key, description)
VALUES
    ('crm.campaigns.read', 'Read CRM marketing campaigns'),
    ('crm.campaigns.create', 'Create CRM marketing campaigns'),
    ('crm.campaigns.update', 'Update CRM marketing campaigns'),
    ('crm.campaigns.delete', 'Delete CRM marketing campaigns'),
    ('crm.segments.read', 'Read CRM marketing segments'),
    ('crm.segments.create', 'Create CRM marketing segments'),
    ('crm.segments.update', 'Update CRM marketing segments'),
    ('crm.templates.read', 'Read CRM message templates'),
    ('crm.templates.create', 'Create CRM message templates'),
    ('crm.templates.update', 'Update CRM message templates'),
    ('crm.opportunities.read', 'Read CRM opportunities'),
    ('crm.opportunities.update', 'Update CRM opportunities')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
CROSS JOIN core.permissions p
WHERE r.name = 'SUPERADMIN'
  AND p.key IN (
    'crm.campaigns.read',
    'crm.campaigns.create',
    'crm.campaigns.update',
    'crm.campaigns.delete',
    'crm.segments.read',
    'crm.segments.create',
    'crm.segments.update',
    'crm.templates.read',
    'crm.templates.create',
    'crm.templates.update',
    'crm.opportunities.read',
    'crm.opportunities.update'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;
