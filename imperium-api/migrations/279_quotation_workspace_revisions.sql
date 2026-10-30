-- ============================================================================
-- Migration 279: quotation workspace - concurrency, frozen revisions, handoff
-- ============================================================================
-- Additive only. Existing quotation rows, columns and write paths keep
-- working unchanged.
--
-- 1. finance.quotations.row_version - bumped by a trigger on EVERY update, so
--    any writer (builder, CRM client-copy upload, decision, BOQ approval)
--    moves it. The workspace sends the version it loaded; PUT refuses a stale
--    one with 409 instead of silently overwriting a newer edit. Callers that
--    do not send a version keep the old last-write-wins behaviour.
--
-- 2. finance.quotation_revisions - one immutable commercial snapshot per
--    issued / approved revision: the full metadata blob as saved, the server
--    QuotationCalculator result, and the frozen tax rate. Further editing
--    happens on the live quotation (the working draft); an issued revision is
--    never rewritten. A trigger rejects UPDATE/DELETE of snapshot content.
--
-- 3. finance.quotation_handoff_packages - post-award planning outputs
--    (materials schedule from rate build-ups) keyed by (quotation, revision,
--    package_type), so retries and double clicks return the existing package
--    instead of creating a duplicate. A materials schedule is a planning
--    output only - it never creates a purchase order or commits spend.

ALTER TABLE finance.quotations
    ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION finance.bump_quotation_row_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.row_version := COALESCE(OLD.row_version, 1) + 1;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quotations_row_version ON finance.quotations;
CREATE TRIGGER trg_quotations_row_version
    BEFORE UPDATE ON finance.quotations
    FOR EACH ROW EXECUTE FUNCTION finance.bump_quotation_row_version();


CREATE TABLE IF NOT EXISTS finance.quotation_revisions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES core.organizations(id),
    quotation_id        uuid NOT NULL REFERENCES finance.quotations(id),
    revision_number     integer NOT NULL CHECK (revision_number >= 1),
    parent_revision_id  uuid REFERENCES finance.quotation_revisions(id),
    kind                varchar(20) NOT NULL DEFAULT 'issued'
        CHECK (kind IN ('issued', 'internal')),
    change_reason       text,
    snapshot            jsonb NOT NULL,
    calculation         jsonb NOT NULL,
    currency            varchar(10),
    tax_rate            numeric(9,6) NOT NULL DEFAULT 0,
    tax_rate_source     varchar(40),
    direct_costs        numeric(18,2) NOT NULL DEFAULT 0,
    grand_total         numeric(18,2) NOT NULL DEFAULT 0,
    item_count          integer NOT NULL DEFAULT 0,
    audit_trail_hash    varchar(64),
    source_row_version  integer,
    created_by          uuid REFERENCES core.users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (quotation_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_quotation_revisions_quotation
    ON finance.quotation_revisions (organization_id, quotation_id, revision_number DESC);

CREATE OR REPLACE FUNCTION finance.reject_quotation_revision_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'quotation revisions are immutable (revision %)', OLD.id
        USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_quotation_revisions_immutable ON finance.quotation_revisions;
CREATE TRIGGER trg_quotation_revisions_immutable
    BEFORE UPDATE OR DELETE ON finance.quotation_revisions
    FOR EACH ROW EXECUTE FUNCTION finance.reject_quotation_revision_change();


CREATE TABLE IF NOT EXISTS finance.quotation_handoff_packages (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES core.organizations(id),
    quotation_id        uuid NOT NULL REFERENCES finance.quotations(id),
    revision_id         uuid NOT NULL REFERENCES finance.quotation_revisions(id),
    project_id          uuid REFERENCES projects.projects(id),
    package_type        varchar(40) NOT NULL
        CHECK (package_type IN ('materials_schedule')),
    status              varchar(20) NOT NULL DEFAULT 'planning'
        CHECK (status IN ('planning', 'superseded')),
    lines               jsonb NOT NULL DEFAULT '[]'::jsonb,
    summary             jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by          uuid REFERENCES core.users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (quotation_id, revision_id, package_type)
);

CREATE INDEX IF NOT EXISTS idx_quotation_handoff_packages_quotation
    ON finance.quotation_handoff_packages (organization_id, quotation_id);

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['quotation_revisions', 'quotation_handoff_packages'] LOOP
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON finance.%I FROM anon, authenticated', t);
        EXECUTE format('GRANT ALL ON finance.%I TO service_role', t);
        EXECUTE format('DROP POLICY IF EXISTS "%s service role only" ON finance.%I', t, t);
        EXECUTE format('CREATE POLICY "%s service role only" ON finance.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
    END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION finance.bump_quotation_row_version() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION finance.reject_quotation_revision_change() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF to_regprocedure('core.process_audit_log()') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS audit_quotation_revisions ON finance.quotation_revisions;
        CREATE TRIGGER audit_quotation_revisions
            AFTER INSERT ON finance.quotation_revisions
            FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
        DROP TRIGGER IF EXISTS audit_quotation_handoff_packages ON finance.quotation_handoff_packages;
        CREATE TRIGGER audit_quotation_handoff_packages
            AFTER INSERT OR UPDATE ON finance.quotation_handoff_packages
            FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
    END IF;
END $$;
