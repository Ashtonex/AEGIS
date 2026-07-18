"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Globe2, History, Image as ImageIcon, KeyRound, Loader2, LockKeyhole, RefreshCw, Save, Settings2, ShieldCheck, Upload, Users } from "lucide-react";
import {
  ApiError,
  assignSettingsUserRole,
  getSettingsAuditEvents,
  getSettingsOverview,
  removeSettingsUserRole,
  setSettingsRolePermission,
  updateSystemSetting,
  updateWebsiteContent,
  getSettingsBroadcastFeeds,
  createBroadcastFeed,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";

type SettingsTab = "configuration" | "access" | "website" | "audit";
type AuditStatus = "success" | "warning" | "blocked" | "unknown";

type Role = { id: string; name: string; description?: string | null; permissions: string[] };
type Permission = { key: string; description?: string | null };
type AccessUser = { id: string; name: string; email: string; roles: { id: string; name: string }[]; status?: string | null; last_active_at?: string | null };
type PageAccess = { page: string; route: string; permission: string; module: string };
type WebsiteContent = { id: string; page_key: string; section_key: string; title?: string | null; subtitle?: string | null; body?: string | null; status: "draft" | "published" | "archived"; metadata?: Record<string, unknown>; updated_at?: string | null };

type SystemSetting = { id: string; section: "organization" | "notifications"; key: string; label: string; description: string; category: string; value: string | number | boolean | null; value_type: string; editable: boolean; updated_at?: string | null };
type Integration = { id: string; name: string; provider?: string | null; status?: string | null; updated_at?: string | null; scopes?: string[] };
type AuditEvent = { id: string; occurred_at: string; event: string; actor: string; resource: string; details?: string | null; status: AuditStatus };

type SettingsOverview = {
  settings: SystemSetting[];
  users: AccessUser[];
  roles: Role[];
  permissions: Permission[];
  page_access: PageAccess[];
  website_content: WebsiteContent[];
  integrations: Integration[];
  audit_events: AuditEvent[];
};

const EMPTY_OVERVIEW: SettingsOverview = { settings: [], users: [], roles: [], permissions: [], page_access: [], website_content: [], integrations: [], audit_events: [] };

const FIELD_LABELS: Record<string, string> = {
  trading_name: "Trading name", legal_name: "Legal name", timezone: "Timezone", currency_code: "Currency", fiscal_year_start_month: "Fiscal year start", country_code: "Country", primary_contact_email: "Primary contact email", primary_contact_phone: "Primary contact phone",
  email_enabled: "Email notifications", in_app_enabled: "In-app notifications", daily_digest_enabled: "Daily digest", incident_alerts_enabled: "Incident alerts", approval_alerts_enabled: "Approval alerts",
};

function text(value: unknown, fallback = "Not recorded") { return typeof value === "string" && value.trim() ? value : fallback; }
function dateTime(value?: string | null) { if (!value) return "Not recorded"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString("en-GB", { timeZone: "Africa/Harare" }); }
function list(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function pretty(value: unknown) { return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? ""); }

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
    audit_events: list(source.audit_events).map((item: any) => ({ id: String(item.id ?? `${item.event_type}-${item.occurred_at}`), occurred_at: String(item.occurred_at ?? ""), event: text(item.event_type ?? item.event ?? item.action, "Unspecified event"), actor: text(item.actor_name ?? item.actor_email ?? item.actor ?? item.user, "System"), resource: text(item.resource_type ?? item.resource, "System"), details: typeof item.details === "string" ? item.details : JSON.stringify(item.details ?? {}), status: String(item.status ?? item.outcome ?? "success").toLowerCase() as AuditStatus })),
  };
}

function normalizeAuditEvents(payload: any): AuditEvent[] {
  const source = payload?.data ?? payload ?? [];
  return list(source).map((item: any) => ({ id: String(item.id ?? `${item.event_type}-${item.occurred_at}`), occurred_at: String(item.occurred_at ?? ""), event: text(item.event_type ?? item.event ?? item.action, "Unspecified event"), actor: text(item.actor_name ?? item.actor_email ?? item.actor ?? item.user, "System"), resource: text(item.resource_type ?? item.resource, "System"), details: typeof item.details === "string" ? item.details : JSON.stringify(item.details ?? {}), status: String(item.status ?? item.outcome ?? "success").toLowerCase() as AuditStatus }));
}

