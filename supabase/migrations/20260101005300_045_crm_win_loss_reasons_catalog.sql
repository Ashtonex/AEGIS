-- ============================================================================
-- CRM Phase 1 completeness: crm.win_loss_reasons was dropped during the 043
-- consolidation as unused dead weight (no surviving router referenced it after
-- the orphan crm_win_loss.py router was deleted). The completion spec lists it
-- as a required Phase 1 entity, so it is re-added here as a proper structured
-- catalog (rather than the free-text-only capture that replaced it), wired to
-- crm.opportunities via a new nullable FK column that coexists with the
-- existing free-text win_loss_reason column.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm.win_loss_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    reason_type VARCHAR(10) NOT NULL CHECK (reason_type IN ('won', 'lost')),
    label VARCHAR(160) NOT NULL,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, reason_type, label)
);

ALTER TABLE crm.opportunities
    ADD COLUMN IF NOT EXISTS win_loss_reason_id UUID REFERENCES crm.win_loss_reasons(id) ON DELETE SET NULL;

DO $$
BEGIN
    ALTER TABLE crm.win_loss_reasons ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crm.win_loss_reasons FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Tenant Isolation Policy" ON crm.win_loss_reasons;
    CREATE POLICY "Tenant Isolation Policy" ON crm.win_loss_reasons
        FOR ALL USING (organization_id = get_jwt_org_id() OR current_setting('role') = 'service_role');
    DROP TRIGGER IF EXISTS trg_audit_win_loss_reasons ON crm.win_loss_reasons;
    CREATE TRIGGER trg_audit_win_loss_reasons
        AFTER INSERT OR UPDATE OR DELETE ON crm.win_loss_reasons
        FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
END $$;
