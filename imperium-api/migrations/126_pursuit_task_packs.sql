-- ============================================================================
-- AEGIS MIGRATION 126 — PURSUIT OPERATING SYSTEM (PHASE 3: STAGE TASK PACKS)
-- ============================================================================
-- crm.task_templates (110) only ever fired on entity CREATE, never on a
-- stage transition - a tender being awarded, an opportunity being lost, or
-- a pursuit entering clarification generated no follow-up tasks at all.
-- This adds the three task packs the pursuit model needs for those
-- transitions (entity_type 'award' / 'loss' / 'clarification', entity_id =
-- crm.pursuits.id) and the routers/pursuits.py, routers/crm.py and
-- routers/tender_bids.py wiring that generates them (see those files) fires
-- generate_task_stack() exactly like every other entity_type already does -
-- no new generation mechanism, just new templates and new call sites.
-- ============================================================================

INSERT INTO crm.task_templates (organization_id, entity_type, title, description, sort_order)
SELECT o.id, t.entity_type, t.title, t.description, t.sort_order
FROM core.organizations o
CROSS JOIN (VALUES
    ('award', 'Obtain formal award evidence',                          NULL, 1),
    ('award', 'Review contract against tender assumptions',            NULL, 2),
    ('award', 'Identify contractual deviations',                       NULL, 3),
    ('award', 'Confirm payment terms',                                 NULL, 4),
    ('award', 'Finalise project budget',                               NULL, 5),
    ('award', 'Appoint Project Manager',                               NULL, 6),
    ('award', 'Complete Commercial-to-Construction handover',          NULL, 7),
    ('award', 'Confirm plant and workforce allocation',                NULL, 8),
    ('award', 'Establish project risk register',                       NULL, 9),
    ('award', 'Open project cost centre',                              NULL, 10),
    ('award', 'Approve mobilisation',                                  NULL, 11),
    ('award', 'Notify unsuccessful suppliers where appropriate',       NULL, 12),

    ('loss', 'Confirm award outcome',                                  NULL, 1),
    ('loss', 'Request client feedback',                                NULL, 2),
    ('loss', 'Record winning competitor',                              NULL, 3),
    ('loss', 'Compare price and technical position',                   NULL, 4),
    ('loss', 'Identify compliance weaknesses',                         NULL, 5),
    ('loss', 'Identify relationship weaknesses',                       NULL, 6),
    ('loss', 'Record lessons learned',                                 NULL, 7),
    ('loss', 'Update future pursuit strategy',                         NULL, 8),
    ('loss', 'Close outstanding tasks',                                NULL, 9),
    ('loss', 'Archive the complete pursuit record',                    NULL, 10),

    ('clarification', 'Confirm receipt',                               NULL, 1),
    ('clarification', 'Record clarification deadlines',                NULL, 2),
    ('clarification', 'Prepare presentation or interview',             NULL, 3),
    ('clarification', 'Track client engagement',                       NULL, 4),
    ('clarification', 'Review revised requirements',                   NULL, 5),
    ('clarification', 'Approve negotiated changes',                    NULL, 6),
    ('clarification', 'Maintain pricing discipline',                   NULL, 7),
    ('clarification', 'Record all client commitments',                 NULL, 8),
    ('clarification', 'Update probability of award',                   NULL, 9),
    ('clarification', 'Prepare provisional mobilisation plan',         NULL, 10)
) AS t(entity_type, title, description, sort_order)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM crm.task_templates existing
      WHERE existing.organization_id = o.id AND existing.entity_type = t.entity_type AND existing.title = t.title
  );
