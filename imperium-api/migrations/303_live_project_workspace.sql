-- Live updates, wave 2: the project workspace (overview, schedule, team,
-- quality, risks and delays, drawings, subcontracts, budget, financials,
-- plant).
--
-- Every table here carries project_id. core.notify_table_change() (migration
-- 302) copies it into the event, and core/realtime.py sends these events only
-- to users who may see that project (core/project_scope), the same rule the
-- project REST endpoints apply. Payloads are ids only.

DO $$
DECLARE
  target text;
  targets text[] := ARRAY[
    'projects.project_milestones',
    'projects.milestone_dependencies',
    'projects.site_daily_targets',
    'projects.project_profiles',
    'projects.sites',
    'projects.project_checks',
    'projects.project_changes',
    'projects.project_risks',
    'projects.contractual_delay_events',
    'projects.extension_of_time_claims',
    'projects.controlled_drawings',
    'projects.concrete_pour_cards',
    'projects.site_snags',
    'projects.subcontract_packages',
    'projects.subcontractor_certificates',
    'projects.subcontractor_back_charges',
    'projects.weekly_budgets',
    'projects.weekly_budget_items',
    'projects.progress_photo_diary',
    'projects.site_role_assignments',
    'finance.progress_claims',
    'finance.cost_transactions',
    'finance.project_budgets',
    'finance.variations',
    'finance.boq_line_items',
    'finance.project_money_entries',
    'finance.retention_ledger',
    'finance.project_forecasts',
    'hr.project_allocations',
    'fleet.fleet_assignments'
  ];
BEGIN
  FOREACH target IN ARRAY targets LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS live_change_notify ON %s', target);
    EXECUTE format(
      'CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION core.notify_table_change()',
      target
    );
  END LOOP;
END $$;

-- Files linked to a project (Documents tab) notify too. Those signals are
-- project-scoped like the rest of this wave.
DROP TRIGGER IF EXISTS live_change_notify ON core.document_links;
CREATE TRIGGER live_change_notify
    AFTER INSERT OR UPDATE ON core.document_links
    FOR EACH ROW
    WHEN (NEW.entity_type IN ('daily_site_report', 'tender', 'opportunity', 'project'))
    EXECUTE FUNCTION core.notify_table_change();
