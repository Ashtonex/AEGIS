"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
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
  PortalCommunicationMessage,
  createCrmCommunication,
  getCrmCommunications,
  getUsers,
} from "@/lib/api";

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

export default function DashboardMessagesPage() {
  const [messages, setMessages] = useState<PortalCommunicationMessage[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "internal" | "client">("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    recipient_user_id: "",
    subject: "",
    body: "",
    priority: "normal",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [communicationResult, userResult] = await Promise.allSettled([
        getCrmCommunications({ limit: 200 }),
        getUsers(),
      ]);

      if (communicationResult.status === "fulfilled" && Array.isArray(communicationResult.value.data)) {
        setMessages(communicationResult.value.data);
      } else {
        setMessages([]);
        setError("Communications could not be loaded.");
      }

      if (userResult.status === "fulfilled" && Array.isArray(userResult.value.data)) {
        setUsers(userResult.value.data);
      } else {
        setUsers([]);
      }
    } catch (loadError) {
      const message = loadError instanceof ApiError
        ? loadError.message
        : "Communications could not be loaded.";
      setError(message);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function submitInternalMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = form.body.trim();
    if (!body) {
      setError("Message body is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await createCrmCommunication({
        channel: "manual_note",
        direction: "internal",
        recipient_user_id: form.recipient_user_id || null,
        subject: form.subject.trim() || "Internal message",
        body,
        status: "sent",
        metadata: { source: "dashboard_messages", priority: form.priority },
      });
      setForm({ recipient_user_id: "", subject: "", body: "", priority: "normal" });
      setNotice("Internal message recorded.");
      await load();
    } catch (saveError) {
      const message = saveError instanceof ApiError
        ? saveError.message
        : "Internal message could not be recorded.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink text-paper p-6">
      <section className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="font-mono text-[10px] tracking-widest text-signal uppercase">AEGIS communications</p>
          <h1 className="font-display text-4xl mt-2">Messages</h1>
          <p className="text-slate-light mt-3 max-w-2xl">
            One ledger for client portal messages, CRM outreach, and executive-to-employee communication.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
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
        </div>
      </section>

      {error && (
        <div className="mb-5 border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200 flex gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mb-5 border border-green-500/30 bg-green-950/20 p-4 text-sm text-green-200 flex gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

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
                <article key={message.id} className="p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] uppercase text-signal">{channelLabel(message.channel)}</span>
                        <span className="font-mono text-[10px] uppercase text-slate-light">{message.direction}</span>
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
            disabled={saving}
            className="mt-4 w-full bg-signal text-ink py-3 font-mono text-xs tracking-widest uppercase disabled:opacity-50 flex items-center justify-center"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Record message"}
          </button>
        </form>
      </section>
    </div>
  );
}
