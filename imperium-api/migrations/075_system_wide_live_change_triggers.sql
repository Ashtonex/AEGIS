-- Phase 2 of live updates: extends the notification-only trigger from
-- migration 074 into a generic, reusable change signal for every major
-- module's primary list-view table.
--
-- The payload is deliberately a small "something changed" signal (table,
-- operation, organization_id, row id) rather than the full row - pg_notify
-- caps a payload at 8000 bytes, and several of these tables (quotations,
-- documents) carry large jsonb/text columns that would blow past that
-- limit on some rows. Since the trigger runs inside the same transaction
-- as the write, an oversized payload would raise an error and roll back
-- the write itself. A small invalidation signal is safe on every table
-- uniformly; the backend/frontend fetch the fresh row themselves once
-- authorized, the same REST path they already use.
--
-- Authorization for who receives which table's events happens in Python
-- (core/realtime.py), reusing the same permission checks REST endpoints
-- use - see migration 074's note for why this isn't raw Supabase Realtime.

CREATE OR REPLACE FUNCTION core.notify_table_change() RETURNS trigger AS $$
DECLARE
  row_data jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  PERFORM pg_notify(
    'live_changes',
    json_build_object(
      'table', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      'op', TG_OP,
      'organization_id', row_data->>'organization_id',
      'id', row_data->>'id'
    )::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  target text;
  targets text[] := ARRAY[
    'finance.quotations',
    'crm.opportunities',
    'crm.leads',
    'crm.contacts',
    'crm.activities',
    'crm.organizations',
    'core.internal_messages',
    'core.documents',
    'core.compliance_items',
    'projects.projects',
    'projects.hse_incidents',
    'projects.daily_site_reports',
    'fleet.fleet',
    'fleet.equipment_assets',
    'fleet.maintenance_schedules',
    'procurement.procurement_orders',
    'procurement.inventory_items',
    'procurement.suppliers',
    'finance.budgets'
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
