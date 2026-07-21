from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web"

MIGRATION = (ROOT / "migrations" / "033_system_notifications.sql").read_text(
    encoding="utf-8"
)
ROUTER = (ROOT / "routers" / "notifications.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
EVENTS = (ROOT / "app" / "shared" / "events.py").read_text(encoding="utf-8")
WEB_API = (WEB_ROOT / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
DASHBOARD_SHELL = (
    WEB_ROOT / "src" / "app" / "dashboard" / "DashboardShell.tsx"
).read_text(encoding="utf-8")
NOTIFICATION_BELL = (
    WEB_ROOT / "src" / "components" / "layout" / "dashboard" / "NotificationBell.tsx"
).read_text(encoding="utf-8")
NOTIFICATIONS_PAGE = (
    WEB_ROOT / "src" / "app" / "dashboard" / "notifications" / "page.tsx"
).read_text(encoding="utf-8")


class NotificationsContractTests(unittest.TestCase):
    def test_migration_hardens_notification_center(self):
        self.assertIn("ALTER TABLE core.notifications", MIGRATION)
        self.assertIn("notification_type", MIGRATION)
        self.assertIn("priority", MIGRATION)
        self.assertIn("action_url", MIGRATION)
        self.assertIn("metadata JSONB", MIGRATION)
        self.assertIn("read_at", MIGRATION)
        self.assertIn("notifications_user_unread_idx", MIGRATION)
        self.assertIn("FOR ALL TO service_role", MIGRATION)

    def test_router_is_registered_and_scoped_to_current_user(self):
        self.assertIn("notifications", MAIN)
        self.assertIn('prefix="/api/v1/notifications"', MAIN)
        self.assertIn("@router.get(\"/\")", ROUTER)
        self.assertIn("@router.get(\"/summary\")", ROUTER)
        self.assertIn("@router.patch(\"/{notification_id}/read\")", ROUTER)
        self.assertIn("@router.patch(\"/read-all\")", ROUTER)
        self.assertIn("AND user_id = :user_id", ROUTER)

    def test_domain_event_helpers_can_emit_notifications(self):
        self.assertIn("async def emit_notification", EVENTS)
        self.assertIn("async def emit_role_notification", EVENTS)
        self.assertIn("notification_type", EVENTS)
        self.assertIn("action_url", EVENTS)

    def test_frontend_has_live_bell_and_notifications_page(self):
        self.assertIn("getNotifications", WEB_API)
        self.assertIn("markNotificationRead", WEB_API)
        self.assertIn("markAllNotificationsRead", WEB_API)
        self.assertIn("useNotifications", NOTIFICATION_BELL)
        self.assertIn("NotificationBell", DASHBOARD_SHELL)
        self.assertIn("/dashboard/notifications", DASHBOARD_SHELL)
        self.assertIn("markAllRead", NOTIFICATIONS_PAGE)


if __name__ == "__main__":
    unittest.main()
