"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { CalendarDropdown } from "@/components/layout/dashboard/CalendarDropdown";
import { NotificationBell } from "@/components/layout/dashboard/NotificationBell";
import { PwaPushButton } from "@/components/pwa/PwaPushButton";
import { getMyProfile, updateMyProfile, getMyPermissions } from "@/lib/api";
import { DashboardTour } from "@/components/onboarding/DashboardTour";
import { matchesRole } from "@/lib/rbacMatch";
import {
  Search, Bell, CircleHelp, User, LayoutDashboard, Briefcase,
  HardHat, Activity, Users, Truck, Wrench, ShoppingCart,
  Package, DollarSign, UserCheck, ShieldCheck, FileText,
  BarChart, PieChart, Settings, LogOut, ChevronDown, ChevronRight,
  Target, Handshake, Building2, BookOpen, Inbox, Zap, MapPin,
  LockKeyhole, ClipboardCheck, Calendar, Banknote, BookMarked, Receipt, BrainCircuit,
  Megaphone, Upload, LifeBuoy, Ticket, TrendingUp, Brain, Layers, Menu, X
} from "lucide-react";

type ModuleNavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  // Roles allowed to see this item, mirroring the allowedRoles already
  // passed to <RBACGuard> on the page it links to. Omit to leave the item
  // visible to everyone (matches pages with no RBACGuard today).
  allowedRoles?: string[];
  // Roles explicitly denied this item, on top of whatever allowedRoles
  // permits. For carving a narrow exception (e.g. one restricted role) out
  // of an item that's otherwise open to everyone, without having to convert
  // it into a full allow-list and enumerate every other role that currently
  // relies on the open-by-default behavior.
  restrictedRoles?: string[];
  // Permission key that also grants visibility, on top of allowedRoles -
  // backfilled from PAGE_ACCESS in imperium-api/routers/settings.py so a
  // brand-new self-service role (with no allowedRoles entry at all) still
  // gets this item once granted the matching permission. Undefined items
  // keep today's role-only gating unchanged.
  requiredPermission?: string;
};

type ModuleGroup = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  subItems: ModuleNavItem[];
  // Roles allowed to see the whole group. Harvested from the RBACGuard on
  // the group's root page - sub-items don't carry their own RBACGuard today
  // so this is the closest real signal for "who should see this module".
  allowedRoles?: string[];
  // See ModuleNavItem.restrictedRoles.
  restrictedRoles?: string[];
  // See ModuleNavItem.requiredPermission.
  requiredPermission?: string;
};

// Plain case-insensitive membership check for restrictedRoles. Deliberately
// not matchesRole - that helper always returns true for SUPERADMIN, which
// would make SUPERADMIN itself the one role a restrictedRoles entry could
// never actually restrict.
function isRoleRestricted(userRole: string, restrictedRoles?: string[]): boolean {
  if (!restrictedRoles || restrictedRoles.length === 0) return false;
  const normUser = userRole.toLowerCase().trim();
  return restrictedRoles.some((role) => role.toLowerCase().trim() === normUser);
}

