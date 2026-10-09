import type { ComponentType } from "react";
import {
  LayoutDashboard, Briefcase, HardHat, Activity, Users, Truck, Wrench,
  ShoppingCart, Package, DollarSign, UserCheck, ShieldCheck, FileText,
  BarChart, PieChart, Settings, Target, Handshake, Building2, BookOpen,
  Inbox, Zap, MapPin, LockKeyhole, ClipboardCheck, Calendar, Banknote,
  BookMarked, Receipt, BrainCircuit, Megaphone, Upload, LifeBuoy, Ticket,
  TrendingUp, Brain, Layers, Scale, Bot, FileSearch, Bell, User, Search,
  Gauge,
} from "lucide-react";

/** One permission key, or several where holding ANY of them is enough. */
export type PermissionRequirement = string | string[];

export type ModuleNavItem = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  // Permission that grants this item. Falls back to the group's
  // requiredPermission; with neither, every signed-in user sees it.
  // Access is permission-driven only: grant or revoke it per role in
  // Settings > Access Control, no code change needed.
  requiredPermission?: PermissionRequirement;
};

// The 8 top-level business domains the sidebar groups into (see
// DOMAIN_META below). Executive and Finance are single-group domains that
// render as a flat top-level entry, same as before this domain layer
// existed - only multi-group domains (commercial, delivery, supply,
// assets, people, governance) actually introduce a new nesting level.
export type DomainKey =
  | "executive"
  | "commercial"
  | "delivery"
  | "supply"
  | "assets"
  | "people"
  | "finance"
  | "governance";

export type ModuleGroup = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  subItems: ModuleNavItem[];
  directLink?: boolean;
  // Default permission for sub-items that don't set their own. A group is
  // shown whenever at least one of its sub-items is visible.
  requiredPermission?: PermissionRequirement;
  // Which top-level domain this group nests under in the sidebar (see
  // DOMAIN_META). Omit for the two pinned utility links (Messages,
  // Notifications) that stay outside the domain structure entirely,
  // rendered flat above it - the same as they always have been.
  domain?: DomainKey;
};

// Per-domain label/icon/accent, carried through the sidebar's domain
// header, the active-state highlight, and (via getDomainForPathname) the
// DashboardPageHeader accent and page background on every route under that
// domain - so a user can tell which domain they're in before reading a
// word, per the audit's "give each domain a colour and icon identity"
// item. Colors are deliberately distinct hues from the base --dxl-signal
// amber (used only for the generic "active" state and Executive, which has
// no sibling groups to distinguish itself from).
// Every class string here must appear literally (Tailwind's JIT scanner
// greps raw file text - it can't see classes assembled at runtime via
// string concatenation/replace, e.g. `border-${accent}` or
// `"border-x".replace("x","t-")` silently produce a class that was never
// compiled). Keep a distinct literal per domain per usage site instead.
export const DOMAIN_META: Record<
  DomainKey,
  {
    label: string;
    icon: ComponentType<{ className?: string }>;
    accentClass: string;
    accentBgClass: string;
    accentBorderClass: string;
    accentTopBorderClass: string;
  }
