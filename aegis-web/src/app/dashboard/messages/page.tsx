"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  Inbox,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  UserRound,
} from "lucide-react";

import {
  ApiError,
  PortalInboxItem,
  PortalCommunicationMessage,
  createCrmCommunication,
  getCrmCommunications,
  getPortalInbox,
  getUsers,
} from "@/lib/api";
import { useLiveReconnect, useLiveRecord } from "@/lib/live/LiveDataProvider";

const MESSAGE_LIMIT = 200;

type CommunicationDraft = Parameters<typeof createCrmCommunication>[0];

// A message this tab has sent that the server hasn't confirmed yet. It shows
// at once, and `localStatus` drives the "Sending" / "Not sent" label.
type LedgerMessage = PortalCommunicationMessage & {
  localStatus?: "sending" | "failed";
  localDraft?: CommunicationDraft;
};

function messageTime(message: PortalCommunicationMessage): number {
  const value = message.started_at || message.created_at;
  return value ? new Date(value).getTime() : 0;
}

/** The local id this tab gave a send, echoed back in the stored row's
 * metadata, so a pushed or refetched row can be matched to its optimistic copy. */
function clientRefOf(message: PortalCommunicationMessage): string | undefined {
  const ref = (message as { metadata?: { client_ref?: unknown } }).metadata?.client_ref;
  return typeof ref === "string" ? ref : undefined;
}

/** Puts a row into the ledger, replacing any copy with the same id (or the
 * optimistic copy it confirms), and keeps unconfirmed sends first, then
 * newest first. */
function upsertMessage(current: LedgerMessage[], incoming: LedgerMessage): LedgerMessage[] {
  const ref = incoming.localStatus ? undefined : clientRefOf(incoming);
  const next = [incoming, ...current.filter((item) => item.id !== incoming.id && (!ref || item.id !== ref))];
  next.sort((a, b) => {
    if (a.localStatus && !b.localStatus) return -1;
    if (b.localStatus && !a.localStatus) return 1;
    return messageTime(b) - messageTime(a);
  });
  return next.slice(0, MESSAGE_LIMIT);
}

type UserOption = {
  id: string;
  email?: string;
  full_name?: string;
};

function formatDate(value?: string) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function channelLabel(channel?: string) {
  return String(channel || "manual_note").replaceAll("_", " ");
}

function statusTone(status?: string) {
  const value = String(status || "").toLowerCase();
  if (["approved", "selected", "cleared", "resolved", "closed", "completed"].includes(value)) return "border-emerald-500/30 text-emerald-300";
  if (["rejected", "disputed", "cancelled", "failed"].includes(value)) return "border-red-500/30 text-red-300";
  if (["submitted", "received", "sent", "issued", "acknowledged", "waiting_on_client"].includes(value)) return "border-amber-500/30 text-amber-300";
  return "border-ink-mid text-slate-light";
}

