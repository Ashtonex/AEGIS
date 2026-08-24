-- ============================================================================
-- AEGIS MIGRATION 158 - OPPORTUNITY STAGE TASK PACKS
-- ============================================================================
-- Seeds stage-specific opportunity task templates. The backend now generates
-- the pack for the opportunity's current stage and supersedes the prior open
-- pack when the stage changes, keeping the CRM team focused on the work that
-- moves the deal forward.
-- ============================================================================

INSERT INTO crm.task_templates (
    organization_id,
    entity_type,
    title,
    description,
    sort_order,
    template_key,
    requirement_code,
    task_type,
    outcome_key,
    stage,
    responsible_role,
    reviewer_role,
    criticality,
    weight,
    gate_effect,
    completion_criteria,
    required_evidence
)
SELECT
    o.id,
    t.entity_type,
    t.title,
    t.description,
    t.sort_order,
    t.template_key,
    t.requirement_code,
    'control',
    t.outcome_key,
    t.stage,
    t.responsible_role,
    t.reviewer_role,
    t.criticality,
    t.weight,
    t.gate_effect,
    t.completion_criteria::jsonb,
    t.required_evidence::jsonb
FROM core.organizations o
CROSS JOIN (VALUES
    ('opportunity', 'Confirm decision makers', 'Identify the client decision maker, influencer, technical reviewer and procurement route.', 10, 'opportunity.qualification.decision_makers', 'OPP_QUAL_DECISION_MAKERS', 'decision_makers_confirmed', 'Qualification', 'CRM Associate', 'Commercial Manager', 'high', 8, 'blocking', '{"done_when":"Decision makers and procurement route are recorded."}', '["Contact notes or client confirmation"]'),
    ('opportunity', 'Validate scope and budget', 'Confirm scope, site constraints, budget range, expected award date and commercial fit before proposal work starts.', 20, 'opportunity.qualification.scope_budget', 'OPP_QUAL_SCOPE_BUDGET', 'scope_budget_validated', 'Qualification', 'CRM Associate', 'Commercial Manager', 'critical', 10, 'blocking', '{"done_when":"Scope, budget and timeline are validated or escalated."}', '["Client email, call note or meeting note"]'),
    ('opportunity', 'Record qualification outcome', 'Decide whether the opportunity is ready for proposal, needs more discovery, or should be closed out.', 30, 'opportunity.qualification.outcome', 'OPP_QUAL_OUTCOME', 'qualification_outcome_recorded', 'Qualification', 'Commercial Manager', 'Executive (Admin)', 'high', 8, 'blocking', '{"done_when":"Next stage decision and rationale are recorded."}', '["Qualification summary"]'),

    ('opportunity', 'Prepare proposal scope', 'Turn the qualified requirement into a clear proposal scope with exclusions, assumptions and deliverables.', 10, 'opportunity.quotation.scope', 'OPP_PROP_SCOPE', 'proposal_scope_prepared', 'Quotation', 'Quantity Surveyor', 'Commercial Manager', 'critical', 10, 'blocking', '{"done_when":"Proposal scope, exclusions and assumptions are ready for pricing."}', '["Proposal scope document"]'),
    ('opportunity', 'Build price and margin', 'Prepare rates, preliminaries, overheads, margin and risk allowances for commercial review.', 20, 'opportunity.quotation.price_margin', 'OPP_PROP_PRICE_MARGIN', 'price_margin_ready', 'Quotation', 'Quantity Surveyor', 'Commercial Manager', 'critical', 10, 'blocking', '{"done_when":"Priced proposal is ready for review."}', '["Quotation or pricing workbook"]'),
    ('opportunity', 'Submit proposal package', 'Send the approved proposal or quotation and log the submission evidence against the opportunity.', 30, 'opportunity.quotation.submit', 'OPP_PROP_SUBMIT', 'proposal_submitted', 'Quotation', 'CRM Associate', 'Commercial Manager', 'high', 9, 'blocking', '{"done_when":"Proposal is submitted and submission proof is attached."}', '["Sent email, portal receipt or delivery proof"]'),

    ('opportunity', 'Capture negotiation position', 'Record client objections, commercial gaps, revised scope, discount pressure and non-negotiables.', 10, 'opportunity.negotiation.position', 'OPP_NEG_POSITION', 'negotiation_position_captured', 'Negotiation', 'Commercial Manager', 'Executive (Admin)', 'high', 8, 'blocking', '{"done_when":"Negotiation position and decision limits are recorded."}', '["Negotiation note"]'),
    ('opportunity', 'Approve commercial concessions', 'Get approval for any discount, margin reduction, payment-term change or scope concession before committing.', 20, 'opportunity.negotiation.concessions', 'OPP_NEG_CONCESSIONS', 'concessions_approved', 'Negotiation', 'Commercial Manager', 'Executive (Admin)', 'critical', 10, 'blocking', '{"done_when":"Every concession has approval or is rejected."}', '["Approval note or revised quote"]'),
    ('opportunity', 'Secure final client decision', 'Push for final award/loss decision, record the decision path and move the opportunity to won or lost.', 30, 'opportunity.negotiation.final_decision', 'OPP_NEG_FINAL_DECISION', 'final_decision_secured', 'Negotiation', 'CRM Associate', 'Commercial Manager', 'critical', 10, 'blocking', '{"done_when":"Opportunity is ready to be marked won or lost."}', '["Client decision evidence"]')
) AS t(
    entity_type, title, description, sort_order, template_key, requirement_code,
    outcome_key, stage, responsible_role, reviewer_role, criticality, weight,
    gate_effect, completion_criteria, required_evidence
)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1
      FROM crm.task_templates existing
      WHERE existing.organization_id = o.id
        AND existing.entity_type = t.entity_type
        AND existing.template_key = t.template_key
        AND existing.template_version = 1
        AND existing.is_deleted = false
  );
