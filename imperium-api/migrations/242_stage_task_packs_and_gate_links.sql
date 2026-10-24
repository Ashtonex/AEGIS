-- ============================================================================
-- AEGIS MIGRATION 242 — STAGE TASK PACKS AND GATE LINKS
-- ============================================================================
-- 1. Stage packs for the stages that had none, so every move along the
--    pipeline hands people a fresh, relevant set of tasks:
--      tender       Submitted / Adjudication / Awarded / Lost
--      opportunity  Site Visit / Contract
--      project      pending_deposit (won work waiting on its deposit)
--    Stages still without a pack (e.g. tender "Bid Prep") now KEEP the work
--    already in flight instead of superseding and re-creating it - see
--    task_stacks.transition_stage_tasks().
--
-- 2. Gate links. A project's pre-mobilisation checks and commercial
--    readiness controls are what _ensure_project_can_activate() enforces;
--    the project / commercial_readiness task packs describe the same work
--    but were never connected to them. contribution_target on the templates
--    (and the contribution_target_* columns on existing tasks) now name the
--    gate each task satisfies:
--      {"entity_type": "project_check",        "field": "<check_name>"}
--      {"entity_type": "commercial_readiness", "field": "<control key>"}
--    Completing such a task ticks its gate; ticking the gate completes the
--    task (app/shared/task_gates.py). Linked tasks become blocking.
--
-- 3. Two project tasks for the pre-mobilisation gates no task covered
--    (Insurance, Risk).
-- ============================================================================