export default function DashboardMessagesPage() {
  const [messages, setMessages] = useState<LedgerMessage[]>([]);
  const [portalItems, setPortalItems] = useState<PortalInboxItem[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "internal" | "client">("all");
  const [portalFilter, setPortalFilter] = useState<"all" | "client" | "supplier" | "payments" | "variations">("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    recipient_user_id: "",
    subject: "",
    body: "",
    priority: "normal",
  });

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [communicationResult, userResult, portalResult] = await Promise.allSettled([
        getCrmCommunications({ limit: MESSAGE_LIMIT }),
        getUsers(),
        getPortalInbox(150),
      ]);

      if (communicationResult.status === "fulfilled" && Array.isArray(communicationResult.value.data)) {
        const fetched = communicationResult.value.data as LedgerMessage[];
        // Keep this tab's unconfirmed sends, except any the fetch shows were
        // stored after all (matched by the client_ref sent with them).
        const storedRefs = new Set(fetched.map(clientRefOf).filter((ref): ref is string => !!ref));
        storedRefs.forEach((ref) => confirmedRefsRef.current.add(ref));
        setMessages((current) =>
          [...current.filter((item) => item.localStatus && !storedRefs.has(item.id)), ...fetched].slice(0, MESSAGE_LIMIT),
        );
      } else {
        setMessages([]);
        setError("Communications could not be loaded.");
      }

      if (userResult.status === "fulfilled" && Array.isArray(userResult.value.data)) {
        setUsers(userResult.value.data);
      } else {
        setUsers([]);
      }

      if (portalResult.status === "fulfilled" && Array.isArray(portalResult.value.data)) {
        setPortalItems(portalResult.value.data);
      } else {
        setPortalItems([]);
      }
    } catch (loadError) {
      const message = loadError instanceof ApiError
        ? loadError.message
        : "Communications could not be loaded.";
      setError(message);
      setMessages([]);
      setPortalItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Someone else's message (or a portal message) arrives as the full row,
  // so it shows straight away without a refetch through the API proxy.
  const portalRefreshRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (portalRefreshRef.current) window.clearTimeout(portalRefreshRef.current);
  }, []);
  useLiveRecord<PortalCommunicationMessage>("crm.communication_events", (op, id, row) => {
    if (op === "DELETE") {
      setMessages((current) => current.filter((item) => item.id !== id));
      return;
    }
    if (!row) {
      // The server couldn't attach the row (or it was soft-deleted): refetch.
      void load(true);
      return;
    }
    const ref = clientRefOf(row);
    if (ref) confirmedRefsRef.current.add(ref);
    setMessages((current) => upsertMessage(current, row));
    if (row.channel === "portal_message") {
      // The portal inbox is a separate read model; refresh it once a burst settles.
      if (portalRefreshRef.current) window.clearTimeout(portalRefreshRef.current);
      portalRefreshRef.current = window.setTimeout(() => {
        void getPortalInbox(150)
          .then((res) => {
            if (Array.isArray(res.data)) setPortalItems(res.data);
          })
          .catch(() => undefined);
      }, 400);
    }
  });
  // Catch up on anything sent while this tab's connection was down.
  useLiveReconnect(() => void load(true));

  const filteredMessages = useMemo(() => {
    const term = search.trim().toLowerCase();
    return messages.filter((message) => {
      if (filter === "internal" && message.direction !== "internal") return false;
      if (filter === "client" && message.channel !== "portal_message") return false;
      if (!term) return true;
      return [
        message.subject,
        message.body,
        message.actor_name,
        message.actor_email,
        message.recipient_name,
        message.recipient_email,
        message.contact_name,
      ].join(" ").toLowerCase().includes(term);
    });
  }, [filter, messages, search]);

  const filteredPortalItems = useMemo(() => {
    return portalItems.filter((item) => {
      if (portalFilter === "client" && !item.item_type.startsWith("client_")) return false;
      if (portalFilter === "supplier" && !["supplier_rfq_response", "vendor_payment_request"].includes(item.item_type)) return false;
      if (portalFilter === "payments" && !item.item_type.includes("payment")) return false;
      if (portalFilter === "variations" && item.item_type !== "client_variation") return false;
      return true;
    });
  }, [portalFilter, portalItems]);

  // client_refs whose stored row has been seen (pushed or fetched): a send
  // that errors afterwards was in fact stored, so it must not show "Not sent".
  const confirmedRefsRef = useRef(new Set<string>());

  const sendDraft = useCallback(async (tempId: string, draft: CommunicationDraft) => {
    try {
      const res = await createCrmCommunication(draft);
      const realId = (res?.data as { id?: string } | undefined)?.id;
      setMessages((current) => {
        const temp = current.find((item) => item.id === tempId);
        const withoutTemp = current.filter((item) => item.id !== tempId);
        // The live push often lands before this response does.
        if (!temp || !realId || withoutTemp.some((item) => item.id === realId)) return withoutTemp;
        return upsertMessage(withoutTemp, { ...temp, id: realId, localStatus: undefined, localDraft: undefined });
      });
    } catch (saveError) {
      // The server may have stored it and only the response was lost: if the
      // stored row has already arrived (live push or refetch), it was sent.
      if (confirmedRefsRef.current.has(tempId)) return;
      const message = saveError instanceof ApiError ? saveError.message : "The message could not be sent.";
      setMessages((current) =>
        current.map((item) => (item.id === tempId ? { ...item, localStatus: "failed" } : item)),
      );
      toast.error("Message not sent", { description: message });
    }
  }, []);

  function submitInternalMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = form.body.trim();
    if (!body) {
      toast.error("Write a message first.");
      return;
    }

    const recipient = users.find((item) => item.id === form.recipient_user_id);
    const subject = form.subject.trim() || "Internal message";
    const tempId = `local-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
    const draft = {
      channel: "manual_note",
      direction: "internal",
      recipient_user_id: form.recipient_user_id || null,
      subject,
      body,
      status: "sent",
      // client_ref comes back on the stored row, which is how a pushed or
      // refetched row replaces this optimistic copy.
      metadata: { source: "dashboard_messages", priority: form.priority, client_ref: tempId },
    } as CommunicationDraft;
    const now = new Date().toISOString();
    // Shown before the server answers, so sending feels instant even
    // through the ~0.7 s API proxy.
    setMessages((current) =>
      upsertMessage(current, {
        id: tempId,
        channel: "manual_note",
        direction: "internal",
        subject,
        body,
        status: "sent",
        started_at: now,
        created_at: now,
        actor_name: "You",
        recipient_name: recipient?.full_name || recipient?.email,
        localStatus: "sending",
        localDraft: draft,
      }),
    );
    setForm((current) => ({ ...current, subject: "", body: "" }));
    void sendDraft(tempId, draft);
  }

  function retrySend(message: LedgerMessage) {
    const draft = message.localDraft;
    if (!draft) return;
    setMessages((current) =>
      current.map((item) => (item.id === message.id ? { ...item, localStatus: "sending" } : item)),
    );
    void sendDraft(message.id, draft);
  }

  return (
    <div className="min-h-screen bg-ink text-paper p-6">
      <DashboardPageHeader
        className="mb-8"
        eyebrow={{ label: "AEGIS communications" }}
        title="Messages"
        subtitle="One ledger for client portal messages, CRM outreach, and executive-to-employee communication."
        actions={
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border border-ink-mid bg-ink-light px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Total</p>
              <p className="text-2xl font-semibold">{messages.length}</p>
            </div>
            <div className="border border-ink-mid bg-ink-light px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Internal</p>
              <p className="text-2xl font-semibold">{messages.filter((item) => item.direction === "internal").length}</p>
            </div>
            <div className="border border-ink-mid bg-ink-light px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Portal</p>
              <p className="text-2xl font-semibold">{messages.filter((item) => item.channel === "portal_message").length}</p>
            </div>
            <div className="border border-ink-mid bg-ink-light px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Portal inbox</p>
              <p className="text-2xl font-semibold">{portalItems.length}</p>
            </div>
          </div>
        }
      />

      {error && (
        <div className="mb-5 border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200 flex gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="mb-6 border border-ink-mid bg-ink-light">
        <div className="flex flex-col gap-4 border-b border-ink-mid p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Inbox className="h-5 w-5 text-signal" />
            <div>
              <h2 className="text-xl font-semibold">Portal inbox</h2>
              <p className="text-sm text-slate-light">
                External portal work that needs staff attention, routed to the owning module for the actual decision.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap border border-ink-mid bg-ink">
            {(["all", "client", "supplier", "payments", "variations"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPortalFilter(value)}
                className={`px-3 py-2 font-mono text-xs uppercase ${portalFilter === value ? "bg-signal text-ink" : "text-slate-light hover:text-paper"}`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-signal" />
          </div>
        ) : filteredPortalItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-light">No portal items match this view.</div>
        ) : (
          <div className="divide-y divide-ink-mid">
            {filteredPortalItems.map((item) => (
              <article key={`${item.item_type}-${item.id}`} className="grid gap-4 p-5 xl:grid-cols-[1fr_220px]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-signal">{item.item_label}</span>
                    <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${statusTone(item.status)}`}>
                      {item.status || "recorded"}
                    </span>
                    {(item.document_count ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 border border-blue-500/30 px-2 py-0.5 font-mono text-[10px] uppercase text-blue-300">
                        <FileText className="h-3 w-3" /> {item.document_count} doc{item.document_count === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 text-base font-semibold text-paper">{item.title}</h3>
                  {item.detail && <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-light">{item.detail}</p>}
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-light">
                    <span>{item.party_name || "External party"}</span>
                    {item.project_name && <span>{item.project_name}</span>}
                    <span>{formatDate(item.occurred_at)}</span>
                  </div>
                  {item.control_note && (
                    <p className="mt-3 border-l-2 border-signal/50 pl-3 text-xs leading-5 text-slate-light">{item.control_note}</p>
                  )}
                </div>
                <div className="flex items-start xl:justify-end">
                  <Link
                    href={item.action_url}
                    className="inline-flex h-10 items-center gap-2 border border-ink-mid px-4 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal hover:text-signal"
                  >
                    Open <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="border border-ink-mid bg-ink-light">
          <div className="p-5 border-b border-ink-mid flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <Inbox className="w-5 h-5 text-signal" />
              <div>
                <h2 className="text-xl font-semibold">Communication ledger</h2>
                <p className="text-sm text-slate-light">Client portal, internal, email, phone and WhatsApp records.</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex border border-ink-mid bg-ink">
                {(["all", "internal", "client"] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    className={`px-3 py-2 text-xs font-mono uppercase ${filter === value ? "bg-signal text-ink" : "text-slate-light"}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="bg-ink border border-ink-mid pl-9 pr-3 py-2 text-sm text-paper focus:outline-none focus:border-signal w-full sm:w-64"
                  placeholder="Search messages..."
                />
              </div>
              <button
                onClick={() => void load()}
                className="border border-ink-mid px-4 py-2 text-sm text-paper hover:border-signal hover:text-signal flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-6 h-6 text-signal animate-spin" />
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="p-12 text-center">
              <MessageSquare className="w-10 h-10 text-slate mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No messages found</h3>
              <p className="text-sm text-slate-light mt-2">Messages will appear here once they are recorded.</p>
            </div>
          ) : (
            <div className="divide-y divide-ink-mid">
              {filteredMessages.map((message) => (
                <article
                  key={message.id}
                  data-message-id={message.id}
                  className={message.localStatus === "sending" ? "p-5 opacity-70" : "p-5"}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] uppercase text-signal">{channelLabel(message.channel)}</span>
                        <span className="font-mono text-[10px] uppercase text-slate-light">{message.direction}</span>
                        {message.localStatus === "sending" && (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-slate-light">
                            <Loader2 className="h-3 w-3 animate-spin" /> Sending
                          </span>
                        )}
                        {message.localStatus === "failed" && (
                          <button
                            type="button"
                            onClick={() => retrySend(message)}
                            className="inline-flex items-center gap-1 border border-red-500/40 px-2 py-0.5 font-mono text-[10px] uppercase text-red-300 hover:border-red-400"
                          >
                            <RefreshCw className="h-3 w-3" /> Not sent, retry
                          </button>
                        )}
                      </div>
                      <h3 className="text-base font-semibold mt-2">{message.subject || "Communication"}</h3>
                      <p className="text-sm text-slate-light mt-2 leading-relaxed">{message.body || "No body recorded."}</p>
                    </div>
                    <span className="font-mono text-[10px] uppercase text-slate-light whitespace-nowrap">
                      {formatDate(message.started_at || message.created_at)}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2 text-xs text-slate-light sm:grid-cols-2">
                    <p className="flex items-center gap-2">
                      <UserRound className="w-3 h-3" />
                      From {message.actor_name || message.actor_email || message.contact_name || "External client"}
                    </p>
                    <p className="flex items-center gap-2">
                      <UserRound className="w-3 h-3" />
                      To {message.recipient_name || message.recipient_email || "SNC team"}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={submitInternalMessage} className="border border-ink-mid bg-ink-light p-5 h-fit">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <p className="font-mono text-[10px] tracking-widest text-signal uppercase">Internal message</p>
              <h2 className="text-xl font-semibold mt-1">Exec / employee note</h2>
            </div>
            <Send className="w-5 h-5 text-slate-light" />
          </div>
          <label className="block mb-3">
            <span className="font-mono text-[10px] uppercase text-slate-light">Recipient</span>
            <select
              value={form.recipient_user_id}
              onChange={(event) => setForm((current) => ({ ...current, recipient_user_id: event.target.value }))}
              className="mt-2 w-full bg-ink border border-ink-mid p-3 text-sm text-paper focus:outline-none focus:border-signal"
            >
              <option value="">SNC team broadcast</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name || user.email || user.id}
                </option>
              ))}
            </select>
          </label>
          <label className="block mb-3">
            <span className="font-mono text-[10px] uppercase text-slate-light">Priority</span>
            <select
              value={form.priority}
              onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
              className="mt-2 w-full bg-ink border border-ink-mid p-3 text-sm text-paper focus:outline-none focus:border-signal"
            >
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
              <option value="approval">Approval required</option>
            </select>
          </label>
          <input
            value={form.subject}
            onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
            className="mb-3 w-full bg-ink border border-ink-mid p-3 text-sm text-paper focus:outline-none focus:border-signal"
            placeholder="Subject"
          />
          <textarea
            value={form.body}
            onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
            rows={8}
            className="w-full bg-ink border border-ink-mid p-3 text-sm text-paper focus:outline-none focus:border-signal resize-none"
            placeholder="Write an instruction, escalation, approval note, or operational update..."
          />
          <button
            type="submit"
            className="mt-4 w-full bg-signal text-ink py-3 font-mono text-xs tracking-widest uppercase flex items-center justify-center"
          >
            Send message
          </button>
        </form>
      </section>
    </div>
  );
}