> = {
  executive: { label: "Executive", icon: LayoutDashboard, accentClass: "text-signal", accentBgClass: "bg-signal/10", accentBorderClass: "border-signal/30", accentTopBorderClass: "border-t-signal/30" },
  commercial: { label: "Commercial", icon: Briefcase, accentClass: "text-sky-400", accentBgClass: "bg-sky-400/10", accentBorderClass: "border-sky-400/30", accentTopBorderClass: "border-t-sky-400/30" },
  delivery: { label: "Delivery", icon: HardHat, accentClass: "text-amber-400", accentBgClass: "bg-amber-400/10", accentBorderClass: "border-amber-400/30", accentTopBorderClass: "border-t-amber-400/30" },
  supply: { label: "Supply", icon: ShoppingCart, accentClass: "text-emerald-400", accentBgClass: "bg-emerald-400/10", accentBorderClass: "border-emerald-400/30", accentTopBorderClass: "border-t-emerald-400/30" },
  assets: { label: "Assets", icon: Truck, accentClass: "text-orange-400", accentBgClass: "bg-orange-400/10", accentBorderClass: "border-orange-400/30", accentTopBorderClass: "border-t-orange-400/30" },
  people: { label: "People", icon: UserCheck, accentClass: "text-violet-400", accentBgClass: "bg-violet-400/10", accentBorderClass: "border-violet-400/30", accentTopBorderClass: "border-t-violet-400/30" },
  finance: { label: "Finance", icon: DollarSign, accentClass: "text-lime-400", accentBgClass: "bg-lime-400/10", accentBorderClass: "border-lime-400/30", accentTopBorderClass: "border-t-lime-400/30" },
  governance: { label: "Governance", icon: ShieldCheck, accentClass: "text-rose-400", accentBgClass: "bg-rose-400/10", accentBorderClass: "border-rose-400/30", accentTopBorderClass: "border-t-rose-400/30" },
};

export const DOMAIN_ORDER: DomainKey[] = [
  "executive", "commercial", "delivery", "supply", "assets", "people", "finance", "governance",
];

