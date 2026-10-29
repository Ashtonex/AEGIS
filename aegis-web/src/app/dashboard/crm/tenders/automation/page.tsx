"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Play, RefreshCw, Save } from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { getAssignableUsers } from "@/lib/api";
import {
  getAutomationOverview, retryDelivery, runAutomationNow, saveAutomationSettings,
  type AutomationOverview, type AutomationSettings,
} from "@/lib/api/tender-workflow";
import { Chip, Panel, btn, errorMessage, fmtHarare, input, relativeDays, CONNECTION_LABEL, RUN_STATUS_TONE, OUTCOME_LABEL } from "@/components/crm/tender-discovery/shared";

type Tab = "pipeline" | "upcoming" | "problems" | "runs";
const STATUS_LABEL: Record<string, string> = {
  not_started: "Not on workflow", captured: "Captured", pending_tender_review: "Pending tender review",
  pending_qs_verification: "Pending QS verification", returned_for_correction: "Returned for correction", qs_preparation: "QS preparation",
};

interface SettingsDraft {
  schedule_enabled: boolean; schedule_interval_minutes: number; auto_import_enabled: boolean; auto_import_bands: string[];
  collect_documents: boolean; workflow_enabled: boolean; review_due_days: number; review_user_ids: string[]; qs_user_ids: string[];
  qs_assignment_rule: string; qs_fixed_user_id: string | null; notify_enabled: boolean;
  notify_users: { user_id: string; company: boolean; private: boolean }[]; notify_extra_emails: string;
}

const toDraft = (s: AutomationSettings): SettingsDraft => ({
  schedule_enabled: s.schedule_enabled, schedule_interval_minutes: s.schedule_interval_minutes, auto_import_enabled: s.auto_import_enabled,
  auto_import_bands: s.auto_import_bands, collect_documents: s.collect_documents, workflow_enabled: s.workflow_enabled,
  review_due_days: s.review_due_days, review_user_ids: s.reviewers.map((p) => p.id), qs_user_ids: s.qs.map((p) => p.id),
  qs_assignment_rule: s.qs_assignment_rule, qs_fixed_user_id: s.qs_fixed_user_id, notify_enabled: s.notify_enabled,
  notify_users: s.notify_users.map((u) => ({ user_id: u.id, company: u.company, private: u.private })),
  notify_extra_emails: (s.notify_extra_emails || []).join(", "),
});

