-- Context-aware task engine
-- Extends crm.tasks from a flat task list into one task record with many
-- contextual views, source history, requirement identity and measurable
-- readiness contribution.

CREATE TABLE IF NOT EXISTS crm.task_pack_instances (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    entity_type          VARCHAR(60) NOT NULL,
    entity_id            UUID NOT NULL,
    stage                VARCHAR(120) NOT NULL,
    template_key         VARCHAR(160) NOT NULL,
    template_version     INTEGER NOT NULL DEFAULT 1,
    generation_reason    TEXT,
    status               VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'cancelled', 'superseded')),
    generated_by         UUID REFERENCES core.users(id),
    generated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted           BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, entity_type, entity_id, stage, template_key, template_version)
);

CREATE INDEX IF NOT EXISTS idx_task_pack_instances_entity
    ON crm.task_pack_instances (organization_id, entity_type, entity_id, status)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS crm.task_related_entities (
    task_id             UUID NOT NULL REFERENCES crm.tasks(id) ON DELETE CASCADE,
    entity_type         VARCHAR(60) NOT NULL,
    entity_id           UUID NOT NULL,
    relationship        VARCHAR(80) NOT NULL DEFAULT 'related',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, entity_type, entity_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_task_related_entities_lookup
    ON crm.task_related_entities (entity_type, entity_id);

ALTER TABLE crm.task_templates
    ADD COLUMN IF NOT EXISTS template_key VARCHAR(160),
    ADD COLUMN IF NOT EXISTS template_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS requirement_code VARCHAR(160),
    ADD COLUMN IF NOT EXISTS task_type VARCHAR(80) NOT NULL DEFAULT 'control',
    ADD COLUMN IF NOT EXISTS outcome_key VARCHAR(160),
    ADD COLUMN IF NOT EXISTS stage VARCHAR(120),
    ADD COLUMN IF NOT EXISTS reuse_scope VARCHAR(40) NOT NULL DEFAULT 'entity_specific'
        CHECK (reuse_scope IN (
            'organisation_wide_reusable', 'entity_specific', 'event_specific',
            'periodically_recurring', 'asset_and_project_specific',
            'person_and_project_specific'
        )),
    ADD COLUMN IF NOT EXISTS applicability_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS responsible_role VARCHAR(120),
    ADD COLUMN IF NOT EXISTS reviewer_role VARCHAR(120),
    ADD COLUMN IF NOT EXISTS approver_role VARCHAR(120),
    ADD COLUMN IF NOT EXISTS criticality VARCHAR(16) NOT NULL DEFAULT 'medium'
        CHECK (criticality IN ('critical', 'high', 'medium', 'low')),
    ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 5 CHECK (weight BETWEEN 1 AND 10),
    ADD COLUMN IF NOT EXISTS gate_effect VARCHAR(16) NOT NULL DEFAULT 'non_blocking'
        CHECK (gate_effect IN ('blocking', 'non_blocking')),
    ADD COLUMN IF NOT EXISTS completion_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS required_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS contribution_target JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE crm.task_templates
SET template_key = COALESCE(
        template_key,
        upper(regexp_replace(entity_type || '.' || COALESCE(requirement_code, title), '[^a-zA-Z0-9]+', '.', 'g'))
    ),
    requirement_code = COALESCE(
        requirement_code,
        upper(regexp_replace(title, '[^a-zA-Z0-9]+', '_', 'g'))
    )
WHERE template_key IS NULL OR requirement_code IS NULL;

ALTER TABLE crm.task_templates
    ALTER COLUMN template_key SET NOT NULL,
    ALTER COLUMN requirement_code SET NOT NULL;

ALTER TABLE crm.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE crm.tasks
    ADD CONSTRAINT tasks_status_check CHECK (status IN (
        'planned', 'not_started', 'ready', 'in_progress', 'waiting_on_third_party',
        'blocked', 'under_review', 'completed', 'rejected', 'not_applicable',
        'cancelled', 'superseded'
    ));

ALTER TABLE crm.tasks
    ADD COLUMN IF NOT EXISTS task_type VARCHAR(80) NOT NULL DEFAULT 'control',
    ADD COLUMN IF NOT EXISTS requirement_code VARCHAR(160),
    ADD COLUMN IF NOT EXISTS primary_entity_type VARCHAR(60),
    ADD COLUMN IF NOT EXISTS primary_entity_id UUID,
    ADD COLUMN IF NOT EXISTS related_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_event VARCHAR(160),
    ADD COLUMN IF NOT EXISTS source_event_id UUID,
    ADD COLUMN IF NOT EXISTS source_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS expected_outcome TEXT,
    ADD COLUMN IF NOT EXISTS template_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS deduplication_key TEXT,
    ADD COLUMN IF NOT EXISTS applicability_result VARCHAR(40) NOT NULL DEFAULT 'required'
        CHECK (applicability_result IN (
            'required', 'conditionally_required', 'optional',
            'not_applicable', 'already_satisfied'
        )),
    ADD COLUMN IF NOT EXISTS applicability_reason TEXT,
    ADD COLUMN IF NOT EXISTS responsible_role VARCHAR(120),
    ADD COLUMN IF NOT EXISTS accountable_role VARCHAR(120),
    ADD COLUMN IF NOT EXISTS reviewer_role VARCHAR(120),
    ADD COLUMN IF NOT EXISTS approver_role VARCHAR(120),
    ADD COLUMN IF NOT EXISTS criticality VARCHAR(16) NOT NULL DEFAULT 'medium'
        CHECK (criticality IN ('critical', 'high', 'medium', 'low')),
    ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 5 CHECK (weight BETWEEN 1 AND 10),
    ADD COLUMN IF NOT EXISTS gate_effect VARCHAR(16) NOT NULL DEFAULT 'non_blocking'
        CHECK (gate_effect IN ('blocking', 'non_blocking')),
    ADD COLUMN IF NOT EXISTS contribution_target_type VARCHAR(80),
    ADD COLUMN IF NOT EXISTS contribution_target_id UUID,
    ADD COLUMN IF NOT EXISTS contribution_target_field VARCHAR(160),
    ADD COLUMN IF NOT EXISTS contribution_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS completion_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS required_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS evidence_status VARCHAR(32) NOT NULL DEFAULT 'not_submitted'
        CHECK (evidence_status IN ('not_required', 'not_submitted', 'submitted', 'accepted', 'rejected', 'outdated')),
    ADD COLUMN IF NOT EXISTS review_status VARCHAR(32) NOT NULL DEFAULT 'not_submitted'
        CHECK (review_status IN ('not_required', 'not_submitted', 'submitted', 'accepted', 'rejected')),
    ADD COLUMN IF NOT EXISTS parent_pack_id UUID REFERENCES crm.task_pack_instances(id),
    ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES crm.tasks(id),
    ADD COLUMN IF NOT EXISTS generation_rule VARCHAR(160),
    ADD COLUMN IF NOT EXISTS reuse_scope VARCHAR(40) NOT NULL DEFAULT 'entity_specific',
    ADD COLUMN IF NOT EXISTS superseded_by_task_id UUID REFERENCES crm.tasks(id),
    ADD COLUMN IF NOT EXISTS merged_into_task_id UUID REFERENCES crm.tasks(id),
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
    ADD COLUMN IF NOT EXISTS cancellation_authorized_by UUID REFERENCES core.users(id);

UPDATE crm.tasks
SET primary_entity_type = COALESCE(primary_entity_type, entity_type),
    primary_entity_id = COALESCE(primary_entity_id, entity_id),
    requirement_code = COALESCE(
        requirement_code,
        CASE
            WHEN template_id IS NOT NULL THEN (
                SELECT tt.requirement_code FROM crm.task_templates tt WHERE tt.id = crm.tasks.template_id
            )
            ELSE upper(regexp_replace(title, '[^a-zA-Z0-9]+', '_', 'g'))
        END
    ),
    source_event = COALESCE(source_event, CASE WHEN source = 'template' THEN 'task_stack_generated' ELSE 'manual_task_created' END),
    expected_outcome = COALESCE(expected_outcome, outcome),
    deduplication_key = COALESCE(
        deduplication_key,
        CASE
            WHEN source = 'template' THEN
                COALESCE(entity_type, 'TASK') || ':' || COALESCE(entity_id::text, id::text) || '|' ||
                COALESCE(requirement_code, upper(regexp_replace(title, '[^a-zA-Z0-9]+', '_', 'g'))) || '|MAIN|V' ||
                COALESCE(template_version, 1)::text
            ELSE
                'LEGACY:' || id::text
        END
    )
WHERE primary_entity_type IS NULL
   OR primary_entity_id IS NULL
   OR requirement_code IS NULL
   OR deduplication_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_tasks_dedupe_active
    ON crm.tasks (organization_id, deduplication_key)
    WHERE is_deleted = false AND status NOT IN ('cancelled', 'superseded');

CREATE INDEX IF NOT EXISTS idx_crm_tasks_primary_context
    ON crm.tasks (organization_id, primary_entity_type, primary_entity_id)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_pack_outcome
    ON crm.tasks (organization_id, parent_pack_id, requirement_code, status)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_gate_weight
    ON crm.tasks (organization_id, primary_entity_type, primary_entity_id, gate_effect, criticality, status)
    WHERE is_deleted = false;
