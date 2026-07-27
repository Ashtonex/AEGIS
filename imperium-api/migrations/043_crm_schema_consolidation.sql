-- ============================================================================
-- CRM schema consolidation (corrective, forward-only)
--
-- 041_crm_completion_phases_1_6.sql, 041_crm_schema_stabilization_and_hardening.sql,
-- and 042_crm_lifecycle_compatibility_completion.sql were three independent, partially
-- overlapping attempts at the same schema, applied in that (alphabetical) order. They
-- did not conflict at apply time (everything was IF NOT EXISTS / IF EXISTS guarded) but
-- left redundant duplicate columns, a mismatched automation_rules shape, RLS gaps on a
-- few tables, and an unused win_loss_reasons table. All affected tables are confirmed
-- empty (0 rows) at the time of writing this migration, so these are safe structural
-- fixes, not data migrations.
-- ============================================================================

-- 1. crm.automation_rules was created by 041_crm_completion_phases_1_6.sql with
--    (conditions, actions, retry_policy), but routers/crm_automations.py's CRUD (the
--    canonical automation-rule router) reads/writes (trigger_conditions, action_type,
--    action_config) — columns that never existed on this table. Add them; the merged
--    execution engine in crm_automations.py already falls back between both shapes.
ALTER TABLE crm.automation_rules
    ADD COLUMN IF NOT EXISTS trigger_conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS action_type VARCHAR(100),
    ADD COLUMN IF NOT EXISTS action_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Drop redundant duplicate columns, keeping one canonical name per concern.
--    crm.campaigns: keep campaign_type/source_channel/start_date/end_date/goals.
ALTER TABLE crm.campaigns
    DROP COLUMN IF EXISTS channel,
    DROP COLUMN IF EXISTS source,
    DROP COLUMN IF EXISTS starts_on,
    DROP COLUMN IF EXISTS ends_on,
    DROP COLUMN IF EXISTS type,
    DROP COLUMN IF EXISTS actual_cost,
    DROP COLUMN IF EXISTS started_at,
    DROP COLUMN IF EXISTS ended_at;

-- crm.segments: keep criteria (drop rules).
ALTER TABLE crm.segments
    DROP COLUMN IF EXISTS rules;

-- crm.campaign_members: keep status (drop member_status).
ALTER TABLE crm.campaign_members
    DROP COLUMN IF EXISTS member_status;

-- 3. crm.win_loss_reasons: confirmed 0 rows, no FK references, and no surviving router
--    references it (crm_win_loss.py deleted; crm.py's mark-won/mark-lost use the plain
--    win_loss_status/win_loss_reason text columns already on crm.opportunities).
DROP TABLE IF EXISTS crm.win_loss_reasons;

-- 4. RLS reconciliation. "Tenant Isolation Policy" (organization_id = get_jwt_org_id()
--    OR service_role) is the canonical convention used across 30+ committed migrations.
--    Several 041/042-created tables also got a redundant, more restrictive
--    "CRM tenant service role" (service_role-only) policy layered on top; both coexist
--    as permissive OR'd policies today, so dropping the redundant one changes nothing
--    for service_role and is a no-op for already-working tenant access. Three tables
--    (nurture_sequences, pipeline_stages, sequence_steps) only ever got the
--    service-role-only policy and never a Tenant Isolation Policy at all — add it so
--    ordinary tenant users aren't unexpectedly locked out once Phase 4/5 wiring reaches
--    these tables.
DO $$
DECLARE
    t_name text;
BEGIN
    FOREACH t_name IN ARRAY ARRAY[
        'automation_rules', 'automation_runs', 'campaign_members', 'campaigns',
        'message_templates', 'segments', 'support_tickets', 'ticket_comments',
        'ticket_sla_events', 'communication_events'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON crm.%I', 'CRM tenant service role', t_name);
    END LOOP;

    EXECUTE format('DROP POLICY IF EXISTS %I ON crm.communication_events', 'CRM communication service role only');

    FOREACH t_name IN ARRAY ARRAY['nurture_sequences', 'pipeline_stages', 'sequence_steps']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON crm.%I', 'CRM tenant service role', t_name);
        EXECUTE format(
            'CREATE POLICY %I ON crm.%I FOR ALL USING (organization_id = get_jwt_org_id() OR current_setting(''role'') = ''service_role'')',
            'Tenant Isolation Policy',
            t_name
        );
    END LOOP;
END $$;

-- 5. Remove permission keys left registered by the now-deleted orphan routers
--    (crm_campaigns.py, crm_templates.py, crm_win_loss.py) that no surviving
--    require_permission(...) call references anymore. crm.marketing.* / crm.support.* /
--    crm.reports.read / crm.automations.execute / crm.import / crm.export / the
--    crm.{view,create,update}_* opportunity/tender/subcontractor keys all remain in use.
DELETE FROM core.role_permissions
WHERE permission_id IN (
    SELECT id FROM core.permissions
    WHERE key IN (
        'crm.campaigns.read', 'crm.campaigns.create', 'crm.campaigns.update', 'crm.campaigns.delete',
        'crm.segments.read', 'crm.segments.create', 'crm.segments.update',
        'crm.templates.read', 'crm.templates.create', 'crm.templates.update',
        'crm.opportunities.read', 'crm.opportunities.update'
    )
);

DELETE FROM core.permissions
WHERE key IN (
    'crm.campaigns.read', 'crm.campaigns.create', 'crm.campaigns.update', 'crm.campaigns.delete',
    'crm.segments.read', 'crm.segments.create', 'crm.segments.update',
    'crm.templates.read', 'crm.templates.create', 'crm.templates.update',
    'crm.opportunities.read', 'crm.opportunities.update'
);