-- --- 1+3. New templates (per org, idempotent on template_key) --------------
WITH new_templates (entity_type, stage, template_key, title, description, sort_order,
                    criticality, gate_effect, responsible_role, contribution_target) AS (
    VALUES
    ('tender', 'Submitted', 'tender.submitted.receipt', 'Confirm submission receipt',
        'Get written confirmation the client received the bid on time.', 10, 'high', 'non_blocking', 'CRM Associate', '{}'),
    ('tender', 'Submitted', 'tender.submitted.bond_validity', 'Track bid validity and bid bond expiry',
        'Diarise the bid validity period and bid bond expiry; extend before they lapse.', 20, 'high', 'non_blocking', 'Finance Manager', '{}'),
    ('tender', 'Submitted', 'tender.submitted.follow_up', 'Follow up on evaluation progress',
        'Check in with the procuring entity on evaluation timelines.', 30, 'medium', 'non_blocking', 'CRM Associate', '{}'),
    ('tender', 'Adjudication', 'tender.adjudication.clarifications', 'Respond to adjudication clarifications',
        'Answer evaluation queries in writing, within the deadline, without changing price.', 10, 'critical', 'non_blocking', 'Quantity Surveyor', '{}'),
    ('tender', 'Adjudication', 'tender.adjudication.presentation', 'Prepare for presentation or site interview',
        'Brief the team, prepare method statement and key rates for questioning.', 20, 'high', 'non_blocking', 'Commercial Manager', '{}'),
    ('tender', 'Adjudication', 'tender.adjudication.decision', 'Follow up on award decision',
        'Chase the outcome and record the expected decision date.', 30, 'medium', 'non_blocking', 'CRM Associate', '{}'),
    ('tender', 'Awarded', 'tender.awarded.letter', 'Obtain formal award letter',
        'Written award or notice to proceed, filed against the tender.', 10, 'critical', 'non_blocking', 'CRM Associate', '{}'),
    ('tender', 'Awarded', 'tender.awarded.bonds', 'Release bid bond and arrange performance bond',
        'Recover the bid bond and put the contract performance security in place.', 20, 'high', 'non_blocking', 'Finance Manager', '{}'),
    ('tender', 'Awarded', 'tender.awarded.reconcile', 'Reconcile award against tender price',
        'Check the awarded sum and scope against the submitted BOQ.', 30, 'high', 'non_blocking', 'Quantity Surveyor', '{}'),
    ('tender', 'Lost', 'tender.lost.outcome', 'Record outcome and winning price',
        'Log the winner and winning price for future pricing.', 10, 'medium', 'non_blocking', 'CRM Associate', '{}'),
    ('tender', 'Lost', 'tender.lost.debrief', 'Request client debrief',
        'Ask the procuring entity why the bid lost.', 20, 'low', 'non_blocking', 'CRM Associate', '{}'),
    ('tender', 'Lost', 'tender.lost.bond', 'Recover bid bond',
        'Get the bid bond or guarantee returned and cancelled.', 30, 'medium', 'non_blocking', 'Finance Manager', '{}'),
    ('opportunity', 'Site Visit', 'opportunity.site_visit.schedule', 'Schedule site visit',
        'Agree date, access and attendees with the client.', 10, 'high', 'blocking', 'CRM Associate', '{}'),
    ('opportunity', 'Site Visit', 'opportunity.site_visit.measure', 'Conduct site visit and take measurements',
        'Measure, photograph and note constraints needed for pricing.', 20, 'critical', 'blocking', 'Quantity Surveyor', '{}'),
    ('opportunity', 'Site Visit', 'opportunity.site_visit.report', 'File site visit report',
        'Findings, risks and quantities recorded against the opportunity.', 30, 'high', 'blocking', 'Quantity Surveyor', '{}'),
    ('opportunity', 'Contract', 'opportunity.contract.issue', 'Issue contract or LOI for signature',
        'Send the agreed contract, LOI or order form to the client.', 10, 'critical', 'blocking', 'Commercial Manager', '{}'),
    ('opportunity', 'Contract', 'opportunity.contract.signed', 'Obtain signed contract or purchase order',
        'Countersigned contract, PO or notice to proceed on file.', 20, 'critical', 'blocking', 'CRM Associate', '{}'),
    ('opportunity', 'Contract', 'opportunity.contract.deposit_invoice', 'Issue deposit invoice',
        'Invoice the agreed deposit or advance payment.', 30, 'critical', 'blocking', 'Finance Manager', '{}'),
    ('opportunity', 'Contract', 'opportunity.contract.handover', 'Hand over to project setup',
        'Pass the priced scope, contract and contacts to the project team.', 40, 'high', 'blocking', 'Commercial Manager', '{}'),
    ('project', 'pending_deposit', 'project.deposit.invoice', 'Issue deposit invoice',
        'Invoice the contract deposit so mobilisation can be funded.', 10, 'critical', 'blocking', 'Finance Manager', '{}'),
    ('project', 'pending_deposit', 'project.deposit.follow_up', 'Follow up deposit payment',
        'Chase the client until the deposit lands.', 20, 'high', 'blocking', 'CRM Associate', '{}'),
    ('project', 'pending_deposit', 'project.deposit.confirm', 'Confirm deposit received',
        'Match the deposit on the bank statement, then Confirm Deposit on the project.', 30, 'critical', 'blocking', 'Finance Manager', '{}'),
    ('project', NULL, 'project.insurance.cover', 'Project insurance cover',
        'Valid project-specific insurance (CAR, public liability) in place.', 175, 'high', 'blocking', 'Finance Manager',
        '{"entity_type": "project_check", "field": "Insurance"}'),
    ('project', NULL, 'project.risk.register_review', 'Risk register review',
        'Reviewed project risk register with treatment actions.', 176, 'high', 'blocking', 'Project Manager',
        '{"entity_type": "project_check", "field": "Risk"}')
)
INSERT INTO crm.task_templates (
    organization_id, entity_type, stage, template_key, requirement_code, title, description,
    sort_order, criticality, gate_effect, responsible_role, contribution_target, task_type
)
SELECT o.id, t.entity_type, t.stage, t.template_key,
       upper(replace(t.template_key, '.', '_')), t.title, t.description,
       t.sort_order, t.criticality, t.gate_effect, t.responsible_role,
       CAST(t.contribution_target AS jsonb), 'control'
FROM core.organizations o
CROSS JOIN new_templates t
WHERE NOT EXISTS (
    SELECT 1 FROM crm.task_templates existing
    WHERE existing.organization_id = o.id
      AND existing.entity_type = t.entity_type
      AND existing.template_key = t.template_key
);