const MODULE_GROUPS: ModuleGroup[] = [
  {
    name: "Executive",
    href: "/dashboard/executive",
    icon: LayoutDashboard,
    allowedRoles: ["Executive (Admin)"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "executive.view_dashboard",
    subItems: [{ name: "Overview", href: "/dashboard/executive", icon: LayoutDashboard, requiredPermission: "executive.view_dashboard" }],
  },
  {
    name: "Messages",
    href: "/dashboard/messages",
    icon: Inbox,
    restrictedRoles: ["CRM Associate"],
    subItems: [{ name: "Communication Ledger", href: "/dashboard/messages", icon: Inbox }],
  },
  {
    name: "Notifications",
    href: "/dashboard/notifications",
    icon: Bell,
    restrictedRoles: ["CRM Associate"],
    subItems: [{ name: "Notification Center", href: "/dashboard/notifications", icon: Bell }],
  },
  {
    name: "CRM",
    href: "/dashboard/crm",
    icon: Briefcase,
    // No group-level requiredPermission - unlike the single-page groups
    // below, CRM's subItems are gated individually (a self-service role
    // granted only crm_leads.read should still see Leads even without
    // crm.view_opportunities), matching how restrictedRoles already works
    // per-subitem here rather than on the group as a whole.
    subItems: [
      { name: "Commercial Command", href: "/dashboard/crm", icon: BarChart, restrictedRoles: ["CRM Associate"], requiredPermission: "crm.view_opportunities" },
      { name: "Leads", href: "/dashboard/crm/leads", icon: Target, requiredPermission: "crm_leads.read" },
      { name: "Opportunities", href: "/dashboard/crm/opportunities", icon: Briefcase, requiredPermission: "crm.view_opportunities" },
      { name: "Tenders & Bids", href: "/dashboard/crm/tenders", icon: Building2 },
      { name: "Organizations", href: "/dashboard/crm/organizations", icon: Handshake, restrictedRoles: ["CRM Associate"], requiredPermission: "crm_organizations.read" },
      { name: "Contacts", href: "/dashboard/crm/contacts", icon: Users, restrictedRoles: ["CRM Associate"], requiredPermission: "crm_contacts.read" },
      { name: "Subcontractors", href: "/dashboard/crm/subcontractors", icon: HardHat, restrictedRoles: ["CRM Associate"] },
      { name: "Activities", href: "/dashboard/crm/activities", icon: MapPin, restrictedRoles: ["CRM Associate"], requiredPermission: "crm_activities.read" },
      { name: "Documents", href: "/dashboard/crm/documents", icon: BookOpen, restrictedRoles: ["CRM Associate"], requiredPermission: "documents.read" },
      { name: "Sales Inbox", href: "/dashboard/crm/inbox", icon: Inbox, restrictedRoles: ["CRM Associate"], requiredPermission: "crm_communications.read" },
      { name: "Automations", href: "/dashboard/crm/automations", icon: Zap, restrictedRoles: ["CRM Associate"], requiredPermission: "crm_automations.read" },
      { name: "Marketing", href: "/dashboard/crm/marketing", icon: Megaphone, restrictedRoles: ["CRM Associate"] },
      { name: "Campaigns", href: "/dashboard/crm/campaigns", icon: TrendingUp, restrictedRoles: ["CRM Associate"], requiredPermission: "crm.marketing.read" },
      { name: "Segments", href: "/dashboard/crm/segments", icon: PieChart, restrictedRoles: ["CRM Associate"] },
      { name: "Templates", href: "/dashboard/crm/templates", icon: FileText, restrictedRoles: ["CRM Associate"] },
      { name: "Import & Export", href: "/dashboard/crm/import", icon: Upload, restrictedRoles: ["CRM Associate"], requiredPermission: "crm.import" },
      { name: "Support", href: "/dashboard/crm/support", icon: LifeBuoy, restrictedRoles: ["CRM Associate"], requiredPermission: "crm.support.read" },
      { name: "Tickets", href: "/dashboard/crm/tickets", icon: Ticket, restrictedRoles: ["CRM Associate"] },
      {
        name: "Reports",
        href: "/dashboard/crm/reports",
        icon: BarChart,
        allowedRoles: ["Executive (Admin)", "Project Manager", "Finance Manager", "Compliance Officer"],
        restrictedRoles: ["CRM Associate"],
        requiredPermission: "crm.reports.read",
      },
      { name: "Tasks", href: "/dashboard/crm/tasks", icon: ClipboardCheck },
      { name: "Teams", href: "/dashboard/crm/teams", icon: Users },
    ],
  },
  {
    name: "Estimating & Quotations",
    href: "/dashboard/quotations",
    icon: FileText,
    restrictedRoles: ["CRM Associate"],
    subItems: [
      { name: "Overview Dashboard", href: "/dashboard/quotations", icon: LayoutDashboard },
      { name: "Quotation Builder", href: "/dashboard/quotations/builder", icon: FileText },
      { name: "Commercial Control Brain", href: "/dashboard/quotations/ccb", icon: BrainCircuit },
      { name: "Intelligence Engine", href: "/dashboard/quotations/intelligence", icon: Brain },
      { name: "Drawing Takeoff", href: "/dashboard/quotations/drawings", icon: Layers },
      { name: "Export & History", href: "/dashboard/quotations/history", icon: BookOpen },
    ],
  },
  {
    name: "Projects",
    href: "/dashboard/projects",
    icon: HardHat,
    allowedRoles: ["Executive (Admin)", "Project Manager"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "projects.read",
    subItems: [
      { name: "Projects Command", href: "/dashboard/projects", icon: LayoutDashboard },
      { name: "Overview", href: "/dashboard/projects/overview", icon: LayoutDashboard },
      { name: "Schedule", href: "/dashboard/projects/schedule", icon: Activity },
      { name: "Financials", href: "/dashboard/projects/financials", icon: DollarSign },
      { name: "Materials", href: "/dashboard/projects/materials", icon: Package },
    ],
  },
  {
    name: "Site Operations",
    href: "/dashboard/site-operations",
    icon: Activity,
    allowedRoles: ["Executive (Admin)", "Project Manager", "Site Agent", "Site Clerk", "Storekeeper"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "site_operations.read",
    subItems: [{ name: "Daily Reports", href: "/dashboard/site-operations", icon: Activity }],
  },
  {
    name: "Workforce",
    href: "/dashboard/workforce",
    icon: Users,
    allowedRoles: ["Executive (Admin)", "HR Manager", "Project Manager"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "workforce.read",
    subItems: [{ name: "Overview", href: "/dashboard/workforce", icon: Users }],
  },
  {
    name: "Fleet",
    href: "/dashboard/fleet",
    icon: Truck,
    allowedRoles: ["Executive (Admin)", "Fleet Supervisor", "Fleet Clerk"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "fleet.read",
    subItems: [{ name: "Overview", href: "/dashboard/fleet", icon: Truck }],
  },
  {
    name: "Equipment",
    href: "/dashboard/equipment",
    icon: Wrench,
    allowedRoles: ["Executive (Admin)", "Fleet Supervisor", "Equipment Manager", "Site Manager"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "equipment_assets.read",
    subItems: [{ name: "Overview", href: "/dashboard/equipment", icon: Wrench }],
  },
  {
    name: "Procurement",
    href: "/dashboard/procurement",
    icon: ShoppingCart,
    allowedRoles: ["Executive (Admin)", "Procurement Manager", "Procurement Associate", "Project Manager", "Finance Manager", "Site Agent"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "procurement.requisition.read",
    subItems: [
      { name: "Procurement Pipeline", href: "/dashboard/procurement", icon: LayoutDashboard },
      { name: "Requisitions", href: "/dashboard/procurement/requisitions", icon: ClipboardCheck },
      { name: "RFQs", href: "/dashboard/procurement/rfqs", icon: Search },
      { name: "Purchase Orders", href: "/dashboard/procurement/purchase-orders", icon: ShoppingCart },
      { name: "Suppliers", href: "/dashboard/procurement/suppliers", icon: Package },
      { name: "Invoices", href: "/dashboard/procurement/invoices", icon: DollarSign },
    ],
  },
  {
    name: "Inventory",
    href: "/dashboard/inventory",
    icon: Package,
    allowedRoles: ["Executive (Admin)", "Project Manager", "Site Agent", "Site Clerk", "Quantity Surveyor", "Storekeeper", "Procurement Manager"],
    restrictedRoles: ["CRM Associate"],
    subItems: [
      { name: "Stock Management", href: "/dashboard/inventory", icon: LayoutDashboard },
      { name: "Stock Levels", href: "/dashboard/inventory/stock", icon: Package },
      { name: "Item Catalogue", href: "/dashboard/inventory/catalogue", icon: FileText },
      { name: "Stores", href: "/dashboard/inventory/stores", icon: Building2 },
      { name: "Movements", href: "/dashboard/inventory/movements", icon: Activity },
    ],
  },
  {
    name: "Finance",
    href: "/dashboard/finance",
    icon: DollarSign,
    allowedRoles: ["Executive (Admin)", "Project Manager", "Finance Manager", "Payroll Administrator", "Accounts Payable / Cash Officer", "Budget & Reporting Analyst"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "finance.cost.read",
    subItems: [
      { name: "Finance & Cost Control", href: "/dashboard/finance", icon: LayoutDashboard },
      { name: "Project Financials", href: "/dashboard/finance/project-financials", icon: DollarSign },
      { name: "Cost Codes", href: "/dashboard/finance/cost-codes", icon: FileText },
      { name: "Variations", href: "/dashboard/finance/variations", icon: BarChart },
      { name: "Progress Claims", href: "/dashboard/finance/progress-claims", icon: ClipboardCheck },
      { name: "Earned Value", href: "/dashboard/finance/earned-value", icon: TrendingUp },
      { name: "Close-Out", href: "/dashboard/finance/close-out", icon: ShieldCheck },
      { name: "Budgets", href: "/dashboard/finance/budgets", icon: PieChart },
      { name: "Banking & Cash", href: "/dashboard/finance/banking", icon: Banknote },
      { name: "Cashbook", href: "/dashboard/finance/cashbook", icon: BookMarked },
      { name: "Supplier Payments", href: "/dashboard/finance/supplier-payments", icon: Receipt },
      { name: "Payroll", href: "/dashboard/finance/payroll", icon: Users },
      { name: "Internal Transfers", href: "/dashboard/finance/transfers", icon: Receipt },
      { name: "Department P&L", href: "/dashboard/finance/department-pnl", icon: PieChart },
      { name: "Statutory", href: "/dashboard/finance/statutory", icon: ShieldCheck },
    ],
  },
  {
    name: "HR",
    href: "/dashboard/hr",
    icon: UserCheck,
    allowedRoles: ["Executive (Admin)", "Project Manager", "HR Officer", "HR Manager"],
    restrictedRoles: ["CRM Associate"],
    subItems: [
      { name: "HR & Workforce", href: "/dashboard/hr", icon: LayoutDashboard },
      { name: "Employee Register", href: "/dashboard/hr/employees", icon: Users },
      { name: "Attendance Log", href: "/dashboard/hr/attendance", icon: Calendar },
      { name: "Leave Management", href: "/dashboard/hr/leave", icon: UserCheck },
      { name: "Payroll", href: "/dashboard/hr/payroll", icon: Banknote },
    ],
  },
  {
    name: "Compliance",
    href: "/dashboard/compliance",
    icon: ShieldCheck,
    // HSE / Safety Officer added here alongside the landing-page migration
    // (083) that sends this role straight to /dashboard/compliance - this
    // role held zero nav access to any group before this fix, despite being
    // created specifically for HSE incident tracking (migration 066).
    allowedRoles: ["Executive (Admin)", "Compliance Officer", "Internal Auditor", "Project Manager", "HSE / Safety Officer"],
    restrictedRoles: ["CRM Associate"],
    subItems: [
      { name: "Compliance Overview", href: "/dashboard/compliance", icon: LayoutDashboard },
      { name: "Obligation Register", href: "/dashboard/compliance/obligations", icon: ShieldCheck },
      { name: "Employee Credentials", href: "/dashboard/compliance/employees", icon: Users },
      { name: "Equipment Licenses", href: "/dashboard/compliance/equipment", icon: Wrench },
      { name: "Deployment Gates", href: "/dashboard/compliance/deployment-gates", icon: LockKeyhole },
      { name: "Corrective Actions", href: "/dashboard/compliance/corrective-actions", icon: ClipboardCheck },
      { name: "HSE Incidents", href: "/dashboard/compliance/incidents", icon: Activity },
    ],
  },
  {
    name: "Client Portal",
    href: "/dashboard/client-portal",
    icon: LockKeyhole,
    restrictedRoles: ["CRM Associate"],
    subItems: [{ name: "Overview", href: "/dashboard/client-portal", icon: LockKeyhole }],
  },
  {
    name: "Documents",
    href: "/dashboard/documents",
    icon: FileText,
    allowedRoles: ["Executive (Admin)", "Project Manager", "Site Agent", "Compliance Officer", "Finance Manager"],
    restrictedRoles: ["CRM Associate"],
    subItems: [{ name: "Overview", href: "/dashboard/documents", icon: FileText }],
  },
  {
    name: "Reports",
    href: "/dashboard/reports",
    icon: BarChart,
    allowedRoles: ["Executive (Admin)", "Project Manager", "Finance Manager", "Compliance Officer"],
    restrictedRoles: ["CRM Associate"],
    subItems: [{ name: "Overview", href: "/dashboard/reports", icon: BarChart }],
  },
  {
    name: "Analytics",
    href: "/dashboard/analytics",
    icon: PieChart,
    allowedRoles: ["Executive (Admin)", "Project Manager", "Finance Manager"],
    restrictedRoles: ["CRM Associate"],
    subItems: [
      { name: "Analytics Overview", href: "/dashboard/analytics", icon: LayoutDashboard },
      { name: "Project Margin Trends", href: "/dashboard/analytics/projects", icon: BarChart },
      { name: "Fleet Productivity", href: "/dashboard/analytics/equipment", icon: Truck },
      { name: "Spend & Supplier SLA", href: "/dashboard/analytics/procurement", icon: ShoppingCart },
      { name: "Labour Allocation", href: "/dashboard/analytics/workforce", icon: Users },
    ],
  },
  {
    name: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
    restrictedRoles: ["CRM Associate"],
    subItems: [
      { name: "Settings Overview", href: "/dashboard/settings", icon: LayoutDashboard, requiredPermission: "settings.read" },
      // Configuration/Access Control/Account Setup/Website Content/Audit Log
      // previously had no role restriction at all - every logged-in employee
      // could open them (the underlying endpoints still enforced their own
      // permission checks, but the pages themselves weren't gated). Settings
      // Overview and My Profile stay open to everyone - general-purpose
      // pages, not administrative controls.
      { name: "Configuration", href: "/dashboard/settings/configuration", icon: Settings, allowedRoles: ["Executive (Admin)"] },
      { name: "Access Control", href: "/dashboard/settings/access", icon: LockKeyhole, allowedRoles: ["Executive (Admin)"] },
      { name: "Account Setup", href: "/dashboard/settings/accounts", icon: Building2, allowedRoles: ["Executive (Admin)"] },
      { name: "Website Content", href: "/dashboard/settings/website", icon: FileText, allowedRoles: ["Executive (Admin)"] },
      { name: "Audit Log", href: "/dashboard/settings/audit", icon: ShieldCheck, allowedRoles: ["Executive (Admin)"] },
      { name: "My Profile", href: "/dashboard/profile", icon: User },
    ],
  },
];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, role, isLoading, signOut } = useAuth();
  const [time, setTime] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [tourOpen, setTourOpen] = useState(false);
  const [tourReady, setTourReady] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Top bar auto-hide: visible on load, on scroll (either direction), or
  // while hovering the bar itself or a thin trigger strip at the very top
  // of the viewport; hides again after a short idle period. The bar is
  // fixed/overlaid rather than in normal flow specifically so showing or
  // hiding it never shifts or resizes the page content underneath.
  //
  // Desktop-only: the reveal mechanism is entirely hover-based (the bar
  // itself, plus a thin trigger strip at the top of the viewport), and
  // touch devices have no hover at all. On mobile the hamburger button
  // that opens the side nav drawer lives inside this same bar, so once it
  // auto-hid there - with no scrollable content to trigger the scroll
  // fallback, which is exactly the case on short pages - there was no way
  // to bring it back and both the top nav and side nav became unreachable.
  const [topBarVisible, setTopBarVisible] = useState(true);
  const [isDesktop, setIsDesktop] = useState(true);
  const topBarHoveredRef = useRef(false);
  const topBarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainScrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const scheduleTopBarHide = useCallback(() => {
    if (topBarHideTimerRef.current) clearTimeout(topBarHideTimerRef.current);
    if (!isDesktop) return;
    topBarHideTimerRef.current = setTimeout(() => {
      if (!topBarHoveredRef.current) setTopBarVisible(false);
    }, 2000);
  }, [isDesktop]);

  const revealTopBar = useCallback(() => {
    setTopBarVisible(true);
    scheduleTopBarHide();
  }, [scheduleTopBarHide]);

  useEffect(() => {
    scheduleTopBarHide();
    const mainEl = mainScrollRef.current;
    if (!mainEl) return;
    const onScroll = () => revealTopBar();
    mainEl.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      mainEl.removeEventListener("scroll", onScroll);
      if (topBarHideTimerRef.current) clearTimeout(topBarHideTimerRef.current);
    };
  }, [revealTopBar, scheduleTopBarHide]);

  // Extract user info from session
  const userEmail = session?.user?.email || "System User";
  // Create a display name from email (e.g., admin@example.com -> Admin)
  const displayName = userEmail.split('@')[0].charAt(0).toUpperCase() + userEmail.split('@')[0].slice(1);
  const userRole = role || "EMPLOYEE";

  // Resolved permission keys for the signed-in user, used to layer
  // requiredPermission checks on top of the existing role-based nav gates.
  // null = not loaded yet - treated as "no additional restriction" so
  // existing role-gated items don't flash hidden while this is in flight;
  // once loaded, items with a requiredPermission are gated strictly.
  const [permissions, setPermissions] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!session?.access_token) {
      setPermissions(null);
      return;
    }
    let cancelled = false;
    getMyPermissions()
      .then((res) => {
        if (!cancelled && res.success && Array.isArray(res.data)) setPermissions(new Set(res.data));
      })
      .catch(() => {
        // Leave permissions null on failure - falls back to role-only gating.
      });
    return () => { cancelled = true; };
  }, [session?.access_token]);

  const hasPermission = useCallback(
    (requiredPermission?: string) => !requiredPermission || !permissions || permissions.has(requiredPermission),
    [permissions]
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' }) + ' CAT');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const visibleGroups = useMemo(
    () =>
      MODULE_GROUPS.filter(
        (group) =>
          (!group.allowedRoles || matchesRole(userRole, group.allowedRoles)) &&
          !isRoleRestricted(userRole, group.restrictedRoles) &&
          hasPermission(group.requiredPermission)
      )
        .map((group) => ({
          ...group,
          subItems: group.subItems.filter(
            (sub) =>
              (!sub.allowedRoles || matchesRole(userRole, sub.allowedRoles)) &&
              !isRoleRestricted(userRole, sub.restrictedRoles) &&
              hasPermission(sub.requiredPermission)
          ),
        }))
        .filter((group) => group.subItems.length > 0),
    [userRole, hasPermission]
  );

  const activeGroup = useMemo(
    () => visibleGroups.find((group) => pathname === group.href || pathname?.startsWith(`${group.href}/`)) ?? null,
    [pathname, visibleGroups]
  );

  const tourStorageKey = session?.user?.id ? `aegis:onboarding:tour:${session.user.id}` : null;

  const closeTour = useCallback(() => {
    setTourOpen(false);
    if (tourStorageKey && typeof window !== "undefined") {
      window.localStorage.setItem(tourStorageKey, new Date().toISOString());
    }
  }, [tourStorageKey]);

  const openTour = useCallback(() => {
    setTourOpen(true);
  }, []);

  const completeTour = useCallback(async () => {
    const completedAt = new Date().toISOString();
    setTourOpen(false);
    if (tourStorageKey && typeof window !== "undefined") {
      window.localStorage.setItem(tourStorageKey, completedAt);
    }
    try {
      await updateMyProfile({ onboarding_completed_at: completedAt });
    } catch {
      // Local completion still prevents repeat prompts if the profile write fails.
    }
  }, [tourStorageKey]);

  useEffect(() => {
    if (!activeGroup) return;
    setOpenGroups((current) => ({ ...current, [activeGroup.name]: true }));
  }, [activeGroup]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!session || !pathname?.startsWith("/dashboard")) {
      setTourOpen(false);
      setTourReady(false);
      return;
    }

    let mounted = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await getMyProfile();
        const profile = response.data || {};
        const completed = Boolean(profile.onboarding_completed_at);
        const localCompleted = tourStorageKey ? Boolean(window.localStorage.getItem(tourStorageKey)) : false;
        if (mounted && !completed && !localCompleted) {
          setTourOpen(true);
        }
      } catch {
        const localCompleted = tourStorageKey ? Boolean(window.localStorage.getItem(tourStorageKey)) : false;
        if (mounted && !localCompleted) {
          setTourOpen(true);
        }
      } finally {
        if (mounted) {
          setTourReady(true);
        }
      }
    }, 700);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
    // Deliberately NOT keyed on pathname - DashboardShell mounts once per
    // session (it lives in the shared dashboard layout), so this should
    // check completion once, not re-fetch the profile and potentially
    // reopen the full-screen tour (which spotlights the sidebar itself) on
    // every single navigation, which is what was reading as "the whole nav
    // keeps reloading."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, tourStorageKey]);

  const renderNavGroups = () => (
    <>
      {visibleGroups.map((group) => {
        const isCurrent = pathname === group.href || pathname?.startsWith(`${group.href}/`);
        const isOpen = Boolean(openGroups[group.name] ?? isCurrent);

        return (
          <div key={group.name} className="mb-1">
            <button
              onClick={() => setOpenGroups((current) => ({ ...current, [group.name]: !isOpen }))}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                isCurrent ? "text-signal bg-signal/5" : "text-slate-light hover:text-paper hover:bg-ink-light"
              }`}
            >
              <div className="flex items-center space-x-3">
                <group.icon className={`w-4 h-4 ${isCurrent ? "text-signal" : "text-slate"}`} />
                <span>{group.name}</span>
              </div>
              {isOpen ? <ChevronDown className="w-4 h-4 text-slate" /> : <ChevronRight className="w-4 h-4 text-slate" />}
            </button>

            {isOpen && (
              <div className="mt-1 flex flex-col space-y-1 relative before:absolute before:left-5 before:top-0 before:bottom-0 before:w-px before:bg-ink-mid">
                {group.subItems.map((sub) => {
                  const isSubCurrent = pathname === sub.href || pathname?.startsWith(`${sub.href}/`);
                  return (
                    <Link
                      key={sub.name}
                      href={sub.href}
                      className={`flex items-center space-x-3 py-1.5 pl-10 pr-3 rounded-sm text-xs transition-colors relative ${
                        isSubCurrent
                          ? "text-paper bg-ink-light before:absolute before:left-[19px] before:top-1/2 before:-translate-y-1/2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-signal"
                          : "text-slate hover:text-paper hover:bg-ink-light/50"
                      }`}
                    >
                      <sub.icon className={`w-3.5 h-3.5 ${isSubCurrent ? "text-signal" : "text-slate-light"}`} />
                      <span>{sub.name}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  // Don't render dashboard chrome/content until the session check has
  // resolved. Rendering nothing here (instead of the full shell with
  // placeholder "System User" data) closes the window where protected
  // content could flash before AuthContext's redirect-to-/login fires.
  if (isLoading || !session) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-signal border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-dvh bg-ink flex flex-col font-sans selection:bg-signal selection:text-ink overflow-hidden">

      {/* Thin always-present strip at the very top of the viewport so hovering
          there can bring the top bar back even while it's hidden - the bar
          itself isn't there to hover over once translated out of view. */}
      <div
        className="fixed top-0 inset-x-0 h-2 z-40"
        onMouseEnter={revealTopBar}
      />

      {/* GLOBAL TOP NAVIGATION BAR - fixed/overlaid, not in normal flow, so
          hiding or showing it never shifts the page content beneath it. */}
      <header
        onMouseEnter={() => { topBarHoveredRef.current = true; revealTopBar(); }}
        onMouseLeave={() => { topBarHoveredRef.current = false; scheduleTopBarHide(); }}
        className={`fixed top-0 inset-x-0 h-14 border-b border-ink-mid bg-ink flex items-center justify-between px-6 z-50 shrink-0 transition-transform duration-300 ease-out ${
          // Mobile has no persistent sidebar - this bar (and the hamburger
          // inside it) is the only way to reach navigation there, so it must
          // never actually hide on mobile regardless of the desktop-only
          // auto-hide timer's state. scheduleTopBarHide() already skips
          // scheduling a hide on mobile, but that alone doesn't cover the
          // case where the bar was auto-hidden at desktop width and the
          // viewport is then narrowed below the breakpoint - this render-time
          // guard is the single source of truth so there's no state-timing
          // window where mobile navigation is unreachable.
          (topBarVisible || !isDesktop) ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <div className="flex items-center space-x-4 md:space-x-8">
          <button
            type="button"
            className="md:hidden text-slate hover:text-paper transition-colors p-1 -ml-1"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <Link href="/dashboard/executive" className="flex items-center space-x-3" aria-label="SNC Imperium dashboard">
            <Image
              src="/logo.png"
              alt="SNC Logo"
              width={72}
              height={48}
              className="h-11 w-auto object-contain"
            />
            <span className="font-display text-lg tracking-tight text-paper">IMPERIUM</span>
          </Link>
          
          <div className="relative group hidden md:block" data-tour="dashboard-search">
            <Search className="w-4 h-4 text-slate absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-signal transition-colors" />
            <input
              type="text"
              placeholder="Search Imperium..."
              className="bg-ink-light border border-ink-mid rounded-sm pl-10 pr-4 py-1.5 text-sm text-paper placeholder-slate focus:outline-none focus:border-signal/50 focus:ring-1 focus:ring-signal/50 transition-all w-64"
            />
          </div>
        </div>

        <div className="flex items-center space-x-3 md:space-x-6">
          <div className="hidden lg:flex items-center space-x-2 border-r border-ink-mid pr-6">
            <span className="w-2 h-2 rounded-full bg-signal animate-pulse-signal"></span>
            <span className="text-data-sm font-mono text-slate-light tracking-widest uppercase">Six Nine Construction</span>
          </div>

          <CalendarDropdown />
          <NotificationBell />
          <div className="hidden md:block">
            <PwaPushButton />
          </div>

          <button
            type="button"
            onClick={openTour}
            className="hidden md:inline-flex text-slate hover:text-paper transition-colors"
            title="Replay onboarding tour"
            aria-label="Replay onboarding tour"
          >
            <CircleHelp className="w-5 h-5" />
          </button>

          <div className="hidden lg:block font-mono text-data-sm text-slate-light tracking-widest">
            {time}
          </div>

          <div className="relative" ref={userMenuRef} data-tour="dashboard-profile">
            <button
              type="button"
              onClick={() => setUserMenuOpen((prev) => !prev)}
              className="flex items-center space-x-3 border-l border-ink-mid pl-6 cursor-pointer group focus:outline-none"
              aria-expanded={userMenuOpen}
              aria-haspopup="true"
            >
              <div className="text-right">
                <p className="text-sm font-medium text-paper group-hover:text-signal transition-colors">{displayName}</p>
                <p className="text-[10px] font-mono tracking-widest text-slate uppercase">{userRole}</p>
              </div>
              <div className="w-8 h-8 rounded-sm bg-ink-light border border-ink-mid flex items-center justify-center text-slate group-hover:border-signal/50 transition-colors relative">
                <User className="w-4 h-4" />
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-ink" title="Active Session" />
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-slate transition-transform duration-200 ${userMenuOpen ? "rotate-180 text-signal" : ""}`} />
            </button>

            {/* USER PROFILE DROPDOWN MENU */}
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-ink-light border border-white/10 rounded-sm shadow-2xl z-50 py-2 animate-in fade-in slide-in-from-top-2 duration-150">
                {/* User Identity Header */}
                <div className="px-4 py-3 border-b border-white/10">
                  <p className="text-xs font-semibold text-paper truncate">{userEmail}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="inline-block px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider bg-signal/10 text-signal border border-signal/30 rounded-xs font-bold">
                      {userRole}
                    </span>
                    <span className="text-[10px] font-mono text-slate-light">Six Nine Construction</span>
                  </div>
                </div>

                {/* Quick Navigation Links */}
                <div className="py-1">
                  <Link
                    href="/dashboard/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center space-x-2.5 px-4 py-2 text-xs text-slate-light hover:text-paper hover:bg-white/5 transition-colors"
                  >
                    <Settings className="w-4 h-4 text-slate" />
                    <span>System Settings &amp; Profile</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      openTour();
                    }}
                    className="w-full flex items-center space-x-2.5 px-4 py-2 text-xs text-slate-light hover:text-paper hover:bg-white/5 transition-colors text-left"
                  >
                    <CircleHelp className="w-4 h-4 text-slate" />
                    <span>Replay Onboarding Tour</span>
                  </button>
                </div>

                <div className="border-t border-white/10 my-1" />

                {/* LOG OUT BUTTON */}
                <div className="px-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      void signOut();
                    }}
                    className="w-full flex items-center space-x-2.5 px-3 py-2 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-950/40 border border-red-500/20 hover:border-red-500/40 rounded-sm transition-all"
                  >
                    <LogOut className="w-4 h-4 text-red-400" />
                    <span>Log Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* BODY CONFIGURATION */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* FIXED LEFT SIDEBAR (desktop) */}
        <aside className="hidden md:flex md:flex-col w-56 flex-shrink-0 border-r border-ink-mid bg-ink z-20">
          <nav className="flex-1 py-4 overflow-y-auto no-scrollbar flex flex-col px-3" data-tour="dashboard-nav">
            {renderNavGroups()}
          </nav>
        </aside>

        {/* MAIN CONTENT AREA */}
        <main ref={mainScrollRef} className="flex-1 overflow-auto bg-ink relative">
          {children}
        </main>
      </div>

      {/* MOBILE NAV DRAWER */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-ink-mid bg-ink flex flex-col">
            <nav className="flex-1 py-4 overflow-y-auto no-scrollbar flex flex-col px-3 pt-16">
              {renderNavGroups()}
            </nav>
          </aside>
        </div>
      )}

      <DashboardTour
        open={tourOpen && tourReady}
        onClose={closeTour}
        onComplete={completeTour}
      />
    </div>
  );
}
