-- ============================================================================
-- CCB AUTOMATED MONITORING — open/resolved-lifecycle findings from background
-- checks (budget vs BOQ/actual-cost drift, requisitions breaching budget,
-- stale client variance approvals), as opposed to finance.commercial_guard_audits
-- and finance.document_change_logs which are point-in-time records of a human
-- manually running a CCB tool. Deliberately a separate table: those two answer
-- "what did someone check," this one answers "what is still an open problem
-- right now" - conflating the two loses that distinction.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.ccb_monitor_findings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id        UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    check_type        VARCHAR(40) NOT NULL
        CHECK (check_type IN ('budget_boq_overrun', 'requisition_budget_breach', 'variance_stale_approval')),
    -- project_id + check_type + subject (boq line / requisition / change-log id) -
    -- the UPSERT key that lets a repeated run update an existing open finding
    -- instead of creating a duplicate every time the check fires.
    natural_key       VARCHAR(255) NOT NULL,
    severity          VARCHAR(20) NOT NULL DEFAULT 'medium'
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status            VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'resolved')),
    summary           TEXT NOT NULL,
    evidence          JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at       TIMESTAMPTZ,
    resolved_by       UUID REFERENCES core.users(id),
    last_notified_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted        BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, natural_key)
);

CREATE INDEX IF NOT EXISTS ccb_monitor_findings_project_status_idx
    ON finance.ccb_monitor_findings (organization_id, project_id, status)
    WHERE is_deleted = false;

ALTER TABLE finance.ccb_monitor_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.ccb_monitor_findings FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.ccb_monitor_findings FROM anon, authenticated;

DROP POLICY IF EXISTS "CCB monitor findings service role only" ON finance.ccb_monitor_findings;
CREATE POLICY "CCB monitor findings service role only" ON finance.ccb_monitor_findings
    FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('finance.ccb_findings.read',    'View automated CCB monitoring findings'),
    ('finance.ccb_findings.resolve', 'Acknowledge or resolve automated CCB monitoring findings')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)',  'finance.ccb_findings.read'),
    ('Executive (Admin)',  'finance.ccb_findings.resolve'),
    ('Finance Manager',    'finance.ccb_findings.read'),
    ('Finance Manager',    'finance.ccb_findings.resolve'),
    ('Project Manager',    'finance.ccb_findings.read'),
    ('Project Manager',    'finance.ccb_findings.resolve')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_audit_ccb_monitor_findings ON finance.ccb_monitor_findings;
CREATE TRIGGER trg_audit_ccb_monitor_findings
AFTER INSERT OR UPDATE OR DELETE ON finance.ccb_monitor_findings
FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
