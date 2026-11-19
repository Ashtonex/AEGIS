-- Live updates, wave 1: tenders, opportunities and CRM tasks.
--
-- 1. core.notify_table_change() now also sends the row's parent ids when the
--    table has them: project_id, tender_id, opportunity_id, entity_type and
--    entity_id. An open tender or opportunity page can then refresh when one
--    of its child rows changes (a requirement, a review item, a linked
--    document, a task) without the server loading anything. Ids only, never
--    row content, so the payload stays far below pg_notify's 8000-byte cap.
--    Every existing live_change_notify trigger picks this up automatically.
-- 2. Triggers on the tender, discovery and task tables, none of which had one.
-- 3. core.document_links now also notifies for tender and opportunity links
--    (it was daily-report links only, migration 301).

CREATE OR REPLACE FUNCTION core.notify_table_change() RETURNS trigger AS $$
DECLARE
  row_data jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  PERFORM pg_notify(
    'live_changes',
    jsonb_strip_nulls(jsonb_build_object(
      'table', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      'op', TG_OP,
      'organization_id', row_data->>'organization_id',
      'id', row_data->>'id',
      'project_id', row_data->>'project_id',
      'tender_id', row_data->>'tender_id',
      'opportunity_id', row_data->>'opportunity_id',
      'entity_type', row_data->>'entity_type',
      'entity_id', row_data->>'entity_id'
    ))::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  target text;
  targets text[] := ARRAY[
    'crm.tenders',
    'crm.tender_requirements',
    'crm.tender_review_items',
    'crm.tender_candidates',
    'crm.tender_discovery_runs',
    'crm.tasks'
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

DROP TRIGGER IF EXISTS live_change_notify ON core.document_links;
CREATE TRIGGER live_change_notify
    AFTER INSERT OR UPDATE ON core.document_links
    FOR EACH ROW
    WHEN (NEW.entity_type IN ('daily_site_report', 'tender', 'opportunity'))
    EXECUTE FUNCTION core.notify_table_change();
