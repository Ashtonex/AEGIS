"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Loader2, RefreshCw, Settings2, ShieldCheck } from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  ApiError,
  assignSettingsUserRole,
  createSettingsManagedAccount,
  createSettingsRole,
  deleteSettingsUser,
  getSettingsAuditEvents,
  getSettingsOverview,
  inviteSettingsUser,
  removeSettingsUserRole,
  setSettingsRolePermission,
  setSettingsUserStatus,
  setSettingsUserEmail,
  updateSystemSetting,
  updateWebsiteContent,
} from "@/lib/api";

// Only the active tab's panel ships to the browser instead of all 6 (plus
// their own sub-components - user/role cards, QR provisioning, etc.) at once.
function PanelLoading() {
  return <Skeleton className="h-64 w-full" />;
}
const ConfigurationTab = dynamic(() => import("./SettingsTabPanels").then((m) => m.ConfigurationTab), { loading: PanelLoading });
const AccessTab = dynamic(() => import("./SettingsTabPanels").then((m) => m.AccessTab), { loading: PanelLoading });
const ManagedAccountsTab = dynamic(() => import("./SettingsTabPanels").then((m) => m.ManagedAccountsTab), { loading: PanelLoading });
const WebsiteTab = dynamic(() => import("./SettingsTabPanels").then((m) => m.WebsiteTab), { loading: PanelLoading });
const AuditTab = dynamic(() => import("./SettingsTabPanels").then((m) => m.AuditTab), { loading: PanelLoading });
const PerformanceTab = dynamic(() => import("./SettingsTabPanels").then((m) => m.PerformanceTab), { loading: PanelLoading });

export type SettingsTab = "configuration" | "access" | "accounts" | "website" | "audit" | "performance";
export type AuditStatus = "success" | "warning" | "blocked" | "unknown";

export type Role = { id: string; name: string; description?: string | null; permissions: string[] };
export type Permission = { key: string; description?: string | null };
export type AccessUser = { id: string; name: string; email: string; roles: { id: string; name: string }[]; status?: string | null; last_active_at?: string | null };
export type PageAccess = { page: string; route: string; permission: string; module: string };
export type PermissionOption = { permission: string; page: string; module: string; description?: string | null };
export type WebsiteContent = { id: string; page_key: string; section_key: string; title?: string | null; subtitle?: string | null; body?: string | null; status: "draft" | "published" | "archived"; metadata?: Record<string, unknown>; updated_at?: string | null };

export type SystemSetting = { id: string; section: "organization" | "notifications"; key: string; label: string; description: string; category: string; value: string | number | boolean | null; value_type: string; editable: boolean; updated_at?: string | null };
export type Integration = { id: string; name: string; provider?: string | null; status?: string | null; updated_at?: string | null; scopes?: string[] };
export type AuditEvent = { id: string; occurred_at: string; event: string; actor: string; resource: string; details?: string | null; status: AuditStatus };

export type SettingsOverview = {
  settings: SystemSetting[];
  users: AccessUser[];
  roles: Role[];
  permissions: Permission[];
  page_access: PageAccess[];
  website_content: WebsiteContent[];
  integrations: Integration[];
  audit_events: AuditEvent[];
  source_warnings: string[];
};

export type ManagedAccountType = "client" | "supplier" | "subcontractor";
export type ManagedEmployeeDraft = {
  full_name: string;
  email: string;
  job_title: string;
  phone: string;
  access_level: "viewer" | "contributor" | "manager" | "admin";
  role_ids: string[];
  module_permissions: string[];
  portal_access: boolean;
};

export type ManagedAccountDraft = {
  account_type: ManagedAccountType;
  company_name: string;
  trading_name: string;
  registration_number: string;
  tax_number: string;
  praz_number: string;
  nssa_number: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  address: string;
  capability_tags: string;
  compliance_status: "compliant" | "non_compliant" | "pending" | "exempt";
  authorization_tier: number;
  employees: ManagedEmployeeDraft[];
};

export type ProvisionedEmployeeCard = {
  user_id: string;
  email: string;
  temporary_password: string;
  access_level: ManagedEmployeeDraft["access_level"];
  contact_id?: string | null;
  employee_id?: string | null;
  custom_role_id?: string | null;
};

