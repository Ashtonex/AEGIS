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

export type ModuleNavItem = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
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
  // Derive visibility from explicit child grants, including custom roles.
  permissionDriven?: boolean;
  // Roles allowed to see the whole group. Harvested from the RBACGuard on
  // the group's root page - sub-items don't carry their own RBACGuard today
  // so this is the closest real signal for "who should see this module".
  allowedRoles?: string[];
  // See ModuleNavItem.restrictedRoles.
  restrictedRoles?: string[];
  // See ModuleNavItem.requiredPermission.
  requiredPermission?: string;
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

export const SITE_FIELD_ROLES = ["FOREMAN", "Site Clerk", "Site Engineer", "Site Agent"];
export const SITE_FIELD_DASHBOARD_GROUPS = new Set(["Messages", "Notifications", "Site Operations", "Settings"]);
export const PROCUREMENT_STORES_MANAGER_ROLES = ["Procurement Manager", "Stores and Procurement Manager", "Stores & Procurement Manager"];

export const MODULE_GROUPS: ModuleGroup[] = [
  {
    name: "Executive",
    href: "/dashboard/executive",
    icon: LayoutDashboard,
    domain: "executive",
    allowedRoles: ["Executive (Admin)", "Executive Read Only"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "executive.view_dashboard",
    directLink: true,
    subItems: [{ name: "Overview", href: "/dashboard/executive", icon: LayoutDashboard, requiredPermission: "executive.view_dashboard" }],
  },
  {
    name: "Messages",
    href: "/dashboard/messages",
    icon: Inbox,
    restrictedRoles: ["CRM Associate"],
    directLink: true,
    subItems: [{ name: "Communication Ledger", href: "/dashboard/messages", icon: Inbox }],
  },
  {
    name: "Notifications",
    href: "/dashboard/notifications",
    icon: Bell,
    restrictedRoles: ["CRM Associate"],
    directLink: true,
    subItems: [{ name: "Notification Center", href: "/dashboard/notifications", icon: Bell }],
  },
  {
    name: "CRM",
    href: "/dashboard/crm",
    icon: Briefcase,
    domain: "commercial",
    // No group-level requiredPermission - unlike the single-page groups
    // below, CRM's subItems are gated individually (a self-service role
    // granted only crm_leads.read should still see Leads even without
    // crm.view_opportunities), matching how restrictedRoles already works
    // per-subitem here rather than on the group as a whole.
    subItems: [
      { name: "Commercial Command", href: "/dashboard/crm", icon: BarChart, requiredPermission: "crm.view_opportunities" },
      { name: "Leads", href: "/dashboard/crm/leads", icon: Target, requiredPermission: "crm_leads.read" },
      { name: "Opportunities", href: "/dashboard/crm/opportunities", icon: Briefcase, requiredPermission: "crm.view_opportunities" },
      { name: "Tenders & Bids", href: "/dashboard/crm/tenders", icon: Building2 },
      { name: "Organizations", href: "/dashboard/crm/organizations", icon: Handshake, requiredPermission: "crm_organizations.read" },
      { name: "Contacts", href: "/dashboard/crm/contacts", icon: Users, requiredPermission: "crm_contacts.read" },
      { name: "Subcontractors", href: "/dashboard/crm/subcontractors", icon: HardHat },
      { name: "Activities", href: "/dashboard/crm/activities", icon: MapPin, requiredPermission: "crm_activities.read" },
      { name: "Documents", href: "/dashboard/crm/documents", icon: BookOpen, requiredPermission: "documents.read" },
      { name: "Sales Inbox", href: "/dashboard/crm/inbox", icon: Inbox, requiredPermission: "crm_communications.read" },
      { name: "Automations", href: "/dashboard/crm/automations", icon: Zap, requiredPermission: "crm_automations.read" },
      { name: "Integrations", href: "/dashboard/crm/integrations", icon: Settings, requiredPermission: "crm.integrations.read" },
      { name: "Marketing", href: "/dashboard/crm/marketing", icon: Megaphone },
      { name: "Campaigns", href: "/dashboard/crm/campaigns", icon: TrendingUp, requiredPermission: "crm.marketing.read" },
      { name: "Segments", href: "/dashboard/crm/segments", icon: PieChart },
      { name: "Templates", href: "/dashboard/crm/templates", icon: FileText },
      { name: "Import & Export", href: "/dashboard/crm/import", icon: Upload, requiredPermission: "crm.import" },
      { name: "Support", href: "/dashboard/crm/support", icon: LifeBuoy, requiredPermission: "crm.support.read" },
      { name: "Tickets", href: "/dashboard/crm/tickets", icon: Ticket },
      {
        name: "Reports",
        href: "/dashboard/crm/reports",
        icon: BarChart,
        allowedRoles: ["Executive (Admin)", "Project Manager", "Finance Manager", "Compliance Officer", "Commercial Manager", "Tender / Bid Manager", "Executive Read Only", "CRM Associate"],
        requiredPermission: "crm.reports.read",
      },
      { name: "Tasks", href: "/dashboard/crm/tasks", icon: ClipboardCheck, requiredPermission: "crm_tasks.read" },
      { name: "Teams", href: "/dashboard/crm/teams", icon: Users, requiredPermission: "users.read_assignable" },
    ],
  },
  {
    name: "Estimating & Quotations",
    href: "/dashboard/quotations",
    icon: FileText,
    domain: "commercial",
    subItems: [
      { name: "Overview Dashboard", href: "/dashboard/quotations", icon: LayoutDashboard, restrictedRoles: ["CRM Associate"] },
      { name: "Quotation Builder", href: "/dashboard/quotations/builder", icon: FileText, restrictedRoles: ["CRM Associate"] },
      { name: "Rate Build-Up", href: "/dashboard/quotations/rates", icon: Scale, requiredPermission: "quotations.manage_rate_intelligence" },
      { name: "Commercial Control Brain", href: "/dashboard/quotations/ccb", icon: BrainCircuit, restrictedRoles: ["CRM Associate"] },
      { name: "Intelligence Engine", href: "/dashboard/quotations/intelligence", icon: Brain, restrictedRoles: ["CRM Associate"] },
      { name: "Drawing Takeoff", href: "/dashboard/quotations/drawings", icon: Layers, restrictedRoles: ["CRM Associate"] },
      { name: "Export & History", href: "/dashboard/quotations/history", icon: BookOpen, restrictedRoles: ["CRM Associate"] },
    ],
  },
  {
    name: "Projects",
    href: "/dashboard/projects",
    icon: HardHat,
    domain: "delivery",
    allowedRoles: ["Executive (Admin)", "Project Manager", "Contracts Manager", "Commercial Manager", "Executive Read Only", "External Auditor"],
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
    domain: "delivery",
    allowedRoles: ["Executive (Admin)", "Project Manager", "Site Agent", "Site Clerk", "Site Engineer", "FOREMAN", "Storekeeper"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "site_operations.read",
    subItems: [{ name: "Daily Reports", href: "/dashboard/site-operations", icon: Activity }],
  },
  {
    name: "Workforce",
    href: "/dashboard/workforce",
    icon: Users,
    domain: "people",
    permissionDriven: true,
    subItems: [
      { name: "Overview", href: "/dashboard/workforce", icon: Users, requiredPermission: "workforce.read" },
      { name: "People Register", href: "/dashboard/workforce/people", icon: Users, requiredPermission: "workforce.people.read" },
      { name: "Reporting Authority", href: "/dashboard/workforce/organisation", icon: Users, requiredPermission: "workforce.organisation.read" },
      { name: "My Profile", href: "/dashboard/workforce/me", icon: Users },
    ],
  },
  {
    name: "Fleet",
    href: "/dashboard/fleet",
    icon: Truck,
    domain: "assets",
    allowedRoles: ["Executive (Admin)", "Fleet Supervisor", "Fleet Clerk", "Maintenance Planner", "Executive Read Only"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "fleet.read",
    subItems: [
      { name: "Overview", href: "/dashboard/fleet", icon: Truck },
      { name: "Performance", href: "/dashboard/fleet/performance", icon: Gauge, requiredPermission: "fleet.read" },
    ],
  },
  {
    name: "Equipment",
    href: "/dashboard/equipment",
    icon: Wrench,
    domain: "assets",
    allowedRoles: ["Executive (Admin)", "Fleet Supervisor", "Equipment Manager", "Site Manager", "Maintenance Planner", "Executive Read Only"],
    restrictedRoles: ["CRM Associate"],
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
    allowedRoles: ["Executive (Admin)", ...PROCUREMENT_STORES_MANAGER_ROLES, "Procurement Associate", "Project Manager", "Finance Manager", "Site Agent", "Tender / Bid Manager", "Commercial Manager", "Authorising Officer", "Executive Read Only", "External Auditor"],
    restrictedRoles: ["CRM Associate"],
    requiredPermission: "procurement.requisition.read",
    subItems: [
      { name: "Procurement Pipeline", href: "/dashboard/procurement", icon: LayoutDashboard },
      { name: "Requisitions", href: "/dashboard/procurement/requisitions", icon: ClipboardCheck },
      { name: "RFQs", href: "/dashboard/procurement/rfqs", icon: Search },
      { name: "Purchase Orders", href: "/dashboard/procurement/purchase-orders", icon: ShoppingCart },
      { name: "Suppliers", href: "/dashboard/procurement/suppliers", icon: Package },
      { name: "Pricing", href: "/dashboard/procurement/pricing", icon: DollarSign },
      { name: "Invoices", href: "/dashboard/procurement/invoices", icon: DollarSign },
    ],
  },
  {
    name: "Inventory",
    href: "/dashboard/inventory",
    icon: Package,
    domain: "supply",
    allowedRoles: ["Executive (Admin)", "Project Manager", "Site Agent", "Site Clerk", "Quantity Surveyor", "Storekeeper", ...PROCUREMENT_STORES_MANAGER_ROLES, "Inventory Controller", "Executive Read Only"],
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
    domain: "finance",
    allowedRoles: ["Executive (Admin)", "Project Manager", "Finance Manager", "Payroll Administrator", "Accounts Payable / Cash Officer", "Budget & Reporting Analyst", "Contracts Manager", "Commercial Manager", "Authorising Officer", "Executive Read Only", "External Auditor"],
    restrictedRoles: ["CRM Associate"],
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
    allowedRoles: ["Executive (Admin)", "Project Manager", "HR Officer", "HR Manager"],
    restrictedRoles: ["CRM Associate"],
    subItems: [
      { name: "HR & Workforce", href: "/dashboard/hr", icon: LayoutDashboard },
      { name: "Employee Register", href: "/dashboard/hr/employees", icon: Users },
      { name: "Recruitment", href: "/dashboard/hr/recruitment", icon: Briefcase },
      { name: "Contracts & Docs", href: "/dashboard/hr/documents", icon: FileText },
      { name: "Credentials", href: "/dashboard/hr/credentials", icon: ShieldCheck },
      { name: "Performance", href: "/dashboard/hr/performance", icon: Activity },
      { name: "Assets", href: "/dashboard/hr/assets", icon: Package },
      { name: "Training Matrix", href: "/dashboard/hr/training", icon: BookOpen },
      { name: "Org Chart", href: "/dashboard/hr/org-chart", icon: Users },
      { name: "Workforce Planning", href: "/dashboard/hr/planning", icon: Calendar },
      { name: "Attendance Log", href: "/dashboard/hr/attendance", icon: Calendar },
      { name: "Leave Management", href: "/dashboard/hr/leave", icon: UserCheck },
      { name: "Payroll", href: "/dashboard/hr/payroll", icon: Banknote },
      { name: "Vendor Verification", href: "/dashboard/hr/vendor-verification", icon: ShieldCheck },
    ],
  },
  {
    name: "Compliance",
    href: "/dashboard/compliance",
    icon: ShieldCheck,
    domain: "governance",
    // HSE / Safety Officer added here alongside the landing-page migration
    // (083) that sends this role straight to /dashboard/compliance - this
    // role held zero nav access to any group before this fix, despite being
    // created specifically for HSE incident tracking (migration 066).
    allowedRoles: ["Executive (Admin)", "Compliance Officer", "Internal Auditor", "Project Manager", "HSE / Safety Officer", "Contracts Manager", "Authorising Officer", "Executive Read Only", "External Auditor"],
    restrictedRoles: ["CRM Associate"],
    subItems: [
      { name: "Compliance Overview", href: "/dashboard/compliance", icon: LayoutDashboard },
      { name: "Corporate Credentials", href: "/dashboard/compliance/corporate-credentials", icon: BookMarked },
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
    domain: "commercial",
    restrictedRoles: ["CRM Associate"],
    subItems: [{ name: "Overview", href: "/dashboard/client-portal", icon: LockKeyhole }],
  },
  {
    name: "Documents",
    href: "/dashboard/documents",
    icon: FileText,
    domain: "governance",
    allowedRoles: ["Executive (Admin)", "Project Manager", "Site Agent", "Compliance Officer", "Finance Manager", "Document Controller", "Tender / Bid Manager", "Contracts Manager", "Commercial Manager", "Maintenance Planner", "Inventory Controller", "Executive Read Only", "External Auditor"],
    restrictedRoles: ["CRM Associate"],
    subItems: [{ name: "Overview", href: "/dashboard/documents", icon: FileText }],
  },
  {
    name: "Reports",
    href: "/dashboard/reports",
    icon: BarChart,
    domain: "governance",
    allowedRoles: ["Executive (Admin)", "Project Manager", "Finance Manager", "Compliance Officer", "Commercial Manager", "Contracts Manager", "Authorising Officer", "Executive Read Only", "External Auditor"],
    restrictedRoles: ["CRM Associate"],
    subItems: [{ name: "Overview", href: "/dashboard/reports", icon: BarChart }],
  },
  {
    name: "Analytics",
    href: "/dashboard/analytics",
    icon: PieChart,
    domain: "governance",
    allowedRoles: ["Executive (Admin)", "Project Manager", "Finance Manager", "Commercial Manager", "Executive Read Only"],
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
    domain: "governance",
    restrictedRoles: ["CRM Associate"],
    subItems: [
      { name: "Settings Overview", href: "/dashboard/settings", icon: LayoutDashboard, requiredPermission: "settings.read" },
      // Configuration/Access Control/Account Setup/Website Content/Audit Log
      // previously had no role restriction at all - every logged-in employee
      // could open them (the underlying endpoints still enforced their own
      // permission checks, but the pages themselves weren't gated). Settings
      // Overview and My Profile stay open to everyone - general-purpose
      // pages, not administrative controls.
      { name: "Configuration", href: "/dashboard/settings/configuration", icon: Settings, allowedRoles: ["Executive (Admin)", "System Administrator"] },
      { name: "Access Control", href: "/dashboard/settings/access", icon: LockKeyhole, allowedRoles: ["Executive (Admin)", "System Administrator"] },
      { name: "Account Setup", href: "/dashboard/settings/accounts", icon: Building2, allowedRoles: ["Executive (Admin)", "System Administrator"] },
      { name: "Website Content", href: "/dashboard/settings/website", icon: FileText, allowedRoles: ["Executive (Admin)", "System Administrator"] },
      { name: "Audit Log", href: "/dashboard/settings/audit", icon: ShieldCheck, allowedRoles: ["Executive (Admin)", "System Administrator", "External Auditor"] },
      { name: "Performance", href: "/dashboard/settings/performance", icon: TrendingUp, allowedRoles: ["Executive (Admin)", "System Administrator"] },
      { name: "My Profile", href: "/dashboard/profile", icon: User },
    ],
  },
];

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
