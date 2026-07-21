"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
} from "lucide-react";

import { ApiError, ClientPortalTicket, getClientPortalTickets } from "@/lib/api";

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

function buildReplyMailto(ticket: ClientPortalTicket) {
  if (!ticket.email) return "";
  const reference = ticket.id.slice(0, 8).toUpperCase();
  const subject = `SNC AEGIS portal request ${reference}`;
  const body = [
    `Hello ${ticket.contact_name ?? "there"},`,
    "",
    `We are responding to your AEGIS portal request ${reference}.`,
    "",
    "Original request:",
    ticket.issue_description,
    "",
    "Regards,",
    "Six Nine Construction",
  ].join("\n");

  return `mailto:${encodeURIComponent(ticket.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function ClientPortalDashboardPage() {
  const [tickets, setTickets] = useState<ClientPortalTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getClientPortalTickets();
      setTickets(Array.isArray(response.data) ? response.data : []);
    } catch (loadError) {
      const message = loadError instanceof ApiError
        ? loadError.message
        : "Client portal tickets could not be loaded.";
      setError(message);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tickets;
    return tickets.filter((ticket) => {
      const haystack = [
        ticket.issue_description,
        ticket.contact_name,
        ticket.email,
        ticket.company_name,
        ticket.id,
      ].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [search, tickets]);

  const clientCount = useMemo(() => {
    return new Set(tickets.map((ticket) => ticket.email || ticket.contact_name || ticket.id)).size;
  }, [tickets]);

  return (
    <div className="min-h-screen bg-ink text-paper p-6">
      <section className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="font-mono text-[10px] tracking-widest text-signal uppercase">Portal administration</p>
          <h1 className="font-display text-4xl mt-2">Client Portal</h1>
          <p className="text-slate-light mt-3 max-w-2xl">
            View client-submitted requests and confirm the external portal is receiving source-backed records.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="border border-ink-mid bg-ink-light px-4 py-3">
            <p className="font-mono text-[10px] text-slate-light uppercase">Requests</p>
            <p className="text-2xl font-semibold">{tickets.length}</p>
          </div>
          <div className="border border-ink-mid bg-ink-light px-4 py-3">
            <p className="font-mono text-[10px] text-slate-light uppercase">Clients</p>
            <p className="text-2xl font-semibold">{clientCount}</p>
          </div>
          <div className="border border-ink-mid bg-ink-light px-4 py-3 col-span-2 sm:col-span-1">
            <p className="font-mono text-[10px] text-slate-light uppercase">Access model</p>
            <p className="text-sm font-semibold text-green-400 flex items-center gap-2 mt-1">
              <ShieldCheck className="w-4 h-4" /> Provisioned
            </p>
          </div>
        </div>
      </section>

      <section className="border border-ink-mid bg-ink-light">
        <div className="p-5 border-b border-ink-mid flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-signal" />
            <div>
              <h2 className="text-xl font-semibold">Client request ledger</h2>
              <p className="text-sm text-slate-light">Tickets created from `/portal/client`.</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="bg-ink border border-ink-mid pl-9 pr-3 py-2 text-sm text-paper focus:outline-none focus:border-signal w-full sm:w-72"
                placeholder="Search client, company, request..."
              />
            </div>
            <button
              onClick={() => void loadTickets()}
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
        ) : error ? (
          <div className="p-8">
            <div className="border border-red-500/30 bg-red-950/30 p-5 text-red-200 flex gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="w-10 h-10 text-slate mx-auto mb-4" />
            <h3 className="text-lg font-semibold">{tickets.length === 0 ? "No client requests recorded" : "No matching requests"}</h3>
            <p className="text-sm text-slate-light mt-2">
              {tickets.length === 0
                ? "Submitted client portal requests will appear here."
                : "Adjust the search term to review more portal activity."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink text-slate-light font-mono text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="text-left p-4 font-medium">Client</th>
                  <th className="text-left p-4 font-medium">Request</th>
                  <th className="text-left p-4 font-medium">Received</th>
                  <th className="text-left p-4 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {filteredTickets.map((ticket) => (
                  <tr key={ticket.id} className="hover:bg-ink/50">
                    <td className="p-4 align-top min-w-64">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 border border-ink-mid bg-ink flex items-center justify-center">
                          <User className="w-4 h-4 text-signal" />
                        </div>
                        <div>
                          <p className="font-semibold">{ticket.contact_name ?? "Unlinked client"}</p>
                          <p className="text-xs text-slate-light">{ticket.email ?? "No email recorded"}</p>
                          <p className="text-xs text-slate flex items-center gap-1 mt-1">
                            <Building2 className="w-3 h-3" />
                            {ticket.company_name ?? "No company linked"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 align-top max-w-2xl">
                      <p className="text-paper leading-relaxed">{ticket.issue_description}</p>
                      <p className="font-mono text-[10px] text-slate mt-2">REF {ticket.id.slice(0, 8).toUpperCase()}</p>
                    </td>
                    <td className="p-4 align-top text-slate-light whitespace-nowrap">{formatDate(ticket.created_at)}</td>
                    <td className="p-4 align-top">
                      <div className="flex flex-col gap-2 items-start">
                        <span className="inline-flex items-center gap-2 border border-green-500/25 bg-green-500/10 px-2 py-1 text-xs text-green-300">
                          <CheckCircle2 className="w-3 h-3" /> Recorded
                        </span>
                        {ticket.email ? (
                          <a
                            href={buildReplyMailto(ticket)}
                            className="inline-flex items-center gap-2 border border-ink-mid px-2 py-1 text-xs text-paper hover:border-signal hover:text-signal"
                          >
                            <Mail className="w-3 h-3" /> Reply by email
                          </a>
                        ) : (
                          <span className="text-xs text-slate-light">No email linked</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
