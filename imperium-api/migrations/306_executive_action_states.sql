-- Executive "Needs you" list (Phase 2 of the executive dashboard overhaul).
--
-- The list itself is computed on every read from the source modules
-- (approvals, exceptions, site problems), so an item closes by itself once its
-- underlying condition is fixed. This table only keeps what an executive did
-- with an item: who it is assigned to, a snooze date, or a dismissal.
--
-- item_key is the stable key GET /executive/needs-you gives each item.
-- signature is the set of source ids (or site flag codes) the item had when it
-- was snoozed or dismissed; something new under the same item (another site
-- report, a new site problem) brings it back.

CREATE TABLE IF NOT EXISTS core.executive_action_states (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    item_key         VARCHAR(300) NOT NULL,
    -- 'open', 'snoozed', 'dismissed'
    status           VARCHAR(20) NOT NULL DEFAULT 'open',
    signature        TEXT[] NOT NULL DEFAULT '{}',
    snoozed_until    DATE,
    assigned_to      UUID REFERENCES core.users(id) ON DELETE SET NULL,
    assigned_by      UUID REFERENCES core.users(id) ON DELETE SET NULL,
    assigned_at      TIMESTAMPTZ,
    note             TEXT,
    title            TEXT,
    updated_by       UUID REFERENCES core.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT executive_action_states_unique UNIQUE (organization_id, item_key),
    CONSTRAINT executive_action_states_status_chk
        CHECK (status IN ('open', 'snoozed', 'dismissed')),
    CONSTRAINT executive_action_states_snooze_chk
        CHECK (status <> 'snoozed' OR snoozed_until IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_executive_action_states_assignee
    ON core.executive_action_states (organization_id, assigned_to)
    WHERE assigned_to IS NOT NULL;

DO $$
BEGIN
    ALTER TABLE core.executive_action_states ENABLE ROW LEVEL SECURITY;
    ALTER TABLE core.executive_action_states FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON core.executive_action_states FROM anon, authenticated;
    DROP POLICY IF EXISTS "Core service role only" ON core.executive_action_states;
    CREATE POLICY "Core service role only" ON core.executive_action_states
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    DROP TRIGGER IF EXISTS trg_audit_executive_action_states ON core.executive_action_states;
    CREATE TRIGGER trg_audit_executive_action_states
        AFTER INSERT OR UPDATE OR DELETE ON core.executive_action_states
        FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
    -- Live: another executive's assign/snooze/dismiss shows up straight away.
    DROP TRIGGER IF EXISTS live_change_notify ON core.executive_action_states;
    CREATE TRIGGER live_change_notify
        AFTER INSERT OR UPDATE OR DELETE ON core.executive_action_states
        FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();
END $$;

-- Two exception sources of the list had no live trigger yet. Events carry
-- ids only (core.notify_table_change), never row content.
DO $$
DECLARE
  target text;
  targets text[] := ARRAY[
    'fleet.plant_incidents',
    'procurement.material_requests'
  ];
BEGIN
  FOREACH target IN ARRAY targets LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS live_change_notify ON %s', target);
    EXECUTE format(
      'CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION core.notify_table_change()',
      target
    );
  END LOOP;
END $$;
