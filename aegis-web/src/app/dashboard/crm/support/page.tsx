"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  AlertOctagon, CheckCircle2, Clock, Plus, Ticket,
  MessageSquare, Paperclip, Send, X, ShieldAlert,
  Loader2, User, Building2, Check, ExternalLink
} from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
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
  getCrmTicketComments,
  createCrmTicketComment,
  getCrmTicketAttachments,
  attachCrmTicketDocument,
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

  // Ticket Detail Drawer State
  const [selectedTicket, setSelectedTicket] = useState<RecordData | null>(null);
  const [comments, setComments] = useState<RecordData[]>([]);
  const [attachments, setAttachments] = useState<RecordData[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newCommentBody, setNewCommentBody] = useState("");
  const [commentVisibility, setCommentVisibility] = useState<"internal" | "client">("internal");
  const [postingComment, setPostingComment] = useState(false);
  const [attachDocId, setAttachDocId] = useState("");
  const [attachingDoc, setAttachingDoc] = useState(false);

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openTicketDetail = useCallback(async (ticket: RecordData) => {
    setSelectedTicket(ticket);
    setLoadingComments(true);
    try {
      const [commRes, attRes] = await Promise.allSettled([
        getCrmTicketComments(ticket.id),
        getCrmTicketAttachments(ticket.id),
      ]);
      setComments(commRes.status === "fulfilled" && commRes.value.success ? commRes.value.data || [] : []);
      setAttachments(attRes.status === "fulfilled" && attRes.value.success ? attRes.value.data || [] : []);
    } catch {
      setComments([]);
      setAttachments([]);
    } finally {
      setLoadingComments(false);
    }
  }, []);

  // Check URL search params for deep linking
  useEffect(() => {
    if (typeof window !== "undefined" && tickets.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const ticketId = params.get("ticket_id") || params.get("id");
      if (ticketId && (!selectedTicket || selectedTicket.id !== ticketId)) {
        const found = tickets.find((t) => t.id === ticketId);
        if (found) void openTicketDetail(found);
      }
    }
  }, [tickets, selectedTicket, openTicketDetail]);

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
      if (selectedTicket?.id === ticket.id) {
        setSelectedTicket((prev) => (prev ? { ...prev, status } : null));
      }
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

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket?.id || !newCommentBody.trim()) return;
    setPostingComment(true);
    try {
      const res = await createCrmTicketComment(selectedTicket.id, {
        body: newCommentBody.trim(),
        visibility: commentVisibility,
      });
      if (res.success) {
        setNewCommentBody("");
        const commRes = await getCrmTicketComments(selectedTicket.id);
        if (commRes.success) setComments(commRes.data || []);
      }
    } finally {
      setPostingComment(false);
    }
  };

  const submitAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket?.id || !attachDocId.trim()) return;
    setAttachingDoc(true);
    try {
      const res = await attachCrmTicketDocument(selectedTicket.id, { document_id: attachDocId.trim() });
      if (res.success) {
        setAttachDocId("");
        const attRes = await getCrmTicketAttachments(selectedTicket.id);
        if (attRes.success) setAttachments(attRes.data || []);
      }
    } catch (err: any) {
      alert(err?.message || "Failed to attach document.");
    } finally {
      setAttachingDoc(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-paper p-6">
      <DashboardPageHeader
        backHref="/dashboard/crm"
        backLabel="Back to CRM"
        title="CRM Support Desk"
        subtitle="Client issues, SLA visibility, lifecycle status, comment threads, attachments, and post-sale support context."
      />

      {warnings.length > 0 && (
        <div className="mb-6 rounded border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
          <ul className="list-disc pl-5 space-y-1">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric icon={<Ticket className="h-5 w-5" />} label="Open Tickets" value={summary.open_tickets ?? openTickets.length} />
        <Metric icon={<AlertOctagon className="h-5 w-5" />} label="Escalated" value={summary.escalated_tickets ?? tickets.filter((t) => t.escalated_at).length} />
        <Metric icon={<Clock className="h-5 w-5" />} label="Response Breaches" value={summary.response_breached ?? 0} />
        <Metric icon={<CheckCircle2 className="h-5 w-5" />} label="Resolution Breaches" value={summary.resolution_breached ?? 0} />
      </div>

      <section className="mt-6 rounded border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider">Configured SLA Targets</h2>
            <p className="mt-0.5 text-xs text-slate-light">Target response and resolution windows by priority.</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          {SLA_PRIORITIES.map((priority) => {
            const policy = slaPolicyFor(priority);
            return (
              <div key={priority} className="rounded border border-white/10 bg-black/30 p-3">
                <span className="text-xs font-bold uppercase text-signal">{priority}</span>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-slate-light">Response:</span>
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
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-slate-light">Resolution:</span>
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

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[400px_1fr]">
        <section className="rounded border border-white/10 bg-white/[0.03] p-4 h-fit">
          <h2 className="text-sm font-bold uppercase tracking-wider">Create Support Ticket</h2>
          <form onSubmit={submitTicket} className="mt-4 grid gap-3">
            <input className={inputClass} placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
            <textarea rows={3} className={inputClass} placeholder="Issue description" value={form.issue_description} onChange={(e) => setForm({ ...form, issue_description: e.target.value })} />
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
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider">Ticket Lifecycle ({tickets.length})</h2>
            <span className="font-mono text-[10px] text-slate-light uppercase">Click any ticket for comment thread &amp; documents</span>
          </div>
          <div className="grid gap-3">
            {tickets.map((ticket) => {
              const isSelected = selectedTicket?.id === ticket.id;
              return (
                <div
                  key={ticket.id}
                  onClick={() => openTicketDetail(ticket)}
                  className={`rounded border p-3 cursor-pointer transition-all ${
                    isSelected
                      ? "border-signal bg-signal/5"
                      : "border-white/10 bg-black/30 hover:border-white/20"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-paper flex items-center gap-2">
                        <span>{ticket.subject || ticket.issue_description || ticket.ticket_number || "Untitled ticket"}</span>
                        {ticket.ticket_number && (
                          <span className="font-mono text-[10px] text-slate-light">#{ticket.ticket_number}</span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-slate-light">
                        {ticket.company_name || ticket.contact_name || "Unlinked client"} · {ticket.category || "uncategorized"}
                      </p>
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
                      <span className="rounded bg-white/10 px-2 py-1 uppercase text-[10px]">{ticket.priority || "normal"}</span>
                      <span className="rounded bg-signal/20 px-2 py-1 uppercase text-signal text-[10px]">{ticket.status || "new"}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    {["assigned", "in_progress", "waiting_on_client", "resolved", "closed"].map((next) => (
                      <button
                        key={next}
                        disabled={busy || ticket.status === next}
                        onClick={() => transition(ticket, next)}
                        className="rounded border border-white/10 px-2 py-1 text-[10px] uppercase text-slate-light hover:border-signal hover:text-signal disabled:opacity-40"
                      >
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
                    <button
                      onClick={() => openTicketDetail(ticket)}
                      className="rounded border border-signal/30 bg-signal/10 px-2 py-1 text-[10px] uppercase text-signal hover:bg-signal/20 flex items-center gap-1"
                    >
                      <MessageSquare className="w-3 h-3" /> Comments &amp; Files
                    </button>
                  </div>
                  {escalatingTicketId === ticket.id && (
                    <form onSubmit={submitEscalation} onClick={(e) => e.stopPropagation()} className="mt-3 grid gap-2 rounded border border-rose-400/20 bg-rose-500/5 p-3">
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
              );
            })}
            {tickets.length === 0 && <p className="rounded border border-dashed border-white/10 p-6 text-center text-sm text-slate-light">No support tickets loaded.</p>}
          </div>
        </section>
      </div>

      {/* TICKET DETAIL DRAWER */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedTicket(null)} />
          <div className="relative w-full max-w-xl bg-[#0A0A0A] border-l border-white/10 h-full overflow-y-auto flex flex-col z-10 shadow-2xl">
            {/* Header */}
            <div className="p-5 border-b border-white/10 bg-white/[0.02] flex justify-between items-start">
              <div>
                <span className="font-mono text-[9px] uppercase tracking-wider text-signal">Ticket #{selectedTicket.ticket_number || selectedTicket.id.slice(0, 8)}</span>
                <h3 className="text-base font-bold text-paper mt-1">{selectedTicket.subject || "Support Ticket"}</h3>
                <div className="flex items-center gap-2 mt-2">
                  <span className="px-2 py-0.5 rounded text-[9px] font-mono uppercase bg-white/10 text-paper">{selectedTicket.priority || "normal"}</span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-mono uppercase bg-signal/20 text-signal">{selectedTicket.status || "open"}</span>
                </div>
              </div>
              <button onClick={() => setSelectedTicket(null)} className="p-1 text-slate-light hover:text-paper rounded-sm">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-6 flex-1">
              {/* Description */}
              {selectedTicket.issue_description && (
                <div className="bg-white/[0.02] border border-white/5 p-4 rounded-sm">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-slate-light block mb-1">Issue Description</span>
                  <p className="text-xs text-paper whitespace-pre-wrap">{selectedTicket.issue_description}</p>
                </div>
              )}

              {/* Attachments Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-mono text-[10px] uppercase tracking-wider text-slate-light flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5 text-signal" />
                    Attached Files ({attachments.length})
                  </h4>
                </div>

                <div className="space-y-2">
                  {attachments.map((att: any) => (
                    <div key={att.id} className="p-2.5 rounded-sm bg-black/40 border border-white/5 flex items-center justify-between text-xs">
                      <div className="truncate pr-2">
                        <p className="font-mono text-paper truncate">{att.title || att.document_id || "Attachment"}</p>
                        <span className="text-[9px] text-slate-light font-mono">{att.file_type || "document"}</span>
                      </div>
                      {att.file_path && (
                        <a
                          href={att.file_path}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[9px] font-mono text-signal uppercase flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" /> View
                        </a>
                      )}
                    </div>
                  ))}
                  {attachments.length === 0 && (
                    <p className="text-xs font-mono text-slate-dark py-2">No files attached to this ticket.</p>
                  )}
                </div>

                {/* Attach form */}
                <form onSubmit={submitAttachment} className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={attachDocId}
                    onChange={(e) => setAttachDocId(e.target.value)}
                    placeholder="Document UUID to attach..."
                    className="flex-1 bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-xs text-paper font-mono outline-none focus:border-signal"
                  />
                  <button
                    type="submit"
                    disabled={attachingDoc || !attachDocId.trim()}
                    className="px-3 py-1.5 bg-white/10 hover:bg-white/15 disabled:opacity-50 text-paper font-mono text-[10px] uppercase rounded"
                  >
                    {attachingDoc ? "Attaching..." : "Attach"}
                  </button>
                </form>
              </div>

              {/* Comments Thread */}
              <div className="space-y-3">
                <h4 className="font-mono text-[10px] uppercase tracking-wider text-slate-light flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-signal" />
                  Conversation Thread ({comments.length})
                </h4>

                {loadingComments ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="w-5 h-5 text-signal animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {comments.map((c: any) => (
                      <div
                        key={c.id}
                        className={`p-3 rounded-sm border ${
                          c.visibility === "internal"
                            ? "bg-amber-950/10 border-amber-500/20"
                            : "bg-white/[0.02] border-white/5"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5 text-[9px] font-mono text-slate-light">
                          <span className="flex items-center gap-1.5">
                            <span className="font-bold text-paper">{c.user_name || c.author_name || "Agent"}</span>
                            <span className={`px-1.5 py-0.2 rounded uppercase ${c.visibility === "internal" ? "text-amber-400 bg-amber-500/10" : "text-signal bg-signal/10"}`}>
                              {c.visibility}
                            </span>
                          </span>
                          <span>{c.created_at ? new Date(c.created_at).toLocaleString() : ""}</span>
                        </div>
                        <p className="text-xs text-paper whitespace-pre-wrap">{c.body}</p>
                      </div>
                    ))}
                    {comments.length === 0 && (
                      <p className="text-xs font-mono text-slate-dark py-2">No comments recorded yet.</p>
                    )}
                  </div>
                )}

                {/* Post comment form */}
                <form onSubmit={submitComment} className="pt-2 space-y-2">
                  <textarea
                    required
                    rows={3}
                    value={newCommentBody}
                    onChange={(e) => setNewCommentBody(e.target.value)}
                    placeholder="Type an update or resolution note..."
                    className="w-full bg-black/50 border border-white/10 rounded p-2.5 text-xs text-paper outline-none focus:border-signal resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-mono uppercase text-slate-light">Visibility:</label>
                      <select
                        value={commentVisibility}
                        onChange={(e) => setCommentVisibility(e.target.value as "internal" | "client")}
                        className="bg-black border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-paper"
                      >
                        <option value="internal">Internal Note (Staff only)</option>
                        <option value="client">Client Visible</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={postingComment || !newCommentBody.trim()}
                      className="px-4 py-1.5 bg-signal hover:bg-signal/90 disabled:opacity-50 text-ink font-bold font-mono text-[10px] uppercase rounded flex items-center gap-1.5"
                    >
                      <Send className="w-3 h-3" />
                      {postingComment ? "Posting..." : "Post Comment"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 h-5 w-5 text-signal">{icon}</div>
      <p className="text-xs uppercase tracking-wider text-slate-light">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}