-- --- 2. Gate links on existing templates and tasks ------------------------
CREATE TEMP TABLE _gate_links (entity_type text, title text, target_type text, field text) ON COMMIT DROP;
INSERT INTO _gate_links VALUES
    ('project', 'Contract and award confirmation',   'project_check', 'Contract authority'),
    ('project', 'Site Handover',                     'project_check', 'Site access'),
    ('project', 'Technical readiness',               'project_check', 'Scope'),
    ('project', 'Commercial baseline',               'project_check', 'Budget'),
    ('project', 'Construction planning',             'project_check', 'Programme'),
    ('project', 'Finance readiness',                 'project_check', 'Cash'),
    ('project', 'Procurement and stores readiness',  'project_check', 'Procurement'),
    ('project', 'Plant and equipment readiness',     'project_check', 'Plant'),
    ('project', 'Workforce readiness',               'project_check', 'Workforce'),
    ('project', 'HSE and quality readiness',         'project_check', 'HSE'),
    ('project', 'Project insurance cover',           'project_check', 'Insurance'),
    ('project', 'Governance and appointments',       'project_check', 'Governance'),
    ('project', 'Risk register review',              'project_check', 'Risk'),
    ('commercial_readiness', 'Contract authority verification', 'commercial_readiness', 'contract_authority_verified'),
    ('commercial_readiness', 'Formal contract review',          'commercial_readiness', 'contract_review_completed'),
    ('commercial_readiness', 'Tender handover',                 'commercial_readiness', 'tender_handover_completed'),
    ('commercial_readiness', 'Award reconciliation',            'commercial_readiness', 'award_reconciled'),
    ('commercial_readiness', 'Commercial baseline setup',       'commercial_readiness', 'commercial_baseline_approved'),
    ('commercial_readiness', 'Cash-flow forecast',              'commercial_readiness', 'cash_flow_forecast_approved'),
    ('commercial_readiness', 'Procurement commercial plan',     'commercial_readiness', 'procurement_plan_ready'),
    ('commercial_readiness', 'Subcontract package plan',        'commercial_readiness', 'subcontract_plan_ready'),
    ('commercial_readiness', 'Measurement and valuation setup', 'commercial_readiness', 'valuation_system_ready'),
    ('commercial_readiness', 'Variation control setup',         'commercial_readiness', 'variation_control_ready'),
    ('commercial_readiness', 'Claims and notice setup',         'commercial_readiness', 'claims_notice_ready'),
    ('commercial_readiness', 'Commercial register setup',       'commercial_readiness', 'commercial_registers_ready'),
    ('commercial_readiness', 'Commercial reporting setup',      'commercial_readiness', 'reporting_ready'),
    ('commercial_readiness', 'Commercial readiness review',     'commercial_readiness', 'readiness_review_completed');

UPDATE crm.task_templates tt
SET contribution_target = jsonb_build_object('entity_type', g.target_type, 'field', g.field),
    gate_effect = 'blocking',
    criticality = CASE WHEN tt.criticality IN ('low', 'medium') THEN 'high' ELSE tt.criticality END
FROM _gate_links g
WHERE tt.entity_type = g.entity_type AND tt.title = g.title AND tt.stage IS NULL AND tt.is_deleted = false;

-- contribution_target_id is the project the gate lives on - the task's own
-- entity_id for both packs (commercial_readiness packs hang off the project id).
UPDATE crm.tasks t
SET contribution_target_type = g.target_type,
    contribution_target_field = g.field,
    contribution_target_id = t.entity_id,
    gate_effect = 'blocking',
    criticality = CASE WHEN t.criticality IN ('low', 'medium') THEN 'high' ELSE t.criticality END,
    updated_at = NOW()
FROM _gate_links g
WHERE t.entity_type = g.entity_type AND t.title = g.title AND t.is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_contribution_target
    ON crm.tasks (organization_id, contribution_target_id, contribution_target_type, contribution_target_field)
    WHERE contribution_target_id IS NOT NULL AND is_deleted = false;
