-- ============================================================================
-- AEGIS MIGRATION 232 — BANK STATEMENT AUTO-TAGGING RULES
-- ============================================================================
-- "If the bank description contains X (optionally: money in/out, amount
-- range, date range) then set category / project / who / note."
--
-- Rules only ever fill fields that are still empty on a line - they never
-- overwrite a tag a person set - and run in priority order (lowest first;
-- the first rule to fill a field wins). They apply on demand (with a
-- preview first) and automatically to newly imported statement lines.
-- Tagging goes through the normal path, so claims, costs, petty cash, the
-- ledger and the Teams workbook follow.
--
-- bank_statement_lines.tag_rule_id records the rule that last tagged a line.
--
-- Additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.bank_tag_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    name                VARCHAR(120) NOT NULL,
    match_text          VARCHAR(200) NOT NULL CHECK (length(trim(match_text)) >= 3),
    direction           VARCHAR(3) NOT NULL DEFAULT 'any' CHECK (direction IN ('any', 'in', 'out')),
    amount_min          NUMERIC(15,2),
    amount_max          NUMERIC(15,2),
    date_from           DATE,
    date_to             DATE,
    set_category        VARCHAR(60),
    set_project_id      UUID REFERENCES projects.projects(id) ON DELETE SET NULL,
    set_counterparty    VARCHAR(200),
    set_note            TEXT,
    priority            INT NOT NULL DEFAULT 100,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    times_applied       INT NOT NULL DEFAULT 0,
    last_applied_at     TIMESTAMPTZ,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (set_category IS NOT NULL OR set_project_id IS NOT NULL OR set_counterparty IS NOT NULL OR set_note IS NOT NULL),
    CHECK (amount_min IS NULL OR amount_max IS NULL OR amount_min <= amount_max),
    CHECK (date_from IS NULL OR date_to IS NULL OR date_from <= date_to)
);

CREATE INDEX IF NOT EXISTS bank_tag_rules_org_active_idx
    ON finance.bank_tag_rules (organization_id, is_active, priority);

ALTER TABLE finance.bank_statement_lines
    ADD COLUMN IF NOT EXISTS tag_rule_id UUID REFERENCES finance.bank_tag_rules(id) ON DELETE SET NULL;

ALTER TABLE finance.bank_tag_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.bank_tag_rules FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.bank_tag_rules FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.bank_tag_rules;
CREATE POLICY "Finance service role only" ON finance.bank_tag_rules
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_audit_bank_tag_rules ON finance.bank_tag_rules;
CREATE TRIGGER trg_audit_bank_tag_rules AFTER INSERT OR UPDATE OR DELETE ON finance.bank_tag_rules
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
