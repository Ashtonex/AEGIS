-- Ensure every existing tenant policy validates the proposed row, not only the old row.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT pol.schemaname, pol.tablename, pol.policyname
    FROM pg_policies pol
    JOIN information_schema.columns col ON col.table_schema = pol.schemaname AND col.table_name = pol.tablename AND col.column_name = 'organization_id'
    WHERE pol.policyname = 'Tenant Isolation Policy'
      AND pol.schemaname IN ('core', 'crm', 'hr', 'projects', 'finance', 'procurement', 'fleet', 'executive')
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (organization_id = (SELECT public.get_jwt_org_id()) OR current_setting(''role'') = ''service_role'')', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

ALTER FUNCTION public.get_jwt_org_id() SET search_path = pg_catalog, public;
ALTER FUNCTION core.process_audit_log() SET search_path = pg_catalog, core;

REVOKE ALL ON ALL TABLES IN SCHEMA core, crm, hr, projects, finance, procurement, fleet, executive FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA core, crm, hr, projects, finance, procurement, fleet, executive FROM anon, authenticated;
