"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Award, Building2, CheckCircle2, Database, Globe2, History, Image as ImageIcon, KeyRound, Loader2, LockKeyhole, Mail, Plus, PowerOff, RefreshCw, Save, Settings2, ShieldCheck, Trash2, Upload, UserCheck, UserPlus, Users, X } from "lucide-react";
import * as QRCode from "qrcode";
import {
  ApiError,
  assignSettingsUserRole,
  createSettingsManagedAccount,
  createSettingsRole,
  deleteSettingsUser,
  getSettingsAuditEvents,
  getSettingsOverview,
  getTaskPerformance,
  inviteSettingsUser,
  removeSettingsUserRole,
  setSettingsRolePermission,
  setSettingsUserStatus,
  updateSystemSetting,
  updateWebsiteContent,
  getSettingsBroadcastFeeds,
  createBroadcastFeed,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  type Role, type Permission, type AccessUser, type PageAccess, type PermissionOption,
  type WebsiteContent, type SystemSetting, type Integration, type AuditEvent, type SettingsOverview,
  type ManagedAccountType, type ManagedEmployeeDraft, type ManagedAccountDraft,
  type ProvisionedEmployeeCard, type ProvisionedAccountCard, type TaskPerformanceRow,
  EMPTY_EMPLOYEE, EMPTY_MANAGED_ACCOUNT, ACCOUNT_TYPE_LABELS, ACCESS_PRESETS, FIELD_LABELS,
  text, dateTime, list, pretty, moduleNameFromPermission, normalizeActionError, StatusBadge,
} from "./page";

