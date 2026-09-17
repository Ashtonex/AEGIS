"use client";

import type React from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck, CheckCircle2, Clock, ChevronDown, ChevronRight, FolderKanban,
  Loader2, Pencil, Plus, RefreshCw, Search, Send, UserPlus, UserX, Users, Wallet, X, XCircle,
} from "lucide-react";
import {
  createPayrollRun,
  decidePayrollRun,
  getFinanceCashAccounts,
  getFinancePayrollProfiles,
  getHREmployees,
  getPayrollItemAllocations,
  getPayrollRun,
  getPayrollRuns,
  putPayrollItemAllocations,
  upsertFinancePayrollProfile,
} from "@/lib/api";
import { Skeleton, SkeletonTableRows } from "@/components/ui/Skeleton";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function endOfMonth(dateStr: string) {
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const labelClass = "block text-[11px] font-mono uppercase tracking-wider text-slate mb-1";
const buttonClass = "inline-flex items-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50 disabled:cursor-not-allowed";
const ghostButtonClass = "inline-flex items-center gap-2 border border-ink-mid text-paper font-medium px-3 py-2 rounded-sm text-sm hover:border-signal/50 disabled:opacity-50";

const RUN_STATUS_CLASS: Record<string, string> = {
  draft: "border-slate-500/30 bg-slate-950/20 text-slate-300",
  approved: "border-sky-500/30 bg-sky-950/20 text-sky-300",
  posted: "border-emerald-500/30 bg-emerald-950/20 text-emerald-300",
  cancelled: "border-red-500/30 bg-red-950/20 text-red-300",
};
const RUN_STATUS_ICON: Record<string, typeof Clock> = {
  draft: Clock,
  approved: BadgeCheck,
  posted: CheckCircle2,
  cancelled: XCircle,
};

const PAY_TYPE_LABEL: Record<string, string> = { monthly_salary: "Monthly", hourly: "Hourly", daily: "Daily" };
const PAY_TYPE_CLASS: Record<string, string> = {
  monthly_salary: "border-sky-500/30 bg-sky-950/20 text-sky-300",
  hourly: "border-amber-500/30 bg-amber-950/20 text-amber-300",
  daily: "border-violet-500/30 bg-violet-950/20 text-violet-300",
};

const AVATAR_PALETTE = [
  "bg-sky-500/15 text-sky-300",
  "bg-emerald-500/15 text-emerald-300",
  "bg-amber-500/15 text-amber-300",
  "bg-violet-500/15 text-violet-300",
  "bg-rose-500/15 text-rose-300",
  "bg-signal/15 text-signal",
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function avatarTone(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const dims = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  return (
    <span className={`inline-flex ${dims} flex-shrink-0 items-center justify-center rounded-full font-semibold ${avatarTone(name)}`}>
      {initials(name)}
    </span>
  );
}

function PayTypeBadge({ payType }: { payType: string }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${PAY_TYPE_CLASS[payType] || "border-ink-mid text-slate"}`}>
      {PAY_TYPE_LABEL[payType] || payType}
    </span>
  );
}

function estimateGross(profile: RecordData, regularHours: number, overtimeHours: number) {
  const base = Number(profile.base_rate || 0);
  const ot = Number(profile.overtime_rate || 0);
  switch (profile.pay_type) {
    case "monthly_salary":
      return base + overtimeHours * (ot || 0);
    case "hourly":
      return regularHours * base + overtimeHours * (ot || base * 1.5);
    case "daily":
      return (regularHours / 8) * base + overtimeHours * (ot || (base / 8) * 1.5);
    default:
      return base;
  }
}

function emptyProfileForm() {
  return { employee_id: "", pay_type: "monthly_salary", base_rate: "", overtime_rate: "0", currency: "USD", bank_name: "", bank_account_number: "", tax_number: "", nssa_number: "" };
}

export function PayrollPanel({ projects, departmentId = "" }: { projects: RecordData[]; departmentId?: string }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [accounts, setAccounts] = useState<RecordData[]>([]);
  const [employees, setEmployees] = useState<RecordData[]>([]);
  const [payProfiles, setPayProfiles] = useState<RecordData[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<RecordData[]>([]);

  const [profileForm, setProfileForm] = useState(emptyProfileForm());
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileSearch, setProfileSearch] = useState("");

  const [runForm, setRunForm] = useState({ period_start: `${today().slice(0, 7)}-01`, period_end: endOfMonth(today()), payment_date: today(), cash_account_id: "", project_id: "" });
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedProfileIds, setSelectedProfileIds] = useState<Record<string, boolean>>({});
  const [profileHours, setProfileHours] = useState<Record<string, { regular_hours: string; overtime_hours: string }>>({});

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedRunItems, setExpandedRunItems] = useState<RecordData[]>([]);
  const [expandedRunLoading, setExpandedRunLoading] = useState(false);

  const notify = (text: string, tone: "ok" | "error" = "ok") => setNotice({ text, tone });

  const loadData = useCallback(async () => {
    setLoading(true);
    const [accountRes, employeeRes, profileRes, runRes] = await Promise.allSettled([
      getFinanceCashAccounts(),
      getHREmployees({ status: "active" }),
      getFinancePayrollProfiles(),
      getPayrollRuns({ department_id: departmentId || undefined }),
    ]);
    if (accountRes.status === "fulfilled") setAccounts(accountRes.value.data || []);
    if (employeeRes.status === "fulfilled") setEmployees(employeeRes.value.data || []);
    if (profileRes.status === "fulfilled") setPayProfiles(profileRes.value.data || []);
    if (runRes.status === "fulfilled") setPayrollRuns(runRes.value.data || []);
    setLoading(false);
  }, [departmentId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.id, e.employee_name || e.full_name || e.name || "");
    return map;
  }, [employees]);
  const profileDisplayName = useCallback((p: RecordData) => employeeNameById.get(p.employee_id) || p.full_name || p.employee_id, [employeeNameById]);

  const profilesByEmployeeId = useMemo(() => new Set(payProfiles.map(p => p.employee_id)), [payProfiles]);
  const employeesWithoutProfile = useMemo(() => employees.filter(e => !profilesByEmployeeId.has(e.id)), [employees, profilesByEmployeeId]);
  const openPayrollTotal = useMemo(() => payrollRuns.filter(r => r.status !== "posted" && r.status !== "cancelled").reduce((sum, r) => sum + Number(r.net_pay || 0), 0), [payrollRuns]);
  const postedThisYear = useMemo(() => {
    const yr = String(new Date().getFullYear());
    return payrollRuns.filter(r => r.status === "posted" && String(r.period_start || "").startsWith(yr)).reduce((sum, r) => sum + Number(r.net_pay || 0), 0);
  }, [payrollRuns]);

  const filteredProfiles = useMemo(() => {
    const q = profileSearch.trim().toLowerCase();
    if (!q) return payProfiles;
    return payProfiles.filter(p => `${profileDisplayName(p)} ${p.employee_number || ""}`.toLowerCase().includes(q));
  }, [payProfiles, profileSearch, profileDisplayName]);

  const runCandidates = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return payProfiles;
    return payProfiles.filter(p => `${profileDisplayName(p)} ${p.employee_number || ""}`.toLowerCase().includes(q));
  }, [payProfiles, employeeSearch, profileDisplayName]);

  const selectedCount = Object.values(selectedProfileIds).filter(Boolean).length;
  const selectedEstimate = useMemo(() => {
    return payProfiles.filter(p => selectedProfileIds[p.id]).reduce((sum, p) => {
      const hours = profileHours[p.id] || { regular_hours: "160", overtime_hours: "0" };
      return sum + estimateGross(p, Number(hours.regular_hours) || 0, Number(hours.overtime_hours) || 0);
    }, 0);
  }, [payProfiles, selectedProfileIds, profileHours]);

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      notify(success, "ok");
      await loadData();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Payroll operation failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const openProfileForm = (profile?: RecordData) => {
    if (profile) {
      setProfileForm({
        employee_id: profile.employee_id,
        pay_type: profile.pay_type || "monthly_salary",
        base_rate: String(profile.base_rate ?? ""),
        overtime_rate: String(profile.overtime_rate ?? "0"),
        currency: profile.currency || "USD",
        bank_name: profile.bank_name || "",
        bank_account_number: profile.bank_account_number || "",
        tax_number: profile.tax_number || "",
        nssa_number: profile.nssa_number || "",
      });
    } else {
      setProfileForm(emptyProfileForm());
    }
    setShowProfileForm(true);
  };

  const saveProfile = (event: React.FormEvent) => {
    event.preventDefault();
    void runAction(
      () => upsertFinancePayrollProfile({ ...profileForm, base_rate: Number(profileForm.base_rate), overtime_rate: Number(profileForm.overtime_rate) }),
      "Payroll profile saved."
    ).then(() => setShowProfileForm(false));
  };

  const toggleProfileSelected = (profileId: string) => {
    setSelectedProfileIds(prev => ({ ...prev, [profileId]: !prev[profileId] }));
    setProfileHours(prev => prev[profileId] ? prev : { ...prev, [profileId]: { regular_hours: "160", overtime_hours: "0" } });
  };

  const createRun = (event: React.FormEvent) => {
    event.preventDefault();
    const selected = payProfiles.filter(p => selectedProfileIds[p.id]);
    if (selected.length === 0) {
      notify("Select at least one employee to include in this run.", "error");
      return;
    }
    if (!runForm.cash_account_id) {
      notify("Choose the cash account payroll will be paid from.", "error");
      return;
    }
    const items = selected.map(p => {
      const hours = profileHours[p.id] || { regular_hours: "0", overtime_hours: "0" };
      return {
        employee_id: p.employee_id,
        project_id: runForm.project_id || null,
        regular_hours: Number(hours.regular_hours) || 0,
        overtime_hours: Number(hours.overtime_hours) || 0,
        other_deduction: 0,
      };
    });
    void runAction(() => createPayrollRun({
      period_start: runForm.period_start,
      period_end: runForm.period_end,
      payment_date: runForm.payment_date,
      cash_account_id: runForm.cash_account_id,
      items,
    }), `Payroll run created for ${selected.length} employee${selected.length === 1 ? "" : "s"}.`);
    setSelectedProfileIds({});
  };

  const toggleRunExpanded = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      setExpandedRunItems([]);
      return;
    }
    setExpandedRunId(runId);
    setExpandedRunLoading(true);
    try {
      const res = await getPayrollRun(runId);
      setExpandedRunItems(res.data?.items || []);
    } finally {
      setExpandedRunLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-ink-light border border-ink-mid rounded-lg p-4 space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
        <div className="bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
          <div className="border-b border-ink-mid px-4 py-3"><Skeleton className="h-3 w-32" /></div>
          <SkeletonTableRows rows={4} columns={5} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Metric icon={Users} label="Payroll profiles" value={String(payProfiles.length)} />
        <Metric icon={Wallet} label="Open payroll" value={money(openPayrollTotal)} />
        <Metric icon={CheckCircle2} label="Posted this year" value={money(postedThisYear)} />
        <Metric
          icon={UserX}
          label="Missing a profile"
          value={String(employeesWithoutProfile.length)}
          tone={employeesWithoutProfile.length > 0 ? "warn" : "default"}
        />
      </div>

      {notice && (
        <div className={`border px-4 py-3 text-sm flex justify-between items-center animate-in fade-in slide-in-from-top-1 duration-fast ${notice.tone === "error" ? "border-red-500/30 bg-red-950/20 text-red-300" : "border-signal/30 bg-signal/10 text-paper"}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="hover:opacity-70"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {employeesWithoutProfile.length > 0 && (
        <div className="border border-amber-500/30 bg-amber-950/10 px-4 py-3 text-sm text-amber-200 flex flex-wrap items-center gap-2">
          <UserX className="h-4 w-4 flex-shrink-0" />
          <span>{employeesWithoutProfile.length} active employee{employeesWithoutProfile.length === 1 ? "" : "s"} won&apos;t appear in a payroll run until they have a pay profile: {employeesWithoutProfile.slice(0, 4).map(e => e.employee_name || e.full_name || e.name).join(", ")}{employeesWithoutProfile.length > 4 ? `, +${employeesWithoutProfile.length - 4} more` : ""}.</span>
        </div>
      )}

      <Panel
        title="Payroll Profiles"
        action={
          <button onClick={() => (showProfileForm ? setShowProfileForm(false) : openProfileForm())} className={ghostButtonClass}>
            {showProfileForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showProfileForm ? "Cancel" : "Add profile"}
          </button>
        }
      >
        {showProfileForm && (
          <form onSubmit={saveProfile} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5 p-4 bg-ink/40 border border-ink-mid rounded animate-in fade-in slide-in-from-top-1 duration-fast">
            <div>
              <label className={labelClass}>Employee</label>
              <select className={inputClass} value={profileForm.employee_id} onChange={e => setProfileForm({ ...profileForm, employee_id: e.target.value })} required>
                <option value="">Select employee</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.employee_name || e.full_name || e.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Pay type</label>
              <select className={inputClass} value={profileForm.pay_type} onChange={e => setProfileForm({ ...profileForm, pay_type: e.target.value })}>
                <option value="monthly_salary">Monthly salary</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Currency</label>
              <select className={inputClass} value={profileForm.currency} onChange={e => setProfileForm({ ...profileForm, currency: e.target.value })}>
                <option value="USD">USD</option>
                <option value="ZWG">ZWG</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{profileForm.pay_type === "monthly_salary" ? "Monthly base rate" : profileForm.pay_type === "daily" ? "Day rate" : "Hourly rate"}</label>
              <input className={inputClass} placeholder="0.00" value={profileForm.base_rate} onChange={e => setProfileForm({ ...profileForm, base_rate: e.target.value })} required />
            </div>
            <div>
              <label className={labelClass}>Overtime rate</label>
              <input className={inputClass} placeholder="0.00" value={profileForm.overtime_rate} onChange={e => setProfileForm({ ...profileForm, overtime_rate: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Bank</label>
              <input className={inputClass} value={profileForm.bank_name} onChange={e => setProfileForm({ ...profileForm, bank_name: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Bank account number</label>
              <input className={inputClass} value={profileForm.bank_account_number} onChange={e => setProfileForm({ ...profileForm, bank_account_number: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Tax (PAYE) number</label>
              <input className={inputClass} value={profileForm.tax_number} onChange={e => setProfileForm({ ...profileForm, tax_number: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>NSSA number</label>
              <input className={inputClass} value={profileForm.nssa_number} onChange={e => setProfileForm({ ...profileForm, nssa_number: e.target.value })} />
            </div>
            <div className="md:col-span-3 flex justify-end">
              <button disabled={busy} className={buttonClass}><BadgeCheck className="h-4 w-4" />Save Profile</button>
            </div>
          </form>
        )}

        <div className="relative mb-3">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate" />
          <input className={`${inputClass} pl-8 pr-8`} placeholder="Search profiles by name or employee number..." value={profileSearch} onChange={e => setProfileSearch(e.target.value)} />
          {profileSearch && (
            <button onClick={() => setProfileSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate hover:text-paper" title="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {filteredProfiles.length === 0 ? (
          <EmptyState
            icon={payProfiles.length === 0 ? UserPlus : Search}
            title={payProfiles.length === 0 ? "No payroll profiles yet" : "No profiles match your search"}
            subtitle={payProfiles.length === 0 ? "Add a profile above to start running payroll for an employee." : "Try a different name or employee number."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[11px]">
                  <th className="p-2">Employee</th><th className="p-2">No.</th><th className="p-2">Pay type</th>
                  <th className="p-2 text-right">Rate</th><th className="p-2">Bank</th><th className="p-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {filteredProfiles.map(p => (
                  <tr key={p.id} className="hover:bg-ink-mid/20 transition-colors duration-micro">
                    <td className="p-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={profileDisplayName(p)} size="sm" />
                        <span className="text-paper font-medium">{profileDisplayName(p)}</span>
                      </div>
                    </td>
                    <td className="p-2 text-slate-light">{p.employee_number || "—"}</td>
                    <td className="p-2"><PayTypeBadge payType={p.pay_type} /></td>
                    <td className="p-2 text-right text-paper tabular-nums">{money(p.base_rate)}</td>
                    <td className="p-2 text-slate-light">{p.bank_name || "—"}</td>
                    <td className="p-2 text-right">
                      <button onClick={() => openProfileForm(p)} className="text-slate hover:text-signal transition-colors duration-micro" title="Edit profile"><Pencil className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Run Payroll">
        <form onSubmit={createRun} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <label className={labelClass}>Period start</label>
              <input className={inputClass} type="date" value={runForm.period_start} onChange={e => setRunForm({ ...runForm, period_start: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Period end</label>
              <input className={inputClass} type="date" value={runForm.period_end} onChange={e => setRunForm({ ...runForm, period_end: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Payment date</label>
              <input className={inputClass} type="date" value={runForm.payment_date} onChange={e => setRunForm({ ...runForm, payment_date: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Pay from account</label>
              <select className={inputClass} value={runForm.cash_account_id} onChange={e => setRunForm({ ...runForm, cash_account_id: e.target.value })} required>
                <option value="">Cash account</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name} - {money(a.current_balance)}</option>)}
              </select>
            </div>
            <div>
              <label className={`${labelClass} flex items-center gap-1`}><FolderKanban className="h-3 w-3" />Project (optional)</label>
              <select className={inputClass} value={runForm.project_id} onChange={e => setRunForm({ ...runForm, project_id: e.target.value })}>
                <option value="">HQ / no project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelClass}>Employees in this run</label>
              <div className="relative w-56">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate" />
                <input className={`${inputClass} pl-7 pr-7 py-1.5`} placeholder="Search..." value={employeeSearch} onChange={e => setEmployeeSearch(e.target.value)} />
                {employeeSearch && (
                  <button onClick={() => setEmployeeSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate hover:text-paper" title="Clear search">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="border border-ink-mid rounded overflow-hidden">
              {payProfiles.length === 0 ? (
                <EmptyState icon={UserPlus} title="No active payroll profiles" subtitle="Add one above first to include them in a run." compact />
              ) : (
                <div className="max-h-80 overflow-y-auto divide-y divide-ink-mid">
                  <div className="hidden md:grid grid-cols-[auto_1fr_100px_100px_110px] gap-2 px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-slate bg-ink/30 sticky top-0">
                    <span></span><span>Employee</span><span className="text-right">Reg. hrs</span><span className="text-right">OT hrs</span><span className="text-right">Est. gross</span>
                  </div>
                  {runCandidates.map(p => {
                    const checked = !!selectedProfileIds[p.id];
                    const hours = profileHours[p.id] || { regular_hours: "160", overtime_hours: "0" };
                    const estimate = checked ? estimateGross(p, Number(hours.regular_hours) || 0, Number(hours.overtime_hours) || 0) : 0;
                    return (
                      <div key={p.id} className={`grid grid-cols-[auto_1fr_100px_100px_110px] gap-2 items-center px-3 py-2 text-sm transition-colors duration-micro ${checked ? "bg-signal/5" : ""}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleProfileSelected(p.id)} className="accent-signal" />
                        <div className="min-w-0 flex items-center gap-2">
                          <Avatar name={profileDisplayName(p)} size="sm" />
                          <div className="min-w-0">
                            <p className="text-paper truncate">{profileDisplayName(p)}</p>
                            <p className="text-[11px] text-slate">{PAY_TYPE_LABEL[p.pay_type] || p.pay_type} &middot; {money(p.base_rate)}</p>
                          </div>
                        </div>
                        <input
                          className={`${inputClass} py-1 text-right`}
                          disabled={!checked}
                          value={hours.regular_hours}
                          onChange={e => setProfileHours(prev => ({ ...prev, [p.id]: { ...hours, regular_hours: e.target.value } }))}
                        />
                        <input
                          className={`${inputClass} py-1 text-right`}
                          disabled={!checked}
                          value={hours.overtime_hours}
                          onChange={e => setProfileHours(prev => ({ ...prev, [p.id]: { ...hours, overtime_hours: e.target.value } }))}
                        />
                        <span className="text-right text-paper tabular-nums">{checked ? money(estimate) : "—"}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className={`flex flex-wrap items-center justify-between gap-3 rounded px-3 py-2.5 transition-colors duration-fast ${selectedCount > 0 ? "bg-signal/5 border border-signal/20" : "border-t border-ink-mid"}`}>
            <span className="flex items-center gap-2 text-sm text-slate">
              <Users className="h-3.5 w-3.5" />
              {selectedCount === 0 ? "No employees selected" : `${selectedCount} employee${selectedCount === 1 ? "" : "s"} selected · est. gross ${money(selectedEstimate)}`}
            </span>
            <button disabled={busy || selectedCount === 0} className={buttonClass}><Send className="h-4 w-4" />Create Run</button>
          </div>
        </form>
      </Panel>

      <Panel title="Payroll Runs">
        {payrollRuns.length === 0 ? (
          <EmptyState icon={Send} title="No payroll runs yet" subtitle="Create one above once profiles and employees are selected." compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[11px]">
                  <th className="p-2"></th><th className="p-2">Run</th><th className="p-2">Period</th>
                  <th className="p-2 text-right">Net pay</th><th className="p-2">Status</th><th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {payrollRuns.map(run => {
                  const StatusIcon = RUN_STATUS_ICON[run.status] || Clock;
                  return (
                  <Fragment key={run.id}>
                    <tr className="hover:bg-ink-mid/20 transition-colors duration-micro cursor-pointer" onClick={() => void toggleRunExpanded(run.id)}>
                      <td className="p-2 text-slate">{expandedRunId === run.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="p-2 text-paper font-medium">{run.run_number}</td>
                      <td className="p-2 text-slate-light">{run.period_start} &rarr; {run.period_end}</td>
                      <td className="p-2 text-right text-paper tabular-nums">{money(run.net_pay)}</td>
                      <td className="p-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${RUN_STATUS_CLASS[run.status] || ""}`}>
                          <StatusIcon className="h-3 w-3" />{run.status}
                        </span>
                      </td>
                      <td className="p-2 text-right" onClick={e => e.stopPropagation()}>
                        {run.status === "draft" && <button disabled={busy} className="text-xs text-signal hover:underline" onClick={() => void runAction(() => decidePayrollRun(run.id, "approve"), "Payroll run approved.")}>Approve</button>}
                        {run.status === "approved" && <button disabled={busy} className="text-xs text-signal hover:underline" onClick={() => void runAction(() => decidePayrollRun(run.id, "post"), "Payroll posted.")}>Post</button>}
                      </td>
                    </tr>
                    {expandedRunId === run.id && (
                      <tr className="animate-in fade-in duration-fast">
                        <td colSpan={6} className="p-0 bg-ink/20">
                          <div className="p-3 space-y-2">
                            {expandedRunLoading ? (
                              <p className="text-xs text-slate flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Loading items...</p>
                            ) : expandedRunItems.length === 0 ? (
                              <p className="text-xs text-slate">No items on this run.</p>
                            ) : (
                              expandedRunItems.map(item => (
                                <PayrollItemAllocationRow
                                  key={item.id}
                                  item={item}
                                  projects={projects}
                                  editable={run.status === "draft" || run.status === "approved"}
                                  onSaved={() => notify("Allocation saved.")}
                                />
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <button onClick={() => void loadData()} className="inline-flex items-center gap-2 text-xs text-slate hover:text-paper"><RefreshCw className="h-3 w-3" />Refresh payroll</button>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone = "default" }: { icon: any; label: string; value: string; tone?: "default" | "warn" }) {
  return (
    <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-4 transition-colors duration-fast hover:border-signal/30">
      <div className="flex items-center gap-2 text-slate text-xs font-mono uppercase"><Icon className="h-4 w-4" />{label}</div>
      <div className={`mt-2 text-xl font-semibold ${tone === "warn" && value !== "0" ? "text-amber-400" : "text-paper"}`}>{value}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle, compact = false }: { icon: any; title: string; subtitle: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-6" : "py-10"}`}>
      <div className="h-10 w-10 rounded-full bg-ink-mid/40 flex items-center justify-center mb-3">
        <Icon className="h-4.5 w-4.5 text-slate" />
      </div>
      <p className="text-sm text-paper font-medium">{title}</p>
      <p className="text-xs text-slate mt-1 max-w-xs">{subtitle}</p>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
      <div className="border-b border-ink-mid px-4 py-3 flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wider text-slate">{title}</span>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function PayrollItemAllocationRow({ item, projects, editable, onSaved }: { item: RecordData; projects: RecordData[]; editable: boolean; onSaved: () => void }) {
  const [rows, setRows] = useState<Array<{ project_id: string; allocation_pct: string }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPayrollItemAllocations(item.id).then(res => {
      if (cancelled) return;
      const existing = res.data?.allocations || [];
      setRows(
        existing.length > 0
          ? existing.map((a: RecordData) => ({ project_id: a.project_id || "", allocation_pct: String(a.allocation_pct) }))
          : [{ project_id: item.project_id || "", allocation_pct: "100" }]
      );
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [item.id, item.project_id]);

  const total = rows.reduce((sum, r) => sum + (Number(r.allocation_pct) || 0), 0);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await putPayrollItemAllocations(item.id, rows.map(r => ({ project_id: r.project_id || null, allocation_pct: Number(r.allocation_pct) || 0 })));
      onSaved();
    } catch (err: any) {
      setError(err?.message || "Failed to save allocation.");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <div className="text-xs text-slate flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />{item.employee_name || item.employee_number}...</div>;

  return (
    <div className="border border-ink-mid rounded px-3 py-2 space-y-1.5 bg-ink-light animate-in fade-in duration-fast">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 text-paper">
          <Avatar name={item.employee_name || item.employee_number || "?"} size="sm" />
          {item.employee_name || item.employee_number} &middot; {money(item.gross_pay)} gross &middot; {money(item.net_pay)} net
        </span>
        {!editable && <span className="text-slate">Locked (run posted)</span>}
      </div>
      {rows.map((row, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <select
            className={`${inputClass} flex-1 py-1`}
            disabled={!editable}
            value={row.project_id}
            onChange={e => setRows(prev => prev.map((r, i) => (i === idx ? { ...r, project_id: e.target.value } : r)))}
          >
            <option value="">HQ / no project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            className={`${inputClass} w-20 py-1`}
            disabled={!editable}
            value={row.allocation_pct}
            onChange={e => setRows(prev => prev.map((r, i) => (i === idx ? { ...r, allocation_pct: e.target.value } : r)))}
          />
          <span className="text-xs text-slate">%</span>
          {editable && rows.length > 1 && (
            <button className="text-xs text-red-300" onClick={() => setRows(prev => prev.filter((_, i) => i !== idx))}>
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {editable && (
        <div className="flex items-center justify-between">
          <button className="text-xs text-signal" onClick={() => setRows(prev => [...prev, { project_id: "", allocation_pct: "0" }])}>+ Add project</button>
          <div className="flex items-center gap-2">
            <span className={`text-xs ${Math.abs(total - 100) > 0.01 ? "text-red-300" : "text-slate"}`}>{total}%</span>
            <button disabled={saving} className="text-xs text-signal font-semibold" onClick={() => void save()}>Save Split</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
