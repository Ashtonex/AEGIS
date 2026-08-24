-- ============================================================================
-- Commercial pre-mobilisation readiness pack
-- ============================================================================
-- Commercial owns the contract, revenue, budget and entitlement before a
-- project can mobilise. This pack runs beside the existing project-wide
-- pre-mobilisation gate and gives Commercial an explicit stop/go decision.

ALTER TABLE projects.project_profiles
    ADD COLUMN IF NOT EXISTS commercial_readiness_status VARCHAR(32) NOT NULL DEFAULT 'not_started'
        CHECK (commercial_readiness_status IN ('not_started', 'in_progress', 'blocked', 'ready', 'cleared')),
    ADD COLUMN IF NOT EXISTS commercial_readiness_pack JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS commercial_readiness_blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS commercial_clearance_statement JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS commercial_cleared_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS commercial_cleared_by UUID REFERENCES core.users(id);

CREATE INDEX IF NOT EXISTS project_profiles_commercial_readiness_idx
    ON projects.project_profiles (organization_id, commercial_readiness_status, commercial_cleared_at)
    WHERE commercial_readiness_status <> 'cleared';

COMMENT ON COLUMN projects.project_profiles.commercial_readiness_pack IS
    'Commercial pre-mobilisation readiness checklist covering authority, contract review, handover, award reconciliation, baseline, cash flow, procurement, subcontracts, valuations, variations, claims, registers, reporting and clearance.';

COMMENT ON COLUMN projects.project_profiles.commercial_readiness_blockers IS
    'Current blockers preventing Commercial clearance to mobilise.';

COMMENT ON COLUMN projects.project_profiles.commercial_clearance_statement IS
    'Final commercial clearance: authority relied upon, contract value, baseline, margin, mobilisation budget, working-capital exposure, risks, exceptions and named owners.';

INSERT INTO core.permissions (key, description) VALUES
    ('projects.commercial_readiness.read', 'View project Commercial pre-mobilisation readiness pack'),
    ('projects.commercial_readiness.update', 'Update project Commercial pre-mobilisation readiness checks and blockers'),
    ('projects.commercial_readiness.clear', 'Issue Commercial clearance to mobilise')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'projects.commercial_readiness.read',
    'projects.commercial_readiness.update',
    'projects.commercial_readiness.clear',
    'projects.update',
    'crm_tasks.read',
    'crm_tasks.create',
    'crm_tasks.update',
    'documents.read',
    'documents.create',
    'documents.link'
)
WHERE r.name IN ('Commercial Manager', 'Contracts Manager', 'Quantity Surveyor', 'Executive (Admin)')
  AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'projects.commercial_readiness.read'
WHERE r.name IN ('Project Manager', 'Finance Manager', 'Tender / Bid Manager', 'Executive Read Only', 'External Auditor')
  AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO crm.task_templates (organization_id, entity_type, title, description, sort_order)
SELECT o.id, 'commercial_readiness', t.title, t.description, t.sort_order
FROM core.organizations o
CROSS JOIN (VALUES
    ('Contract document collection', 'Upload signed contract, purchase order, award letter or notice to proceed and flag missing or contradictory authority documents.', 10),
    ('Contract authority verification', 'Confirm client legal entity, authorised representative, project description, site, contract value, dates, site possession, conditions precedent, contract form and document precedence.', 20),
    ('Formal contract review', 'Extract contract sum, type, scope, programme, retention, payment cycle, tax, LDs, securities, insurance, notices, variation, EOT, suspension, termination and dispute procedures.', 30),
    ('Commercial risk assessment', 'Log adverse clauses, unpriced obligations, unlimited liabilities, penalties, design responsibility, escalation, ground-condition and client-delay risks with exposure, owner and decision required.', 40),
    ('Tender handover', 'Transfer final tender submission, priced BOQ, addenda, clarifications, exclusions, qualifications, discounts, provisional sums, prime-cost items, rates, quotations, preliminaries, margin and contingency assumptions.', 50),
    ('Award reconciliation', 'Compare tender against award for value, scope, quantities, rates, qualifications, new conditions, discounts, programme, retention, payment and penalties.', 60),
    ('Commercial baseline setup', 'Create cost codes, BOQ work packages, revenue baseline, direct/labour/material/plant/subcontract/prelim budgets, overhead recovery, contingency, risk allowances, approved margin and CVR structure.', 70),
    ('Cash-flow forecast', 'Forecast revenue, valuations, certificates, receipts, retention, labour, supplier, subcontractor, plant, fuel, mobilisation cost, peak working capital and delayed-payment/escalation scenarios.', 80),
    ('Procurement commercial plan', 'Extract BOQ requirements, critical packages, long-lead items, budget allowances, quotation validity, target dates, thresholds, approval limits, escalation exposure and committed-cost reporting.', 90),
    ('Subcontract package plan', 'Define subcontract scopes, gap analysis, budgets, enquiry documents, comparable quotations, evaluations, capability, compliance, insurance, agreements, retention, valuation and variation procedures.', 100),
    ('Measurement and valuation setup', 'Confirm measurement method, BOQ mapping, measurement sheets, joint measurement, quantity verification, material-on-site valuation, cut-off dates, certificate tracking, retention and final account structure.', 110),
    ('Variation control setup', 'Create variation register, instruction authority, notification deadlines, notice templates, quotation/approval workflow, evidence links, time/cost assessment and emergency-work procedure.', 120),
    ('Claims and notice setup', 'Create contractual notice calendar, early-warning notices, EOT process, loss-and-expense records, disruption evidence, late-information/drawing-delay tracking and owner assignment.', 130),
    ('Commercial register setup', 'Create contract, obligation, tender-assumption, risk, BOQ, budget, procurement package, commitment, subcontract, variation, instruction, claim, valuation, payment, retention, cost-to-complete and final-account registers.', 140),
    ('Commercial reporting setup', 'Configure weekly commercial report, monthly CVR, cash-flow forecast, risk register, commitments, actuals, variations, missing site records, over-budget packages, debt, retention and claims reporting.', 150),
    ('Commercial readiness review', 'Review authority, scope, contract risks, award reconciliation, handover, baseline, cash flow, procurement, subcontracts, valuations, variations, claims, reporting and unresolved exceptions.', 160),
    ('Commercial clearance', 'Issue clearance stating authority relied upon, contract value, baseline, margin, mobilisation budget, peak working capital, payment/retention conditions, risks, outstanding conditions, controls, owners and accepted executive exceptions.', 170)
) AS t(title, description, sort_order)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM crm.task_templates existing
      WHERE existing.organization_id = o.id
        AND existing.entity_type = 'commercial_readiness'
        AND existing.title = t.title
        AND existing.is_deleted = false
  );