export type ProvisionedAccountCard = {
  account_type: ManagedAccountType;
  company_name: string;
  trading_name: string;
  website: string;
  portal_path: string;
  login_url: string;
  website_url: string;
  employees: ProvisionedEmployeeCard[];
};

export const EMPTY_OVERVIEW: SettingsOverview = { settings: [], users: [], roles: [], permissions: [], page_access: [], website_content: [], integrations: [], audit_events: [], source_warnings: [] };

export const EMPTY_EMPLOYEE: ManagedEmployeeDraft = {
  full_name: "",
  email: "",
  job_title: "",
  phone: "",
  access_level: "viewer",
  role_ids: [],
  module_permissions: [],
  portal_access: true,
};

export const EMPTY_MANAGED_ACCOUNT: ManagedAccountDraft = {
  account_type: "client",
  company_name: "",
  trading_name: "",
  registration_number: "",
  tax_number: "",
  praz_number: "",
  nssa_number: "",
  industry: "",
  website: "",
  phone: "",
  email: "",
  address: "",
  capability_tags: "",
  compliance_status: "pending",
  authorization_tier: 1,
  employees: [{ ...EMPTY_EMPLOYEE }],
};

export const ACCOUNT_TYPE_LABELS: Record<ManagedAccountType, string> = {
  client: "Client",
  supplier: "Supplier",
  subcontractor: "Subcontractor",
};

export const ACCESS_PRESETS = [
  {
    id: "employee",
    label: "Employee",
    description: "Daily CRM, project, document, and notification access.",
    access_level: "contributor" as const,
    roleHints: ["EMPLOYEE"],
    permissions: ["crm", "crm_leads", "crm_contacts", "crm_organizations", "documents", "projects", "notifications"],
  },
  {
    id: "manager",
    label: "Manager",
    description: "Operational oversight across delivery, workforce, fleet, CRM, and documents.",
    access_level: "manager" as const,
    roleHints: ["MANAGER", "EMPLOYEE"],
    permissions: ["crm", "crm_leads", "crm_contacts", "crm_organizations", "documents", "projects", "workforce", "fleet", "site_operations", "procurement", "notifications"],
  },
  {
    id: "admin",
    label: "Admin",
    description: "Administration access without protected sole-superadmin ownership.",
    access_level: "admin" as const,
    roleHints: ["ADMIN", "EMPLOYEE"],
    permissions: ["settings", "users", "crm", "crm_leads", "crm_contacts", "crm_organizations", "documents", "projects", "workforce", "fleet", "procurement", "notifications", "executive"],
  },
  {
    id: "ceo",
    label: "CEO",
    description: "Executive visibility plus management access across all operational modules.",
    access_level: "admin" as const,
    roleHints: ["CEO", "EXECUTIVE", "ADMIN", "EMPLOYEE"],
    permissions: ["executive", "settings", "crm", "crm_leads", "crm_contacts", "crm_organizations", "documents", "projects", "workforce", "fleet", "finance", "procurement", "notifications", "reports"],
  },
  {
    id: "viewer",
    label: "Viewer",
    description: "Read-only visibility for selected modules.",
    access_level: "viewer" as const,
    roleHints: [],
    permissions: ["read", "view"],
  },
];

export const FIELD_LABELS: Record<string, string> = {
  trading_name: "Trading name", legal_name: "Legal name", timezone: "Timezone", currency_code: "Currency", fiscal_year_start_month: "Fiscal year start", country_code: "Country", primary_contact_email: "Primary contact email", primary_contact_phone: "Primary contact phone",
  email_enabled: "Email notifications", in_app_enabled: "In-app notifications", daily_digest_enabled: "Daily digest", incident_alerts_enabled: "Incident alerts", approval_alerts_enabled: "Approval alerts",
};

