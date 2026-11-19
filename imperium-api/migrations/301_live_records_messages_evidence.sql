-- Live push for the Messages page and daily-report evidence.
--
-- Both tables reuse core.notify_table_change() (migration 075), which sends
-- {table, op, organization_id, id} on the 'live_changes' channel. For these
-- two tables the API loads the row once per worker and pushes it whole, so
-- other people's screens update without a refetch (see core/live_records.py).
--
-- core.document_links gets a trigger only for daily-report links. Other link
-- types (tenders, opportunities, projects) have no live consumer yet, and
-- skipping them keeps bulk link writes off the channel. Soft deletes are
-- UPDATEs, so INSERT OR UPDATE covers removals too.

ALTER TABLE core.file_attachments
    ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;

COMMENT ON COLUMN core.file_attachments.thumbnail_path IS
    'Small JPEG preview the uploading browser made, stored next to the original in the same bucket. NULL for files without one.';

DROP TRIGGER IF EXISTS live_change_notify ON crm.communication_events;
CREATE TRIGGER live_change_notify
    AFTER INSERT OR UPDATE OR DELETE ON crm.communication_events
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();

DROP TRIGGER IF EXISTS live_change_notify ON core.document_links;
CREATE TRIGGER live_change_notify
    AFTER INSERT OR UPDATE ON core.document_links
    FOR EACH ROW
    WHEN (NEW.entity_type = 'daily_site_report')
    EXECUTE FUNCTION core.notify_table_change();
