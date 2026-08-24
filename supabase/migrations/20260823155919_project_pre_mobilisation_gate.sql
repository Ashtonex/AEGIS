-- ============================================================================
-- Project pre-mobilisation readiness gate
-- ============================================================================
-- A project must pass a formal readiness review before mobilisation / active
-- delivery starts. Deposit confirmation opens this gate; executive approval
-- closes it and records the mobilisation authorisation.

ALTER TABLE projects.project_profiles
    ADD COLUMN IF NOT EXISTS mobilisation_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS mobilisation_approved_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS mobilisation_authorisation_number VARCHAR(80),
    ADD COLUMN IF NOT EXISTS approved_mobilisation_date DATE,
    ADD COLUMN IF NOT EXISTS mobilisation_budget NUMERIC(15,2) CHECK (mobilisation_budget IS NULL OR mobilisation_budget >= 0),
    ADD COLUMN IF NOT EXISTS mobilisation_conditions TEXT,
    ADD COLUMN IF NOT EXISTS residual_risk_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_project_profiles_mobilisation_gate
    ON projects.project_profiles (organization_id, mobilisation_approved_at)
    WHERE mobilisation_approved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_checks_pre_mobilisation
    ON projects.project_checks (organization_id, project_id, status)
    WHERE check_type = 'pre_mobilisation';

INSERT INTO crm.task_templates (organization_id, entity_type, title, description, sort_order)
SELECT o.id, t.entity_type, t.title, t.description, t.sort_order
FROM core.organizations o
CROSS JOIN (VALUES
    ('project', 'Contract and award confirmation', 'Upload the signed contract, purchase order, letter of award or notice to proceed and confirm authority to start.', 10),
    ('project', 'Tender handover', 'Transfer the submitted tender, priced BOQ, clarifications, assumptions, exclusions, supplier quotations and commercial risks to delivery.', 20),
    ('project', 'Governance and appointments', 'Appoint project roles, record reporting lines, approval limits, responsibility matrix and contact directory.', 30),
    ('project', 'Technical readiness', 'Confirm AFC drawings, registers, RFIs, specifications, utilities, setting-out information and inspection requirements.', 40),
    ('project', 'Commercial baseline', 'Freeze the approved BOQ, cost codes, cost-loaded budget, cash flow, procurement budget and valuation calendar.', 50),
    ('project', 'Construction planning', 'Approve the execution plan, baseline programme, critical path, look-ahead plan, logistics and site establishment plan.', 60),
    ('project', 'Site due diligence', 'Capture existing conditions, access constraints, utilities, storage, security risks and client acknowledgement before site possession.', 70),
    ('project', 'Procurement and stores readiness', 'Set the procurement schedule, approved suppliers, requisition limits, store location, GRN and material custody procedures.', 80),
    ('project', 'Plant and equipment readiness', 'Approve plant requirements, allocation or hire decisions, certifications, operators, movement orders and fuel controls.', 90),
    ('project', 'Workforce readiness', 'Confirm labour schedule, employee records, competencies, induction, PPE, transport, accommodation, attendance and payroll rules.', 100),
    ('project', 'HSE and quality readiness', 'Approve HSE plan, risk assessments, method statements, permits, emergency plan, toolbox talks, PPE and quality controls.', 110),
    ('project', 'Finance readiness', 'Confirm project codes, budget loading, mobilisation funding, cash controls, payment controls, payroll allocation and insurance cover.', 120),
    ('project', 'Systems and records setup', 'Create the project workspace, registers, report templates, access permissions, backup and retention controls.', 130),
    ('project', 'Pre-mobilisation review', 'Complete the readiness review across all workstreams and record Risk Department opinion.', 140),
    ('project', 'Mobilisation authorisation', 'Issue the mobilisation order, authorisation number, approved date, budget, first-week plan and accepted residual risks.', 150)
) AS t(entity_type, title, description, sort_order)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM crm.task_templates existing
      WHERE existing.organization_id = o.id
        AND existing.entity_type = t.entity_type
        AND existing.title = t.title
        AND existing.is_deleted = false
  );
