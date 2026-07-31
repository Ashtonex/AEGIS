-- ============================================================================
-- Audit trigger for core.user_roles
-- ============================================================================
-- Discovered while investigating an unexplained incident: a test account's
-- core.user_roles assignment vanished and its is_active flag flapped
-- false/true/false with no code path found that could explain it (every
-- application write to core.users.is_active only ever sets it TRUE; the
-- Supabase auth signup trigger only fires once per account). The
-- investigation was unable to reach a conclusion because core.user_roles -
-- unlike every other core.* table - had no audit trigger at all, so there
-- was no record of the row disappearing or reappearing.
--
-- core.user_roles has a composite primary key (user_id, role_id), not the
-- single `id` column core.process_audit_log() expects, so it needs its own
-- trigger function rather than reusing the generic one.

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
        VALUES ('core.user_roles', NULL, 'DELETE', row_to_json(OLD)::jsonb, current_user_id);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, old_data, new_data, created_by)
        VALUES ('core.user_roles', NULL, 'UPDATE', row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb, current_user_id);
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, new_data, created_by)
        VALUES ('core.user_roles', NULL, 'INSERT', row_to_json(NEW)::jsonb, current_user_id);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_user_roles ON core.user_roles;
CREATE TRIGGER trg_audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON core.user_roles
FOR EACH ROW EXECUTE FUNCTION core.process_user_roles_audit_log();