export const TAB_ROUTES: Record<SettingsTab, string> = {
  configuration: "/dashboard/settings/configuration",
  access: "/dashboard/settings/access",
  accounts: "/dashboard/settings/accounts",
  website: "/dashboard/settings/website",
  audit: "/dashboard/settings/audit",
  performance: "/dashboard/settings/performance",
};

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  configuration: "Configuration",
  access: "Access Control",
  accounts: "Account Setup",
  website: "Website Content",
  audit: "Audit Log",
  performance: "Performance",
};

export function text(value: unknown, fallback = "Not recorded") { return typeof value === "string" && value.trim() ? value : fallback; }
export function dateTime(value?: string | null) { if (!value) return "Not recorded"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString("en-GB", { timeZone: "Africa/Harare" }); }
export function list(value: unknown): any[] { return Array.isArray(value) ? value : []; }
export function pretty(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(pretty).filter(Boolean).join(" · ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const primary = record.message ?? record.summary ?? record.reason ?? record.description ?? record.detail ?? record.body ?? record.title;
    if (primary) return pretty(primary);
    return Object.entries(record)
      .filter(([key]) => !["id", "uuid", "metadata", "tags", "source", "raw_payload"].includes(key))
      .map(([key, entry]) => `${key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())}: ${pretty(entry)}`)
      .filter((entry) => !entry.endsWith(": "))
      .join(" · ");
  }
  return String(value);
}
export function moduleNameFromPermission(key: string) {
  const prefix = key.split(".")[0].replace(/_/g, " ");
  return prefix.replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeSection(section: "organization" | "notifications", source: unknown): SystemSetting[] {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  return Object.entries(source as Record<string, unknown>)
    .filter(([key, value]) => !["id", "updated_at", "created_at", "created_by", "updated_by"].includes(key) && ["string", "number", "boolean"].includes(typeof value))
    .map(([key, value]) => ({
      id: `${section}-${key}`,
      section,
      key,
      label: FIELD_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: section === "organization" ? "Organisation-level ERP and tenant setting." : "Notification delivery preference used by ERP workflows.",
      category: section === "organization" ? "Organisation" : "Notifications",
      value: value as string | number | boolean,
      value_type: typeof value,
      editable: true,
      updated_at: (source as Record<string, unknown>).updated_at as string | null,
    }));
}

function normalizeOverview(payload: any): SettingsOverview {
  const source = payload?.data ?? payload ?? {};
  return {
    settings: [...normalizeSection("organization", source.organization), ...normalizeSection("notifications", source.notifications)],
    users: list(source.users).map((item: any) => ({ id: String(item.id), name: text(item.name ?? item.full_name, "Unnamed user"), email: text(item.email), roles: list(item.roles), status: item.is_active === false ? "inactive" : "active", last_active_at: item.last_active_at ?? item.updated_at ?? null })),
    roles: list(source.roles).map((item: any) => ({ id: String(item.id), name: String(item.name), description: item.description ?? null, permissions: list(item.permissions).map(String) })),
    permissions: list(source.permissions).map((item: any) => ({ key: String(item.key), description: item.description ?? null })),
    page_access: list(source.page_access).map((item: any) => ({ page: String(item.page), route: String(item.route), permission: String(item.permission), module: String(item.module) })),
    website_content: list(source.website_content).map((item: any) => ({ id: String(item.id ?? `${item.page_key}-${item.section_key}`), page_key: String(item.page_key), section_key: String(item.section_key), title: item.title ?? "", subtitle: item.subtitle ?? "", body: item.body ?? "", status: item.status ?? "draft", metadata: item.metadata ?? {}, updated_at: item.updated_at ?? null })),
    integrations: list(source.integrations).map((item: any) => ({ id: String(item.id ?? item.provider), name: text(item.display_name ?? item.name, "Unnamed integration"), provider: item.provider ?? null, status: item.status ?? null, updated_at: item.updated_at ?? null, scopes: list(item.scopes).map(String) })),
    audit_events: list(source.audit_events).map((item: any) => ({ id: String(item.id ?? `${item.event_type}-${item.occurred_at}`), occurred_at: String(item.occurred_at ?? ""), event: text(item.event_type ?? item.event ?? item.action, "Unspecified event"), actor: text(item.actor_name ?? item.actor_email ?? item.actor ?? item.user, "System"), resource: text(item.resource_type ?? item.resource, "System"), details: pretty(item.details), status: String(item.status ?? item.outcome ?? "success").toLowerCase() as AuditStatus })),
    source_warnings: list(source.source_warnings).map(String),
  };
}

function normalizeAuditEvents(payload: any): AuditEvent[] {
  const source = payload?.data ?? payload ?? [];
  return list(source).map((item: any) => ({ id: String(item.id ?? `${item.event_type}-${item.occurred_at}`), occurred_at: String(item.occurred_at ?? ""), event: text(item.event_type ?? item.event ?? item.action, "Unspecified event"), actor: text(item.actor_name ?? item.actor_email ?? item.actor ?? item.user, "System"), resource: text(item.resource_type ?? item.resource, "System"), details: pretty(item.details), status: String(item.status ?? item.outcome ?? "success").toLowerCase() as AuditStatus }));
}

function normalizeLoadError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(message)) {
    return fallback;
  }
  return fallback;
}