export function PerformanceTab() {
  const [rows, setRows] = useState<TaskPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getTaskPerformance();
        if (!cancelled && res.success && Array.isArray(res.data)) setRows(res.data);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Task performance data could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const pct = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;

  return <section className="border border-ink-mid bg-ink p-5">
    <h2 className="mb-2 flex items-center gap-2 border-b border-ink-mid pb-3 font-mono text-xs font-bold uppercase tracking-widest text-paper"><Award className="h-4 w-4 text-signal" /> Task completion performance</h2>
    <p className="mb-4 text-xs leading-relaxed text-slate-light">Internal recognition data for admins - who completes their work reliably and on time, so you know who to recognize. Not a ranked leaderboard; this list is not sorted by performance.</p>
    {error && <div className="mb-4 flex gap-2 border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</div>}
    {loading ? <div className="flex items-center justify-center py-10 text-slate-light"><Loader2 className="h-5 w-5 animate-spin" /></div>
      : rows.length === 0 ? <p className="py-8 text-center font-mono text-xs text-slate-light">No task assignment history yet.</p>
      : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-y border-ink-mid font-mono uppercase tracking-wider text-slate"><tr><th className="p-3">Person</th><th className="p-3">Assigned</th><th className="p-3">Completed</th><th className="p-3">Completion rate</th><th className="p-3">On-time rate</th><th className="p-3">Avg days to complete</th></tr></thead><tbody className="divide-y divide-ink-mid/50">{rows.map((row) => <tr key={row.user_id}><td className="p-3 text-paper">{row.full_name}</td><td className="p-3">{row.assigned_count}</td><td className="p-3">{row.completed_count}</td><td className="p-3">{pct(row.completion_rate)}</td><td className="p-3">{pct(row.on_time_rate)}</td><td className="p-3">{row.avg_days_to_complete ?? "—"}</td></tr>)}</tbody></table></div>}
  </section>;
}

export function ConfigurationTab({ overview, saving, saveSetting }: { overview: SettingsOverview; saving: string | null; saveSetting: (setting: SystemSetting, value: string | number | boolean) => Promise<void> }) {
  return <section className="grid grid-cols-1 gap-6 xl:grid-cols-3"><div className="space-y-4 xl:col-span-2"><section className="border border-ink-mid bg-ink p-5"><h2 className="mb-4 flex items-center gap-2 border-b border-ink-mid pb-3 font-mono text-xs font-bold uppercase tracking-widest text-paper"><Database className="h-4 w-4 text-signal" /> Approved system configuration</h2><div className="divide-y divide-ink-mid/50">{overview.settings.map((setting) => <SettingRow key={setting.id} setting={setting} saving={saving === setting.id} onSave={saveSetting} />)}</div></section></div><section className="border border-ink-mid bg-ink p-5"><h2 className="mb-4 flex items-center gap-2 border-b border-ink-mid pb-3 font-mono text-xs font-bold uppercase tracking-widest text-paper"><KeyRound className="h-4 w-4 text-signal" /> Integrations</h2><p className="mb-4 text-xs leading-relaxed text-slate-light">Credentials remain in deployment secrets. This shows connection metadata only.</p><div className="space-y-3">{overview.integrations.length === 0 ? <p className="py-6 text-center font-mono text-xs text-slate-light">No registered integrations.</p> : overview.integrations.map((integration) => <div key={integration.id} className="border border-ink-mid/70 p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold text-paper">{integration.name}</p><p className="font-mono text-[10px] uppercase text-slate">{integration.provider || "Server managed"}</p></div><StatusBadge status={integration.status} /></div><p className="mt-2 text-[11px] text-slate-light">Last updated: {dateTime(integration.updated_at)}</p></div>)}</div></section></section>;
}

function SettingRow({ setting, saving, onSave }: { setting: SystemSetting; saving: boolean; onSave: (setting: SystemSetting, value: string | number | boolean) => Promise<void> }) {
  const [draft, setDraft] = useState(setting.value ?? "");
  useEffect(() => { setDraft(setting.value ?? ""); }, [setting.value]);
  const type = setting.value_type === "boolean" || typeof setting.value === "boolean" ? "boolean" : setting.value_type === "number" || typeof setting.value === "number" ? "number" : "string";
  return <div className="grid gap-3 py-4 md:grid-cols-[1fr_minmax(220px,0.8fr)]"><div><p className="font-semibold text-paper">{setting.label}</p><p className="mt-1 text-xs text-slate-light">{setting.description}</p><p className="mt-1 font-mono text-[10px] uppercase text-slate">{setting.category} | Updated {dateTime(setting.updated_at)}</p></div><div className="flex items-center gap-2">{type === "boolean" ? <select disabled={saving} value={String(draft)} onChange={(event) => setDraft(event.target.value === "true")} className="min-w-0 flex-1 border border-ink-mid bg-ink px-2 py-2 text-xs text-paper disabled:opacity-50"><option value="true">Enabled</option><option value="false">Disabled</option></select> : <input disabled={saving} type={type === "number" ? "number" : "text"} value={String(draft)} onChange={(event) => setDraft(type === "number" ? Number(event.target.value) : event.target.value)} className="min-w-0 flex-1 border border-ink-mid bg-ink px-2 py-2 text-xs text-paper disabled:opacity-50" />}<button disabled={saving} onClick={() => void onSave(setting, draft as string | number | boolean)} className="inline-flex h-8 w-8 items-center justify-center border border-signal/50 text-signal hover:bg-signal/10 disabled:opacity-50" title={`Save ${setting.label}`}><Save className="h-3.5 w-3.5" /></button></div></div>;
}

function InviteUserModal({ roles, onClose, onInvite }: { roles: Role[]; onClose: () => void; onInvite: (payload: { full_name: string; email: string; role_ids: string[]; no_real_email?: boolean }) => Promise<any> }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [noRealEmail, setNoRealEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; temporary_password: string } | null>(null);
  const visibleRoles = roles.filter((role) => role.name.toUpperCase() !== "SUPERADMIN");

  const toggleRole = (roleId: string) => setRoleIds((current) => current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!fullName.trim() || !email.trim()) {
      setFormError("Full name and email are required.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await onInvite({ full_name: fullName.trim(), email: email.trim(), role_ids: roleIds, no_real_email: noRealEmail });
      if (noRealEmail && result?.temporary_password) {
        setIssued({ email: result.email ?? email.trim(), temporary_password: result.temporary_password });
      } else {
        onClose();
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "The invite could not be sent.");
    } finally {
      setSubmitting(false);
    }
  };

  if (issued) {
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md border border-ink-mid bg-ink-light p-6">
        <div className="mb-5 flex items-start justify-between gap-3 border-b border-ink-mid pb-4">
          <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><ShieldCheck className="h-4 w-4 text-signal" /> Account created</h2>
          <button type="button" onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-slate-light">This address has no real inbox, so nothing was emailed. Copy the password below now and hand it to them directly - it will not be shown again, and they must change it on first login.</p>
        <div className="space-y-2">
          <div className="border border-ink-mid bg-ink p-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Sign-in email</p>
            <p className="mt-1 break-all font-mono text-[12px] text-paper">{issued.email}</p>
          </div>
          <div className="border border-signal/40 bg-signal/5 p-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Temporary password</p>
            <p className="mt-1 break-all font-mono text-[12px] text-paper">{issued.temporary_password}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="mt-5 flex w-full items-center justify-center gap-2 bg-signal py-3 font-mono text-xs uppercase tracking-widest text-ink">Done</button>
      </div>
    </div>;
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
    <div className="w-full max-w-md border border-ink-mid bg-ink-light p-6">
      <div className="mb-5 flex items-start justify-between gap-3 border-b border-ink-mid pb-4">
        <div>
          <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><Mail className="h-4 w-4 text-signal" /> Invite internal user</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-light">{noRealEmail ? "No email is sent. The account is created immediately with a password you set and hand to them directly." : "Supabase emails them a sign-in link and requires them to set their own password before the account is usable. No credentials are shared manually."}</p>
        </div>
        <button type="button" onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
      </div>
      <form onSubmit={submit} className="space-y-4">
        {formError && <div className="border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">{formError}</div>}
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Full name</span>
          <input required value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1 w-full border border-ink-mid bg-ink p-2 text-sm text-paper focus:border-signal focus:outline-none" />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Email</span>
          <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={noRealEmail ? "firstname.lastname@aegis.local" : undefined} className="mt-1 w-full border border-ink-mid bg-ink p-2 text-sm text-paper focus:border-signal focus:outline-none" />
          {noRealEmail && <span className="mt-1 block text-[11px] text-slate-light">Doesn&apos;t need to be a real mailbox - just unique. Use a made-up address like a placeholder domain (e.g. <span className="text-paper">@aegis.local</span>); it only has to work for signing in to AEGIS.</span>}
        </label>
        <label className="flex items-start gap-2 border border-ink-mid/60 p-3 text-xs text-slate-light">
          <input type="checkbox" checked={noRealEmail} onChange={(event) => setNoRealEmail(event.target.checked)} className="mt-0.5" />
          <span>This person has no real email inbox (e.g. an intern). Skip the email invite and issue a password directly instead.</span>
        </label>
        <div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Roles (optional)</span>
          <div className="mt-2 grid max-h-40 gap-2 overflow-y-auto">
            {visibleRoles.length === 0 ? <p className="text-xs text-slate-light">No roles available.</p> : visibleRoles.map((role) => <label key={role.id} className="flex items-center justify-between gap-3 border border-ink-mid/60 px-3 py-2 text-xs text-slate-light">
              <span className="truncate text-paper">{role.name}</span>
              <input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => toggleRole(role.id)} />
            </label>)}
          </div>
        </div>
        <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 bg-signal py-3 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><UserPlus className="h-4 w-4" /> {noRealEmail ? "Create account" : "Send invite"}</>}
        </button>
      </form>
    </div>
  </div>;
}

function NewRoleForm({ saving, createRole }: { saving: string | null; createRole: (name: string, description?: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const busy = saving === "create-role";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    try {
      await createRole(name.trim(), description.trim() || undefined);
      setName("");
      setDescription("");
      setOpen(false);
    } catch {
      // notice already surfaced by parent
    }
  };

  if (!open) {
    return <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 border border-signal/50 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-signal hover:bg-signal/10"><Plus className="h-3.5 w-3.5" /> New role</button>;
  }
  return <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border border-ink-mid/70 bg-ink p-3">
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-light">Role name</label>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Site Material Clerk" className="mt-1 border border-ink-mid bg-ink-light px-2 py-2 text-xs text-paper" autoFocus />
    </div>
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-light">Description (optional)</label>
      <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this role is for" className="mt-1 border border-ink-mid bg-ink-light px-2 py-2 text-xs text-paper" />
    </div>
    <button type="submit" disabled={!name.trim() || busy} className="inline-flex items-center gap-2 border border-signal/50 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-signal disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}</button>
    <button type="button" onClick={() => setOpen(false)} className="border border-ink-mid px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-light hover:text-paper">Cancel</button>
  </form>;
}

export function AccessTab({ overview, saving, assignRole, removeRole, togglePermission, toggleUserStatus, deleteUser, inviteUser, createRole }: { overview: SettingsOverview; saving: string | null; assignRole: (userId: string, roleId: string) => Promise<void>; removeRole: (userId: string, roleId: string) => Promise<void>; togglePermission: (roleId: string, permission: string, enabled: boolean) => Promise<void>; toggleUserStatus: (userId: string, nextActive: boolean) => Promise<void>; deleteUser: (userId: string) => Promise<void>; inviteUser: (payload: { full_name: string; email: string; role_ids: string[]; no_real_email?: boolean }) => Promise<any>; createRole: (name: string, description?: string) => Promise<void> }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  return <div className="space-y-6">
    {inviteOpen && <InviteUserModal roles={overview.roles} onClose={() => setInviteOpen(false)} onInvite={inviteUser} />}
    <section className="border border-ink-mid bg-ink p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><Users className="h-4 w-4 text-signal" /> User role assignments</h2>
        <button onClick={() => setInviteOpen(true)} className="inline-flex items-center gap-2 border border-signal/50 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-signal hover:bg-signal/10"><UserPlus className="h-3.5 w-3.5" /> Invite user</button>
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-xs"><thead className="border-y border-ink-mid font-mono uppercase tracking-wider text-slate"><tr><th className="p-3">User</th><th className="p-3">Status</th><th className="p-3">Roles</th><th className="p-3">Assign role</th></tr></thead><tbody className="divide-y divide-ink-mid/50">{overview.users.map((user) => <UserAccessRow key={user.id} user={user} roles={overview.roles} saving={saving} assignRole={assignRole} removeRole={removeRole} toggleUserStatus={toggleUserStatus} deleteUser={deleteUser} />)}</tbody></table>
      </div>
      <div className="grid gap-3 lg:hidden">
        {overview.users.map((user) => <UserAccessCard key={user.id} user={user} roles={overview.roles} saving={saving} assignRole={assignRole} removeRole={removeRole} toggleUserStatus={toggleUserStatus} deleteUser={deleteUser} />)}
      </div>
    </section>
    <section className="border border-ink-mid bg-ink p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><LockKeyhole className="h-4 w-4 text-signal" /> Page access by role</h2>
        <NewRoleForm saving={saving} createRole={createRole} />
      </div>
      <p className="mb-4 text-[11px] text-slate-light">A new role starts with no page access. Tick the pages it should see below, then assign it to a user above — the sidebar shows only what a role is granted.</p>
      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full text-left text-xs"><thead className="border-y border-ink-mid font-mono uppercase tracking-wider text-slate"><tr><th className="p-3">ERP page</th><th className="p-3">Permission</th>{overview.roles.map((role) => <th key={role.id} className="p-3 text-center">{role.name}</th>)}</tr></thead><tbody className="divide-y divide-ink-mid/50">{overview.page_access.map((page) => <tr key={`${page.route}|${page.permission}`}><td className="p-3"><p className="font-semibold text-paper">{page.page}</p><p className="text-[11px] text-slate-light">{page.module} · {page.route}</p></td><td className="p-3 font-mono text-[11px] text-slate-light">{page.permission}</td>{overview.roles.map((role) => { const enabled = role.permissions.includes(page.permission); return <td key={role.id} className="p-3 text-center"><input type="checkbox" checked={enabled} disabled={saving === `${role.id}-${page.permission}`} onChange={(event) => void togglePermission(role.id, page.permission, event.target.checked)} /></td>; })}</tr>)}</tbody></table>
      </div>
      <div className="grid gap-3 xl:hidden">
        {overview.page_access.map((page) => <div key={`${page.route}|${page.permission}`} className="border border-ink-mid/70 p-3">
          <div className="mb-3">
            <p className="font-semibold text-paper">{page.page}</p>
            <p className="text-[11px] text-slate-light">{page.module} · {page.route}</p>
            <p className="mt-1 break-all font-mono text-[10px] uppercase text-slate">{page.permission}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {overview.roles.map((role) => {
              const enabled = role.permissions.includes(page.permission);
              return <label key={role.id} className="flex min-w-0 items-center justify-between gap-3 border border-ink-mid/60 px-3 py-2 text-xs text-slate-light">
                <span className="truncate text-paper">{role.name}</span>
                <input type="checkbox" checked={enabled} disabled={saving === `${role.id}-${page.permission}`} onChange={(event) => void togglePermission(role.id, page.permission, event.target.checked)} />
              </label>;
            })}
          </div>
        </div>)}
      </div>
    </section>
  </div>;
}

function UserActionsControl({ user, saving, toggleUserStatus, deleteUser }: { user: AccessUser; saving: string | null; toggleUserStatus: (userId: string, nextActive: boolean) => Promise<void>; deleteUser: (userId: string) => Promise<void> }) {
  const isActive = user.status !== "inactive";
  const busyStatus = saving === `status-${user.id}`;
  const busyDelete = saving === `delete-${user.id}`;
  const [confirmMode, setConfirmMode] = useState<null | "deactivate" | "delete">(null);

  if (confirmMode) {
    const isDelete = confirmMode === "delete";
    const busy = isDelete ? busyDelete : busyStatus;
    return <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-light">{isDelete ? "Remove user?" : "Deactivate?"}</span>
      <button disabled={busy} onClick={() => { setConfirmMode(null); void (isDelete ? deleteUser(user.id) : toggleUserStatus(user.id, false)); }} title={isDelete ? "Confirm removal" : "Confirm deactivation"} className="inline-flex h-6 w-6 items-center justify-center border border-red-500/50 text-red-300 hover:bg-red-500/10 disabled:opacity-50">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
      </button>
      <button disabled={busy} onClick={() => setConfirmMode(null)} title="Cancel" className="inline-flex h-6 w-6 items-center justify-center border border-ink-mid text-slate-light hover:text-paper disabled:opacity-50"><X className="h-3 w-3" /></button>
    </div>;
  }

  return <div className="flex items-center gap-2">
    <StatusBadge status={user.status} />
    <button disabled={busyStatus} onClick={() => isActive ? setConfirmMode("deactivate") : void toggleUserStatus(user.id, true)} title={isActive ? "Deactivate user" : "Reactivate user"} className={`inline-flex h-6 w-6 items-center justify-center border disabled:opacity-50 ${isActive ? "border-red-500/40 text-red-300 hover:bg-red-500/10" : "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"}`}>
      {busyStatus ? <Loader2 className="h-3 w-3 animate-spin" /> : isActive ? <PowerOff className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
    </button>
    <button disabled={busyDelete} onClick={() => setConfirmMode("delete")} title="Remove user" className="inline-flex h-6 w-6 items-center justify-center border border-ink-mid text-slate-light hover:border-red-400 hover:text-red-300 disabled:opacity-50">
      {busyDelete ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
    </button>
  </div>;
}

function UserAccessRow({ user, roles, saving, assignRole, removeRole, toggleUserStatus, deleteUser }: { user: AccessUser; roles: Role[]; saving: string | null; assignRole: (userId: string, roleId: string) => Promise<void>; removeRole: (userId: string, roleId: string) => Promise<void>; toggleUserStatus: (userId: string, nextActive: boolean) => Promise<void>; deleteUser: (userId: string) => Promise<void> }) {
  const [roleId, setRoleId] = useState("");
  const assignedIds = new Set(user.roles.map((role) => role.id));
  return <tr><td className="p-3"><p className="font-semibold text-paper">{user.name}</p><p className="text-[11px] text-slate-light">{user.email}</p></td><td className="p-3"><UserActionsControl user={user} saving={saving} toggleUserStatus={toggleUserStatus} deleteUser={deleteUser} /></td><td className="p-3"><div className="flex flex-wrap gap-2">{user.roles.length === 0 ? <span className="text-slate-light">No roles</span> : user.roles.map((role) => <button key={role.id} disabled={saving === `remove-${user.id}-${role.id}`} onClick={() => void removeRole(user.id, role.id)} className="border border-ink-mid px-2 py-1 text-[11px] text-paper hover:border-red-400">{role.name} ×</button>)}</div></td><td className="p-3"><div className="flex gap-2"><select value={roleId} onChange={(event) => setRoleId(event.target.value)} className="border border-ink-mid bg-ink px-2 py-2 text-xs text-paper"><option value="">Select role</option>{roles.filter((role) => !assignedIds.has(role.id)).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><button disabled={!roleId || saving === `assign-${user.id}`} onClick={() => void assignRole(user.id, roleId)} className="border border-signal/50 px-3 py-2 font-mono text-[10px] uppercase text-signal disabled:opacity-50">Assign</button></div></td></tr>;
}

function UserAccessCard({ user, roles, saving, assignRole, removeRole, toggleUserStatus, deleteUser }: { user: AccessUser; roles: Role[]; saving: string | null; assignRole: (userId: string, roleId: string) => Promise<void>; removeRole: (userId: string, roleId: string) => Promise<void>; toggleUserStatus: (userId: string, nextActive: boolean) => Promise<void>; deleteUser: (userId: string) => Promise<void> }) {
  const [roleId, setRoleId] = useState("");
  const assignedIds = new Set(user.roles.map((role) => role.id));
  return <article className="border border-ink-mid/70 p-3">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="truncate font-semibold text-paper">{user.name}</p><p className="break-all text-[11px] text-slate-light">{user.email}</p></div>
      <UserActionsControl user={user} saving={saving} toggleUserStatus={toggleUserStatus} deleteUser={deleteUser} />
    </div>
    <div className="mb-3 flex flex-wrap gap-2">{user.roles.length === 0 ? <span className="text-xs text-slate-light">No roles</span> : user.roles.map((role) => <button key={role.id} disabled={saving === `remove-${user.id}-${role.id}`} onClick={() => void removeRole(user.id, role.id)} className="border border-ink-mid px-2 py-1 text-[11px] text-paper hover:border-red-400">{role.name} ×</button>)}</div>
    <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><select value={roleId} onChange={(event) => setRoleId(event.target.value)} className="min-w-0 border border-ink-mid bg-ink px-2 py-2 text-xs text-paper"><option value="">Select role</option>{roles.filter((role) => !assignedIds.has(role.id)).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><button disabled={!roleId || saving === `assign-${user.id}`} onClick={() => void assignRole(user.id, roleId)} className="border border-signal/50 px-3 py-2 font-mono text-[10px] uppercase text-signal disabled:opacity-50">Assign</button></div>
  </article>;
}

export function ManagedAccountsTab({ overview, saving, createManagedAccount }: { overview: SettingsOverview; saving: boolean; createManagedAccount: (payload: Record<string, unknown>) => Promise<any> }) {
  const [draft, setDraft] = useState<ManagedAccountDraft>(EMPTY_MANAGED_ACCOUNT);
  const [formError, setFormError] = useState<string | null>(null);
  const [issuedCards, setIssuedCards] = useState<ProvisionedAccountCard[]>([]);
  const visibleRoles = overview.roles.filter((role) => !["SUPERADMIN"].includes(role.name.toUpperCase()));
  const permissions: PermissionOption[] = useMemo(() => {
    const byKey = new Map<string, PermissionOption>();
    overview.permissions.forEach((permission) => {
      byKey.set(permission.key, {
        permission: permission.key,
        page: permission.key.replace(/_/g, " ").replace(/\./g, " / "),
        module: moduleNameFromPermission(permission.key),
        description: permission.description,
      });
    });
    overview.page_access.forEach((page) => {
      byKey.set(page.permission, {
        permission: page.permission,
        page: page.page,
        module: page.module,
        description: byKey.get(page.permission)?.description ?? null,
      });
    });
    return Array.from(byKey.values()).sort((a, b) => `${a.module}.${a.permission}`.localeCompare(`${b.module}.${b.permission}`));
  }, [overview.page_access, overview.permissions]);
  const permissionsByModule = useMemo(() => {
    return permissions.reduce<Record<string, PermissionOption[]>>((groups, permission) => {
      groups[permission.module] = [...(groups[permission.module] ?? []), permission];
      return groups;
    }, {});
  }, [permissions]);

  const updateDraft = <K extends keyof ManagedAccountDraft>(key: K, value: ManagedAccountDraft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  const updateEmployee = <K extends keyof ManagedEmployeeDraft>(index: number, key: K, value: ManagedEmployeeDraft[K]) => setDraft((prev) => ({ ...prev, employees: prev.employees.map((employee, employeeIndex) => employeeIndex === index ? { ...employee, [key]: value } : employee) }));
  const toggleEmployeeArray = (index: number, key: "role_ids" | "module_permissions", value: string) => {
    const current = draft.employees[index][key];
    updateEmployee(index, key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };
  const applyPreset = (index: number, presetId: string) => {
    const preset = ACCESS_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const roleIds = visibleRoles.filter((role) => preset.roleHints.some((hint) => role.name.toUpperCase().includes(hint))).map((role) => role.id);
    // Match module hints (e.g. "crm_leads") against the permission's exact
    // top-level segment, and generic action hints (e.g. "read") against its
    // exact final segment - loose substring matching here previously swept
    // in unrelated permissions (e.g. "documents" matched "crm.documents.x",
    // "read" matched almost every permission key in the catalog), which
    // could select 70+ permissions for a single preset and exceed the
    // backend's module_permissions limit on account creation.
    const selectedPermissions = permissions
      .filter((permission) => {
        const segments = permission.permission.toLowerCase().split(".");
        const topSegment = segments[0];
        const lastSegment = segments[segments.length - 1];
        return preset.permissions.some((match) => match === topSegment || match === lastSegment);
      })
      .map((permission) => permission.permission);
    setDraft((prev) => ({
      ...prev,
      employees: prev.employees.map((employee, employeeIndex) => employeeIndex === index ? {
        ...employee,
        access_level: preset.access_level,
        role_ids: Array.from(new Set([...employee.role_ids, ...roleIds])),
        module_permissions: Array.from(new Set([...selectedPermissions])),
      } : employee),
    }));
  };
  const setModulePermissions = (index: number, module: string, enabled: boolean) => {
    const modulePermissionKeys = permissionsByModule[module]?.map((permission) => permission.permission) ?? [];
    const current = new Set(draft.employees[index].module_permissions);
    modulePermissionKeys.forEach((permission) => enabled ? current.add(permission) : current.delete(permission));
    updateEmployee(index, "module_permissions", Array.from(current));
  };
  const addEmployee = () => setDraft((prev) => ({ ...prev, employees: [...prev.employees, { ...EMPTY_EMPLOYEE }] }));
  const removeEmployee = (index: number) => setDraft((prev) => ({ ...prev, employees: prev.employees.filter((_, employeeIndex) => employeeIndex !== index) }));

  const submit = async () => {
    setFormError(null);
    if (!draft.company_name.trim()) {
      setFormError("Company name is required.");
      return;
    }
    const incompleteEmployee = draft.employees.find((employee) => !employee.full_name.trim() || !employee.email.trim());
    if (incompleteEmployee) {
      setFormError("Every employee needs a full name and email address.");
      return;
    }
    const payload = {
      ...draft,
      email: draft.email || null,
      trading_name: draft.trading_name || null,
      registration_number: draft.registration_number || null,
      tax_number: draft.tax_number || null,
      praz_number: draft.praz_number || null,
      nssa_number: draft.nssa_number || null,
      industry: draft.industry || null,
      website: draft.website || null,
      phone: draft.phone || null,
      address: draft.address || null,
      capability_tags: draft.capability_tags.split(",").map((item) => item.trim()).filter(Boolean),
      employees: draft.employees.map((employee) => ({
        ...employee,
        job_title: employee.job_title || null,
        phone: employee.phone || null,
      })),
    };
    try {
      const result = await createManagedAccount(payload);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      const loginUrl = baseUrl ? `${baseUrl}/login` : "/login";
      const websiteUrl = baseUrl ? `${baseUrl}/` : "/";
      const accountCard: ProvisionedAccountCard = {
        account_type: draft.account_type,
        company_name: draft.company_name,
        trading_name: draft.trading_name,
        website: draft.website,
        portal_path:
          draft.account_type === "client"
            ? "/portal/client"
            : draft.account_type === "supplier"
              ? "/portal/supplier"
              : "/portal/foreman",
        login_url: loginUrl,
        website_url: websiteUrl,
        employees: ((result?.users ?? []) as any[]).map((employee) => ({
          user_id: String(employee.user_id),
          email: String(employee.email),
          temporary_password: String(employee.temporary_password ?? ""),
          access_level: employee.access_level,
          contact_id: employee.contact_id ?? null,
          employee_id: employee.employee_id ?? null,
          custom_role_id: employee.custom_role_id ?? null,
        })),
      };
      setIssuedCards((current) => [accountCard, ...current]);
      setDraft({ ...EMPTY_MANAGED_ACCOUNT, account_type: draft.account_type });
    } catch {
      setFormError("The account could not be created. Check that Supabase Auth is configured and the selected roles still exist.");
    }
  };

  return <section className="space-y-6">
    <div className="border border-ink-mid bg-ink p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-ink-mid pb-4">
        <div>
          <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><Building2 className="h-4 w-4 text-signal" /> Supplier, client, and subcontractor accounts</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-light">Create a complete external company profile, provision its employees, and issue portal cards plus module-level access in one controlled action.</p>
        </div>
        <StatusBadge status={ACCOUNT_TYPE_LABELS[draft.account_type]} />
      </div>

      {formError && <div className="mb-4 flex gap-2 border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100"><AlertTriangle className="h-4 w-4 shrink-0" /> {formError}</div>}

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4 border border-ink-mid/70 p-4">
          <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Account type</span><select value={draft.account_type} onChange={(event) => updateDraft("account_type", event.target.value as ManagedAccountType)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper"><option value="client">Client</option><option value="supplier">Supplier</option><option value="subcontractor">Subcontractor</option></select></label>
          <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Company name</span><input value={draft.company_name} onChange={(event) => updateDraft("company_name", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
          <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Trading name</span><input value={draft.trading_name} onChange={(event) => updateDraft("trading_name", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Registration</span><input value={draft.registration_number} onChange={(event) => updateDraft("registration_number", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
            <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Tax number</span><input value={draft.tax_number} onChange={(event) => updateDraft("tax_number", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="font-mono text-[10px] uppercase text-slate">PRAZ</span><input value={draft.praz_number} onChange={(event) => updateDraft("praz_number", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
            <label className="block"><span className="font-mono text-[10px] uppercase text-slate">NSSA</span><input value={draft.nssa_number} onChange={(event) => updateDraft("nssa_number", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
          </div>
          <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Capability tags</span><input placeholder="Civil works, electrical, concrete" value={draft.capability_tags} onChange={(event) => updateDraft("capability_tags", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Compliance</span><select value={draft.compliance_status} onChange={(event) => updateDraft("compliance_status", event.target.value as ManagedAccountDraft["compliance_status"])} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper"><option value="pending">Pending</option><option value="compliant">Compliant</option><option value="non_compliant">Non-compliant</option><option value="exempt">Exempt</option></select></label>
            <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Access tier</span><input type="number" min={1} max={5} value={draft.authorization_tier} onChange={(event) => updateDraft("authorization_tier", Number(event.target.value))} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
          </div>
          <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Address</span><textarea value={draft.address} onChange={(event) => updateDraft("address", event.target.value)} rows={3} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Company email</span><input type="email" value={draft.email} onChange={(event) => updateDraft("email", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
            <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Company phone</span><input value={draft.phone} onChange={(event) => updateDraft("phone", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
            <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Website</span><input value={draft.website} onChange={(event) => updateDraft("website", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-ink-mid pb-2">
              <h3 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><UserPlus className="h-4 w-4 text-signal" /> Employees and access</h3>
              <button type="button" onClick={addEmployee} className="inline-flex items-center gap-2 border border-ink-mid px-3 py-2 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper"><Plus className="h-3.5 w-3.5" /> Add employee</button>
            </div>

            {draft.employees.map((employee, index) => <article key={index} className="border border-ink-mid/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Employee {index + 1}</p>
                {draft.employees.length > 1 && <button type="button" onClick={() => removeEmployee(index)} className="inline-flex h-8 w-8 items-center justify-center border border-red-500/30 text-red-300 hover:bg-red-500/10" title="Remove employee"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Full name</span><input value={employee.full_name} onChange={(event) => updateEmployee(index, "full_name", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
                <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Email</span><input type="email" value={employee.email} onChange={(event) => updateEmployee(index, "email", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
                <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Job title</span><input value={employee.job_title} onChange={(event) => updateEmployee(index, "job_title", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
                <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Phone</span><input value={employee.phone} onChange={(event) => updateEmployee(index, "phone", event.target.value)} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /></label>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
                <div className="space-y-3">
                  <div>
                    <p className="mb-2 font-mono text-[10px] uppercase text-slate">Access preset</p>
                    <div className="grid gap-2">
                      {ACCESS_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => applyPreset(index, preset.id)} className="border border-ink-mid/70 px-3 py-2 text-left hover:border-signal hover:bg-signal/5">
                        <span className="block font-mono text-[10px] uppercase tracking-wider text-paper">{preset.label}</span>
                        <span className="mt-1 block text-[11px] leading-relaxed text-slate-light">{preset.description}</span>
                      </button>)}
                    </div>
                  </div>
                  <label className="block"><span className="font-mono text-[10px] uppercase text-slate">Access level</span><select value={employee.access_level} onChange={(event) => updateEmployee(index, "access_level", event.target.value as ManagedEmployeeDraft["access_level"])} className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper"><option value="viewer">Viewer</option><option value="contributor">Contributor</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label>
                  <label className="flex items-center gap-2 text-xs text-slate-light"><input type="checkbox" checked={employee.portal_access} onChange={(event) => updateEmployee(index, "portal_access", event.target.checked)} /> Portal access enabled</label>
                  <div><p className="mb-2 font-mono text-[10px] uppercase text-slate">Roles</p><div className="max-h-36 space-y-1 overflow-y-auto border border-ink-mid/70 p-2">{visibleRoles.map((role) => <label key={role.id} className="flex items-center gap-2 text-xs text-slate-light"><input type="checkbox" checked={employee.role_ids.includes(role.id)} onChange={() => toggleEmployeeArray(index, "role_ids", role.id)} /> {role.name}</label>)}</div></div>
                </div>
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-[10px] uppercase text-slate">Module permissions</p>
                    <span className="font-mono text-[10px] uppercase text-signal">{employee.module_permissions.length} selected</span>
                  </div>
                  <div className="max-h-[30rem] space-y-3 overflow-y-auto border border-ink-mid/70 p-3">
                    {Object.entries(permissionsByModule).map(([module, modulePermissions]) => {
                      const selectedCount = modulePermissions.filter((permission) => employee.module_permissions.includes(permission.permission)).length;
                      return <div key={module} className="border border-ink-mid/50 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div><p className="font-semibold text-paper">{module}</p><p className="font-mono text-[10px] uppercase text-slate">{selectedCount}/{modulePermissions.length} permissions</p></div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setModulePermissions(index, module, true)} className="border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper">All</button>
                            <button type="button" onClick={() => setModulePermissions(index, module, false)} className="border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase text-slate-light hover:border-red-400 hover:text-paper">Clear</button>
                          </div>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          {modulePermissions.map((permission) => <label key={permission.permission} className="flex min-w-0 items-start gap-2 text-xs text-slate-light"><input type="checkbox" checked={employee.module_permissions.includes(permission.permission)} onChange={() => toggleEmployeeArray(index, "module_permissions", permission.permission)} className="mt-0.5" /><span className="min-w-0"><span className="block truncate text-paper">{permission.page}</span><span className="block break-all font-mono text-[10px] uppercase text-slate">{permission.permission}</span></span></label>)}
                        </div>
                      </div>;
                    })}
                  </div>
                </div>
              </div>
            </article>)}
          </div>

          <div className="flex justify-end border-t border-ink-mid pt-4">
            <button type="button" disabled={saving} onClick={() => void submit()} className="inline-flex items-center gap-2 border border-signal/50 bg-signal/5 px-4 py-2 font-mono text-xs uppercase text-signal hover:bg-signal/15 disabled:opacity-50"><ShieldCheck className="h-4 w-4" /> {saving ? "Creating account..." : "Create account and issue cards"}</button>
          </div>

          {issuedCards.length > 0 && (
            <section className="border border-signal/30 bg-signal/5 p-4">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-signal/20 pb-3">
                <div>
                  <h3 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper">
                    <CheckCircle2 className="h-4 w-4 text-signal" /> Issued access cards
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-light">Scan the login QR to reach the sign-in page, then use the temporary credential and set a new password on first entry.</p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-signal">{issuedCards.length} account{issuedCards.length === 1 ? "" : "s"}</span>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {issuedCards.map((card) => (
                  <ProvisionedAccessCard key={`${card.company_name}-${card.account_type}`} card={card} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  </section>;
}

function QrTile({ value, label }: { value: string; label: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!value) {
      setDataUrl(null);
      return;
    }

    void QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: 220 })
      .then((result: string) => {
        if (mounted) setDataUrl(result);
      })
      .catch(() => {
        if (mounted) setDataUrl(null);
      });

    return () => {
      mounted = false;
    };
  }, [value]);

  return (
    <div className="border border-ink-mid bg-ink p-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate">{label}</p>
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt={label} className="h-40 w-40 bg-white p-2" />
      ) : (
        <div className="flex h-40 w-40 items-center justify-center border border-dashed border-ink-mid text-[11px] text-slate-light">
          QR unavailable
        </div>
      )}
    </div>
  );
}

function ProvisionedAccessCard({ card }: { card: ProvisionedAccountCard }) {
  return (
    <article className="border border-ink-mid bg-ink-light p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-mid pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Provisioned account</p>
          <h3 className="mt-1 text-lg font-semibold text-paper">{card.company_name}</h3>
          <p className="mt-1 text-xs text-slate-light">
            {ACCOUNT_TYPE_LABELS[card.account_type]} portal {card.trading_name ? `· ${card.trading_name}` : ""}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-light">{card.portal_path}</span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          <div className="border border-ink-mid bg-ink p-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Login page</p>
            <p className="mt-2 break-all font-mono text-[11px] text-paper">{card.login_url}</p>
          </div>
          <QrTile value={card.login_url} label="Login QR" />
        </div>

        <div className="space-y-3">
          <div className="border border-ink-mid bg-ink p-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Website</p>
            <p className="mt-2 break-all font-mono text-[11px] text-paper">{card.website_url}</p>
          </div>
          <QrTile value={card.website_url} label="Website QR" />
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {card.employees.map((employee) => (
          <div key={employee.user_id} className="border border-signal/20 bg-signal/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Login credentials</p>
                <p className="mt-1 text-sm font-semibold text-paper">{employee.email}</p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-signal">{employee.access_level}</span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div className="border border-ink-mid bg-ink p-2">
                <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Temporary password</p>
                <p className="mt-1 break-all font-mono text-[12px] text-paper">{employee.temporary_password}</p>
              </div>
              <div className="border border-ink-mid bg-ink p-2">
                <p className="font-mono text-[10px] uppercase tracking-widest text-slate">First login</p>
                <p className="mt-1 text-xs text-slate-light">Users must change this password immediately after signing in.</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

export function WebsiteTab({ items, saving, saveContent }: { items: WebsiteContent[]; saving: string | null; saveContent: (item: WebsiteContent) => Promise<void> }) {
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
        <div className="border border-ink-mid/70 bg-ink-mid/5 p-4 space-y-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
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
                  <div className="w-20 h-20 bg-ink-mid relative shrink-0 overflow-hidden border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
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

export function AuditTab({ events, loading, error, auditSearch, setAuditSearch, auditStatus, setAuditStatus, onRefresh }: { events: AuditEvent[]; loading: boolean; error: string | null; auditSearch: string; setAuditSearch: (value: string) => void; auditStatus: string; setAuditStatus: (value: string) => void; onRefresh: () => void }) {
  return <section className="border border-ink-mid bg-ink p-5"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-paper"><History className="h-4 w-4 text-signal" /> Security event audit log</h2><p className="mt-1 text-xs text-slate-light">Immutable settings, access, and content-control events.</p></div><div className="flex flex-wrap gap-2"><input value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} placeholder="Search events" className="border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal" /><select value={auditStatus} onChange={(event) => setAuditStatus(event.target.value)} className="border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"><option value="all">All outcomes</option><option value="success">Success</option><option value="warning">Warning</option><option value="blocked">Blocked</option></select><button onClick={onRefresh} className="border border-ink-mid px-3 py-2 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper">Refresh audit</button></div></div>{error && <div className="mb-4 flex gap-2 border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</div>}<div className="overflow-x-auto">{loading ? <div className="flex h-48 items-center justify-center text-slate-light"><Loader2 className="mr-2 h-5 w-5 animate-spin text-signal" /> Loading audit events...</div> : <table className="w-full text-left text-xs"><thead className="border-y border-ink-mid font-mono uppercase tracking-wider text-slate"><tr><th className="p-3">Time</th><th className="p-3">Event</th><th className="p-3">Actor</th><th className="p-3">Resource</th><th className="p-3">Details</th><th className="p-3">Outcome</th></tr></thead><tbody className="divide-y divide-ink-mid/50">{events.map((event) => <tr key={event.id}><td className="p-3 whitespace-nowrap text-slate-light">{dateTime(event.occurred_at)}</td><td className="p-3 font-semibold text-paper">{event.event}</td><td className="p-3 text-slate-light">{event.actor}</td><td className="p-3 text-slate-light">{event.resource}</td><td className="p-3 text-slate-light">{event.details || "-"}</td><td className="p-3"><StatusBadge status={event.status} /></td></tr>)}{events.length === 0 && <tr><td colSpan={6} className="p-10 text-center font-mono text-sm text-slate-light">No audit events match the active filters.</td></tr>}</tbody></table>}</div></section>;
}
