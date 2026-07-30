-- ============================================================================
-- PROJECT IMPERIUM - FIX AUDIT TRIGGERS
-- Migration: 004_fix_audit_trigger.sql
-- ============================================================================

-- The core.process_audit_log function assumes every table has a single UUID 'id' column.
-- Junction tables like role_permissions and user_roles use composite primary keys and lack an 'id' column,
-- causing the trigger to fail with 'record "new" has no field "id"' during inserts.

-- 1. Drop the trigger from tables without a single UUID 'id' column
DROP TRIGGER IF EXISTS trg_audit_role_permissions ON core.role_permissions;
DROP TRIGGER IF EXISTS trg_audit_user_roles ON core.user_roles;

-- 2. Update the dynamic trigger application block in case it is re-run in the future
-- (This ensures the junction tables are explicitly excluded)
DO $$ 
DECLARE
    t_name text;
    s_name text;
BEGIN
    FOR s_name, t_name IN 
        SELECT table_schema, table_name FROM information_schema.tables 
        WHERE table_schema IN ('core', 'crm', 'projects', 'finance', 'procurement', 'fleet', 'hr', 'executive')
        AND table_name NOT IN ('audit_log', 'role_permissions', 'user_roles') -- Excluded junction tables
    LOOP
        -- Recreate only for tables that have an 'id' column
        EXECUTE format('
            DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
            CREATE TRIGGER trg_audit_%I
            AFTER INSERT OR UPDATE OR DELETE ON %I.%I
            FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
        ', t_name, s_name, t_name, t_name, s_name, t_name);
    END LOOP;
END $$;