function PeoplePicker({ label, users, value, onChange, disabled }: {
  label: string; users: { id: string; full_name: string }[]; value: string[]; onChange: (v: string[]) => void; disabled: boolean;
}) {
  const [add, setAdd] = useState("");
  const name = (id: string) => users.find((u) => u.id === id)?.full_name ?? "Unknown user";
  return (
    <div>
      <p className="mb-1 text-xs text-slate-light">{label}</p>
      <div className="flex flex-wrap gap-1">
        {value.map((id) => (
          <Chip key={id} className="border-white/10 text-paper">{name(id)}{!disabled && <button className="ml-1 text-rose-300" onClick={() => onChange(value.filter((v) => v !== id))} aria-label="Remove">×</button>}</Chip>
        ))}
        {value.length === 0 && <span className="text-xs text-rose-300">Nobody configured</span>}
      </div>
      {!disabled && (
        <div className="mt-1 flex gap-2">
          <select className={input} value={add} onChange={(e) => setAdd(e.target.value)}>
            <option value="">Add a person…</option>
            {users.filter((u) => !value.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <button className={btn.ghost} disabled={!add} onClick={() => { onChange([...value, add]); setAdd(""); }}>Add</button>
        </div>
      )}
    </div>
  );
}

export default function TenderAutomationPage() {
  const [data, setData] = useState<AutomationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pipeline");
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getAutomationOverview();
      if (!res.data) throw new Error(res.message || "Empty response from the server.");
      setData(res.data);
      setDraft(toDraft(res.data.settings));
      setError(null);
    } catch (err) {
      setError({ message: errorMessage(err, "Could not load tender automation."), denied: (err as { status?: number })?.status === 403 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    getAssignableUsers().then((r) => setUsers(r.data || [])).catch(() => setUsers([]));
  }, [load]);

  const act = async (key: string, fn: () => Promise<{ message?: string }>) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fn();
      setNotice(res.message || "Done.");
      await load();
    } catch (err) {
      setNotice(errorMessage(err, "That did not work."));
    } finally {
      setBusy(null);
    }
  };

  const save = () => draft && act("save", () => saveAutomationSettings({
    ...draft,
    notify_extra_emails: draft.notify_extra_emails.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean),
    qs_fixed_user_id: draft.qs_assignment_rule === "fixed" ? draft.qs_fixed_user_id : null,
  }));

  const isAdmin = !!data?.permissions.is_admin;
  const s = data?.settings;
  const source = data?.sources[0];

  return (
    <div className="min-h-dvh bg-[#050505] px-4 py-4 text-paper sm:px-6">
      <DashboardPageHeader
        breadcrumbs={[{ label: "CRM", href: "/dashboard/crm" }, { label: "Tenders & Bids", href: "/dashboard/crm/tenders" }, { label: "Tender automation" }]}
        backHref="/dashboard/crm/tenders"
        backLabel="Back to Tenders & Bids"
        eyebrow={{ label: "Sourcing · review · QS handover" }}
        title="Tender Automation"
        subtitle="Scheduled e-GP sourcing, the initial review → QS workflow, and new-tender emails - what ran, what is waiting, and what failed."
      />

      {loading ? (
        <div className="flex h-72 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#D4AF37]" /></div>
      ) : error || !data || !s || !draft ? (
        <div className="mx-auto mt-8 max-w-lg rounded-sm border border-rose-400/20 bg-rose-950/10 p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-rose-300" />
          <p className="text-sm text-rose-200">{error?.denied ? "You don't have access to tender automation." : error?.message}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {data.warnings.length > 0 && (
            <div className="rounded-sm border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
              <ul className="list-disc space-y-0.5 pl-5">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          {notice && <div className="rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-paper">{notice}</div>}

          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {["captured", "pending_tender_review", "returned_for_correction", "pending_qs_verification", "qs_preparation", "not_started"].map((k) => (
              <div key={k} className="rounded-sm border border-white/5 bg-[#0A0A0A] p-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-slate-light">{STATUS_LABEL[k]}</p>
                <p className="mt-1 text-xl text-paper">{data.counts[k] ?? 0}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[380px,1fr]">
            <div className="space-y-4">
              {source && (
                <Panel title="Source: PRAZ e-GP" actions={isAdmin ? (
                  <button className={btn.primary} disabled={!!busy} onClick={() => act("run", runAutomationNow)}>
                    {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Run now
                  </button>) : undefined}>
                  <Chip className={CONNECTION_LABEL[source.connection_state as keyof typeof CONNECTION_LABEL]?.tone}>{CONNECTION_LABEL[source.connection_state as keyof typeof CONNECTION_LABEL]?.label ?? source.connection_state}</Chip>
                  <dl className="mt-2 space-y-1 text-xs">
                    <div><dt className="inline text-slate-light">Last run: </dt><dd className="inline">{fmtHarare(source.last_run_at)} {source.last_run_status ?? ""}</dd></div>
                    <div><dt className="inline text-slate-light">Last verified: </dt><dd className="inline">{fmtHarare(source.last_verified_at)}</dd></div>
                    {source.last_auth_problem && <div className="text-rose-300">Access problem ({fmtHarare(source.last_auth_problem_at)}): {source.last_auth_problem}</div>}
                  </dl>
                  <p className="mt-2 text-xs text-slate-light">{source.access_note}</p>
                  <Link href="/dashboard/crm/tenders/discovery" className="mt-2 inline-block text-xs text-[#D4AF37] hover:underline">Open e-GP Discovery (connection, profile, review queue) →</Link>
                </Panel>
              )}

              <Panel title="Settings" actions={isAdmin ? <button className={btn.primary} disabled={!!busy} onClick={save}><Save className="h-3.5 w-3.5" />Save</button> : <Chip className="border-white/10 text-slate-light">read only</Chip>}>
                <fieldset disabled={!isAdmin} className="space-y-3 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={draft.schedule_enabled} onChange={(e) => setDraft({ ...draft, schedule_enabled: e.target.checked })} />Run e-GP discovery on a schedule</label>
                  <label className="block text-xs text-slate-light">Every (minutes, 60-10080)
                    <input type="number" min={60} max={10080} className={input} value={draft.schedule_interval_minutes} onChange={(e) => setDraft({ ...draft, schedule_interval_minutes: Number(e.target.value) })} />
                  </label>
                  <p className="text-[11px] text-slate">Last scheduled run: {fmtHarare(s.last_scheduled_run_at)}. Needs the cron entry for scripts/run_tender_automation.py on the server.</p>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={draft.auto_import_enabled} onChange={(e) => setDraft({ ...draft, auto_import_enabled: e.target.checked })} />Import matching notices automatically</label>
                  <div className="flex gap-3 text-xs">
                    {["strong", "possible", "weak"].map((b) => (
                      <label key={b} className="flex items-center gap-1"><input type="checkbox" checked={draft.auto_import_bands.includes(b)}
                        onChange={(e) => setDraft({ ...draft, auto_import_bands: e.target.checked ? [...draft.auto_import_bands, b] : draft.auto_import_bands.filter((x) => x !== b) })} />{b} matches</label>
                    ))}
                  </div>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={draft.collect_documents} onChange={(e) => setDraft({ ...draft, collect_documents: e.target.checked })} />Download documents and schedule from e-GP</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={draft.workflow_enabled} onChange={(e) => setDraft({ ...draft, workflow_enabled: e.target.checked })} />Start the review workflow for every new tender</label>
                  <PeoplePicker label="Initial reviewers (shared queue, primary by round robin)" users={users} value={draft.review_user_ids} disabled={!isAdmin} onChange={(v) => setDraft({ ...draft, review_user_ids: v })} />
                  <label className="block text-xs text-slate-light">Review due after (days)
                    <input type="number" min={0} max={14} className={input} value={draft.review_due_days} onChange={(e) => setDraft({ ...draft, review_due_days: Number(e.target.value) })} />
                  </label>
                  <PeoplePicker label="QS team" users={users} value={draft.qs_user_ids} disabled={!isAdmin} onChange={(v) => setDraft({ ...draft, qs_user_ids: v })} />
                  <label className="block text-xs text-slate-light">QS assignment rule
                    <select className={input} value={draft.qs_assignment_rule} onChange={(e) => setDraft({ ...draft, qs_assignment_rule: e.target.value })}>
                      <option value="round_robin">Round robin</option><option value="least_loaded">Fewest open tenders</option><option value="fixed">Always the same QS</option>
                    </select>
                  </label>
                  {draft.qs_assignment_rule === "fixed" && (
                    <select className={input} value={draft.qs_fixed_user_id ?? ""} onChange={(e) => setDraft({ ...draft, qs_fixed_user_id: e.target.value || null })}>
                      <option value="">Choose the QS…</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                    </select>
                  )}
                  <label className="flex items-center gap-2"><input type="checkbox" checked={draft.notify_enabled} onChange={(e) => setDraft({ ...draft, notify_enabled: e.target.checked })} />Email every new tender</label>
                  <div>
                    <p className="mb-1 text-xs text-slate-light">New-tender email recipients</p>
                    <ul className="space-y-1">
                      {draft.notify_users.map((n, i) => (
                        <li key={n.user_id} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="min-w-[8rem] text-paper">{users.find((u) => u.id === n.user_id)?.full_name ?? s.notify_users.find((u) => u.id === n.user_id)?.name ?? "Unknown"}</span>
                          <label className="flex items-center gap-1"><input type="checkbox" checked={n.company} onChange={(e) => { const next = [...draft.notify_users]; next[i] = { ...n, company: e.target.checked }; setDraft({ ...draft, notify_users: next }); }} />company</label>
                          <label className="flex items-center gap-1"><input type="checkbox" checked={n.private} onChange={(e) => { const next = [...draft.notify_users]; next[i] = { ...n, private: e.target.checked }; setDraft({ ...draft, notify_users: next }); }} />private (Teams)</label>
                          {isAdmin && <button className="text-rose-300" onClick={() => setDraft({ ...draft, notify_users: draft.notify_users.filter((x) => x.user_id !== n.user_id) })}>remove</button>}
                        </li>
                      ))}
                    </ul>
                    {isAdmin && (
                      <select className={`${input} mt-1`} value="" onChange={(e) => e.target.value && setDraft({ ...draft, notify_users: [...draft.notify_users, { user_id: e.target.value, company: true, private: false }] })}>
                        <option value="">Add a recipient…</option>
                        {users.filter((u) => !draft.notify_users.some((n) => n.user_id === u.id)).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    )}
                    <label className="mt-2 block text-xs text-slate-light">Other verified addresses (comma separated)
                      <input className={input} value={draft.notify_extra_emails} onChange={(e) => setDraft({ ...draft, notify_extra_emails: e.target.value })} />
                    </label>
                  </div>
                </fieldset>
                <div className="mt-3 rounded-sm border border-white/5 bg-black/30 p-2">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-slate-light">Addresses the next email goes to</p>
                  <ul className="space-y-0.5 text-xs">
                    {s.resolved_recipients.map((r) => (
                      <li key={`${r.label}-${r.email}`} className={r.status === "unresolved" ? "text-rose-300" : "text-paper"}>
                        {r.label}: {r.email ?? "not found - add it to their profile/HR record or as an extra address"}
                        {r.source && <span className="text-slate"> ({r.source.replace(/_/g, " ")})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </Panel>
            </div>

            <div className="min-w-0 space-y-3">
              <nav className="flex gap-1 overflow-x-auto border-b border-white/5 pb-px">
                {([["pipeline", "New tenders & assignments"], ["upcoming", "Deadlines & site visits"], ["problems", `Problems (${data.email_problems.length + data.collection_problems.length + data.overdue_tasks.length + data.blocked_handovers.length})`], ["runs", "Runs"]] as [Tab, string][]).map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)} className={`shrink-0 border-b-2 px-3 py-2 font-mono text-[10px] uppercase tracking-widest ${tab === k ? "border-[#D4AF37] text-[#D4AF37]" : "border-transparent text-slate-light hover:text-paper"}`}>{label}</button>
                ))}
                <button className="ml-auto shrink-0 px-2 text-slate-light hover:text-paper" onClick={() => void load()} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>
              </nav>

              {tab === "pipeline" && (
                <Panel>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead className="text-slate-light"><tr><th className="py-1.5">Tender</th><th>Source</th><th>Status</th><th>Reviewer</th><th>QS</th><th>Docs</th><th>Checklist</th><th>Deadline</th></tr></thead>
                      <tbody className="divide-y divide-white/5">
                        {data.new_tenders.map((t) => (
                          <tr key={t.id}>
                            <td className="py-1.5 pr-2"><Link className="text-paper hover:text-[#D4AF37]" href={`/dashboard/crm/tenders/${t.id}`}>{t.tender_name}</Link><div className="text-slate">{fmtHarare(t.created_at, false)}</div></td>
                            <td>{t.source_key === "praz_egp" ? `e-GP ${t.source_notice_id ?? ""}` : "Manual"}</td>
                            <td>{STATUS_LABEL[t.review_workflow_status ?? "not_started"]}</td>
                            <td>{t.primary_name ?? "—"}</td>
                            <td>{t.qs_name ?? "—"}</td>
                            <td className={Number(t.documents_missing) > 0 ? "text-rose-300" : ""}>{t.documents}{Number(t.documents_missing) > 0 ? ` (+${t.documents_missing} missing)` : ""}</td>
                            <td className={Number(t.items_pending) > 0 ? "text-amber-300" : "text-emerald-300"}>{t.review_workflow_status ? `${t.items_pending} unverified` : "—"}</td>
                            <td>{fmtHarare(t.submission_deadline)} <span className="text-slate">{relativeDays(t.submission_deadline) ?? ""}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {data.new_tenders.length === 0 && <p className="py-3 text-sm text-slate-light">No tenders in the workflow or entered in the last 30 days.</p>}
                  </div>
                </Panel>
              )}

              {tab === "upcoming" && (
                <Panel>
                  <ul className="divide-y divide-white/5 text-sm">
                    {data.upcoming.map((u) => (
                      <li key={`${u.id}-${u.kind}`} className="flex flex-wrap justify-between gap-2 py-1.5">
                        <span><Chip className={u.kind === "site_visit" ? "border-amber-400/30 text-amber-300" : "border-sky-400/30 text-sky-300"}>{u.kind === "site_visit" ? "site visit" : "deadline"}</Chip> <Link className="text-paper hover:text-[#D4AF37]" href={`/dashboard/crm/tenders/${u.id}`}>{u.tender_name}</Link>{u.detail ? <span className="text-xs text-slate-light"> · {u.detail}</span> : null}</span>
                        <span className="text-xs text-slate-light">{fmtHarare(u.at)} · {relativeDays(u.at)}</span>
                      </li>
                    ))}
                    {data.upcoming.length === 0 && <li className="py-2 text-slate-light">Nothing in the next 21 days.</li>}
                  </ul>
                </Panel>
              )}

              {tab === "problems" && (
                <div className="space-y-3">
                  <Panel title="Email notifications not delivered">
                    <ul className="space-y-1 text-xs">
                      {data.email_problems.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span><span className="text-paper">{d.tender_name}</span> → {d.recipient_label}{d.recipient_email ? ` <${d.recipient_email}>` : ""} · <span className={d.status === "pending" || d.status === "sending" ? "text-slate-light" : "text-rose-300"}>{d.status}</span>{d.last_error ? <span className="text-slate-light"> · {d.last_error}</span> : null}</span>
                          {isAdmin && d.status === "failed" && <button className={btn.ghost} disabled={!!busy} onClick={() => act(`retry:${d.id}`, () => retryDelivery(d.id))}>Retry</button>}
                        </li>
                      ))}
                      {data.email_problems.length === 0 && <li className="text-slate-light">All new-tender emails delivered.</li>}
                    </ul>
                  </Panel>
                  <Panel title="Documents that failed to download">
                    <ul className="space-y-1 text-xs">
                      {data.collection_problems.map((c) => <li key={c.id}><Link className="text-paper hover:text-[#D4AF37]" href={`/dashboard/crm/tenders/${c.tender_id}`}>{c.tender_name}</Link>: {c.label} - {c.download_error || c.download_status} ({c.download_attempts} tries)</li>)}
                      {data.collection_problems.length === 0 && <li className="text-slate-light">None.</li>}
                    </ul>
                  </Panel>
                  <Panel title="Overdue review and QS tasks">
                    <ul className="space-y-1 text-xs">
                      {data.overdue_tasks.map((k) => <li key={k.id}><Link className="text-paper hover:text-[#D4AF37]" href={`/dashboard/crm/tenders/${k.tender_id}`}>{k.title}</Link> · {k.assignee_name ?? "Unassigned"} · due {k.due_date}</li>)}
                      {data.overdue_tasks.length === 0 && <li className="text-slate-light">None.</li>}
                    </ul>
                  </Panel>
                  <Panel title="Blocked handovers">
                    <ul className="space-y-1 text-xs">
                      {data.blocked_handovers.map((b) => <li key={b.id}><Link className="text-paper hover:text-[#D4AF37]" href={`/dashboard/crm/tenders/${b.id}`}>{b.tender_name}</Link> · {b.reason}</li>)}
                      {data.blocked_handovers.length === 0 && <li className="text-slate-light">None.</li>}
                    </ul>
                  </Panel>
                </div>
              )}

              {tab === "runs" && (
                <Panel>
                  <ul className="divide-y divide-white/5 text-xs">
                    {data.runs.map((r) => (
                      <li key={r.id} className="py-1.5">
                        <Chip className={RUN_STATUS_TONE[r.status as keyof typeof RUN_STATUS_TONE]}>{r.status}</Chip>{" "}
                        <span className="text-paper">{fmtHarare(r.created_at)}</span>{" "}
                        <span className="text-slate-light">{r.executor === "schedule" ? "scheduled" : r.started_by_name ?? "API"} · {r.outcome ? OUTCOME_LABEL[r.outcome] ?? r.outcome : ""} · pages {r.pages_fetched}/{r.pages_total ?? "?"} · {r.notices_matched} matched · {r.candidates_new} new</span>
                        {(r.failures || []).length > 0 && <div className="text-rose-300">{(r.failures as { error: string }[]).slice(0, 3).map((f) => f.error).join(" · ")}</div>}
                      </li>
                    ))}
                    {data.runs.length === 0 && <li className="py-2 text-slate-light">No runs yet.</li>}
                  </ul>
                </Panel>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