function normalizeLoadError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(message)) {
    return fallback;
  }
  return fallback;
}

function normalizeActionError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(message)) {
    return fallback;
  }
  return fallback;
}

function StatusBadge({ status }: { status?: string | null }) {
  const normalized = String(status ?? "unknown").toLowerCase();
  const style = normalized === "success" || normalized === "active" || normalized === "published" || normalized === "connected" || normalized === "healthy" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : normalized === "blocked" || normalized === "failed" || normalized === "revoked" || normalized === "inactive" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return <span className={`inline-flex border px-2 py-0.5 font-mono text-[10px] uppercase ${style}`}>{status || "Unknown"}</span>;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("configuration");
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
    catch (cause) { setError(cause instanceof ApiError && cause.status === 403 ? "Your current role does not have permission to view system settings." : normalizeLoadError(cause, "Settings data could not be loaded. Check the service connection and try again.")); setOverview(EMPTY_OVERVIEW); }
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

  const assignRole = async (userId: string, roleId: string) => { if (!roleId) return; setSaving(`assign-${userId}`); try { await assignSettingsUserRole(userId, roleId); setNotice("Role assigned."); await load(true); } catch (err) { setNotice(normalizeActionError(err, "Unable to assign role.")); } finally { setSaving(null); } };
  const removeRole = async (userId: string, roleId: string) => { setSaving(`remove-${userId}-${roleId}`); try { await removeSettingsUserRole(userId, roleId); setNotice("Role removed."); await load(true); } catch { setNotice("Unable to remove role."); } finally { setSaving(null); } };
  const togglePermission = async (roleId: string, permission: string, enabled: boolean) => { setSaving(`${roleId}-${permission}`); try { await setSettingsRolePermission(roleId, permission, enabled); setNotice("Page access updated."); await load(true); } catch { setNotice("Unable to update page access."); } finally { setSaving(null); } };
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
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-mid pb-5"><div><p className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-signal"><Settings2 className="h-3.5 w-3.5" /> System controls</p><h1 className="font-display text-3xl font-bold uppercase tracking-tight text-paper">System Settings</h1><p className="mt-1 text-sm text-slate-light">ERP configuration, access control, website content, integrations, and audit evidence.</p></div><button onClick={() => void load(true)} disabled={refreshing} className="inline-flex items-center gap-2 border border-ink-mid px-3 py-2 font-mono text-xs uppercase text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh</button></header>
    {error && <div className="flex gap-2 border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</div>}
    {notice && <div className="flex gap-2 border border-signal/40 bg-signal/10 p-3 text-sm text-paper"><ShieldCheck className="h-4 w-4 shrink-0 text-signal" /> {notice}</div>}
    <nav className="flex overflow-x-auto border-b border-ink-mid font-mono text-xs">{([ ["configuration", Database, "Configuration"], ["access", Users, "Access control"], ["website", Globe2, "Website content"], ["audit", History, "Audit log"] ] as const).map(([value, Icon, label]) => <button key={value} onClick={() => setTab(value)} className={`flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 font-bold uppercase tracking-wider ${tab === value ? "border-signal bg-signal/5 text-signal" : "border-transparent text-slate hover:text-paper"}`}><Icon className="h-4 w-4" /> {label}</button>)}</nav>

    {tab === "configuration" && <ConfigurationTab overview={overview} saving={saving} saveSetting={saveSetting} />}
    {tab === "access" && <AccessTab overview={overview} saving={saving} assignRole={assignRole} removeRole={removeRole} togglePermission={togglePermission} />}
    {tab === "website" && <WebsiteTab items={overview.website_content} saving={saving} saveContent={saveContent} />}
    {tab === "audit" && <AuditTab events={filteredEvents} loading={auditLoading} error={auditError} auditSearch={auditSearch} setAuditSearch={setAuditSearch} auditStatus={auditStatus} setAuditStatus={setAuditStatus} onRefresh={() => void loadAudit(true)} />}
  </main>;
}

function ConfigurationTab({ overview, saving, saveSetting }: { overview: SettingsOverview; saving: string | null; saveSetting: (setting: SystemSetting, value: string | number | boolean) => Promise<void> }) {
  return <section className="grid grid-cols-1 gap-6 xl:grid-cols-3"><div className="space-y-4 xl:col-span-2"><section className="border border-ink-mid bg-ink p-5"><h2 className="mb-4 flex items-center gap-2 border-b border-ink-mid pb-3 font-mono text-xs font-bold uppercase tracking-widest text-paper"><Database className="h-4 w-4 text-signal" /> Approved system configuration</h2><div className="divide-y divide-ink-mid/50">{overview.settings.map((setting) => <SettingRow key={setting.id} setting={setting} saving={saving === setting.id} onSave={saveSetting} />)}</div></section></div><section className="border border-ink-mid bg-ink p-5"><h2 className="mb-4 flex items-center gap-2 border-b border-ink-mid pb-3 font-mono text-xs font-bold uppercase tracking-widest text-paper"><KeyRound className="h-4 w-4 text-signal" /> Integrations</h2><p className="mb-4 text-xs leading-relaxed text-slate-light">Credentials remain in deployment secrets. This shows connection metadata only.</p><div className="space-y-3">{overview.integrations.length === 0 ? <p className="py-6 text-center font-mono text-xs text-slate-light">No registered integrations.</p> : overview.integrations.map((integration) => <div key={integration.id} className="border border-ink-mid/70 p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold text-paper">{integration.name}</p><p className="font-mono text-[10px] uppercase text-slate">{integration.provider || "Server managed"}</p></div><StatusBadge status={integration.status} /></div><p className="mt-2 text-[11px] text-slate-light">Last updated: {dateTime(integration.updated_at)}</p></div>)}</div></section></section>;
}

function SettingRow({ setting, saving, onSave }: { setting: SystemSetting; saving: boolean; onSave: (setting: SystemSetting, value: string | number | boolean) => Promise<void> }) {
  const [draft, setDraft] = useState(setting.value ?? "");
  useEffect(() => { setDraft(setting.value ?? ""); }, [setting.value]);
  const type = setting.value_type === "boolean" || typeof setting.value === "boolean" ? "boolean" : setting.value_type === "number" || typeof setting.value === "number" ? "number" : "string";
  return <div className="grid gap-3 py-4 md:grid-cols-[1fr_minmax(220px,0.8fr)]"><div><p className="font-semibold text-paper">{setting.label}</p><p className="mt-1 text-xs text-slate-light">{setting.description}</p><p className="mt-1 font-mono text-[10px] uppercase text-slate">{setting.category} | Updated {dateTime(setting.updated_at)}</p></div><div className="flex items-center gap-2">{type === "boolean" ? <select disabled={saving} value={String(draft)} onChange={(event) => setDraft(event.target.value === "true")} className="min-w-0 flex-1 border border-ink-mid bg-ink px-2 py-2 text-xs text-paper disabled:opacity-50"><option value="true">Enabled</option><option value="false">Disabled</option></select> : <input disabled={saving} type={type === "number" ? "number" : "text"} value={String(draft)} onChange={(event) => setDraft(type === "number" ? Number(event.target.value) : event.target.value)} className="min-w-0 flex-1 border border-ink-mid bg-ink px-2 py-2 text-xs text-paper disabled:opacity-50" />}<button disabled={saving} onClick={() => void onSave(setting, draft as string | number | boolean)} className="inline-flex h-8 w-8 items-center justify-center border border-signal/50 text-signal hover:bg-signal/10 disabled:opacity-50" title={`Save ${setting.label}`}><Save className="h-3.5 w-3.5" /></button></div></div>;
}

function AccessTab({ overview, saving, assignRole, removeRole, togglePermission }: { overview: SettingsOverview; saving: string | null; assignRole: (userId: string, roleId: string) => Promise<void>; removeRole: (userId: string, roleId: string) => Promise<void>; togglePermission: (roleId: string, permission: string, enabled: boolean) => Promise<void> }) {
  return <div className="space-y-6"><section className="border border-ink-mid bg-ink p-5"><h2 className="mb-4 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><Users className="h-4 w-4 text-signal" /> User role assignments</h2><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-y border-ink-mid font-mono uppercase tracking-wider text-slate"><tr><th className="p-3">User</th><th className="p-3">Status</th><th className="p-3">Roles</th><th className="p-3">Assign role</th></tr></thead><tbody className="divide-y divide-ink-mid/50">{overview.users.map((user) => <UserAccessRow key={user.id} user={user} roles={overview.roles} saving={saving} assignRole={assignRole} removeRole={removeRole} />)}</tbody></table></div></section><section className="border border-ink-mid bg-ink p-5"><h2 className="mb-4 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><LockKeyhole className="h-4 w-4 text-signal" /> Page access by role</h2><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-y border-ink-mid font-mono uppercase tracking-wider text-slate"><tr><th className="p-3">ERP page</th><th className="p-3">Permission</th>{overview.roles.map((role) => <th key={role.id} className="p-3 text-center">{role.name}</th>)}</tr></thead><tbody className="divide-y divide-ink-mid/50">{overview.page_access.map((page) => <tr key={page.route}><td className="p-3"><p className="font-semibold text-paper">{page.page}</p><p className="text-[11px] text-slate-light">{page.module} · {page.route}</p></td><td className="p-3 font-mono text-[11px] text-slate-light">{page.permission}</td>{overview.roles.map((role) => { const enabled = role.permissions.includes(page.permission); return <td key={role.id} className="p-3 text-center"><input type="checkbox" checked={enabled} disabled={saving === `${role.id}-${page.permission}`} onChange={(event) => void togglePermission(role.id, page.permission, event.target.checked)} /></td>; })}</tr>)}</tbody></table></div></section></div>;
}

function UserAccessRow({ user, roles, saving, assignRole, removeRole }: { user: AccessUser; roles: Role[]; saving: string | null; assignRole: (userId: string, roleId: string) => Promise<void>; removeRole: (userId: string, roleId: string) => Promise<void> }) {
  const [roleId, setRoleId] = useState("");
  const assignedIds = new Set(user.roles.map((role) => role.id));
  return <tr><td className="p-3"><p className="font-semibold text-paper">{user.name}</p><p className="text-[11px] text-slate-light">{user.email}</p></td><td className="p-3"><StatusBadge status={user.status} /></td><td className="p-3"><div className="flex flex-wrap gap-2">{user.roles.length === 0 ? <span className="text-slate-light">No roles</span> : user.roles.map((role) => <button key={role.id} disabled={saving === `remove-${user.id}-${role.id}`} onClick={() => void removeRole(user.id, role.id)} className="border border-ink-mid px-2 py-1 text-[11px] text-paper hover:border-red-400">{role.name} ×</button>)}</div></td><td className="p-3"><div className="flex gap-2"><select value={roleId} onChange={(event) => setRoleId(event.target.value)} className="border border-ink-mid bg-ink px-2 py-2 text-xs text-paper"><option value="">Select role</option>{roles.filter((role) => !assignedIds.has(role.id)).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><button disabled={!roleId || saving === `assign-${user.id}`} onClick={() => void assignRole(user.id, roleId)} className="border border-signal/50 px-3 py-2 font-mono text-[10px] uppercase text-signal disabled:opacity-50">Assign</button></div></td></tr>;
}

function WebsiteTab({ items, saving, saveContent }: { items: WebsiteContent[]; saving: string | null; saveContent: (item: WebsiteContent) => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, WebsiteContent>>({});
  const [feeds, setFeeds] = useState<any[]>([]);
  const [loadingFeeds, setLoadingFeeds] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedTitle, setFeedTitle] = useState("");
  const [feedDesc, setFeedDesc] = useState("");
  const [feedFile, setFeedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadFeeds = async () => {
    setLoadingFeeds(true);
    setFeedError(null);
    try {
      const res = await getSettingsBroadcastFeeds();
      if (res.success && Array.isArray(res.data)) {
        setFeeds(res.data);
      }
    } catch (err) {
      setFeeds([]);
      setFeedError(normalizeActionError(err, "Broadcast image stream could not be loaded."));
    } finally {
      setLoadingFeeds(false);
    }
  };

  useEffect(() => {
    setDrafts(Object.fromEntries(items.map((item) => [item.id, item])));
    void loadFeeds();
  }, [items]);

  const handleUploadFeed = async () => {
    if (!feedFile || !feedTitle) return;
    setUploading(true);
    try {
      const fileExt = feedFile.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
      const filePath = `feeds/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('broadcast-feeds')
        .upload(filePath, feedFile, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('broadcast-feeds')
        .getPublicUrl(filePath);

      await createBroadcastFeed({
        title: feedTitle,
        description: feedDesc,
        image_url: publicUrl
      });

      setFeedTitle("");
      setFeedDesc("");
      setFeedFile(null);
      await loadFeeds();
    } catch (err) {
      setFeedError(normalizeActionError(err, "Failed to broadcast image."));
    } finally {
      setUploading(false);
    }
  };

  return <div className="space-y-6">
    <section className="border border-ink-mid bg-ink p-5"><h2 className="mb-2 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><Globe2 className="h-4 w-4 text-signal" /> Website content editor</h2><p className="mb-5 text-xs text-slate-light">Edit public-site content records. Published content can be wired into public pages by page and section key.</p><div className="grid gap-4 xl:grid-cols-2">{items.map((item) => { const draft = drafts[item.id] ?? item; return <article key={item.id} className="border border-ink-mid/70 p-4"><div className="mb-3 flex items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase text-slate">{item.page_key} / {item.section_key}</p><h3 className="mt-1 text-sm font-semibold text-paper">{draft.title || "Untitled section"}</h3></div><StatusBadge status={draft.status} /></div><label className="mb-2 block"><span className="font-mono text-[10px] uppercase text-slate">Title</span><input value={draft.title ?? ""} onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, title: event.target.value } }))} className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper" /></label><label className="mb-2 block"><span className="font-mono text-[10px] uppercase text-slate">Subtitle</span><input value={draft.subtitle ?? ""} onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, subtitle: event.target.value } }))} className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper" /></label><label className="mb-2 block"><span className="font-mono text-[10px] uppercase text-slate">Body</span><textarea value={draft.body ?? ""} onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, body: event.target.value } }))} rows={4} className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper" /></label><div className="flex items-center justify-between gap-3"><select value={draft.status} onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, status: event.target.value as WebsiteContent["status"] } }))} className="border border-ink-mid bg-ink px-2 py-2 text-xs text-paper"><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select><button disabled={saving === `content-${item.id}`} onClick={() => void saveContent(draft)} className="inline-flex items-center gap-2 border border-signal/50 px-3 py-2 font-mono text-[10px] uppercase text-signal disabled:opacity-50"><Save className="h-3.5 w-3.5" /> Save content</button></div><p className="mt-2 text-[11px] text-slate-light">Updated {dateTime(item.updated_at)}</p></article>; })}</div></section>

    <section className="border border-ink-mid bg-ink p-5 space-y-6">
      <div>
        <h2 className="mb-2 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><ImageIcon className="h-4 w-4 text-signal" /> Supabase Image Broadcast</h2>
        <p className="text-xs text-slate-light font-mono">Broadcast live photos and drone updates directly into Supabase storage buckets.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="border border-ink-mid/70 bg-ink-mid/5 p-4 space-y-4 rounded-sm">
          <h3 className="text-xs font-bold uppercase tracking-widest text-paper font-mono border-b border-ink-mid pb-2 flex items-center gap-2"><Upload className="h-3.5 w-3.5 text-signal" /> New Broadcast</h3>
          
          <label className="block">
            <span className="font-mono text-[10px] uppercase text-slate">Image File</span>
            <input type="file" accept="image/*" onChange={(e) => setFeedFile(e.target.files?.[0] || null)} className="mt-1.5 w-full text-xs text-slate-light file:mr-3 file:py-1.5 file:px-3 file:border file:border-ink-mid file:text-xs file:font-mono file:bg-ink file:text-paper hover:file:bg-signal/10 file:cursor-pointer" />
          </label>
          
          <label className="block">
            <span className="font-mono text-[10px] uppercase text-slate">Title</span>
            <input type="text" placeholder="e.g. Site Excavation Progression" value={feedTitle} onChange={(e) => setFeedTitle(e.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" />
          </label>
          
          <label className="block">
            <span className="font-mono text-[10px] uppercase text-slate">Description</span>
            <textarea placeholder="e.g. Ground clearing operations at Harare site..." value={feedDesc} onChange={(e) => setFeedDesc(e.target.value)} rows={3} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" />
          </label>
          
          <button disabled={uploading || !feedFile || !feedTitle} onClick={handleUploadFeed} className="w-full inline-flex items-center justify-center gap-2 border border-signal/50 bg-signal/5 px-4 py-2 font-mono text-xs uppercase text-signal hover:bg-signal/15 disabled:opacity-50 transition-colors duration-300">
            <Upload className="h-4 w-4" />
            {uploading ? "Broadcasting..." : "Broadcast Image"}
          </button>
        </div>

        <div className="lg:col-span-2 border border-ink-mid/70 p-4 rounded-sm space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-paper font-mono border-b border-ink-mid pb-2">Live Broadcast Stream</h3>
          {feedError && (
            <div className="border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              {feedError}
            </div>
          )}
          {loadingFeeds ? (
            <div className="flex justify-center items-center h-48 text-slate-light"><Loader2 className="h-5 w-5 animate-spin mr-2 text-signal" /> Loading stream...</div>
          ) : feeds.length === 0 ? (
            <div className="flex flex-col justify-center items-center h-48 border border-dashed border-ink-mid text-slate"><p className="text-xs font-mono">No active image broadcasts.</p></div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 max-h-[420px] overflow-y-auto pr-2">
              {feeds.map((feed) => (
                <div key={feed.id} className="border border-ink-mid bg-ink-mid/5 p-3 flex gap-3 rounded-sm">
                  <div className="w-20 h-20 bg-ink-mid relative shrink-0 overflow-hidden border border-ink-mid rounded-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={feed.image_url} alt={feed.title} className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0 flex flex-col justify-between">
                    <div>
                      <h4 className="font-semibold text-xs text-paper truncate">{feed.title}</h4>
                      <p className="text-[11px] text-slate-light mt-1 line-clamp-2">{feed.description || "No details."}</p>
                    </div>
                    <span className="text-[9px] font-mono text-slate block mt-1">{dateTime(feed.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  </div>;
}

function AuditTab({ events, loading, error, auditSearch, setAuditSearch, auditStatus, setAuditStatus, onRefresh }: { events: AuditEvent[]; loading: boolean; error: string | null; auditSearch: string; setAuditSearch: (value: string) => void; auditStatus: string; setAuditStatus: (value: string) => void; onRefresh: () => void }) {
  return <section className="border border-ink-mid bg-ink p-5"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><History className="h-4 w-4 text-signal" /> Security event audit log</h2><p className="mt-1 text-xs text-slate-light">Immutable settings, access, and content-control events.</p></div><div className="flex flex-wrap gap-2"><input value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} placeholder="Search events" className="border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /><select value={auditStatus} onChange={(event) => setAuditStatus(event.target.value)} className="border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"><option value="all">All outcomes</option><option value="success">Success</option><option value="warning">Warning</option><option value="blocked">Blocked</option></select><button onClick={onRefresh} className="border border-ink-mid px-3 py-2 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper">Refresh audit</button></div></div>{error && <div className="mb-4 flex gap-2 border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</div>}<div className="overflow-x-auto">{loading ? <div className="flex h-48 items-center justify-center text-slate-light"><Loader2 className="mr-2 h-5 w-5 animate-spin text-signal" /> Loading audit events...</div> : <table className="w-full text-left text-xs"><thead className="border-y border-ink-mid font-mono uppercase tracking-wider text-slate"><tr><th className="p-3">Time</th><th className="p-3">Event</th><th className="p-3">Actor</th><th className="p-3">Resource</th><th className="p-3">Details</th><th className="p-3">Outcome</th></tr></thead><tbody className="divide-y divide-ink-mid/50">{events.map((event) => <tr key={event.id}><td className="p-3 whitespace-nowrap text-slate-light">{dateTime(event.occurred_at)}</td><td className="p-3 font-semibold text-paper">{event.event}</td><td className="p-3 text-slate-light">{event.actor}</td><td className="p-3 text-slate-light">{event.resource}</td><td className="p-3 text-slate-light">{event.details || "-"}</td><td className="p-3"><StatusBadge status={event.status} /></td></tr>)}{events.length === 0 && <tr><td colSpan={6} className="p-10 text-center font-mono text-sm text-slate-light">No audit events match the active filters.</td></tr>}</tbody></table>}</div></section>;
}
