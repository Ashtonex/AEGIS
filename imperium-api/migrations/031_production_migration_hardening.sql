-- Production migration hardening.
-- This migration closes legacy migration gaps without renaming or editing
-- previously applied files. It creates no users, roles, business records, or
-- seed data.

-- SECURITY DEFINER functions should not depend on caller-controlled search_path.
-- The JWT helper does not require elevated privileges, so keep it invoker-safe.
CREATE OR REPLACE FUNCTION public.get_jwt_org_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN (current_setting('request.jwt.claim.org_id', true))::uuid;
END;
$$;

-- Harden the audit trigger function that replaced the original public trigger.
CREATE OR REPLACE FUNCTION core.process_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core, public
AS $$
DECLARE
    current_user_id UUID;
BEGIN
    BEGIN
        current_user_id := (current_setting('request.jwt.claim.sub', true))::uuid;
    EXCEPTION WHEN OTHERS THEN
        current_user_id := NULL;
    END;

    IF (TG_OP = 'DELETE') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, old_data, created_by)
        VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, OLD.id, 'DELETE', row_to_json(OLD)::jsonb, current_user_id);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, old_data, new_data, created_by)
        VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.id, 'UPDATE', row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb, current_user_id);
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, new_data, created_by)
        VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.id, 'INSERT', row_to_json(NEW)::jsonb, current_user_id);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION core.process_audit_log() FROM PUBLIC, anon, authenticated;

-- Core tables without organization_id need explicit policies after legacy global
-- policies are tightened. The service-role API remains the write path.
ALTER TABLE core.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON core.organizations, core.role_permissions, core.audit_log FROM anon, authenticated;

DROP POLICY IF EXISTS "Organizations service role only" ON core.organizations;
CREATE POLICY "Organizations service role only" ON core.organizations
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Role permissions service role only" ON core.role_permissions;
CREATE POLICY "Role permissions service role only" ON core.role_permissions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Audit log service role only" ON core.audit_log;
CREATE POLICY "Audit log service role only" ON core.audit_log
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Executive project drill-down tables are backend-managed.
ALTER TABLE projects.project_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.project_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.project_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.project_checks FORCE ROW LEVEL SECURITY;

REVOKE ALL ON projects.project_profiles, projects.project_checks FROM anon, authenticated;
REVOKE ALL ON projects.project_milestones, projects.project_changes, projects.project_risks FROM anon, authenticated;

DROP POLICY IF EXISTS "Project profile service role only" ON projects.project_profiles;
CREATE POLICY "Project profile service role only" ON projects.project_profiles
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Project check service role only" ON projects.project_checks;
CREATE POLICY "Project check service role only" ON projects.project_checks
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Project milestones service role only" ON projects.project_milestones;
CREATE POLICY "Project milestones service role only" ON projects.project_milestones
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Project changes service role only" ON projects.project_changes;
CREATE POLICY "Project changes service role only" ON projects.project_changes
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Project risks service role only" ON projects.project_risks;
CREATE POLICY "Project risks service role only" ON projects.project_risks
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- CRM operational tables are accessed through the authenticated FastAPI layer.
REVOKE ALL ON crm.organizations, crm.activities, crm.automations FROM anon, authenticated;
REVOKE ALL ON crm.web_intakes, crm.tender_interests FROM anon, authenticated;
REVOKE ALL ON hr.applications FROM anon, authenticated;

-- Owner-read portal/profile tables intentionally have authenticated RLS policies.
-- Pair those policies with narrow grants so Supabase Data API exposure is explicit
-- if hr/crm are configured as exposed schemas.
GRANT USAGE ON SCHEMA hr, crm TO authenticated;
GRANT SELECT, UPDATE ON hr.employee_profiles TO authenticated;
GRANT SELECT ON crm.client_portal_access, crm.supplier_portal_access TO authenticated;
