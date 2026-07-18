"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Save, UserRound } from "lucide-react";
import { getMyProfile, updateMyProfile } from "@/lib/api";

type Profile = Record<string, any>;
const fields = [
  ["preferred_name", "Preferred name"], ["work_phone", "Work phone"], ["job_title", "Job title"],
  ["department", "Department"], ["location", "Location"], ["timezone", "Time zone"],
  ["linkedin_url", "LinkedIn URL"], ["portfolio_url", "Portfolio URL"], ["website_url", "Professional website"],
] as const;

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { void getMyProfile().then((response) => setProfile(response.data || {})).catch(() => setMessage("Unable to load your profile.")).finally(() => setLoading(false)); }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage("");
    try { const response = await updateMyProfile(profile); setProfile((current) => ({ ...current, ...(response.data || {}) })); setMessage("Profile saved."); }
    catch { setMessage("Profile could not be saved."); } finally { setSaving(false); }
  };
  if (loading) return <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 text-signal animate-spin" /></div>;
  return <main className="h-full overflow-y-auto p-6 max-w-5xl"><header className="border-b border-ink-mid pb-5 mb-6 flex gap-3 items-center"><div className="w-10 h-10 bg-ink-light border border-ink-mid flex items-center justify-center rounded-sm"><UserRound className="w-5 h-5 text-signal" /></div><div><h1 className="font-display text-3xl text-paper">My Profile</h1><p className="text-sm text-slate-light">{profile.email || "Employee account"}</p></div></header><form onSubmit={save} className="space-y-6"><section className="border border-ink-mid bg-ink p-5 rounded-sm"><h2 className="font-mono text-xs uppercase tracking-widest text-paper mb-4">Professional details</h2><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{fields.map(([key, label]) => <label key={key} className="text-sm text-slate-light">{label}<input type={key.includes("url") ? "url" : "text"} value={profile[key] || ""} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} className="mt-1 w-full bg-ink-light border border-ink-mid p-2 text-paper rounded-sm focus:outline-none focus:border-signal" /></label>)}</div><label className="block text-sm text-slate-light mt-4">Professional biography<textarea value={profile.bio || ""} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} maxLength={1500} rows={5} className="mt-1 w-full bg-ink-light border border-ink-mid p-2 text-paper rounded-sm focus:outline-none focus:border-signal" /></label></section><section className="border border-ink-mid bg-ink p-5 rounded-sm"><h2 className="font-mono text-xs uppercase tracking-widest text-paper mb-2">Account controls</h2><p className="text-sm text-slate-light">Your email, organization, employment status, role, manager, and access permissions are managed by authorized administrators.</p></section><div className="flex items-center gap-4"><button type="submit" disabled={saving} className="inline-flex items-center gap-2 bg-signal text-ink px-4 py-2 rounded-sm font-medium disabled:opacity-50"><Save className="w-4 h-4" />{saving ? "Saving" : "Save profile"}</button>{message && <p className="text-sm text-slate-light">{message}</p>}</div></form></main>;
}
