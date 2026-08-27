from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web" / "src"

DASHBOARD_SHELL = (WEB_ROOT / "app" / "dashboard" / "DashboardShell.tsx").read_text(
    encoding="utf-8"
)
PORTAL_LAYOUT = (WEB_ROOT / "app" / "portal" / "layout.tsx").read_text(encoding="utf-8")
NAVIGATION_WRAPPER = (WEB_ROOT / "components" / "layout" / "NavigationWrapper.tsx").read_text(
    encoding="utf-8"
)
NOTIFICATION_BELL = (
    WEB_ROOT / "components" / "layout" / "dashboard" / "NotificationBell.tsx"
).read_text(encoding="utf-8")


class SystemShellRenderContractTests(unittest.TestCase):
    def test_portal_routes_use_system_shell_not_public_navigation(self):
        self.assertIn('pathname?.startsWith(\'/portal\')', NAVIGATION_WRAPPER)
        self.assertIn('import DashboardShell from "@/app/dashboard/DashboardShell"', PORTAL_LAYOUT)
        self.assertIn("<DashboardShell>{children}</DashboardShell>", PORTAL_LAYOUT)
        self.assertIn('const isPortalRoute = pathname?.startsWith("/portal") ?? false;', DASHBOARD_SHELL)
        self.assertIn('href={isPortalRoute ? portalHome.href : "/dashboard/executive"}', DASHBOARD_SHELL)

    def test_portal_sidebar_is_limited_to_the_current_portal_workspace(self):
        self.assertIn('if (pathname?.startsWith("/portal/client"))', DASHBOARD_SHELL)
        self.assertIn('if (pathname?.startsWith("/portal/supplier"))', DASHBOARD_SHELL)
        self.assertIn('if (pathname?.startsWith("/portal/foreman"))', DASHBOARD_SHELL)
        self.assertIn("if (isPortalRoute) return portalGroups;", DASHBOARD_SHELL)
        self.assertIn('subItems: [{ name: "Workspace", href: portalHome.href, icon: portalHome.icon }]', DASHBOARD_SHELL)

    def test_superadmin_sidebar_is_not_collapsed_by_field_role_filter(self):
        self.assertIn("function isExactRole(userRole: string, roles: string[]): boolean", DASHBOARD_SHELL)
        self.assertIn("function isSuperAdminRole(userRole: string): boolean", DASHBOARD_SHELL)
        self.assertIn("const isSiteFieldRole = isExactRole(userRole, SITE_FIELD_ROLES);", DASHBOARD_SHELL)
        self.assertNotIn("const isSiteFieldRole = matchesRole(userRole, SITE_FIELD_ROLES);", DASHBOARD_SHELL)
        self.assertIn("isSuperAdminRole(userRole) || !requiredPermission", DASHBOARD_SHELL)

    def test_top_nav_and_mobile_drawer_have_non_overlapping_layout(self):
        self.assertIn('className="fixed top-0 inset-x-0 h-14', DASHBOARD_SHELL)
        self.assertIn('className="box-border flex h-full min-h-0 overflow-hidden pt-14"', DASHBOARD_SHELL)
        self.assertIn('className="fixed inset-0 z-[60] md:hidden"', DASHBOARD_SHELL)
        self.assertIn('w-[min(20rem,88vw)]', DASHBOARD_SHELL)
        self.assertIn('hidden min-w-0 text-right sm:block', DASHBOARD_SHELL)
        self.assertIn('hidden sm:block', DASHBOARD_SHELL)
        self.assertIn('w-[min(360px,calc(100vw-1rem))]', NOTIFICATION_BELL)


if __name__ == "__main__":
    unittest.main()