// Every page's access is decided by permission keys alone, so assigning a
// role (built-in or custom) gives that user exactly the pages its
// permissions cover - no role names are hard-coded here. Each key below is
// the permission the page's own primary data endpoint already enforces, so
// the sidebar never shows a page whose data would then be refused.
export const MODULE_GROUPS: ModuleGroup[] = [
  {
    name: "Executive",
    href: "/dashboard/executive",
    icon: LayoutDashboard,
    domain: "executive",
    requiredPermission: "executive.view_dashboard",
    directLink: true,
    subItems: [{ name: "Overview", href: "/dashboard/executive", icon: LayoutDashboard }],
  },
  {
    name: "Messages",
    href: "/dashboard/messages",
    icon: Inbox,
    requiredPermission: "internal_messages.read",
    directLink: true,
    subItems: [{ name: "Communication Ledger", href: "/dashboard/messages", icon: Inbox }],
  },
  {
    name: "Notifications",
    href: "/dashboard/notifications",
    icon: Bell,
    directLink: true,
    subItems: [{ name: "Notification Center", href: "/dashboard/notifications", icon: Bell }],
  },
  {
    name: "CRM",
    href: "/dashboard/crm",
    icon: Briefcase,
    domain: "commercial",
    subItems: [
      { name: "Commercial Command", href: "/dashboard/crm", icon: BarChart, requiredPermission: "crm.view_opportunities" },
      { name: "Leads", href: "/dashboard/crm/leads", icon: Target, requiredPermission: "crm_leads.read" },
      { name: "Opportunities", href: "/dashboard/crm/opportunities", icon: Briefcase, requiredPermission: "crm.view_opportunities" },
      { name: "Tenders & Bids", href: "/dashboard/crm/tenders", icon: Building2, requiredPermission: ["crm.view_tenders", "tender_bids.read"] },
      { name: "Organizations", href: "/dashboard/crm/organizations", icon: Handshake, requiredPermission: "crm_organizations.read" },
      { name: "Contacts", href: "/dashboard/crm/contacts", icon: Users, requiredPermission: "crm_contacts.read" },
      { name: "Subcontractors", href: "/dashboard/crm/subcontractors", icon: HardHat, requiredPermission: "crm.view_subcontractors" },
      { name: "Activities", href: "/dashboard/crm/activities", icon: MapPin, requiredPermission: "crm_activities.read" },
      { name: "Documents", href: "/dashboard/crm/documents", icon: BookOpen, requiredPermission: "documents.read" },
      { name: "Sales Inbox", href: "/dashboard/crm/inbox", icon: Inbox, requiredPermission: "crm_communications.read" },
      { name: "Automations", href: "/dashboard/crm/automations", icon: Zap, requiredPermission: "crm_automations.read" },
      { name: "Integrations", href: "/dashboard/crm/integrations", icon: Settings, requiredPermission: "crm.integrations.read" },
      { name: "Marketing", href: "/dashboard/crm/marketing", icon: Megaphone, requiredPermission: "crm.marketing.read" },
      { name: "Campaigns", href: "/dashboard/crm/campaigns", icon: TrendingUp, requiredPermission: "crm.marketing.read" },
      { name: "Segments", href: "/dashboard/crm/segments", icon: PieChart, requiredPermission: ["crm.segments.read", "crm.marketing.read"] },
      { name: "Templates", href: "/dashboard/crm/templates", icon: FileText, requiredPermission: ["crm.templates.read", "crm.marketing.read"] },
      { name: "Import & Export", href: "/dashboard/crm/import", icon: Upload, requiredPermission: "crm.import" },
      { name: "Support", href: "/dashboard/crm/support", icon: LifeBuoy, requiredPermission: "crm.support.read" },
      { name: "Tickets", href: "/dashboard/crm/tickets", icon: Ticket, requiredPermission: "crm.support.read" },
      { name: "Reports", href: "/dashboard/crm/reports", icon: BarChart, requiredPermission: "crm.reports.read" },
      { name: "Tasks", href: "/dashboard/crm/tasks", icon: ClipboardCheck, requiredPermission: "crm_tasks.read" },
      { name: "Teams", href: "/dashboard/crm/teams", icon: Users, requiredPermission: "users.read_assignable" },
    ],
  },
  {
    name: "Estimating & Quotations",
    href: "/dashboard/quotations",
    icon: FileText,
    domain: "commercial",
    requiredPermission: "quotations.read",
    subItems: [
      { name: "Overview Dashboard", href: "/dashboard/quotations", icon: LayoutDashboard },
      { name: "Quotation Builder", href: "/dashboard/quotations/builder", icon: FileText },
      { name: "Rate Build-Up", href: "/dashboard/quotations/rates", icon: Scale, requiredPermission: "quotations.manage_rate_intelligence" },
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
    domain: "delivery",
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
    domain: "delivery",
    requiredPermission: "site_operations.read",
    subItems: [{ name: "Site Day", href: "/dashboard/site-operations", icon: Activity }],
  },
  {
    name: "Workforce",
    href: "/dashboard/workforce",
    icon: Users,
    domain: "people",
    subItems: [
      { name: "Overview", href: "/dashboard/workforce", icon: Users, requiredPermission: "workforce.read" },
      { name: "People Register", href: "/dashboard/workforce/people", icon: Users, requiredPermission: "workforce.people.read" },
      { name: "Reporting Lines", href: "/dashboard/workforce/organisation", icon: Users, requiredPermission: "workforce.organisation.read" },
      { name: "My Profile", href: "/dashboard/workforce/me", icon: Users },
      { name: "My Performance", href: "/dashboard/workforce/my-performance", icon: Activity },
    ],
  },
  {
    name: "Fleet",
    href: "/dashboard/fleet",
    icon: Truck,
    domain: "assets",
    requiredPermission: "fleet.read",
    subItems: [
      { name: "Overview", href: "/dashboard/fleet", icon: Truck },
      { name: "Performance", href: "/dashboard/fleet/performance", icon: Gauge },
    ],
  },
  {
    name: "Equipment",
    href: "/dashboard/equipment",
    icon: Wrench,
    domain: "assets",
    requiredPermission: "equipment_assets.read",
    subItems: [
      { name: "Overview", href: "/dashboard/equipment", icon: Wrench },
      { name: "Performance", href: "/dashboard/fleet/performance", icon: Gauge, requiredPermission: "fleet.read" },
    ],
  },
  {
    name: "Procurement",
    href: "/dashboard/procurement",
    icon: ShoppingCart,
    domain: "supply",
    requiredPermission: "procurement.requisition.read",
    subItems: [
      { name: "Procurement Pipeline", href: "/dashboard/procurement", icon: LayoutDashboard },
      { name: "Requisitions", href: "/dashboard/procurement/requisitions", icon: ClipboardCheck },
      { name: "RFQs", href: "/dashboard/procurement/rfqs", icon: Search, requiredPermission: "procurement.rfq.read" },
      { name: "Purchase Orders", href: "/dashboard/procurement/purchase-orders", icon: ShoppingCart, requiredPermission: "procurement.po.read" },
      { name: "Suppliers", href: "/dashboard/procurement/suppliers", icon: Package, requiredPermission: "procurement.supplier.read" },
      { name: "Pricing", href: "/dashboard/procurement/pricing", icon: DollarSign, requiredPermission: "procurement.vendor_rate.read" },
      { name: "Invoices", href: "/dashboard/procurement/invoices", icon: DollarSign, requiredPermission: "procurement.invoice.read" },
    ],
  },
  {
    name: "Inventory",
    href: "/dashboard/inventory",
    icon: Package,
    domain: "supply",
    requiredPermission: "inventory_items.read",
    subItems: [
      { name: "Stock Management", href: "/dashboard/inventory", icon: LayoutDashboard },
      { name: "Stock Levels", href: "/dashboard/inventory/stock", icon: Package },
      { name: "Item Catalogue", href: "/dashboard/inventory/catalogue", icon: FileText },
      { name: "Stores", href: "/dashboard/inventory/stores", icon: Building2 },
      { name: "Movements", href: "/dashboard/inventory/movements", icon: Activity },
    ],
  },
  {
    // Every Finance sub-page renders the same FinancePage shell, whose
    // primary data load requires finance.cost.read.
    name: "Finance",
    href: "/dashboard/finance",
    icon: DollarSign,
    domain: "finance",
    requiredPermission: "finance.cost.read",
    subItems: [
      { name: "Finance & Cost Control", href: "/dashboard/finance", icon: LayoutDashboard },
      { name: "Financial Data Room", href: "/dashboard/finance/data-room", icon: FileText },
      { name: "Project Financials", href: "/dashboard/finance/project-financials", icon: DollarSign },
      { name: "Cost Codes", href: "/dashboard/finance/cost-codes", icon: FileText },
      { name: "Variations", href: "/dashboard/finance/variations", icon: BarChart },
      { name: "Progress Claims", href: "/dashboard/finance/progress-claims", icon: ClipboardCheck },
      { name: "Earned Value", href: "/dashboard/finance/earned-value", icon: TrendingUp },
      { name: "Close-Out", href: "/dashboard/finance/close-out", icon: ShieldCheck },
      { name: "Budgets", href: "/dashboard/finance/budgets", icon: PieChart },
      { name: "Banking & Cash", href: "/dashboard/finance/banking", icon: Banknote },
      { name: "Cashbook", href: "/dashboard/finance/cashbook", icon: BookMarked },
      { name: "Bank Statement Review", href: "/dashboard/finance/bank-review", icon: Banknote },
      { name: "Supplier Payments", href: "/dashboard/finance/supplier-payments", icon: Receipt },
      { name: "Payroll", href: "/dashboard/finance/payroll", icon: Users },
      { name: "Internal Transfers", href: "/dashboard/finance/transfers", icon: Receipt },
      { name: "Department P&L", href: "/dashboard/finance/department-pnl", icon: PieChart },
      { name: "Statutory", href: "/dashboard/finance/statutory", icon: ShieldCheck },
      { name: "Vendor Payments", href: "/dashboard/finance/vendor-payments", icon: Receipt },
      { name: "Client Payments", href: "/dashboard/finance/client-payments", icon: Banknote },
      { name: "Historical Entry", href: "/dashboard/finance/historical-entry", icon: BookMarked },
      { name: "Financial Statements", href: "/dashboard/finance/financial-statements", icon: FileText },
      { name: "General Ledger", href: "/dashboard/finance/general-ledger", icon: Scale },
      { name: "Cash Forecast", href: "/dashboard/finance/cash-forecast", icon: TrendingUp },
      { name: "AI Assistant", href: "/dashboard/finance/ai-assistant", icon: Bot },
      { name: "Management Accounts", href: "/dashboard/finance/management-accounts", icon: FileText },
      { name: "Project Portfolio", href: "/dashboard/finance/project-portfolio", icon: Layers },
      { name: "Audit Workspace", href: "/dashboard/finance/audit-workspace", icon: FileSearch },
    ],
  },
  {
    name: "HR",
    href: "/dashboard/hr",
    icon: UserCheck,
    domain: "people",
    requiredPermission: "hr.operations.read",
    subItems: [
      { name: "HR Dashboard", href: "/dashboard/hr", icon: LayoutDashboard },
      { name: "Employee Register", href: "/dashboard/hr/employees", icon: Users },
      { name: "Recruitment", href: "/dashboard/hr/recruitment", icon: Briefcase },
      { name: "Contracts & Docs", href: "/dashboard/hr/documents", icon: FileText },
      { name: "Credentials", href: "/dashboard/hr/credentials", icon: ShieldCheck },
      { name: "Performance", href: "/dashboard/hr/performance", icon: Activity },
      { name: "Assets", href: "/dashboard/hr/assets", icon: Package },
      { name: "Training Matrix", href: "/dashboard/hr/training", icon: BookOpen },
      { name: "Org Chart", href: "/dashboard/hr/org-chart", icon: Users },
      { name: "Workforce Planning", href: "/dashboard/hr/planning", icon: Calendar },
      { name: "Attendance Log", href: "/dashboard/hr/attendance", icon: Calendar, requiredPermission: "hr.attendance.read" },
      { name: "Project Hires", href: "/dashboard/hr/project-hires", icon: HardHat, requiredPermission: "workforce.project_hires.manage" },
      { name: "Leave Management", href: "/dashboard/hr/leave", icon: UserCheck, requiredPermission: "hr.leave.read" },
      { name: "Payroll", href: "/dashboard/hr/payroll", icon: Banknote, requiredPermission: ["hr.payroll.read", "finance.payroll.read"] },
      { name: "Vendor Verification", href: "/dashboard/hr/vendor-verification", icon: ShieldCheck, requiredPermission: "hr.vendor_verification.read" },
    ],
  },
  {
    name: "Compliance",
    href: "/dashboard/compliance",
    icon: ShieldCheck,
    domain: "governance",
    requiredPermission: "compliance_items.read",
    subItems: [
      { name: "Compliance Overview", href: "/dashboard/compliance", icon: LayoutDashboard },
      { name: "Corporate Credentials", href: "/dashboard/compliance/corporate-credentials", icon: BookMarked, requiredPermission: "compliance_credentials.read" },
      { name: "Obligation Register", href: "/dashboard/compliance/obligations", icon: ShieldCheck, requiredPermission: "compliance.requirement.read" },
      { name: "Employee Credentials", href: "/dashboard/compliance/employees", icon: Users },
      { name: "Equipment Licenses", href: "/dashboard/compliance/equipment", icon: Wrench },
      { name: "Deployment Gates", href: "/dashboard/compliance/deployment-gates", icon: LockKeyhole, requiredPermission: "compliance.gate.read" },
      { name: "Corrective Actions", href: "/dashboard/compliance/corrective-actions", icon: ClipboardCheck, requiredPermission: "compliance.corrective_action.read" },
      { name: "HSE Incidents", href: "/dashboard/compliance/incidents", icon: Activity, requiredPermission: "hse_incidents.read" },
    ],
  },
  {
    name: "Client Portal",
    href: "/dashboard/client-portal",
    icon: LockKeyhole,
    domain: "commercial",
    requiredPermission: "client_portal_tickets.read",
    subItems: [{ name: "Overview", href: "/dashboard/client-portal", icon: LockKeyhole }],
  },
  {
    name: "Documents",
    href: "/dashboard/documents",
    icon: FileText,
    domain: "governance",
    requiredPermission: "documents.read",
    subItems: [{ name: "Overview", href: "/dashboard/documents", icon: FileText }],
  },
  {
    name: "Reports",
    href: "/dashboard/reports",
    icon: BarChart,
    domain: "governance",
    requiredPermission: "automated_reports.read",
    subItems: [{ name: "Overview", href: "/dashboard/reports", icon: BarChart }],
  },
  {
    name: "Analytics",
    href: "/dashboard/analytics",
    icon: PieChart,
    domain: "governance",
    requiredPermission: ["executive.view_dashboard", "kpi_metrics.read"],
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
    domain: "governance",
    subItems: [
      { name: "Settings Overview", href: "/dashboard/settings", icon: LayoutDashboard, requiredPermission: "settings.read" },
      { name: "Configuration", href: "/dashboard/settings/configuration", icon: Settings, requiredPermission: "settings.update" },
      { name: "Access Control", href: "/dashboard/settings/access", icon: LockKeyhole, requiredPermission: "settings.update" },
      { name: "Account Setup", href: "/dashboard/settings/accounts", icon: Building2, requiredPermission: "settings.update" },
      { name: "Website Content", href: "/dashboard/settings/website", icon: FileText, requiredPermission: "website_content.update" },
      { name: "Audit Log", href: "/dashboard/settings/audit", icon: ShieldCheck, requiredPermission: "settings.audit.read" },
      { name: "Performance", href: "/dashboard/settings/performance", icon: TrendingUp, requiredPermission: "crm_tasks.performance.view" },
      { name: "My Profile", href: "/dashboard/profile", icon: User },
    ],
  },
];

/** True when the granted set satisfies a requirement (any-of for arrays).
 * No requirement means open to every signed-in user. */
export function hasRequiredPermission(
  granted: ReadonlySet<string> | null | undefined,
  requirement: PermissionRequirement | undefined,
): boolean {
  if (!requirement || (Array.isArray(requirement) && requirement.length === 0)) return true;
  if (!granted) return false;
  const keys = Array.isArray(requirement) ? requirement : [requirement];
  return keys.some((key) => granted.has(key));
}

/** The permission an item effectively needs (its own, else its group's). */
export function itemRequirement(group: ModuleGroup, item: ModuleNavItem): PermissionRequirement | undefined {
  return item.requiredPermission ?? group.requiredPermission;
}

/** The sidebar a user gets for a set of granted permissions. SUPERADMIN
 * sees everything. Groups with no visible sub-items are dropped. */
export function visibleModuleGroups(
  granted: ReadonlySet<string> | null | undefined,
  isSuperAdmin: boolean,
): ModuleGroup[] {
  return MODULE_GROUPS.map((group) => ({
    ...group,
    subItems: group.subItems.filter(
      (item) => isSuperAdmin || hasRequiredPermission(granted, itemRequirement(group, item)),
    ),
  })).filter((group) => group.subItems.length > 0);
}

/** One row per (sidebar group, permission) for the Settings > Access
 * Control grid. Derived from MODULE_GROUPS, so every page in the sidebar
 * is automatically grantable per role - ticking a box there is all it
 * takes to give a role (built-in or custom) that page. Where a page
 * accepts several permissions, the first is the one the grid toggles. */
export type PageAccessEntry = { page: string; route: string; permission: string; module: string };

// Scope permissions that widen what a page shows rather than gating the
// page itself - listed in the same grid so they're grantable per role.
const SCOPE_ACCESS_ENTRIES: PageAccessEntry[] = [
  {
    page: "All projects (without this, only projects the user is assigned to)",
    route: "/dashboard/projects",
    permission: "projects.read_all",
    module: DOMAIN_META.delivery.label,
  },
];

export const PAGE_ACCESS_CATALOGUE: PageAccessEntry[] = [...MODULE_GROUPS.flatMap((group) => {
  const byKey = new Map<string, ModuleNavItem[]>();
  for (const item of group.subItems) {
    const requirement = itemRequirement(group, item);
    const key = Array.isArray(requirement) ? requirement[0] : requirement;
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  const moduleLabel = group.domain ? DOMAIN_META[group.domain].label : group.name;
  return Array.from(byKey.entries()).map(([permission, items]) => ({
    page: items.length === group.subItems.length ? group.name : `${group.name}: ${items.map((item) => item.name).join(", ")}`,
    route: items[0].href,
    permission,
    module: moduleLabel,
  }));
}), ...SCOPE_ACCESS_ENTRIES];

/** Permission needed to open a dashboard path: the exact sub-item if one
 * matches, else the group whose href is the longest prefix (covers detail
 * pages like /dashboard/projects/123). Undefined = open to signed-in users. */
export function requiredPermissionForPath(pathname: string | null | undefined): PermissionRequirement | undefined {
  if (!pathname) return undefined;
  for (const group of MODULE_GROUPS) {
    for (const item of group.subItems) {
      if (item.href === pathname) return itemRequirement(group, item);
    }
  }
  let best: ModuleGroup | null = null;
  for (const group of MODULE_GROUPS) {
    if (pathname === group.href || pathname.startsWith(`${group.href}/`)) {
      if (!best || group.href.length > best.href.length) best = group;
    }
  }
  return best?.requiredPermission;
}

/** Which domain a dashboard pathname belongs to, by matching the longest
 * group.href prefix - used to carry the domain accent through
 * DashboardPageHeader and the page background outside the sidebar itself. */
export function getDomainForPathname(pathname: string | null | undefined): DomainKey | null {
  if (!pathname) return null;
  let best: ModuleGroup | null = null;
  for (const group of MODULE_GROUPS) {
    if (!group.domain) continue;
    if (pathname === group.href || pathname.startsWith(`${group.href}/`)) {
      if (!best || group.href.length > best.href.length) best = group;
    }
  }
  return best?.domain ?? null;
}

/** Default breadcrumb trail for a dashboard pathname, derived from the same
 * MODULE_GROUPS data the sidebar uses: Domain > Group > current sub-item
 * (single-group domains omit the domain segment, since it's redundant with
 * the group itself - see DOMAIN_META/render notes in DashboardShell). Pages
 * with dynamic titles (e.g. a customer's name) should pass their own
 * `breadcrumbs` prop instead and ignore this helper. */
export function getBreadcrumbsForPathname(pathname: string | null | undefined): { label: string; href?: string }[] {
  if (!pathname) return [];
  let matchedGroup: ModuleGroup | null = null;
  let matchedItem: ModuleNavItem | null = null;
  for (const group of MODULE_GROUPS) {
    for (const item of group.subItems) {
      if (pathname === item.href) {
        matchedGroup = group;
        matchedItem = item;
        break;
      }
    }
    if (matchedGroup) break;
  }
  if (!matchedGroup) {
    matchedGroup = MODULE_GROUPS.find((g) => pathname === g.href || pathname.startsWith(`${g.href}/`)) ?? null;
  }
  if (!matchedGroup) return [];

  const crumbs: { label: string; href?: string }[] = [];
  const domainGroupCount = matchedGroup.domain
    ? MODULE_GROUPS.filter((g) => g.domain === matchedGroup!.domain).length
    : 0;
  if (matchedGroup.domain && domainGroupCount > 1) {
    crumbs.push({ label: DOMAIN_META[matchedGroup.domain].label });
  }
  crumbs.push({ label: matchedGroup.name, href: matchedGroup.href });
  if (matchedItem && matchedItem.href !== matchedGroup.href) {
    crumbs.push({ label: matchedItem.name });
  }
  return crumbs;
}
