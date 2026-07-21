"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";

import {
  ApiError,
  ClientPortalTicket,
  ClientPortalWorkspace,
  PortalCommunicationMessage,
  createClientPortalMessage,
  createClientPortalTicket,
  getClientPortalWorkspace,
  getPortalAccess,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { ForemanPortalHome } from "@/components/auth/ForemanPortalHome";

type ExternalPortal = "client" | "supplier" | "foreman";

function formatDate(value?: string) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function PortalShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-ink text-paper">{children}</main>;
}

export function PortalHome({ portal }: { portal: ExternalPortal }) {
  const router = useRouter();
  const { session, isLoading } = useAuth();
  const [admitted, setAdmitted] = useState(false);
  const [workspace, setWorkspace] = useState<ClientPortalWorkspace | null>(null);
  const [tickets, setTickets] = useState<ClientPortalTicket[]>([]);
  const [messages, setMessages] = useState<PortalCommunicationMessage[]>([]);
  const [requestText, setRequestText] = useState("");
  const [messageText, setMessageText] = useState("");
  const [messageSubject, setMessageSubject] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    if (portal !== "client") return;
    setLoadingWorkspace(true);
    setError(null);
    try {
      const response = await getClientPortalWorkspace();
      const data = response.data;
      setWorkspace(data ?? null);
      setTickets(data?.tickets ?? []);
      setMessages(data?.messages ?? []);
    } catch (loadError) {
      const message = loadError instanceof ApiError
        ? loadError.message
        : "The client portal workspace could not be loaded.";
      setError(message);
      setWorkspace(null);
      setTickets([]);
      setMessages([]);
    } finally {
      setLoadingWorkspace(false);
    }
  }, [portal]);

  useEffect(() => {
    if (isLoading) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    void getPortalAccess(portal)
      .then(async (access) => {
        if (access.data?.destination === "/setup-password") {
          router.replace("/setup-password");
          return;
        }
        setAdmitted(true);
        await loadWorkspace();
      })
      .catch(async () => {
        await supabase.auth.signOut();
        router.replace("/login");
      });
  }, [isLoading, loadWorkspace, portal, router, session]);

  const activeModules = useMemo(
    () => workspace?.modules.filter((module) => module.status === "active").length ?? 0,
    [workspace]
  );

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = requestText.trim();
    if (cleaned.length < 10) {
      setError("Please describe the request in at least 10 characters.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await createClientPortalTicket(cleaned);
      if (response.data) {
        setTickets((current) => [response.data as ClientPortalTicket, ...current]);
      }
      setRequestText("");
      setNotice("Request submitted to the SNC project team.");
    } catch (submitError) {
      const message = submitError instanceof ApiError
        ? submitError.message
        : "The request could not be submitted.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = messageText.trim();
    if (body.length < 2) {
      setError("Please enter a message before sending.");
      return;
    }

    setSendingMessage(true);
    setError(null);
    setNotice(null);
    try {
      const response = await createClientPortalMessage({
        subject: messageSubject.trim() || "Client portal message",
        body,
      });
      if (response.data) {
        setMessages((current) => [response.data as PortalCommunicationMessage, ...current]);
      }
      setMessageSubject("");
      setMessageText("");
      setNotice("Message sent to the SNC team.");
    } catch (sendError) {
      const message = sendError instanceof ApiError
        ? sendError.message
        : "The message could not be sent.";
      setError(message);
    } finally {
      setSendingMessage(false);
    }
  }

  if (!admitted || loadingWorkspace) {
    return (
      <PortalShell>
        <section className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-signal animate-spin" />
        </section>
      </PortalShell>
    );
  }

  if (portal === "foreman") {
    return <ForemanPortalHome />;
  }

  if (portal !== "client") {
    return (
      <PortalShell>
        <section className="max-w-4xl mx-auto px-6 pt-20">
          <div className="border border-ink-mid bg-ink-light p-8 rounded-sm">
            <ShieldCheck className="w-7 h-7 text-green-500 mb-5" />
            <p className="font-mono text-[10px] tracking-widest text-signal uppercase">Access confirmed</p>
            <h1 className="font-display text-4xl mt-2">Supplier Portal</h1>
            <p className="text-slate-light mt-3">Supplier modules will appear here as they are activated.</p>
          </div>
        </section>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <section className="border-b border-ink-mid bg-ink-light">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[10px] tracking-widest text-signal uppercase">AEGIS client workspace</p>
            <h1 className="font-display text-4xl mt-2">Client Portal</h1>
            <p className="text-slate-light mt-3 max-w-2xl">
              Secure access for project correspondence, support requests, and activated client records.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Tickets</p>
              <p className="text-2xl font-semibold">{tickets.length}</p>
            </div>
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Messages</p>
              <p className="text-2xl font-semibold">{messages.length}</p>
            </div>
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Modules</p>
              <p className="text-2xl font-semibold">{activeModules}</p>
            </div>
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Access</p>
              <p className="text-sm font-semibold text-green-400 flex items-center gap-2 mt-1">
                <ShieldCheck className="w-4 h-4" /> Verified
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {error && (
            <div className="border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200 flex gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="border border-green-500/30 bg-green-950/20 p-4 text-sm text-green-200 flex gap-3">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {(workspace?.modules ?? []).map((module) => (
              <div key={module.key} className="border border-ink-mid bg-ink-light p-5">
                <div className="flex items-center justify-between gap-3">
                  <FileText className={module.status === "active" ? "w-5 h-5 text-signal" : "w-5 h-5 text-slate"} />
                  <span className={`font-mono text-[10px] uppercase ${module.status === "active" ? "text-green-400" : "text-slate-light"}`}>
                    {module.status === "active" ? "Active" : "Pending"}
                  </span>
                </div>
                <h2 className="text-base font-semibold mt-5">{module.label}</h2>
                <p className="text-sm text-slate-light mt-2">
                  {module.status === "active"
                    ? "Available in this workspace."
                    : "Awaiting source integration or administrator activation."}
                </p>
              </div>
            ))}
          </div>

          <div className="border border-ink-mid bg-ink-light">
            <div className="p-5 border-b border-ink-mid flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] tracking-widest text-signal uppercase">Communication thread</p>
                <h2 className="text-xl font-semibold mt-1">Messages</h2>
              </div>
              <MessageSquare className="w-5 h-5 text-slate-light" />
            </div>
            {messages.length === 0 ? (
              <div className="p-8 text-center text-slate-light">
                No portal messages have been recorded for this account.
              </div>
            ) : (
              <div className="divide-y divide-ink-mid">
                {messages.map((message) => (
                  <article key={message.id} className="p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-paper">{message.subject || "Portal message"}</p>
                        <p className="text-paper leading-relaxed mt-2">{message.body || "No message body recorded."}</p>
                      </div>
                      <span className="font-mono text-[10px] uppercase text-slate-light whitespace-nowrap">
                        {formatDate(message.started_at || message.created_at)}
                      </span>
                    </div>
                    <p className="font-mono text-[10px] text-slate mt-3">
                      {message.direction === "inbound" ? "Client to SNC" : "SNC to client"} / {message.status || "recorded"}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="border border-ink-mid bg-ink-light">
            <div className="p-5 border-b border-ink-mid flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] tracking-widest text-signal uppercase">Request ledger</p>
                <h2 className="text-xl font-semibold mt-1">Support Tickets</h2>
              </div>
              <MessageSquare className="w-5 h-5 text-slate-light" />
            </div>
            {tickets.length === 0 ? (
              <div className="p-8 text-center text-slate-light">
                No client requests have been recorded for this account.
              </div>
            ) : (
              <div className="divide-y divide-ink-mid">
                {tickets.map((ticket) => (
                  <article key={ticket.id} className="p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <p className="text-paper leading-relaxed">{ticket.issue_description}</p>
                      <span className="font-mono text-[10px] uppercase text-slate-light whitespace-nowrap">
                        {formatDate(ticket.created_at)}
                      </span>
                    </div>
                    <p className="font-mono text-[10px] text-slate mt-3">REF {ticket.id.slice(0, 8).toUpperCase()}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="border border-ink-mid bg-ink-light p-5">
            <p className="font-mono text-[10px] tracking-widest text-signal uppercase">Provisioned identity</p>
            <h2 className="text-xl font-semibold mt-2">{workspace?.client.contact_name ?? "Client contact"}</h2>
            <div className="mt-5 space-y-3 text-sm">
              <p className="flex justify-between gap-4 border-b border-ink-mid pb-2">
                <span className="text-slate-light">Company</span>
                <span className="text-right">{workspace?.client.company_name ?? "Not linked"}</span>
              </p>
              <p className="flex justify-between gap-4 border-b border-ink-mid pb-2">
                <span className="text-slate-light">Email</span>
                <span className="text-right">{workspace?.client.email ?? "Not recorded"}</span>
              </p>
              <p className="flex justify-between gap-4">
                <span className="text-slate-light">Role</span>
                <span className="text-right">{workspace?.client.job_title ?? "Client representative"}</span>
              </p>
            </div>
          </div>

          <form onSubmit={submitMessage} className="border border-ink-mid bg-ink-light p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="font-mono text-[10px] tracking-widest text-signal uppercase">Portal message</p>
                <h2 className="text-xl font-semibold mt-1">Send SNC a message</h2>
              </div>
              <MessageSquare className="w-5 h-5 text-slate-light" />
            </div>
            <input
              value={messageSubject}
              onChange={(event) => setMessageSubject(event.target.value)}
              className="mb-3 w-full bg-ink border border-ink-mid p-3 text-sm text-paper focus:outline-none focus:border-signal"
              placeholder="Subject"
            />
            <textarea
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              rows={6}
              className="w-full bg-ink border border-ink-mid p-3 text-sm text-paper focus:outline-none focus:border-signal resize-none"
              placeholder="Write a portal message to the project or commercial team..."
            />
            <button
              type="submit"
              disabled={sendingMessage}
              className="mt-4 w-full bg-signal text-ink py-3 font-mono text-xs tracking-widest uppercase disabled:opacity-50 flex items-center justify-center"
            >
              {sendingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send message"}
            </button>
          </form>

          <form onSubmit={submitTicket} className="border border-ink-mid bg-ink-light p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="font-mono text-[10px] tracking-widest text-signal uppercase">New request</p>
                <h2 className="text-xl font-semibold mt-1">Contact project team</h2>
              </div>
              <LockKeyhole className="w-5 h-5 text-slate-light" />
            </div>
            <textarea
              value={requestText}
              onChange={(event) => setRequestText(event.target.value)}
              rows={7}
              className="w-full bg-ink border border-ink-mid p-3 text-sm text-paper focus:outline-none focus:border-signal resize-none"
              placeholder="Describe the document, progress, commercial, or support request..."
            />
            <button
              type="submit"
              disabled={submitting}
              className="mt-4 w-full bg-signal text-ink py-3 font-mono text-xs tracking-widest uppercase disabled:opacity-50 flex items-center justify-center"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit request"}
            </button>
          </form>

          <div className="border border-ink-mid bg-ink-light p-5">
            <p className="font-mono text-[10px] tracking-widest text-slate-light uppercase">Service state</p>
            <p className="text-sm text-slate-light mt-3 flex gap-2">
              <Clock className="w-4 h-4 shrink-0 mt-0.5" />
              Project documents, payment records, and progress feeds are shown as pending until their source modules are activated for this client.
            </p>
          </div>
        </aside>
      </section>
    </PortalShell>
  );
}
