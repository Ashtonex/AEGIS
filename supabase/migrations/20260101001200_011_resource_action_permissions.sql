INSERT INTO core.permissions (key, description)
SELECT resource || '.' || action, 'Auto-generated CRUD permission'
FROM unnest(ARRAY[
  'projects','site_operations','workforce','fleet','equipment_assets','procurement_orders','inventory_items',
  'budgets','financial_performance','quotations','hr_records','compliance_items','hse_incidents','documents',
  'crm_contacts','crm_organizations','crm_activities','crm_automations','client_portal_tickets','supplier_records',
  'internal_messages','kpi_metrics','bi_reports','risk_register','tender_bids','maintenance_schedules',
  'automated_reports','website_enquiries'
]) AS resource
CROSS JOIN unnest(ARRAY['read','create','update','delete']) AS action
ON CONFLICT (key) DO NOTHING;
