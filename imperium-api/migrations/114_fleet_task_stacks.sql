-- ============================================================================
-- Task stacks: fleet + machinery
-- ============================================================================
-- 110_crm_task_stacks.sql seeded templates for tender/opportunity/lead/
-- project but never finished the fleet/machinery half its own comment
-- promised ("the assignment pattern already used on
-- leads/opportunities/tenders/projects/fleet/machinery"). generate_task_stack()
-- is now also called from fleet.py's create_asset and equipment_assets.py's
-- create_item (entity_type 'fleet' / 'machinery') - this migration supplies
-- the templates those calls need, and backfills existing assets via the
-- same idempotent generate_task_stack() dup guard through the
-- /api/v1/crm-tasks/backfill-stacks endpoint (run once, manually, post-deploy).
-- ============================================================================

INSERT INTO crm.task_templates (organization_id, entity_type, title, description, sort_order)
SELECT o.id, t.entity_type, t.title, t.description, t.sort_order
FROM core.organizations o
CROSS JOIN (VALUES
    ('fleet',     'Pre-Deployment Inspection',       'Complete a pre-deployment inspection before this asset goes to site.', 1),
    ('fleet',     'Compliance Documents Check',       'Confirm licence, insurance and inspection certificates are current.', 2),
    ('fleet',     'Assignment Confirmation',          'Confirm operator and project assignment for this asset.', 3),
    ('machinery', 'Pre-Deployment Inspection',        'Complete a pre-deployment inspection before this equipment goes to site.', 1),
    ('machinery', 'Compliance Documents Check',       'Confirm licence, insurance and inspection certificates are current.', 2),
    ('machinery', 'Assignment Confirmation',          'Confirm operator and project assignment for this equipment.', 3)
) AS t(entity_type, title, description, sort_order)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM crm.task_templates existing
      WHERE existing.organization_id = o.id AND existing.entity_type = t.entity_type AND existing.title = t.title
  );
