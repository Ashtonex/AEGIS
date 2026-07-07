-- ============================================================================
-- PROJECT IMPERIUM - SEED TEST DATA & AUTH TRIGGERS
-- Migration: 003_seed_test_user.sql
-- ============================================================================

-- 1. Create a Default Organization
INSERT INTO core.organizations (id, name, registration_number)
VALUES ('00000000-0000-0000-0000-000000000001', 'Six Nine Construction (Test Org)', 'SNC-TEST-001')
ON CONFLICT (id) DO NOTHING;

-- 2. Create the SUPERADMIN Role for the Default Org
INSERT INTO core.roles (id, organization_id, name, description)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'SUPERADMIN', 'Unrestricted System Access')
ON CONFLICT (id) DO NOTHING;

-- 3. Define Required Permissions
INSERT INTO core.permissions (key, description)
VALUES 
  ('executive.view_dashboard', 'View the Executive Command Centre KPIs and modules'),
  ('crm.view_opportunities', 'View CRM direct opportunities'),
  ('crm.view_tenders', 'View CRM procurement tenders'),
  ('crm.view_subcontractors', 'View Subcontractor Registry'),
  ('crm.view_accountability', 'View CRM accountability matrix')
ON CONFLICT (key) DO NOTHING;

-- 4. Map Permissions to the SUPERADMIN Role
-- (In core.security.py, SUPERADMIN bypasses permission checks inherently, but it is good practice to map them)
INSERT INTO core.role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000002', id FROM core.permissions
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 5. Trigger: Auto-Provision Supabase Users
-- This trigger fires whenever a new user signs up via Supabase Auth.
-- It adds them to `core.users` and assigns them to the default test organization as a SUPERADMIN for testing purposes.

CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  -- Insert into core.users
  INSERT INTO core.users (id, organization_id, email, full_name, is_active)
  VALUES (
    NEW.id,
    '00000000-0000-0000-0000-000000000001', -- Default Test Org
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Test User'),
    TRUE
  );

  -- Assign SUPERADMIN role
  INSERT INTO core.user_roles (user_id, role_id, organization_id)
  VALUES (
    NEW.id,
    '00000000-0000-0000-0000-000000000002', -- SUPERADMIN Role
    '00000000-0000-0000-0000-000000000001'
  );

  -- IMPORTANT: In a production app, you MUST inject the org_id into the Supabase JWT.
  -- We do this by updating raw_app_meta_data so it is included in the JWT payload.
  UPDATE auth.users 
  SET raw_app_meta_data = raw_app_meta_data || json_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'role', 'SUPERADMIN')::jsonb
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists to allow re-running
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ============================================================================
-- NOTE TO DEVELOPER:
-- If you already created a user in Supabase Auth before running this script, 
-- you need to manually insert them into core.users and core.user_roles, 
-- OR just delete the user in the Supabase Auth UI and sign up again so the trigger fires.
-- ============================================================================
