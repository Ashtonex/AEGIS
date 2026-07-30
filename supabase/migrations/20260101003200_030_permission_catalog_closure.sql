-- Ensure every permission enforced by backend routers exists in the database
-- permission catalog. SUPERADMIN bypasses checks, but non-superadmin roles need
-- these keys to be assignable through role_permissions.

INSERT INTO core.permissions (key, description) VALUES
  ('crm.create_opportunities', 'Create CRM direct opportunities'),
  ('crm.update_opportunities', 'Update CRM direct opportunities'),
  ('crm.create_tenders', 'Create CRM tender opportunities'),
  ('crm.create_subcontractors', 'Create CRM subcontractor records'),
  ('crm.update_subcontractors', 'Update CRM subcontractor records'),
  ('users.delete', 'Deactivate or delete users')
ON CONFLICT (key) DO NOTHING;
