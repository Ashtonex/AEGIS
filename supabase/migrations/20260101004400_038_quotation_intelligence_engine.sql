-- =============================================================================
-- 038_quotation_intelligence_engine.sql
-- Quotation Intelligence Engine & Commercial Control Brain Schema
-- Stores assemblies, material recipes, rate intelligence benchmarks,
-- project commercial baselines, commercial guard audits, document changes,
-- and investigation cases with evidence packs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS finance.construction_assemblies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    assembly_code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    unit VARCHAR(20) NOT NULL DEFAULT 'm3',
    material_recipe JSONB NOT NULL DEFAULT '[]'::jsonb,
    labour_gang JSONB NOT NULL DEFAULT '[]'::jsonb,
    plant_needs JSONB NOT NULL DEFAULT '[]'::jsonb,
    subcontractor_benchmark_rate NUMERIC(14, 2) NOT NULL DEFAULT 0,
    wastage_tolerance_pct NUMERIC(5, 2) NOT NULL DEFAULT 5.0,
    output_rate_per_day NUMERIC(10, 2) NOT NULL DEFAULT 10.0,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS construction_assemblies_org_code_idx
    ON finance.construction_assemblies (organization_id, assembly_code)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS finance.rate_intelligence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    item_code VARCHAR(100) NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    unit VARCHAR(20) NOT NULL DEFAULT 'm',
    target_rate NUMERIC(14, 2) NOT NULL DEFAULT 0,
    supplier_rate NUMERIC(14, 2) NOT NULL DEFAULT 0,
    subcontractor_rate NUMERIC(14, 2) NOT NULL DEFAULT 0,
    last_po_rate NUMERIC(14, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    location VARCHAR(100) NOT NULL DEFAULT 'Harare',
    escalation_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rate_intelligence_org_item_idx
    ON finance.rate_intelligence (organization_id, item_code)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS finance.project_commercial_baselines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    quotation_id VARCHAR(100),
    project_id VARCHAR(100),
    project_title VARCHAR(255) NOT NULL,
    total_direct_costs NUMERIC(14, 2) NOT NULL DEFAULT 0,
    target_selling_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
    protected_margin_pct NUMERIC(5, 2) NOT NULL DEFAULT 15.0,
    worthiness_score INT NOT NULL DEFAULT 75,
    daily_cost_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
    weekly_cost_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
    monthly_cashflow JSONB NOT NULL DEFAULT '[]'::jsonb,
    material_schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
    labour_histogram JSONB NOT NULL DEFAULT '[]'::jsonb,
    margin_at_risk_curve JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance.commercial_guard_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id VARCHAR(100),
    requester_id VARCHAR(100) NOT NULL,
    requester_name VARCHAR(255) NOT NULL,
    document_type VARCHAR(50) NOT NULL,
    item_description TEXT NOT NULL,
    input_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    theoretical_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    variance_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'FLAGGED',
    anomaly_reason TEXT NOT NULL,
    evidence_pack JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance.document_change_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id VARCHAR(100),
    document_name VARCHAR(255) NOT NULL,
    revision VARCHAR(20) NOT NULL DEFAULT 'R1',
    change_type VARCHAR(50) NOT NULL,
    margin_impact_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    approval_level_required VARCHAR(50) NOT NULL DEFAULT 'MD',
    is_approved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance.investigation_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id VARCHAR(100),
    subject_employee_id VARCHAR(100) NOT NULL,
    employee_name VARCHAR(255) NOT NULL,
    risk_score INT NOT NULL DEFAULT 50,
    violation_count INT NOT NULL DEFAULT 1,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    summary TEXT NOT NULL,
    evidence_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
