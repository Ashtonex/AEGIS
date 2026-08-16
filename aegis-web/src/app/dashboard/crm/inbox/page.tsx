"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from 'next/link';
import { 
  Mail, 
  MessageSquare, 
  Search, 
  Send, 
  Loader2, 
  AlertTriangle,
  User,
  Clock,
  CheckCheck,
  Filter,
  FileText,
  Smartphone,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Database,
  ShieldCheck,
  Wifi,
  MoreVertical,
  Paperclip,
  CheckCircle2,
  Bookmark,
  ArrowLeft,
  Briefcase,
  UserCheck
} from "lucide-react";
import {
  getCrmCommunications,
  createCrmCommunication,
  convertCrmCommunication,
  getCrmMessageTemplates,
  getCrmContacts,
  getCrmOrganizations,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";

interface Message {
  id: string;
  sender: "client" | "user";
  body: string;
  timestamp: string;
  channel: string;
  status?: string;
}

interface Thread {
  id: string;
  channel: "Email" | "WhatsApp" | "Other";
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  company?: string;
  subject: string;
  lastMessage: string;
  timestamp: string;
  unread: boolean;
  projectType?: string;
  messages: Message[];
  contactId?: string;
  leadId?: string;
  opportunityId?: string;
  ownerId?: string;
  ownerName?: string;
  linked: boolean;
}

interface ResponseTemplate {
  id: string;
  name: string;
  channel: string;
  subject?: string;
  body: string;
  variables: string[];
}

export default function CRMSalesInbox() {
  const { session } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [channelFilter, setChannelFilter] = useState<"All" | "Email" | "WhatsApp" | "Other">("All");
  const [ownerFilter, setOwnerFilter] = useState<string>("All");
  const [clientFilter, setClientFilter] = useState<string>("All");
  const [linkedFilter, setLinkedFilter] = useState<"All" | "Linked" | "Unlinked">("All");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  
  // CRM lookup collections
  const [contacts, setContacts] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [templates, setTemplates] = useState<ResponseTemplate[]>([]);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Template editor modal/popover states
  const [activeTemplateIdx, setActiveTemplateIdx] = useState<number | null>(null);
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  const [gatewaySelection, setGatewaySelection] = useState<"Email" | "WhatsApp">("Email");

  // Conversion States
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<'lead' | 'ticket' | 'activity'>('lead');
  const [convertForm, setConvertForm] = useState({
    subject: '',
    notes: '',
    budget: '50000'
  });


  const normalizeLoadError = (reason: unknown, fallback: string) => {
    const message = reason instanceof Error ? reason.message : String(reason ?? "");
    if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(message)) {
      return fallback;
    }
    return fallback;
  };

  const isWhatsAppChannel = (channel: string) => channel?.startsWith("whatsapp");

  const loadInboxData = useCallback(async (preserveSelection?: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [commsRes, contactsRes, orgsRes, templatesRes] = await Promise.allSettled([
        getCrmCommunications({ limit: 200 }),
        getCrmContacts(),
        getCrmOrganizations(),
        getCrmMessageTemplates(),
      ]);

      const warnings: string[] = [];
      const threadMap = new Map<string, Thread>();

      if (commsRes.status === "fulfilled" && commsRes.value.success) {
        const communications = (commsRes.value.data || []).slice().reverse(); // oldest first for message ordering
        communications.forEach((c: any) => {
          const key = c.contact_id || c.lead_id || c.opportunity_id || `standalone-${c.id}`;
          const channel: Thread["channel"] = isWhatsAppChannel(c.channel) ? "WhatsApp" : c.channel === "email" ? "Email" : "Other";
          const message: Message = {
            id: c.id,
            sender: c.direction === "inbound" ? "client" : "user",
            body: c.body || "",
            timestamp: c.started_at || c.created_at,
            channel: c.channel,
            status: c.status,
          };
          const ownerId = c.recipient_user_id || c.actor_user_id || undefined;
          const ownerName = c.recipient_name || c.actor_name || undefined;
          const existing = threadMap.get(key);
          if (existing) {
            existing.messages.push(message);
            existing.lastMessage = message.body;
            existing.timestamp = message.timestamp;
            if (message.status && ["received", "pending"].includes(message.status)) existing.unread = true;
            if (!existing.ownerId && ownerId) {
              existing.ownerId = ownerId;
              existing.ownerName = ownerName;
            }
          } else {
            threadMap.set(key, {
              id: key,
              channel,
              clientName: c.contact_name || c.lead_company || c.opportunity_name || c.from_address || "Unknown",
              clientEmail: c.channel === "email" ? (c.direction === "inbound" ? c.from_address : c.to_address) : undefined,
              clientPhone: isWhatsAppChannel(c.channel) ? (c.direction === "inbound" ? c.from_address : c.to_address) : undefined,
              company: c.lead_company,
              subject: c.subject || "CRM communication",
              lastMessage: message.body,
              timestamp: message.timestamp,
              unread: ["received", "pending"].includes(String(c.status || "")),
              messages: [message],
              contactId: c.contact_id || undefined,
              leadId: c.lead_id || undefined,
              opportunityId: c.opportunity_id || undefined,
              ownerId,
              ownerName,
              linked: Boolean(c.contact_id || c.lead_id || c.opportunity_id),
            });
          }
        });
      } else {
        warnings.push("CRM communications could not be loaded.");
      }

      if (contactsRes.status === "fulfilled" && contactsRes.value.success) {
        setContacts(contactsRes.value.data || []);
      } else {
        warnings.push("CRM contacts could not be loaded.");
      }
      if (orgsRes.status === "fulfilled" && orgsRes.value.success) {
        setOrganizations(orgsRes.value.data || []);
      } else {
        warnings.push("CRM organizations could not be loaded.");
      }
      if (templatesRes.status === "fulfilled" && templatesRes.value.success) {
        setTemplates(templatesRes.value.data || []);
      } else {
        warnings.push("Message templates could not be loaded.");
      }

      const loadedThreads = Array.from(threadMap.values());
      loadedThreads.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setThreads(loadedThreads);

      if (preserveSelection && loadedThreads.some((t) => t.id === preserveSelection)) {
        setSelectedThreadId(preserveSelection);
      } else if (loadedThreads.length > 0) {
        setSelectedThreadId(loadedThreads[0].id);
      }
      setSourceWarnings(warnings);
    } catch (err: any) {
      setLoadError(normalizeLoadError(err, "Failed to load CRM inbox data."));
      setSourceWarnings([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadInboxData();
  }, [session, loadInboxData]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const selectedThread = threads.find(t => t.id === selectedThreadId);

  // Sync gateway selection when thread changes
  useEffect(() => {
    if (selectedThread) {
      setGatewaySelection(selectedThread.channel === "WhatsApp" ? "WhatsApp" : "Email");
    }
  }, [selectedThread]);

  // Handle template selection & setup variable values
  const handlePickTemplate = (idx: number) => {
    setActiveTemplateIdx(idx);
    const tmpl = templates[idx];
    if (!tmpl) return;
    const initialVals: Record<string, string> = {};
    (tmpl.variables || []).forEach((variable) => {
      if (/client/i.test(variable)) initialVals[variable] = selectedThread?.clientName || "";
      else if (/project/i.test(variable)) initialVals[variable] = selectedThread?.projectType || "";
      else if (/credit/i.test(variable)) {
        const matchedOrgForTemplate = organizations.find(o => o.name === selectedThread?.company);
        initialVals[variable] = matchedOrgForTemplate ? `$${Number(matchedOrgForTemplate.credit_limit).toLocaleString()}` : "";
      } else {
        initialVals[variable] = "";
      }
    });
    setTemplateValues(initialVals);
  };

  const handleConvertClick = (target: 'lead' | 'ticket' | 'activity') => {
    if (!selectedThread) return;
    setConvertTarget(target);
    setConvertForm({
      subject: selectedThread.subject || '',
      notes: selectedThread.lastMessage || '',
      budget: '50000'
    });
    setIsConvertModalOpen(true);
  };

  const handleConvertMessageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedThread) return;
    const latestMessage = selectedThread.messages[selectedThread.messages.length - 1];
    if (!latestMessage) return;

    setIsSending(true);
    try {
      const response = await convertCrmCommunication(latestMessage.id, {
        target_type: convertTarget,
        company_name: selectedThread.company || selectedThread.clientName,
        contact_name: selectedThread.clientName,
        contact_email: selectedThread.clientEmail,
        contact_phone: selectedThread.clientPhone,
        task_subject: convertForm.subject,
      });
      if (!response.success) throw new Error(response.message || "Conversion failed.");
      showToast(response.message || `Message converted to ${convertTarget}.`);
      setIsConvertModalOpen(false);
    } catch (err: any) {
      showToast(err?.message || "Conversion failed. The message was not converted.", "error");
    } finally {
      setIsSending(false);
    }
  };

  // Compile template and insert into draft
  const handleInsertTemplate = () => {
    if (activeTemplateIdx === null) return;
    const tmpl = templates[activeTemplateIdx];
    if (!tmpl) return;
    let body = tmpl.body;
    (tmpl.variables || []).forEach((variable) => {
      const val = templateValues[variable] || `[${variable}]`;
      body = body.replaceAll(`{{${variable}}}`, val);
    });
    setReplyText(body);
    setActiveTemplateIdx(null);
    showToast("Template drafted to composer.");
  };


  // Send message and log activity in CRM database
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedThread || !replyText.trim() || isSending) return;

    setIsSending(true);
    try {
      // Try to match sender in CRM database to log interaction
      const matchedContact = contacts.find(
        (c) => c.email && c.email.toLowerCase() === selectedThread.clientEmail?.toLowerCase()
      ) || contacts.find(
        (c) => c.phone && c.phone.replace(/[^0-9]/g, '') === selectedThread.clientPhone?.replace(/[^0-9]/g, '')
      );

      const channelValue = gatewaySelection === "WhatsApp" ? "whatsapp_message" : "email";
      const payload: Record<string, unknown> = {
        channel: channelValue,
        direction: "outbound",
        subject: selectedThread.subject,
        body: replyText.trim(),
        status: "sent",
        contact_id: selectedThread.contactId || (matchedContact ? matchedContact.id : undefined),
        lead_id: selectedThread.leadId,
        opportunity_id: selectedThread.opportunityId,
        to_address: gatewaySelection === "WhatsApp" ? selectedThread.clientPhone : selectedThread.clientEmail,
      };

      const response = await createCrmCommunication(payload);
      if (!response.success) throw new Error(response.message || "Reply was not recorded.");

      showToast(`Reply sent via ${gatewaySelection} and logged to CRM.`);
      setReplyText("");
      await loadInboxData(selectedThread.id);
    } catch (err) {
      showToast(normalizeLoadError(err, `Reply was not recorded. Check the ${gatewaySelection} workflow connection and retry.`), "error");
    } finally {
      setIsSending(false);
    }
  };

  // Resolve CRM stats of sender's organization
  const matchedContact = selectedThread ? (
    contacts.find(c => c.email && c.email.toLowerCase() === selectedThread.clientEmail?.toLowerCase()) ||
    contacts.find(c => c.phone && c.phone.replace(/[^0-9]/g, '') === selectedThread.clientPhone?.replace(/[^0-9]/g, ''))
  ) : null;

  const matchedOrg = matchedContact && matchedContact.client_org_id ? (
    organizations.find(o => o.id === matchedContact.client_org_id)
  ) : (
    selectedThread ? organizations.find(o => o.name.toLowerCase() === selectedThread.company?.toLowerCase()) : null
  );

  // Filter threads
  const filteredThreads = threads.filter((thread) => {
    const matchesSearch =
      thread.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (thread.clientEmail && thread.clientEmail.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (thread.clientPhone && thread.clientPhone.includes(searchTerm)) ||
      thread.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (thread.company && thread.company.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesChannel =
      channelFilter === "All" || thread.channel === channelFilter;

    const matchesOwner =
      ownerFilter === "All" || thread.ownerName === ownerFilter;

    const matchesClient =
      clientFilter === "All" || thread.clientName === clientFilter || thread.company === clientFilter;

    const matchesLinked =
      linkedFilter === "All" || (linkedFilter === "Linked" ? thread.linked : !thread.linked);

    const matchesUnread = !unreadOnly || thread.unread;

    return matchesSearch && matchesChannel && matchesOwner && matchesClient && matchesLinked && matchesUnread;
  });

  const ownerOptions = Array.from(new Set(threads.map((t) => t.ownerName).filter(Boolean))) as string[];
  const clientOptions = Array.from(new Set(threads.map((t) => t.clientName).filter(Boolean))) as string[];

  const formatMessageTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch {
      return "";
    }
  };

  const formatThreadDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const today = new Date();
      if (d.toDateString() === today.toDateString()) {
        return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
      }
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-paper overflow-hidden p-6 relative">

      {/* Header */}
      <div className="flex justify-between items-center border-b border-ink-mid pb-3 shrink-0 mb-4">
        <div>
          <div className="flex items-center space-x-2">
            <Link href="/dashboard/crm" className="inline-flex items-center text-[10px] font-mono text-slate hover:text-signal transition-colors mr-2">
              <ArrowLeft className="w-3.5 h-3.5 mr-0.5" />
              BACK
            </Link>
            <h1 className="font-sans font-black text-lg tracking-wide uppercase text-paper">
              Sales Communications Hub
            </h1>
          </div>
          <p className="font-mono text-[9px] text-slate-light tracking-widest uppercase mt-0.5">
            Unified SMTP Mail & WhatsApp Business API gateway responder
          </p>
        </div>

        {/* Telemetry Indicator */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1 bg-green-500/10 px-2.5 py-0.5 border border-green-500/20 text-green-400 font-mono text-[9px] uppercase font-bold">
            <Wifi className="w-3 h-3 animate-pulse" />
            <span>Gateways Online</span>
          </div>
        </div>
      </div>

      {sourceWarnings.length > 0 && (
        <div className="mb-4 space-y-2 rounded border border-amber-500/20 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          {sourceWarnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p>{warning}</p>
            </div>
          ))}
        </div>
      )}

      {/* Notifications Toast */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 p-4 border border-signal bg-ink-light text-signal font-mono text-xs shadow-lg rounded-none">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      {loadError && (
        <div className="bg-red-950/20 border border-red-500/30 p-2.5 mb-3 rounded-none flex items-center space-x-2 text-red-400 shrink-0 font-mono text-xs">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* 3-Column Unified Workspace Layout */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-signal animate-spin" />
        </div>
      ) : (
        <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
          
          {/* COLUMN 1: THREAD LIST (30%) */}
          <div className="w-[30%] min-w-[280px] flex flex-col bg-ink-light border border-ink-mid p-3 min-h-0">
            {/* Search and Filters */}
            <div className="space-y-2 mb-3 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-light" />
                <input
                  type="text"
                  placeholder="Filter pipeline conversations..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-ink border border-ink-mid pl-8 pr-3 py-1.5 text-xs text-paper focus:border-signal outline-none font-mono"
                />
              </div>

              {/* Channel Filter Tab */}
              <div className="flex bg-ink border border-ink-mid p-0.5">
                {(["All", "Email", "WhatsApp", "Other"] as const).map((ch) => (
                  <button
                    key={ch}
                    onClick={() => setChannelFilter(ch)}
                    className={`flex-1 py-1 text-[9px] font-mono tracking-wider uppercase transition-all ${
                      channelFilter === ch
                        ? "bg-signal text-black font-bold"
                        : "text-slate hover:text-paper"
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>

              {/* Owner / Client / Linked-record / Unread filters */}
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  className="bg-ink border border-ink-mid text-[9px] font-mono text-slate-300 py-1 px-1 focus:outline-none"
                >
                  <option value="All">All Owners</option>
                  {ownerOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <select
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  className="bg-ink border border-ink-mid text-[9px] font-mono text-slate-300 py-1 px-1 focus:outline-none"
                >
                  <option value="All">All Clients</option>
                  {clientOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <select
                  value={linkedFilter}
                  onChange={(e) => setLinkedFilter(e.target.value as "All" | "Linked" | "Unlinked")}
                  className="bg-ink border border-ink-mid text-[9px] font-mono text-slate-300 py-1 px-1 focus:outline-none"
                >
                  <option value="All">All Records</option>
                  <option value="Linked">Linked to CRM</option>
                  <option value="Unlinked">Unlinked</option>
                </select>
                <button
                  type="button"
                  onClick={() => setUnreadOnly((prev) => !prev)}
                  className={`text-[9px] font-mono tracking-wider uppercase transition-all border ${
                    unreadOnly ? "bg-signal text-black border-signal font-bold" : "border-ink-mid text-slate hover:text-paper"
                  }`}
                >
                  Unread Only
                </button>
              </div>
            </div>

            {/* Threads Feed */}
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-0.5">
              {filteredThreads.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate font-mono text-xs py-10">
                  <Mail className="w-6 h-6 text-slate/30 mb-1.5" />
                  <span>No active communications.</span>
                </div>
              ) : (
                filteredThreads.map((thread) => {
                  const isSelected = selectedThreadId === thread.id;
                  return (
                    <div
                      key={thread.id}
                      onClick={() => {
                        setSelectedThreadId(thread.id);
                        thread.unread = false;
                      }}
                      className={`p-3 border cursor-pointer transition-all flex flex-col gap-1 relative ${
                        isSelected
                          ? "bg-ink border-signal"
                          : "bg-ink/35 border-ink-mid/45 hover:border-slate/40"
                      }`}
                    >
                      {thread.unread && (
                        <span className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-signal" />
                      )}

                      <div className="flex justify-between items-start">
                        <div className="flex items-center space-x-1.5 min-w-0 pr-4">
                          <span className={`p-0.5 border text-[9px] uppercase ${
                            thread.channel === "WhatsApp"
                              ? "bg-green-500/10 border-green-500/25 text-green-500"
                              : thread.channel === "Email"
                              ? "bg-blue-500/10 border-blue-500/25 text-blue-400"
                              : "bg-slate-500/10 border-slate-500/25 text-slate-300"
                          }`}>
                            {thread.channel === "WhatsApp" ? "WA" : thread.channel === "Email" ? "Mail" : "Other"}
                          </span>
                          <span className="font-bold text-xs text-paper truncate">
                            {thread.clientName}
                          </span>
                        </div>
                        <span className="font-mono text-[8px] text-slate-light tabular-nums shrink-0 mt-0.5">
                          {formatThreadDate(thread.timestamp)}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <p className={`font-sans text-[11px] truncate ${isSelected ? 'text-paper' : 'text-paper/85'}`}>
                          {thread.subject}
                        </p>
                        <p className="font-sans text-[10px] text-slate-light truncate mt-0.5">
                          {thread.lastMessage}
                        </p>
                      </div>

                      {thread.company && (
                        <div className="font-mono text-[8px] uppercase tracking-wider text-signal mt-1 flex items-center">
                          <Briefcase className="w-2 h-2 mr-1" />
                          {thread.company}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* COLUMN 2: MESSAGE CONVERSATION THREAD & RESPONDER (43%) */}
          <div className="w-[43%] flex flex-col bg-ink-light border border-ink-mid p-4 min-h-0">
            {selectedThread ? (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Header info */}
                <div className="border-b border-ink-mid pb-3.5 mb-3 shrink-0 flex justify-between items-center">
                  <div className="min-w-0">
                    <h2 className="font-sans font-black text-sm text-paper truncate">
                      {selectedThread.clientName}
                    </h2>
                    <p className="font-mono text-[10px] text-slate-light mt-0.5 truncate">
                      {selectedThread.subject}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative group">
                      <button className="px-2.5 py-1 bg-white/5 border border-white/10 text-slate-light hover:text-paper font-mono text-[9px] uppercase tracking-wider rounded-sm flex items-center gap-1">
                        Convert ⚙️
                      </button>
                      <div className="absolute right-0 top-full mt-1 bg-[#111827] border border-white/10 rounded-sm shadow-xl hidden group-hover:block z-50 w-36">
                        <button onClick={() => handleConvertClick('lead')} className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-[10px] font-mono uppercase text-slate-light hover:text-white">→ CRM Lead</button>
                        <button onClick={() => handleConvertClick('ticket')} className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-[10px] font-mono uppercase text-slate-light hover:text-white">→ Support Ticket</button>
                        <button onClick={() => handleConvertClick('activity')} className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-[10px] font-mono uppercase text-slate-light hover:text-white">→ Follow-up Activity</button>
                      </div>
                    </div>
                    <span className={`font-mono text-[9px] px-1.5 py-0.5 border uppercase font-bold ${
                      selectedThread.channel === "WhatsApp"
                        ? "bg-green-500/10 border-green-500/25 text-green-500"
                        : "bg-blue-500/10 border-blue-500/25 text-blue-400"
                    }`}>
                      {selectedThread.channel}
                    </span>
                  </div>
                </div>

                {/* Message logs timeline */}
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-1 mb-4 flex flex-col justify-end">
                  <div className="space-y-4">
                    {selectedThread.messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${
                          msg.sender === "client" ? "items-start" : "items-end"
                        }`}
                      >
                        <div
                          className={`max-w-[85%] p-3 border text-xs leading-relaxed ${
                            msg.sender === "client"
                              ? "bg-ink border-ink-mid text-paper"
                              : "bg-signal/5 border-signal/30 text-paper"
                          }`}
                        >
                          <p className="font-sans whitespace-pre-wrap">{msg.body}</p>
                        </div>
                        <div className="flex items-center space-x-1.5 mt-1 font-mono text-[8px] text-slate-light">
                          <span>{formatMessageTime(msg.timestamp)}</span>
                          {msg.sender === "user" && <CheckCheck className="w-3.5 h-3.5 text-signal" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Responder Input Form */}
                <form onSubmit={handleSendMessage} className="border-t border-ink-mid pt-3 shrink-0 space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-[9px] text-slate-light uppercase">GATEWAY OUT:</span>
                      <select 
                        value={gatewaySelection}
                        onChange={(e: any) => setGatewaySelection(e.target.value)}
                        className="bg-ink border border-ink-mid text-[10px] font-mono text-signal py-0.5 px-1 focus:outline-none"
                      >
                        <option value="Email">SMTP Gateway (Email)</option>
                        <option value="WhatsApp">WhatsApp Gateway API</option>
                      </select>
                    </div>

                    {/* Quick template button trigger */}
                    <button
                      type="button"
                      disabled={templates.length === 0}
                      onClick={() => handlePickTemplate(0)}
                      className="flex items-center space-x-1 font-mono text-[9px] bg-signal/10 border border-signal/20 hover:border-signal text-signal px-2 py-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{templates.length === 0 ? "NO TEMPLATES AVAILABLE" : "SELECT RESPONSE TEMPLATE"}</span>
                    </button>
                  </div>

                  <div className="relative">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={`Draft responder payload to commit via ${gatewaySelection}...`}
                      rows={4}
                      className="w-full bg-ink border border-ink-mid p-3 text-xs text-paper focus:border-signal focus:outline-none font-sans resize-none pr-12 custom-scrollbar"
                    />

                    <button
                      type="submit"
                      disabled={isSending || !replyText.trim()}
                      className="absolute right-3 bottom-3 w-8 h-8 bg-signal hover:bg-signal/80 disabled:bg-ink-mid/30 disabled:text-slate text-ink flex items-center justify-center transition-all"
                      title="Commit response outbox"
                    >
                      {isSending ? (
                        <Loader2 className="w-4 h-4 animate-spin text-slate" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div className="flex justify-between items-center text-[8px] font-mono text-slate-light">
                    <span>Replies are committed as Completed Activities on the client timeline automatically.</span>
                  </div>
                </form>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate font-mono text-xs">
                <MessageSquare className="w-8 h-8 text-signal/40 mb-2" />
                <span>Select a conversation to load gateway stream.</span>
              </div>
            )}
          </div>

          {/* COLUMN 3: CRM CLIENT CONTEXT PANEL & LIVE GATEWAY (27%) */}
          <div className="w-[27%] min-w-[240px] bg-ink-light border border-ink-mid p-4 flex flex-col gap-4 min-h-0 overflow-y-auto custom-scrollbar">
            <h3 className="font-mono text-[10px] text-slate-light tracking-widest uppercase border-b border-ink-mid pb-1.5 flex items-center">
              <Database className="w-3.5 h-3.5 mr-1 text-signal" />
              CRM Pipeline Context
            </h3>

            {selectedThread ? (
              <>
                {/* Client Profile Card */}
                <div className="bg-ink p-3 border border-ink-mid space-y-3">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 rounded-full bg-signal/15 border border-signal/25 flex items-center justify-center font-mono text-signal text-xs font-bold">
                      {selectedThread.clientName.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-paper truncate">{selectedThread.clientName}</div>
                      <div className="font-mono text-[9px] text-slate-light uppercase truncate">
                        {matchedContact?.job_title || "Pipeline Contact"}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-ink-mid/40 pt-2 space-y-1.5 font-mono text-[9px] text-slate-light">
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <span className="text-green-500 font-bold uppercase flex items-center">
                        <UserCheck className="w-2.5 h-2.5 mr-0.5" /> Mapped
                      </span>
                    </div>
                    {selectedThread.clientEmail && (
                      <div className="truncate flex justify-between gap-2">
                        <span>Email:</span>
                        <span className="text-paper truncate">{selectedThread.clientEmail}</span>
                      </div>
                    )}
                    {selectedThread.clientPhone && (
                      <div className="flex justify-between">
                        <span>Phone:</span>
                        <span className="text-paper">{selectedThread.clientPhone}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Company Accounts Details */}
                <div className="bg-ink p-3 border border-ink-mid space-y-2.5 text-xs">
                  <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase border-b border-ink-mid/45 pb-1 flex items-center justify-between">
                    <span>Corporate Account</span>
                  </div>

                  {matchedOrg ? (
                    <div className="space-y-2 font-mono text-[9px] text-slate-light">
                      <div className="text-paper text-[10px] font-bold">{matchedOrg.name}</div>
                      <div className="flex justify-between">
                        <span>Industry:</span>
                        <span className="text-paper">{matchedOrg.industry || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Credit Limit:</span>
                        <span className="text-paper font-semibold">${Number(matchedOrg.credit_limit || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total Contract Value:</span>
                        <span className="text-signal font-semibold">${Number(matchedOrg.total_contract_value || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Risk Rating:</span>
                        <span className={`px-1 text-[8px] uppercase font-bold border ${
                          matchedOrg.risk_rating === 'Low' ? 'text-green-500 border-green-500/20 bg-green-500/10' :
                          matchedOrg.risk_rating === 'High' ? 'text-red-400 border-red-500/20 bg-red-500/10' :
                          'text-yellow-400 border-yellow-500/20 bg-yellow-500/10'
                        }`}>
                          {matchedOrg.risk_rating || 'MEDIUM'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-slate font-mono text-[9.5px] py-1 text-center border border-ink-mid/30 bg-ink-light/20">
                      NO CORPORATE ACCOUNT LINKED.<br/>
                      <span className="text-[8px] text-slate-light">Company: {selectedThread.company || 'Unknown'}</span>
                    </div>
                  )}
                </div>

                {/* Quick actions for context */}
                <div className="space-y-1.5 shrink-0">
                  <button 
                    onClick={() => {
                      if (matchedContact) {
                        showToast(`Routing to contacts registry for: ${matchedContact.contact_name}`);
                      } else {
                        showToast("Creating new contact in CRM database...");
                      }
                    }}
                    className="w-full py-1.5 bg-ink border border-ink-mid hover:border-signal text-[10px] font-mono text-paper hover:text-signal transition-all uppercase text-left px-2 flex justify-between items-center"
                  >
                    <span>View Contact Registry Profile</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-light" />
                  </button>
                  {matchedOrg && (
                    <button 
                      onClick={() => showToast(`Routing to Account Ledger: ${matchedOrg.name}`)}
                      className="w-full py-1.5 bg-ink border border-ink-mid hover:border-signal text-[10px] font-mono text-paper hover:text-signal transition-all uppercase text-left px-2 flex justify-between items-center"
                    >
                      <span>View Corporate Account Ledgers</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-light" />
                    </button>
                  )}
                  <button 
                    onClick={() => showToast("Thread flagged as High Priority Commercial Opportunity.")}
                    className="w-full py-1.5 bg-ink border border-ink-mid hover:border-signal text-[10px] font-mono text-paper hover:text-signal transition-all uppercase text-left px-2 flex justify-between items-center"
                  >
                    <span>Flag Staging Opportunity</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-light" />
                  </button>
                </div>

                {/* Channel Telemetry status info */}
                <div className="bg-ink p-3 border border-ink-mid text-[10px] space-y-1.5 font-mono text-slate-light">
                  <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase border-b border-ink-mid/45 pb-1">
                    Gateway Routing Info
                  </div>
                  <div className="flex justify-between items-center">
                    <span>SMTP Outbox:</span>
                    <span className="text-green-500 font-semibold flex items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse mr-1" /> Active
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>WA Business:</span>
                    <span className="text-green-500 font-semibold flex items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse mr-1" /> Connected
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Communication Ledger:</span>
                    <span className="text-[#3b82f6] font-semibold flex items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] mr-1 animate-pulse" /> Connected
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate font-mono text-[10px] text-center uppercase py-8">
                Select a thread to load context.
              </div>
            )}
          </div>

        </div>
      )}

      {/* Response Template Selector & Variable Editor modal */}
      {activeTemplateIdx !== null && templates[activeTemplateIdx] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="bg-ink-light border border-ink-mid w-full max-w-xl p-5 rounded-none">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3 mb-4">
              <h3 className="font-sans font-black text-sm text-paper uppercase tracking-wider flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4 text-signal" />
                <span>Configure response template variables</span>
              </h3>
              <button 
                onClick={() => setActiveTemplateIdx(null)} 
                className="text-slate hover:text-paper font-mono text-xs"
              >
                [ESC] CLOSE
              </button>
            </div>

            {/* Template picker inside list */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="col-span-1 border-r border-ink-mid pr-3 space-y-1">
                <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-1.5">Templates</div>
                {templates.map((tmpl, idx) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => handlePickTemplate(idx)}
                    className={`w-full text-left px-2 py-1.5 text-[10px] font-mono uppercase transition-all border ${
                      idx === activeTemplateIdx
                        ? "border-signal text-signal bg-signal/5"
                        : "border-transparent text-slate-light hover:text-paper"
                    }`}
                  >
                    {tmpl.name}
                  </button>
                ))}
              </div>

              {/* Input variable values editor */}
              <div className="col-span-2 space-y-3.5">
                <div>
                  <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-1">
                    Template: {templates[activeTemplateIdx].name}
                  </div>
                  <div className="font-mono text-[8px] bg-ink border border-ink-mid/45 p-1 text-slate uppercase inline-block">
                    Channel: {templates[activeTemplateIdx].channel}
                  </div>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                  {(templates[activeTemplateIdx].variables || []).map((variable) => (
                    <div key={variable}>
                      <label className="block font-mono text-[9px] text-slate-light mb-1">Variable: &apos;{variable}&apos;</label>
                      <input
                        type="text"
                        value={templateValues[variable] || ""}
                        onChange={(e) => setTemplateValues(prev => ({ ...prev, [variable]: e.target.value }))}
                        placeholder={`Enter value for {{${variable}}}`}
                        className="w-full bg-ink border border-ink-mid p-1.5 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                      />
                    </div>
                  ))}
                </div>

                {/* Compiled preview display */}
                <div className="bg-ink p-3 border border-ink-mid font-sans text-[11px] text-slate-light leading-relaxed max-h-40 overflow-y-auto custom-scrollbar">
                  <div className="font-mono text-[9px] text-signal uppercase tracking-wider mb-1.5 pb-1 border-b border-ink-mid/40">
                    Live Formatted Preview
                  </div>
                  <p className="whitespace-pre-wrap">
                    {(() => {
                      let text = templates[activeTemplateIdx].body;
                      (templates[activeTemplateIdx].variables || []).forEach((variable) => {
                        const val = templateValues[variable] || `{{${variable}}}`;
                        text = text.replaceAll(`{{${variable}}}`, val);
                      });
                      return text;
                    })()}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex justify-end space-x-2.5 pt-2 border-t border-ink-mid/40">
                  <button
                    type="button"
                    onClick={() => setActiveTemplateIdx(null)}
                    className="px-3 py-1.5 border border-ink-mid font-mono text-xs text-slate hover:text-paper"
                  >
                    CANCEL
                  </button>
                  <button
                    type="button"
                    onClick={handleInsertTemplate}
                    className="px-4 py-1.5 bg-signal hover:bg-signal/90 text-black font-mono text-xs font-bold"
                  >
                    INSERT TEMPLATE DRAFT
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* CONVERT MESSAGE MODAL */}
      {isConvertModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setIsConvertModalOpen(false)} />
          <div className="relative bg-[#111827] border border-white/10 w-full max-w-md rounded-sm p-6 shadow-2xl z-10 text-xs">
            <h3 className="font-mono text-sm text-[#3B82F6] uppercase font-bold tracking-wider mb-2">Convert Message to CRM Record</h3>
            <p className="text-slate-400 mb-4">Convert the selected thread conversation from <span className="text-white font-bold">{selectedThread?.clientName}</span> into a live CRM entity.</p>
            <form onSubmit={handleConvertMessageSubmit} className="space-y-4">
              <div>
                <label className="block text-slate-400 mb-1 font-mono uppercase text-[9px]">Conversion Entity Type</label>
                <select 
                  value={convertTarget}
                  onChange={(e) => setConvertTarget(e.target.value as any)}
                  className="w-full bg-black border border-white/10 rounded-sm p-2 text-white"
                >
                  <option value="lead">CRM Lead</option>
                  <option value="ticket">Help Desk Support Ticket</option>
                  <option value="activity">Follow-up Activity</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-mono uppercase text-[9px]">Subject / Title</label>
                <input
                  type="text"
                  value={convertForm.subject}
                  onChange={(e) => setConvertForm(prev => ({ ...prev, subject: e.target.value }))}
                  required
                  className="w-full bg-black border border-white/10 rounded-sm p-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-mono uppercase text-[9px]">Conversion Notes / AI Rationale</label>
                <textarea 
                  value={convertForm.notes}
                  onChange={(e) => setConvertForm(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  className="w-full bg-black border border-white/10 rounded-sm p-2 text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                <button type="button" onClick={() => setIsConvertModalOpen(false)} className="px-3 py-1.5 border border-white/5 text-slate-light hover:text-white font-mono text-[10px] uppercase">Cancel</button>
                <button type="submit" className="px-3 py-1.5 bg-[#3B82F6] hover:bg-[#2563EB] text-white font-mono text-[10px] uppercase font-bold">Convert Record</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {notification && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg border shadow-xl flex items-center gap-3 animate-in slide-in-from-bottom-2 ${
          notification.type === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
        }`}>
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-xs font-semibold">{notification.message}</span>
        </div>
      )}

    </div>
  );
}
