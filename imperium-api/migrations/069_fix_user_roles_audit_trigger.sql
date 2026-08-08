-- core.audit_log.record_id is NOT NULL, but core.process_user_roles_audit_log()
-- unconditionally inserted NULL for it (core.user_roles has a composite key
-- (user_id, role_id), not a single `id` column, and whoever wrote this
-- trigger never filled in a substitute). Every INSERT/UPDATE/DELETE on
-- core.user_roles has therefore been failing outright with a NOT NULL
-- violation - discovered because it blocks Settings -> Users from granting
-- or revoking anyone's role at all, via the app's real role-assignment
-- endpoints (settings.py), not just direct SQL.
--
-- Fix: attribute the audit row to the affected user (user_id), same as any
-- other audit_log row identifies the record it's about. No schema change -
-- record_id stays NOT NULL.

CREATE OR REPLACE FUNCTION core.process_user_roles_audit_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'core'
AS $function$
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
        VALUES ('core.user_roles', OLD.user_id, 'DELETE', row_to_json(OLD)::jsonb, current_user_id);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, old_data, new_data, created_by)
        VALUES ('core.user_roles', NEW.user_id, 'UPDATE', row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb, current_user_id);
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, new_data, created_by)
        VALUES ('core.user_roles', NEW.user_id, 'INSERT', row_to_json(NEW)::jsonb, current_user_id);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$function$;
