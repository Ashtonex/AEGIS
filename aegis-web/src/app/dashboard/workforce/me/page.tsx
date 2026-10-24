"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getMyPersonCard, updateMyPersonalDetails, type PersonCard } from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { PersonalDetailsForm } from "@/components/people/PersonalDetailsForm";
import { WeeklyHoursModal } from "@/components/people/WeeklyHoursModal";
import { StatusPill, formatDate, humanise, secondaryButton, today } from "@/components/people/ui";

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : "Your profile could not be loaded.");

export default function MyWorkforceProfile() {
  const [card, setCard] = useState<PersonCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showHours, setShowHours] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setCard((await getMyPersonCard()).data);
    } catch (reason) {
      setCard(null);
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const p = card?.person;
  const live = card?.allocations.filter((a) => ["planned", "active"].includes(a.status) && a.ends_on >= today()) ?? [];
  const personalMissing = card?.completeness.missing.filter((m) => ["National ID", "Date of birth", "Phone", "Next of kin"].includes(m)) ?? [];

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <DashboardPageHeader
        className="mb-0 border-b-0 pb-0"
        title="My Profile"
        subtitle="Keep your personal details up to date. Your role, pay and projects are maintained by HR. Ask them if something there is wrong."
      />
      {loading && <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-signal" /></div>}
      {error && !loading && (
        <div className="space-y-3 rounded-sm border border-ink-mid bg-ink-light p-5">
          <p role="alert" className="text-paper">{error}</p>
          <p className="text-sm text-slate-light">If you work for Six Nine Construction, HR needs to link your login to your person record in the People Register.</p>
          <button type="button" onClick={() => void load()} className="min-h-10 rounded-sm border border-ink-mid px-4 py-2 text-sm text-signal">Retry</button>
        </div>
      )}
      {!loading && card && p && (
        <>
          <section className="rounded-sm border border-ink-mid bg-ink-light p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-paper">{p.employee_name}</h2>
                <p className="mt-1 text-sm text-slate-light"><span className="font-mono text-signal">{p.employee_number || "Number pending"}</span> · {p.position_name || p.job_title || "Role not set"}</p>
              </div>
              <div className="flex items-center gap-2">
                <button className={secondaryButton} onClick={() => setShowHours(true)}>My hours this week</button>
                <StatusPill status={p.employment_status} />
              </div>
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              {[
                ["Discipline", p.category_name],
                ["Department", p.department_name],
                ["Reports to", card.line_manager?.manager_name],
                ["Started", p.start_date ? formatDate(p.start_date) : null],
                ["Employment", p.employment_type ? humanise(p.employment_type) : null],
                ["Annual leave", p.annual_leave_days != null ? `${p.annual_leave_days} days a year` : null],
              ].map(([label, value]) => (
                <div key={label as string}><dt className="text-xs text-slate">{label}</dt><dd className="text-sm text-paper">{value || "Not recorded"}</dd></div>
              ))}
            </dl>
            {live.length > 0 && (
              <div className="mt-4 border-t border-ink-mid pt-4">
                <p className="text-xs text-slate">Current projects</p>
                <ul className="mt-2 space-y-1 text-sm text-paper">
                  {live.map((a) => <li key={a.id}>{a.project_name} <span className="text-slate-light">· {a.role_on_project || "Team member"} until {formatDate(a.ends_on)}</span></li>)}
                </ul>
              </div>
            )}
          </section>

          <section className="rounded-sm border border-ink-mid bg-ink-light p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-paper">My personal details</h2>
              {personalMissing.length > 0
                ? <span className="rounded-sm border border-signal/40 bg-signal/10 px-2 py-1 text-xs text-signal">Still needed: {personalMissing.join(", ")}</span>
                : p.self_profile_updated_at && <span className="text-xs text-slate">Last updated {formatDate(p.self_profile_updated_at)}</span>}
            </div>
            {notice && <p role="status" className="mb-4 rounded-sm border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{notice}</p>}
            {card.personal && (
              <PersonalDetailsForm
                key={p.version}
                value={card.personal}
                editable
                busy={busy}
                onSave={async (payload) => {
                  setBusy(true); setNotice(""); setError("");
                  try { setCard((await updateMyPersonalDetails(payload)).data); setNotice("Saved. Thank you!"); }
                  catch (reason) { setError(errorText(reason)); }
                  finally { setBusy(false); }
                }}
              />
            )}
            {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
          </section>

          {card.pay && (
            <section className="rounded-sm border border-ink-mid bg-ink-light p-5">
              <h2 className="text-lg font-semibold text-paper">Pay details on file</h2>
              <dl className="mt-3 grid gap-4 sm:grid-cols-3 text-sm">
                <div><dt className="text-xs text-slate">Bank</dt><dd className="text-paper">{card.pay.bank_name || "Not recorded"}</dd></div>
                <div><dt className="text-xs text-slate">Account</dt><dd className="font-mono text-paper">{card.pay.bank_account_number || "Not recorded"}</dd></div>
                <div><dt className="text-xs text-slate">NSSA number</dt><dd className="text-paper">{card.pay.nssa_number || "Not recorded"}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-slate">Bank or tax details wrong? Tell HR or Finance; only they can change pay details.</p>
            </section>
          )}
        </>
      )}
      {showHours && <WeeklyHoursModal onClose={() => setShowHours(false)} />}
    </main>
  );
}
