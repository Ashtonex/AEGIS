-- Live updates for the fleet, procurement/stores and commitment tables.
--
-- The dashboard pages for these modules already subscribe to table-change
-- events (useLiveTable), but these tables never had the live_change_notify
-- trigger from migration 075, so nothing was ever sent and users had to
-- reload to see new rows. Same trigger, same function, same payload.
-- core/realtime.py TABLE_PERMISSION_MAP must list every table here, or the
-- relay drops the event.

DO $$
DECLARE
  target text;
  targets text[] := ARRAY[
    'fleet.external_hire_agreements',
    'fleet.fuel_transactions',
    'fleet.maintenance_work_orders',
    'fleet.operator_profiles',
    'fleet.plant_requests',
    'fleet.utilization_logs',
    'procurement.goods_received_notes',
    'procurement.purchase_requisitions',
    'procurement.rfqs',
    'procurement.stock_ledger',
    'procurement.stores',
    'procurement.supplier_invoices',
    'finance.commitments',
    'finance.ccb_monitor_findings'
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
