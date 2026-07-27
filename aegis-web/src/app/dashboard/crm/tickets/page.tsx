"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  HelpCircle, Plus, RefreshCw, X, Clock,
  AlertTriangle, ShieldCheck, Send, Paperclip
} from 'lucide-react';
import {
  getCrmSupportTickets, getCrmTicketComments, createCrmTicketComment,
  getCrmTicketAttachments, attachCrmTicketDocument, getCrmSupportDashboard,
} from '@/lib/api';

export default function TicketsPage() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [dashboard, setDashboard] = useState<any>(null);

  // Detail panel state
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachDocumentId, setAttachDocumentId] = useState('');

  // New Comment Form
  const [newCommentBody, setNewCommentBody] = useState('');
  const [commentVisibility, setCommentVisibility] = useState<'internal' | 'client'>('internal');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const loadTickets = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [ticketRes, dashboardRes] = await Promise.allSettled([
        getCrmSupportTickets(),
        getCrmSupportDashboard(),
      ]);
      if (ticketRes.status === "fulfilled" && ticketRes.value.success && Array.isArray(ticketRes.value.data)) {
        setTickets(ticketRes.value.data);
      } else {
        setLoadError("Support tickets could not be loaded from the CRM support service.");
      }
      if (dashboardRes.status === "fulfilled" && dashboardRes.value.success) {
        setDashboard(dashboardRes.value.data);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const loadComments = useCallback(async (ticketId: string) => {
    setIsLoadingComments(true);
    try {
      const [commentsRes, attachmentsRes] = await Promise.allSettled([
        getCrmTicketComments(ticketId),
        getCrmTicketAttachments(ticketId),
      ]);
      setComments(commentsRes.status === "fulfilled" && commentsRes.value.success && Array.isArray(commentsRes.value.data) ? commentsRes.value.data : []);
      setAttachments(attachmentsRes.status === "fulfilled" && attachmentsRes.value.success && Array.isArray(attachmentsRes.value.data) ? attachmentsRes.value.data : []);
    } finally {
      setIsLoadingComments(false);
    }
  }, []);

  const handleTicketClick = (ticket: any) => {
    setSelectedTicketId(ticket.id);
    void loadComments(ticket.id);
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId || !newCommentBody.trim()) return;

    setIsSubmittingComment(true);
    try {
      const res = await createCrmTicketComment(selectedTicketId, {
        body: newCommentBody.trim(),
        visibility: commentVisibility
      });
      if (res.success) {
        setNewCommentBody('');
        void loadComments(selectedTicketId);
      }
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleAttachDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId || !attachDocumentId.trim()) return;
    try {
      const res = await attachCrmTicketDocument(selectedTicketId, { document_id: attachDocumentId.trim() });
      if (res.success) {
        setAttachDocumentId('');
        void loadComments(selectedTicketId);
      }
    } catch {
      // Attachment failures surface via the disabled/no-op state; no fake local record is added.
    }
  };

  const filteredTickets = statusFilter === 'All'
    ? tickets
    : tickets.filter(t => t.status === statusFilter);

  const selectedTicket = tickets.find(t => t.id === selectedTicketId);
  const summary = dashboard?.summary || {};

  return (
    <main className="min-h-screen bg-[#0A0D14] text-[#E2E8F0] p-4 lg:p-8 font-sans flex relative overflow-hidden">
      {/* List / Dashboard Area */}
      <div className={`flex-1 transition-all duration-300 ${selectedTicketId ? 'pr-[450px]' : ''}`}>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-[#1E293B] pb-6 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <HelpCircle className="h-6 w-6 text-[#3B82F6]" />
              Help Desk & Support Tickets
            </h1>
            <p className="text-slate-400 text-xs mt-1">Manage technical assistance requests, SLA deadlines, and client support logs.</p>
          </div>
          <Link href="/dashboard/crm/support" className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-white">
            <Plus className="h-4 w-4" />
            Create Support Ticket
          </Link>
        </div>

        {loadError && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {loadError}
          </div>
        )}

        {/* SLA Dashboard Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-[#111827]/60 border border-[#1E293B] p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Total Unresolved</p>
              <h3 className="text-xl font-bold mt-1 text-white">
                {tickets.filter(t => !['resolved', 'closed'].includes(String(t.status || '').toLowerCase())).length} Tickets
              </h3>
            </div>
            <Clock className="h-8 w-8 text-amber-400 opacity-80" />
          </div>

          <div className="bg-[#111827]/60 border border-[#1E293B] p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Overdue</p>
              <h3 className="text-xl font-bold mt-1 text-rose-400">
                {summary.overdue_tickets ?? 0}
              </h3>
            </div>
            <AlertTriangle className="h-8 w-8 text-rose-400 opacity-80" />
          </div>

          <div className="bg-[#111827]/60 border border-[#1E293B] p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Resolution SLA Compliance</p>
              <h3 className="text-xl font-bold mt-1 text-emerald-400">
                {summary.resolution_sla_compliance_pct != null ? `${summary.resolution_sla_compliance_pct}%` : "N/A"}
              </h3>
            </div>
            <ShieldCheck className="h-8 w-8 text-emerald-400 opacity-80" />
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 border-b border-[#1E293B] mb-6">
          {[
            { key: 'All', label: 'All' },
            { key: 'assigned', label: 'Assigned' },
            { key: 'in_progress', label: 'In Progress' },
            { key: 'waiting_on_client', label: 'Waiting on Client' },
            { key: 'resolved', label: 'Resolved' },
            { key: 'closed', label: 'Closed' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition ${
                statusFilter === key
                  ? 'border-[#3B82F6] text-[#3B82F6]'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tickets List */}
        <div className="bg-[#111827]/40 border border-[#1E293B]/60 p-6 rounded-xl">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <RefreshCw className="h-8 w-8 animate-spin text-[#3B82F6]" />
            </div>
          ) : filteredTickets.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No support tickets found for this filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1E293B] text-[10px] font-mono uppercase text-slate-400">
                    <th className="pb-3">Ticket ID</th>
                    <th className="pb-3">Subject</th>
                    <th className="pb-3">Category</th>
                    <th className="pb-3">Priority</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">SLA Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B]/40 text-xs">
                  {filteredTickets.map((t: any) => {
                    const isOpen = !['resolved', 'closed'].includes(String(t.status || '').toLowerCase());
                    const breached = isOpen && t.resolution_due_at && new Date(t.resolution_due_at).getTime() < Date.now();
                    return (
                      <tr
                        key={t.id}
                        onClick={() => handleTicketClick(t)}
                        className={`hover:bg-[#111827]/40 transition cursor-pointer ${selectedTicketId === t.id ? 'bg-[#111827]/60' : ''}`}
                      >
                        <td className="py-3 font-mono font-semibold text-[#3B82F6]">#{t.ticket_number || t.id?.slice(0, 8)}</td>
                        <td className="py-3 font-semibold text-white">{t.subject}</td>
                        <td className="py-3 text-slate-400">{t.category || "uncategorized"}</td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            t.priority === 'urgent' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                            t.priority === 'high' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            'bg-slate-800 text-slate-300'
                          }`}>{t.priority || "normal"}</span>
                        </td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400">{t.status || "new"}</span>
                        </td>
                        <td className="py-3 font-mono">
                          <span className={`px-2 py-0.5 rounded ${
                            breached ? 'text-rose-400 bg-rose-500/10 border border-rose-500/20' : 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                          }`}>{breached ? 'Breached' : 'Within SLA'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Slide-over Detail & Comments Panel */}
      <div className={`fixed top-0 right-0 h-full w-[420px] bg-[#111827] border-l border-[#1E293B] p-6 shadow-2xl transition-transform duration-300 z-40 transform flex flex-col justify-between ${
        selectedTicketId ? 'translate-x-0' : 'translate-x-full'
      }`}>
        {selectedTicket ? (
          <>
            {/* Slide Header */}
            <div className="flex justify-between items-start border-b border-[#1E293B] pb-4 mb-4">
              <div>
                <span className="text-[10px] font-mono text-[#3B82F6]">TICKET #{selectedTicket.ticket_number}</span>
                <h3 className="text-sm font-bold text-white mt-1">{selectedTicket.subject}</h3>
              </div>
              <button 
                onClick={() => setSelectedTicketId(null)}
                className="p-1 rounded-lg hover:bg-[#1E293B] text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Ticket Params */}
            <div className="space-y-3 bg-[#0A0D14] p-3 rounded-lg border border-[#1E293B] text-xs mb-4">
              <div className="flex justify-between">
                <span className="text-slate-400">Category:</span>
                <span className="text-white font-semibold">{selectedTicket.category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Priority:</span>
                <span className="text-rose-400 font-semibold">{selectedTicket.priority}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Status:</span>
                <span className="text-emerald-400 font-semibold">{selectedTicket.status}</span>
              </div>
              {selectedTicket.escalated_at && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Escalated:</span>
                  <span className="text-rose-400 font-semibold">{new Date(selectedTicket.escalated_at).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            {/* Attachments */}
            <div className="mb-4">
              <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400 block mb-2">Attachments</span>
              <div className="space-y-2 mb-2">
                {attachments.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No documents attached.</p>
                ) : attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 rounded bg-[#0A0D14] border border-[#1E293B] px-2 py-1.5 text-[11px] text-slate-200">
                    <Paperclip className="h-3 w-3 text-slate-400 flex-shrink-0" />
                    <span className="truncate">{a.title || a.file_name || a.id}</span>
                  </div>
                ))}
              </div>
              <form onSubmit={handleAttachDocument} className="flex gap-2">
                <input
                  type="text"
                  value={attachDocumentId}
                  onChange={(e) => setAttachDocumentId(e.target.value)}
                  placeholder="Existing document ID"
                  className="flex-1 bg-[#0A0D14] border border-[#1E293B] rounded p-1.5 text-[11px] text-white focus:outline-none focus:border-[#3B82F6]"
                />
                <button type="submit" className="px-2 rounded border border-[#1E293B] text-slate-300 hover:border-[#3B82F6] hover:text-[#3B82F6]">
                  <Paperclip className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>

            {/* Comments Timeline */}
            <div className="flex-1 overflow-y-auto no-scrollbar space-y-4 mb-4">
              <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400 block mb-2">Comment Feed</span>
              {isLoadingComments ? (
                <div className="flex justify-center py-6">
                  <RefreshCw className="h-5 w-5 animate-spin text-[#3B82F6]" />
                </div>
              ) : (
                <div className="space-y-3">
                  {comments.map((comment) => (
                    <div 
                      key={comment.id} 
                      className={`border p-3 rounded-lg ${
                        comment.visibility === 'internal' 
                          ? 'bg-amber-500/5 border-amber-500/10 text-amber-200' 
                          : 'bg-blue-500/5 border-blue-500/10 text-blue-200'
                      }`}
                    >
                      <div className="flex justify-between items-center text-[9px] mb-1 font-mono">
                        <span className="font-bold">{comment.created_by_name || 'System Operator'}</span>
                        <span className="px-1.5 py-0.2 rounded uppercase font-semibold text-[8px] bg-white/5">
                          {comment.visibility === 'internal' ? '🔒 Internal Note' : '🌍 Client Visible'}
                        </span>
                      </div>
                      <p className="text-xs text-white leading-relaxed">{comment.body}</p>
                      <span className="text-[8px] text-slate-400 mt-1 block text-right font-mono">{new Date(comment.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Post Comment Form */}
            <form onSubmit={handlePostComment} className="border-t border-[#1E293B] pt-4 space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">Post Comment As:</span>
                <button
                  type="button"
                  onClick={() => setCommentVisibility(prev => prev === 'internal' ? 'client' : 'internal')}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase transition ${
                    commentVisibility === 'internal' ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'
                  }`}
                >
                  {commentVisibility === 'internal' ? '🔒 Internal' : '🌍 Public/Client'}
                </button>
              </div>
              <div className="relative">
                <input 
                  type="text" 
                  value={newCommentBody}
                  onChange={(e) => setNewCommentBody(e.target.value)}
                  placeholder={commentVisibility === 'internal' ? 'Type internal team note...' : 'Type message to client...'}
                  className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 pr-10 text-xs text-white focus:outline-none focus:border-[#3B82F6]"
                />
                <button 
                  type="submit" 
                  disabled={isSubmittingComment}
                  className="absolute right-2.5 top-2.5 text-[#3B82F6] hover:text-white"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </>
        ) : null}
      </div>
    </main>
  );
}
