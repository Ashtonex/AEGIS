-- Live updates, wave 3: approvals and payment controls.
--
-- 1. core.notify_table_change() also sends three more parent ids when the row
--    has them: batch_id (a payment in a batch), approval_instance_id (an
--    approval step or decision) and payroll_run_id (a payroll line). Ids only.
-- 2. Triggers on approval, payment-batch, payroll-run and payment-request
--    tables. finance.payable_events has had a trigger since migration 247;
--    it is now relayed too (core/realtime.py).

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
      'entity_id', row_data->>'entity_id',
      'batch_id', row_data->>'batch_id',
      'approval_instance_id', row_data->>'approval_instance_id',
      'payroll_run_id', row_data->>'payroll_run_id'
    ))::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  target text;
  targets text[] := ARRAY[
    'core.approval_instances',
    'core.approval_steps',
    'core.approval_decisions',
    'finance.supplier_payment_batches',
    'finance.supplier_payment_items',
    'finance.payroll_runs',
    'finance.payroll_items',
    'finance.vendor_payment_requests',
    'finance.client_payment_requests',
    'finance.payments',
    -- Remaining sources of the executive pending-approvals queue
    -- (routers/executive.py _PENDING_APPROVAL_SOURCES) that had no trigger.
    'crm.subcontractors',
    'finance.company_budgets',
    'finance.management_accounts_packs',
    'hr.leave_requests'
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
