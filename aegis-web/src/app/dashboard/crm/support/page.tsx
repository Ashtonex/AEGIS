"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertOctagon, CheckCircle2, Clock, Plus, Ticket } from "lucide-react";
import {
  createCrmSupportTicket,
  escalateCrmSupportTicket,
  getCrmContacts,
  getCrmOrganizations,
  getCrmSlaPolicies,
  getCrmSupportDashboard,
  getCrmSupportTickets,
  getUsers,
  updateCrmSupportTicket,
  upsertCrmSlaPolicy,
} from "@/lib/api";

const SLA_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
const DEFAULT_SLA_HOURS: Record<string, { response_hours: number; resolution_hours: number }> = {
  urgent: { response_hours: 4, resolution_hours: 12 },
  high: { response_hours: 12, resolution_hours: 24 },
  normal: { response_hours: 24, resolution_hours: 72 },
  low: { response_hours: 48, resolution_hours: 120 },
};

type RecordData = Record<string, any>;

const inputClass = "w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-paper outline-none focus:border-signal";
const buttonClass = "inline-flex items-center gap-2 rounded bg-signal px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-50";

export default function CRMSupportPage() {
  const [tickets, setTickets] = useState<RecordData[]>([]);
  const [contacts, setContacts] = useState<RecordData[]>([]);
  const [organizations, setOrganizations] = useState<RecordData[]>([]);
  const [users, setUsers] = useState<RecordData[]>([]);
  const [dashboard, setDashboard] = useState<RecordData | null>(null);
  const [slaPolicies, setSlaPolicies] = useState<RecordData[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [savingSlaPriority, setSavingSlaPriority] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", issue_description: "", priority: "normal", category: "general", contact_id: "", organization_account_id: "" });
  const [escalatingTicketId, setEscalatingTicketId] = useState<string | null>(null);
  const [escalateTo, setEscalateTo] = useState("");
  const [escalateReason, setEscalateReason] = useState("");

  const load = async () => {
    setWarnings([]);
    const [ticketRes, contactRes, orgRes, dashboardRes, usersRes, slaRes] = await Promise.allSettled([
      getCrmSupportTickets(),
      getCrmContacts(),
      getCrmOrganizations(),
      getCrmSupportDashboard(),
      getUsers(),
      getCrmSlaPolicies(),
    ]);
    const nextWarnings: string[] = [];
    if (ticketRes.status === "fulfilled" && ticketRes.value.success) setTickets(ticketRes.value.data || []);
    else nextWarnings.push("Support tickets could not be loaded from the CRM lifecycle service.");
    if (contactRes.status === "fulfilled" && contactRes.value.success) setContacts(contactRes.value.data || []);
    else nextWarnings.push("CRM contacts could not be loaded.");
    if (orgRes.status === "fulfilled" && orgRes.value.success) setOrganizations(orgRes.value.data || []);
    else nextWarnings.push("CRM organizations could not be loaded.");
    if (dashboardRes.status === "fulfilled" && dashboardRes.value.success) setDashboard(dashboardRes.value.data || null);
    else nextWarnings.push("Support reporting could not be loaded.");
    if (usersRes.status === "fulfilled" && usersRes.value.success) setUsers(usersRes.value.data || []);
    else nextWarnings.push("Users could not be loaded for escalation assignment.");
    if (slaRes.status === "fulfilled" && slaRes.value.success) setSlaPolicies(slaRes.value.data || []);
    else nextWarnings.push("SLA policies could not be loaded.");
    setWarnings(nextWarnings);
  };

  useEffect(() => {
    void load();
  }, []);

  const summary = dashboard?.summary || {};
  const openTickets = useMemo(() => tickets.filter((ticket) => !["closed", "resolved"].includes(String(ticket.status || "").toLowerCase())), [tickets]);

  const submitTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        contact_id: form.contact_id || null,
        organization_account_id: form.organization_account_id || null,
      };
      const response = await createCrmSupportTicket(payload);
      if (!response?.data?.id) throw new Error("Support ticket response did not include an id.");
      setForm({ subject: "", issue_description: "", priority: "normal", category: "general", contact_id: "", organization_account_id: "" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const transition = async (ticket: RecordData, status: string) => {
    setBusy(true);
    try {
      const payload: RecordData = { status };
      if (status === "resolved") payload.resolved_at = new Date().toISOString();
      if (status === "closed") payload.closed_at = new Date().toISOString();
      await updateCrmSupportTicket(ticket.id, payload);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const slaPolicyFor = (priority: string) =>
    slaPolicies.find((policy) => policy.priority === priority) || DEFAULT_SLA_HOURS[priority];

  const saveSlaPolicy = async (priority: string, response_hours: number, resolution_hours: number) => {
    setSavingSlaPriority(priority);
    setWarnings((prev) => prev.filter((w) => !w.startsWith("SLA policy save failed")));
    try {
      await upsertCrmSlaPolicy({ priority, response_hours, resolution_hours });
      await load();
    } catch (error) {
      setWarnings((prev) => [...prev, `SLA policy save failed: ${error instanceof Error ? error.message : "Unknown error"}`]);
    } finally {
      setSavingSlaPriority(null);
    }
  };

  const submitEscalation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!escalatingTicketId || !escalateTo || !escalateReason.trim()) return;
    setBusy(true);
    try {
      await escalateCrmSupportTicket(escalatingTicketId, { escalated_to: escalateTo, reason: escalateReason.trim() });
      setEscalatingTicketId(null);
      setEscalateTo("");
      setEscalateReason("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-paper p-6">
      <Link href="/dashboard/crm" className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-light hover:text-signal">
        <ArrowLeft className="h-4 w-4" /> Back to CRM
      </Link>

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-black uppercase tracking-tight">CRM Support Desk</h1>
          <p className="max-w-3xl text-sm text-slate-light">
            Client issues, SLA visibility, lifecycle status, and post-sale support context linked back to organizations, contacts, opportunities, and projects.
          </p>
        </div>
        <Link
          href="/dashboard/crm/tickets"
          className="inline-flex shrink-0 items-center gap-2 rounded border border-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-light hover:border-signal hover:text-signal"
        >
          <Ticket className="h-4 w-4" /> View Full Ticket List &amp; Comments
        </Link>
      </div>

      {warnings.length > 0 && (
        <div className="mt-5 rounded border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Metric icon={<Ticket />} label="Open Tickets" value={summary.open_tickets ?? openTickets.length} />
        <Metric icon={<Clock />} label="Overdue" value={summary.overdue_tickets ?? 0} />
        <Metric icon={<CheckCircle2 />} label="Satisfaction" value={Number(summary.avg_satisfaction || 0).toFixed(1)} />
        <Metric icon={<Clock />} label="Avg First Response (h)" value={Number(summary.avg_first_response_hours || 0).toFixed(1)} />
        <Metric icon={<Clock />} label="Avg Resolution (h)" value={Number(summary.avg_resolution_hours || 0).toFixed(1)} />
        <Metric icon={<AlertOctagon />} label="Reopened" value={summary.reopened_tickets ?? 0} />
      </div>

      <section className="mt-6 rounded border border-white/10 bg-white/[0.03] p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider">SLA Policies</h2>
        <p className="mt-1 text-xs text-slate-light">Response/resolution hour targets applied when a ticket is created. Editing requires CRM admin configuration access.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          {SLA_PRIORITIES.map((priority) => {
            const policy = slaPolicyFor(priority);
            return (
              <div key={priority} className="rounded border border-white/10 bg-black/30 p-3">
                <p className="text-xs font-bold uppercase text-slate-light">{priority}</p>
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-[10px] uppercase text-slate-light">Response (h)</label>
                  <input
                    type="number"
                    min={1}
                    className={`${inputClass} w-20 px-2 py-1`}
                    defaultValue={policy.response_hours}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value > 0 && value !== policy.response_hours) saveSlaPolicy(priority, value, policy.resolution_hours);
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-[10px] uppercase text-slate-light">Resolution (h)</label>
                  <input
                    type="number"
                    min={1}
                    className={`${inputClass} w-20 px-2 py-1`}
                    defaultValue={policy.resolution_hours}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value > 0 && value !== policy.resolution_hours) saveSlaPolicy(priority, policy.response_hours, value);
                    }}
                  />
                </div>
                {savingSlaPriority === priority && <p className="mt-1 text-[10px] text-signal">Saving...</p>}
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[420px_1fr]">
        <section className="rounded border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider">Create Support Ticket</h2>
          <form onSubmit={submitTicket} className="mt-4 grid gap-3">
            <input className={inputClass} placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
            <textarea className={inputClass} placeholder="Issue description" value={form.issue_description} onChange={(e) => setForm({ ...form, issue_description: e.target.value })} />
            <select className={inputClass} value={form.organization_account_id} onChange={(e) => setForm({ ...form, organization_account_id: e.target.value })}>
              <option value="">No organization link</option>
              {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
            <select className={inputClass} value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}>
              <option value="">No contact link</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.contact_name || contact.email}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <input className={inputClass} placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" /> Create Ticket</button>
          </form>
        </section>

        <section className="rounded border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider">Ticket Lifecycle</h2>
          <div className="mt-4 grid gap-3">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="rounded border border-white/10 bg-black/30 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{ticket.subject || ticket.issue_description || ticket.ticket_number || "Untitled ticket"}</p>
                    <p className="mt-1 text-xs text-slate-light">{ticket.company_name || ticket.contact_name || "Unlinked client"} · {ticket.category || "uncategorized"}</p>
                    {ticket.escalated_at && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-rose-300">
                        <AlertOctagon className="h-3 w-3" /> Escalated {new Date(ticket.escalated_at).toLocaleDateString()}
                        {ticket.escalation_reason ? ` — ${ticket.escalation_reason}` : ""}
                      </p>
                    )}
                    {Number(ticket.reopen_count || 0) > 0 && (
                      <p className="mt-1 text-[11px] text-amber-300">Reopened {ticket.reopen_count}x</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded bg-white/10 px-2 py-1 uppercase">{ticket.priority || "normal"}</span>
                    <span className="rounded bg-signal/20 px-2 py-1 uppercase text-signal">{ticket.status || "new"}</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["assigned", "in_progress", "waiting_on_client", "resolved", "closed"].map((next) => (
                    <button key={next} disabled={busy || ticket.status === next} onClick={() => transition(ticket, next)} className="rounded border border-white/10 px-2 py-1 text-[10px] uppercase text-slate-light hover:border-signal hover:text-signal disabled:opacity-40">
                      {next.replaceAll("_", " ")}
                    </button>
                  ))}
                  <button
                    disabled={busy}
                    onClick={() => setEscalatingTicketId(ticket.id)}
                    className="rounded border border-rose-400/30 px-2 py-1 text-[10px] uppercase text-rose-300 hover:border-rose-400 disabled:opacity-40"
                  >
                    Escalate
                  </button>
                  <Link href="/dashboard/crm/tickets" className="rounded border border-white/10 px-2 py-1 text-[10px] uppercase text-slate-light hover:border-signal hover:text-signal">
                    View comments
                  </Link>
                </div>
                {escalatingTicketId === ticket.id && (
                  <form onSubmit={submitEscalation} className="mt-3 grid gap-2 rounded border border-rose-400/20 bg-rose-500/5 p-3">
                    <select className={inputClass} value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)} required>
                      <option value="">Escalate to...</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                    </select>
                    <textarea className={inputClass} placeholder="Escalation reason" value={escalateReason} onChange={(e) => setEscalateReason(e.target.value)} required />
                    <div className="flex gap-2">
                      <button disabled={busy} className={buttonClass}>Confirm Escalation</button>
                      <button type="button" onClick={() => setEscalatingTicketId(null)} className="rounded border border-white/10 px-4 py-2 text-xs uppercase text-slate-light">Cancel</button>
                    </div>
                  </form>
                )}
              </div>
            ))}
            {tickets.length === 0 && <p className="rounded border border-dashed border-white/10 p-6 text-center text-sm text-slate-light">No support tickets loaded.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return <div className="rounded border border-white/10 bg-white/[0.03] p-4"><div className="mb-3 h-5 w-5 text-signal">{icon}</div><p className="text-xs uppercase tracking-wider text-slate-light">{label}</p><p className="mt-1 text-xl font-black">{value}</p></div>;
}