export function normalizeActionError(reason: unknown, fallback: string) {
  // Actions can fail for a specific, actionable reason (permission denied,
  // duplicate email, a protected account) - surface that instead of always
  // collapsing to the generic fallback, which previously hid it entirely.
  if (reason instanceof ApiError) {
    if (reason.status === 403) return "Your current role does not have permission to do this.";
    if (reason.status === 400 || reason.status === 404 || reason.status === 409) return reason.message || fallback;
    if (reason.status >= 500) return `Action failed (${reason.status}): ${reason.message}`;
  }
  return fallback;
}

function settingsLoadError(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) {
      return "Your login session was not sent to the settings service. Sign in again, then reopen Settings.";
    }
    if (cause.status === 403) {
      return "Your current role does not have permission to view system settings.";
    }
    if (cause.status >= 500) {
      return `Settings service failed (${cause.status}): ${cause.message}`;
    }
    return `Settings data could not be loaded (${cause.status}): ${cause.message}`;
  }
  return normalizeLoadError(cause, "Settings data could not be loaded. Check the service connection and try again.");
}

export function StatusBadge({ status }: { status?: string | null }) {
  const normalized = String(status ?? "unknown").toLowerCase();
  const style = normalized === "success" || normalized === "active" || normalized === "published" || normalized === "connected" || normalized === "healthy" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : normalized === "blocked" || normalized === "failed" || normalized === "revoked" || normalized === "inactive" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return <span className={`inline-flex border px-2 py-0.5 font-mono text-[10px] uppercase ${style}`}>{status || "Unknown"}</span>;
}

export default function SettingsPage() {
  return <SettingsTabPage initialTab="configuration" />;
}

/** Shared Settings workspace, rendered by a real route per tab (see the
 * sibling folders here) instead of the old settings/[tab] -> redirect() ->
 * ?tab= shim. Settings has no RBACGuard wrapper - each sidebar sub-item is
 * gated individually via its own allowedRoles (see lib/navigation.ts). */
