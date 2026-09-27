-- ============================================================================
-- AEGIS MIGRATION 237 — AUDIT LOG ORGANIZATION ID
-- ============================================================================
-- core.audit_log.organization_id existed (with a FK to core.organizations)
-- but core.process_audit_log() - the AFTER ROW trigger on 183 tables - never
-- set it, so every trigger-written audit row was tenant-less. Readers had to
-- scope through the acting user instead (see GET /executive/today).
--
-- The trigger now resolves the tenant, in order:
--   1. the audited row's own organization_id (175 of the 183 tables have
--      one, all uuid);
--   2. for core.organizations rows, the row's own id;
--   3. otherwise the acting user's organization (core.permissions,
--      core.system_modules and similar global tables).
-- A value that doesn't exist in core.organizations is written as NULL
-- rather than violating the FK: an audit insert failing would fail the
-- user's actual write along with it. (Triggers fire AFTER the row change,
-- so an organization's own DELETE finds it already gone and gets NULL.)
--
-- old_data/new_data and created_by are computed exactly as before.
--
-- Existing rows are backfilled with the same rules (only rows still NULL,
-- so re-running is harmless), and the Today → Activity index from 236 is
-- replaced by one that leads with organization_id, now that the feed can
-- scope on the column directly.
-- ============================================================================

CREATE OR REPLACE FUNCTION core.process_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'core'
AS $function$
DECLARE
    current_user_id UUID;
    row_data JSONB;
    row_org_id UUID;
BEGIN
    BEGIN
        current_user_id := (current_setting('request.jwt.claim.sub', true))::uuid;
    EXCEPTION WHEN OTHERS THEN
        current_user_id := NULL;
    END;

    IF (TG_OP = 'DELETE') THEN
        row_data := to_jsonb(OLD);
    ELSE
        row_data := to_jsonb(NEW);
    END IF;

    row_org_id := (row_data->>'organization_id')::uuid;
    IF row_org_id IS NULL AND TG_TABLE_SCHEMA = 'core' AND TG_TABLE_NAME = 'organizations' THEN
        row_org_id := (row_data->>'id')::uuid;
    END IF;
    IF row_org_id IS NULL AND current_user_id IS NOT NULL THEN
        SELECT u.organization_id INTO row_org_id FROM core.users u WHERE u.id = current_user_id;
    END IF;
    -- Never let the audit_log FK fail the audited write itself.
    IF row_org_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM core.organizations o WHERE o.id = row_org_id) THEN
        row_org_id := NULL;
    END IF;

    IF (TG_OP = 'DELETE') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, old_data, created_by, organization_id)
        VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, OLD.id, 'DELETE', row_to_json(OLD)::jsonb, current_user_id, row_org_id);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, old_data, new_data, created_by, organization_id)
        VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.id, 'UPDATE', row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb, current_user_id, row_org_id);
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, new_data, created_by, organization_id)
        VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.id, 'INSERT', row_to_json(NEW)::jsonb, current_user_id, row_org_id);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$function$;

-- Backfill: same resolution order as the trigger, NULL-only.
UPDATE core.audit_log a
SET organization_id = resolved.org_id
FROM (
    SELECT
        src.id,
        COALESCE(
            CASE
                WHEN COALESCE(src.new_data, src.old_data)->>'organization_id'
                     ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (COALESCE(src.new_data, src.old_data)->>'organization_id')::uuid
            END,
            CASE
                WHEN src.table_name = 'core.organizations'
                 AND COALESCE(src.new_data, src.old_data)->>'id'
                     ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (COALESCE(src.new_data, src.old_data)->>'id')::uuid
            END,
            actor.organization_id
        ) AS org_id
    FROM core.audit_log src
    LEFT JOIN core.users actor ON actor.id = src.created_by
    WHERE src.organization_id IS NULL
) resolved
WHERE a.id = resolved.id
  AND resolved.org_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM core.organizations o WHERE o.id = resolved.org_id);

-- Today → Activity now scopes on audit_log.organization_id directly.
CREATE INDEX IF NOT EXISTS audit_log_org_actor_recent_idx
    ON core.audit_log (organization_id, created_at DESC)
    WHERE created_by IS NOT NULL;
DROP INDEX IF EXISTS core.audit_log_actor_recent_idx;
