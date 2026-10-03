from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web" / "src"

DASHBOARD_SHELL = (WEB_ROOT / "app" / "dashboard" / "DashboardShell.tsx").read_text(
    encoding="utf-8"
)
# The sidebar group renderer was extracted out of DashboardShell.tsx into a
# memoized component so that the shell's per-second clock stops re-rendering
# every nav link once a second. The render-side assertions below therefore
# read this file, while the group *data* assertions still read the shell.
SHELL_NAV_GROUPS = (
    WEB_ROOT / "components" / "shell" / "ShellNavGroups.tsx"
).read_text(encoding="utf-8")
PORTAL_LAYOUT = (WEB_ROOT / "app" / "portal" / "layout.tsx").read_text(encoding="utf-8")
NAVIGATION_WRAPPER = (WEB_ROOT / "components" / "layout" / "NavigationWrapper.tsx").read_text(
    encoding="utf-8"
)
NOTIFICATION_BELL = (
    WEB_ROOT / "components" / "layout" / "dashboard" / "NotificationBell.tsx"
).read_text(encoding="utf-8")
MODULE_PAGES_WITH_SIDENAV_ONLY = [
    path.read_text(encoding="utf-8")
    for path in [
        WEB_ROOT / "app" / "dashboard" / "analytics" / "page.tsx",
        WEB_ROOT / "app" / "dashboard" / "compliance" / "page.tsx",
        WEB_ROOT / "app" / "dashboard" / "finance" / "page.tsx",
        WEB_ROOT / "app" / "dashboard" / "hr" / "page.tsx",
        WEB_ROOT / "app" / "dashboard" / "inventory" / "page.tsx",
        WEB_ROOT / "app" / "dashboard" / "procurement" / "page.tsx",
        WEB_ROOT / "app" / "dashboard" / "settings" / "page.tsx",
    ]
]


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

    def test_single_destination_groups_render_as_direct_links(self):
        self.assertIn("directLink?: boolean", SHELL_NAV_GROUPS)
        for name in ("Executive", "Messages", "Notifications"):
            group_start = DASHBOARD_SHELL.index(f'name: "{name}"')
            group_end = DASHBOARD_SHELL.index("subItems:", group_start)
            self.assertIn("directLink: true", DASHBOARD_SHELL[group_start:group_end])
        self.assertIn("if (group.directLink)", SHELL_NAV_GROUPS)
        self.assertIn("href={group.href}", SHELL_NAV_GROUPS)

    def test_nav_group_renderer_is_memoized_away_from_the_clock(self):
        """The shell used to hold a `setInterval(updateTime, 1000)` in the same
        component that rendered all 149 sidebar links, so the whole navigation
        tree re-rendered once a second for as long as a dashboard tab was open.
        The clock and the group renderer must stay in separate components, and
        the renderer must stay memoized."""
        self.assertIn("memo(", SHELL_NAV_GROUPS)
        self.assertNotIn("setInterval", DASHBOARD_SHELL)
        self.assertNotIn("setInterval", SHELL_NAV_GROUPS)

    def test_module_pages_do_not_render_duplicate_horizontal_navigation(self):
        for source in MODULE_PAGES_WITH_SIDENAV_ONLY:
            self.assertNotIn('from "next/link"', source)
            self.assertNotIn("data-tour=\"finance-tabs\"", source)
            self.assertNotIn("{/* Module bar */}", source)
            self.assertNotIn("{/* Tabs */}", source)


if __name__ == "__main__":
    unittest.main()
