-- Phase 1 of live-push updates: notify the backend the instant a row is
-- inserted into core.notifications, so it can relay to the recipient's open
-- WebSocket connection(s) without them ever polling or refreshing.
--
-- Deliberately implemented as plain Postgres LISTEN/NOTIFY rather than
-- Supabase's separate Realtime service: the backend is the only subscriber,
-- authenticated with its own DB credentials, and re-broadcasts to browser
-- clients only after applying the same permission checks every REST
-- endpoint already uses. A client subscribing directly to Supabase Realtime
-- would only be bound by Postgres RLS, which isolates by organization but
-- not by the app's finer-grained role permissions - this keeps a single
-- source of truth for authorization instead of two that can drift apart.

CREATE OR REPLACE FUNCTION core.notify_new_notification() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'notifications_channel',
    json_build_object(
      'id', NEW.id,
      'organization_id', NEW.organization_id,
      'user_id', NEW.user_id,
      'title', NEW.title,
      'message', NEW.message,
      'notification_type', NEW.notification_type,
      'priority', NEW.priority,
      'action_url', NEW.action_url,
      'created_at', NEW.created_at
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_notify_trigger ON core.notifications;
CREATE TRIGGER notifications_notify_trigger
AFTER INSERT ON core.notifications
FOR EACH ROW EXECUTE FUNCTION core.notify_new_notification();
