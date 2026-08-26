"use client";

import { type FormEvent, useEffect, useState } from "react";
import { CalendarDays, Loader2, Plus, Save, UserRound } from "lucide-react";
import { createMyHRLeaveRequest, getMyHREmployeeRecord, getMyHRLeaveBalance, getMyHRLeaveRequests, getMyProfile, updateMyProfile } from "@/lib/api";
import { useAppTheme } from "@/components/theme/AppThemeProvider";
import { THEME_PREFERENCES, isThemePreference, type ThemePreference } from "@/lib/theme";

type Profile = Record<string, any>;

const fields = [
  ["preferred_name", "Preferred name"],
  ["work_phone", "Work phone"],
  ["job_title", "Job title"],
  ["department", "Department"],
  ["location", "Location"],
  ["timezone", "Time zone"],
  ["linkedin_url", "LinkedIn URL"],
  ["portfolio_url", "Portfolio URL"],
  ["website_url", "Professional website"],
] as const;

const THEME_LABELS: Record<ThemePreference, string> = {
  ink: "Ink",
  paper: "Paper",
  slate: "Slate",
  contrast: "Contrast",
};

export default function ProfilePage() {
  const { theme, setTheme } = useAppTheme();
  const [profile, setProfile] = useState<Profile>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [employeeRecord, setEmployeeRecord] = useState<Profile | null>(null);
  const [leaveBalance, setLeaveBalance] = useState<Profile | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<Profile[]>([]);
  const [leaveForm, setLeaveForm] = useState({ leave_type: "annual", start_date: "", end_date: "", days_requested: "1", reason: "" });

  useEffect(() => {
    void getMyProfile()
      .then((response) => {
        const data = response.data || {};
        setProfile(data);
        if (isThemePreference(data.theme_preference)) {
          setTheme(data.theme_preference);
        }
      })
      .catch(() => setMessage("Unable to load your profile."))
      .finally(() => setLoading(false));
    void Promise.allSettled([getMyHREmployeeRecord(), getMyHRLeaveBalance(), getMyHRLeaveRequests()]).then(([employee, balance, leave]) => {
      if (employee.status === "fulfilled") setEmployeeRecord(employee.value.data || null);
      if (balance.status === "fulfilled") setLeaveBalance(balance.value.data || null);
      if (leave.status === "fulfilled") setLeaveRequests(Array.isArray(leave.value.data) ? leave.value.data : []);
    });
  }, [setTheme]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const payload = fields.reduce<Record<string, unknown>>((acc, [key]) => {
        acc[key] = profile[key] ?? null;
        return acc;
      }, {
        preferred_name: profile.preferred_name ?? null,
        work_phone: profile.work_phone ?? null,
        job_title: profile.job_title ?? null,
        department: profile.department ?? null,
        location: profile.location ?? null,
        timezone: profile.timezone ?? null,
        linkedin_url: profile.linkedin_url ?? null,
        portfolio_url: profile.portfolio_url ?? null,
        website_url: profile.website_url ?? null,
        bio: profile.bio ?? null,
        theme_preference: theme,
      });
      const response = await updateMyProfile(payload);
      const nextProfile = response.data || {};
      setProfile((current) => ({ ...current, ...nextProfile }));
      if (isThemePreference(nextProfile.theme_preference)) {
        setTheme(nextProfile.theme_preference);
      }
      setMessage("Profile saved.");
    } catch {
      setMessage("Profile could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const submitLeave = async () => {
    setLeaveSaving(true);
    setMessage("");
    try {
      await createMyHRLeaveRequest({ ...leaveForm, days_requested: Number(leaveForm.days_requested) });
      const [balance, leave] = await Promise.all([getMyHRLeaveBalance(), getMyHRLeaveRequests()]);
      setLeaveBalance(balance.data || null);
      setLeaveRequests(Array.isArray(leave.data) ? leave.data : []);
      setLeaveForm({ leave_type: "annual", start_date: "", end_date: "", days_requested: "1", reason: "" });
      setMessage("Leave request submitted to HR.");
    } catch {
      setMessage("Leave request could not be submitted. Your employee record may not be linked to this account yet.");
    } finally {
      setLeaveSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-signal" />
      </div>
    );
  }

  return (
    <main className="h-full max-w-5xl overflow-y-auto p-6">
      <header className="mb-6 flex items-center gap-3 border-b border-ink-mid pb-5">
        <div className="flex h-10 w-10 items-center justify-center border border-ink-mid bg-ink-light rounded-sm">
          <UserRound className="h-5 w-5 text-signal" />
        </div>
        <div>
          <h1 className="font-display text-3xl text-paper">My Profile</h1>
          <p className="text-sm text-slate-light">{profile.email || "Employee account"}</p>
        </div>
      </header>

      <form onSubmit={save} className="space-y-6">
        <section className="rounded-sm border border-ink-mid bg-ink p-5">
          <h2 className="mb-4 font-mono text-xs uppercase tracking-widest text-paper">Appearance</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-light">
              Theme
              <select
                value={theme}
                onChange={(event) => {
                  const value = event.target.value;
                  if (isThemePreference(value)) {
                    setTheme(value);
                    setProfile((current) => ({ ...current, theme_preference: value }));
                  }
                }}
                className="mt-1 w-full rounded-sm border border-ink-mid bg-ink-light p-2 text-paper focus:border-signal focus:outline-none"
              >
                {THEME_PREFERENCES.map((option) => (
                  <option key={option} value={option}>
                    {THEME_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
            <div className="border border-ink-mid bg-ink-light p-3 text-xs text-slate-light">
              The selection is saved with your profile and follows you across devices.
            </div>
          </div>
        </section>

        <section className="rounded-sm border border-ink-mid bg-ink p-5">
          <h2 className="mb-4 font-mono text-xs uppercase tracking-widest text-paper">Professional details</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map(([key, label]) => (
              <label key={key} className="text-sm text-slate-light">
                {label}
                <input
                  type={key.includes("url") ? "url" : "text"}
                  value={profile[key] || ""}
                  onChange={(event) => setProfile({ ...profile, [key]: event.target.value })}
                  className="mt-1 w-full rounded-sm border border-ink-mid bg-ink-light p-2 text-paper focus:border-signal focus:outline-none"
                />
              </label>
            ))}
          </div>
          <label className="mt-4 block text-sm text-slate-light">
            Professional biography
            <textarea
              value={profile.bio || ""}
              onChange={(event) => setProfile({ ...profile, bio: event.target.value })}
              maxLength={1500}
              rows={5}
              className="mt-1 w-full rounded-sm border border-ink-mid bg-ink-light p-2 text-paper focus:border-signal focus:outline-none"
            />
          </label>
        </section>

        <section className="rounded-sm border border-ink-mid bg-ink p-5">
          <h2 className="mb-2 font-mono text-xs uppercase tracking-widest text-paper">Account controls</h2>
          <p className="text-sm text-slate-light">
            Your email, organization, employment status, role, manager, and access permissions are managed by authorized administrators.
          </p>
        </section>

        <section className="rounded-sm border border-ink-mid bg-ink p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-widest text-paper">My leave</h2>
              <p className="mt-1 text-sm text-slate-light">
                Submit leave from your account. HR sees it in Leave Management and on the leave calendar.
              </p>
            </div>
            <CalendarDays className="h-5 w-5 text-signal" />
          </div>
          {employeeRecord ? (
            <div className="grid gap-5 lg:grid-cols-[1fr_.9fr]">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm text-slate-light">
                    Leave type
                    <select value={leaveForm.leave_type} onChange={(event) => setLeaveForm({ ...leaveForm, leave_type: event.target.value })} className="mt-1 w-full rounded-sm border border-ink-mid bg-ink-light p-2 text-paper focus:border-signal focus:outline-none">
                      <option value="annual">Annual</option>
                      <option value="sick">Sick</option>
                      <option value="maternity">Maternity</option>
                      <option value="paternity">Paternity</option>
                      <option value="compassionate">Compassionate</option>
                      <option value="study">Study</option>
                      <option value="unpaid">Unpaid</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label className="text-sm text-slate-light">
                    Days requested
                    <input type="number" min="0.5" step="0.5" value={leaveForm.days_requested} onChange={(event) => setLeaveForm({ ...leaveForm, days_requested: event.target.value })} className="mt-1 w-full rounded-sm border border-ink-mid bg-ink-light p-2 text-paper focus:border-signal focus:outline-none" />
                  </label>
                  <label className="text-sm text-slate-light">
                    Start date
                    <input type="date" value={leaveForm.start_date} onChange={(event) => setLeaveForm({ ...leaveForm, start_date: event.target.value })} className="mt-1 w-full rounded-sm border border-ink-mid bg-ink-light p-2 text-paper focus:border-signal focus:outline-none" />
                  </label>
                  <label className="text-sm text-slate-light">
                    End date
                    <input type="date" value={leaveForm.end_date} onChange={(event) => setLeaveForm({ ...leaveForm, end_date: event.target.value })} className="mt-1 w-full rounded-sm border border-ink-mid bg-ink-light p-2 text-paper focus:border-signal focus:outline-none" />
                  </label>
                </div>
                <label className="block text-sm text-slate-light">
                  Reason
                  <textarea value={leaveForm.reason} onChange={(event) => setLeaveForm({ ...leaveForm, reason: event.target.value })} rows={3} className="mt-1 w-full rounded-sm border border-ink-mid bg-ink-light p-2 text-paper focus:border-signal focus:outline-none" />
                </label>
                <button type="button" onClick={() => void submitLeave()} disabled={leaveSaving || !leaveForm.start_date || !leaveForm.end_date} className="inline-flex items-center gap-2 rounded-sm bg-signal px-4 py-2 font-medium text-ink disabled:opacity-50">
                  {leaveSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Submit leave
                </button>
              </div>
              <div className="space-y-3">
                <div className="border border-ink-mid bg-ink-light p-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Leave balance</p>
                  <p className="mt-1 text-2xl font-semibold text-paper">{leaveBalance?.days_remaining ?? "—"}</p>
                  <p className="text-xs text-slate-light">remaining from {leaveBalance?.annual_leave_days ?? "—"} annual day(s)</p>
                </div>
                <div className="max-h-64 overflow-y-auto border border-ink-mid">
                  {leaveRequests.length === 0 ? (
                    <p className="p-3 text-sm text-slate-light">No leave requests yet.</p>
                  ) : leaveRequests.map((item) => (
                    <div key={item.id} className="border-b border-ink-mid p-3 text-sm last:border-b-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className="capitalize text-paper">{item.leave_type}</span>
                        <span className="font-mono text-[10px] uppercase text-signal">{item.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-light">{item.start_date} to {item.end_date} · {item.days_requested} day(s)</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100">
              Your employee record is not linked to this account yet. HR or an administrator must link your user account to an employee record before self-service leave can be submitted.
            </div>
          )}
        </section>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-sm bg-signal px-4 py-2 font-medium text-ink disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving" : "Save profile"}
          </button>
          {message && <p className="text-sm text-slate-light">{message}</p>}
        </div>
      </form>
    </main>
  );
}