export function SettingsTabPage({ initialTab }: { initialTab: SettingsTab }) {
  const tab = initialTab;
  const [overview, setOverview] = useState<SettingsOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditStatus, setAuditStatus] = useState("all");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    background ? setRefreshing(true) : setLoading(true);
    setError(null);
    try { setOverview(normalizeOverview(await getSettingsOverview())); }
    catch (cause) { setError(settingsLoadError(cause)); setOverview(EMPTY_OVERVIEW); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const loadAudit = useCallback(async (background = false) => {
    background ? setAuditLoading(true) : setAuditLoading(true);
    setAuditError(null);
    try {
      const res = await getSettingsAuditEvents(100);
      setAuditEvents(normalizeAuditEvents(res));
    } catch (cause) {
      setAuditError(cause instanceof ApiError && cause.status === 403 ? "Your current role does not have permission to view audit logs." : normalizeLoadError(cause, "Audit log data could not be loaded. Check the service connection and try again."));
      setAuditEvents([]);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === "audit") void loadAudit(true); }, [tab, loadAudit]);

  const saveSetting = async (setting: SystemSetting, value: string | number | boolean) => {
    setSaving(setting.id); setNotice(null);
    try { await updateSystemSetting(setting.section, { [setting.key]: value }); setNotice(`${setting.label} was saved.`); await load(true); }
    catch { setNotice(`Unable to save ${setting.label}. Check permissions and field format.`); }
    finally { setSaving(null); }
  };

  const assignRole = async (userId: string, roleId: string) => {
    if (!roleId) return;
    setSaving(`assign-${userId}`);
    try {
      await assignSettingsUserRole(userId, roleId);
      setNotice("Role assigned.");
      // Apply the change to local state immediately so the chip list never
      // waits on a full-overview refetch to reflect it, then reconcile with
      // the server in the background.
      setOverview((prev) => {
        const role = prev.roles.find((item) => item.id === roleId);
        if (!role) return prev;
        return { ...prev, users: prev.users.map((user) => user.id === userId && !user.roles.some((r) => r.id === roleId) ? { ...user, roles: [...user.roles, { id: role.id, name: role.name }] } : user) };
      });
      await load(true);
    } catch (err) {
      setNotice(normalizeActionError(err, "Unable to assign role."));
    } finally {
      setSaving(null);
    }
  };
  const removeRole = async (userId: string, roleId: string) => {
    setSaving(`remove-${userId}-${roleId}`);
    try {
      await removeSettingsUserRole(userId, roleId);
      setNotice("Role removed.");
      setOverview((prev) => ({ ...prev, users: prev.users.map((user) => user.id === userId ? { ...user, roles: user.roles.filter((role) => role.id !== roleId) } : user) }));
      await load(true);
    } catch (err) {
      setNotice(normalizeActionError(err, "Unable to remove role."));
    } finally {
      setSaving(null);
    }
  };
  const toggleUserStatus = async (userId: string, nextActive: boolean) => {
    setSaving(`status-${userId}`);
    try {
      await setSettingsUserStatus(userId, nextActive);
      setNotice(nextActive ? "User reactivated." : "User deactivated.");
      setOverview((prev) => ({ ...prev, users: prev.users.map((user) => user.id === userId ? { ...user, status: nextActive ? "active" : "inactive" } : user) }));
      await load(true);
    } catch (err) {
      setNotice(normalizeActionError(err, "Unable to update this user's status."));
    } finally {
      setSaving(null);
    }
  };
  const deleteUser = async (userId: string) => {
    setSaving(`delete-${userId}`);
    try {
      await deleteSettingsUser(userId);
      setNotice("User removed.");
      setOverview((prev) => ({ ...prev, users: prev.users.filter((user) => user.id !== userId) }));
      await load(true);
    } catch (err) {
      setNotice(normalizeActionError(err, "Unable to remove this user."));
    } finally {
      setSaving(null);
    }
  };
  const setUserEmail = async (userId: string, email: string) => {
    setSaving(`email-${userId}`);
    try {
      const result = await setSettingsUserEmail(userId, email);
      setNotice("Account email updated.");
      setOverview((prev) => ({ ...prev, users: prev.users.map((user) => user.id === userId ? { ...user, email: result.data?.email || email } : user) }));
      await load(true);
    } catch (err) {
      setNotice(normalizeActionError(err, "Unable to update this account's email."));
    } finally {
      setSaving(null);
    }
  };
  const inviteUser = async (payload: { full_name: string; email: string; role_ids: string[]; no_real_email?: boolean }) => {
    setSaving("invite-user");
    setNotice(null);
    try {
      const response = await inviteSettingsUser(payload);
      setNotice(response.message ?? `Invite sent to ${payload.email}.`);
      await load(true);
      return response.data ?? null;
    } catch (err) {
      setNotice(normalizeActionError(err, "Unable to send the invite."));
      throw err;
    } finally {
      setSaving(null);
    }
  };
  const togglePermission = async (roleId: string, permission: string, enabled: boolean) => { setSaving(`${roleId}-${permission}`); try { await setSettingsRolePermission(roleId, permission, enabled); setNotice("Page access updated."); await load(true); } catch { setNotice("Unable to update page access."); } finally { setSaving(null); } };
  const createRole = async (name: string, description?: string) => {
    setSaving("create-role");
    setNotice(null);
    try {
      const response = await createSettingsRole(name, description);
      setNotice(response.message ?? `Role "${name}" created.`);
      await load(true);
    } catch (err) {
      setNotice(normalizeActionError(err, "Unable to create the role."));
      throw err;
    } finally {
      setSaving(null);
    }
  };
  const createManagedAccount = async (payload: Record<string, unknown>) => {
    setSaving("managed-account");
    setNotice(null);
    try {
      const response = await createSettingsManagedAccount(payload);
      setNotice("Account profile created and access credentials were issued.");
      await load(true);
      return response.data ?? null;
    } catch (err) {
      setNotice(normalizeActionError(err, "Unable to create the managed account."));
      throw err;
    } finally {
      setSaving(null);
    }
  };
  const saveContent = async (item: WebsiteContent) => {
    setSaving(`content-${item.id}`);
    try {
      await updateWebsiteContent({
        page_key: item.page_key,
        section_key: item.section_key,
        title: item.title ?? null,
        subtitle: item.subtitle ?? null,
        body: item.body ?? null,
        status: item.status,
        metadata: item.metadata ?? {},
      });
      setNotice("Website content saved.");
      await load(true);
    } catch (err) {
      setNotice(normalizeActionError(err, "Unable to save website content."));
    } finally {
      setSaving(null);
    }
  };

  const filteredEvents = useMemo(() => {
    const source = auditEvents.length > 0 ? auditEvents : overview.audit_events;
    return source.filter((event) => `${event.event} ${event.actor} ${event.resource} ${event.details ?? ""}`.toLowerCase().includes(auditSearch.toLowerCase()) && (auditStatus === "all" || event.status === auditStatus));
  }, [auditEvents, overview.audit_events, auditSearch, auditStatus]);

  if (loading) return <div className="flex h-full items-center justify-center text-slate-light"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading settings...</div>;

  return <main className="h-full overflow-y-auto p-6 space-y-6">
    <DashboardPageHeader
      eyebrow={{ label: "System controls", icon: Settings2 }}
      title={SETTINGS_TAB_LABELS[tab]}
      subtitle="ERP configuration, access control, website content, integrations, and audit evidence."
      actions={
        <button onClick={() => void load(true)} disabled={refreshing} className="inline-flex items-center gap-2 border border-ink-mid px-3 py-2 font-mono text-xs uppercase text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh</button>
      }
    />
    {error && <div className="flex gap-2 border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</div>}
    {overview.source_warnings.length > 0 && <div className="border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100"><div className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" /> Partial settings source availability</div><ul className="list-disc space-y-1 pl-5 text-xs">{overview.source_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
    {notice && <div className="flex gap-2 border border-signal/40 bg-signal/10 p-3 text-sm text-paper"><ShieldCheck className="h-4 w-4 shrink-0 text-signal" /> {notice}</div>}
    {tab === "configuration" && <ConfigurationTab overview={overview} saving={saving} saveSetting={saveSetting} />}
    {tab === "access" && <AccessTab overview={overview} saving={saving} assignRole={assignRole} removeRole={removeRole} togglePermission={togglePermission} toggleUserStatus={toggleUserStatus} deleteUser={deleteUser} setUserEmail={setUserEmail} inviteUser={inviteUser} createRole={createRole} />}
    {tab === "accounts" && <ManagedAccountsTab overview={overview} saving={saving === "managed-account"} createManagedAccount={createManagedAccount} />}
    {tab === "website" && <WebsiteTab items={overview.website_content} saving={saving} saveContent={saveContent} />}
    {tab === "audit" && <AuditTab events={filteredEvents} loading={auditLoading} error={auditError} auditSearch={auditSearch} setAuditSearch={setAuditSearch} auditStatus={auditStatus} setAuditStatus={setAuditStatus} onRefresh={() => void loadAudit(true)} />}
    {tab === "performance" && <PerformanceTab />}
  </main>;
}

export interface TaskPerformanceRow {
  user_id: string;
  full_name: string;
  assigned_count: number;
  completed_count: number;
  completion_rate: number | null;
  on_time_rate: number | null;
  avg_days_to_complete: number | null;
}

