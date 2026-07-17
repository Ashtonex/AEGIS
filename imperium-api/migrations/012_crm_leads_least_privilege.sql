-- CRM leads are a distinct resource.  These definitions deliberately do not
-- grant access to any role; administrators must assign them explicitly.
INSERT INTO core.permissions (key, description)
VALUES
    ('crm_leads.read', 'View CRM leads'),
    ('crm_leads.create', 'Create CRM leads'),
    ('crm_leads.update', 'Update CRM leads'),
    ('crm_leads.delete', 'Delete CRM leads'),
    ('crm_leads.qualify', 'Qualify CRM leads into opportunities')
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description;
