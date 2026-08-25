"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Calendar,
  CheckCircle2,
  Mail,
  MapPin,
  MessageSquare,
  Plug,
  RefreshCw,
  Settings,
  ShieldCheck,
  Unplug,
  Workflow,
} from "lucide-react";
import {
  disconnectCrmConnectedAccount,
  getCrmAiRecommendations,
  getCrmConnectedAccounts,
  getCrmIntegrationProviders,
  getCrmIntegrationSyncJobs,
  queueCrmIntegrationSync,
  runCrmAiScoring,
  saveCrmConnectedAccount,
  updateCrmAiRecommendation,
} from "@/lib/api";

type Provider = {
  provider: string;
  label: string;
  category: string;
  auth_type: string;
  configured: boolean;
  capabilities: string[];
  required_env: string[];
};

type ConnectedAccount = {
  id: string;
  provider: string;
  account_label?: string;
  account_email?: string;
  status: string;
  token_status: string;
  last_sync_at?: string;
  last_error?: string;
  latest_sync_status?: string;
};

type SyncJob = {
  id: string;
  provider: string;
  sync_type: string;
  status: string;
  account_label?: string;
  account_email?: string;
  error_summary?: string;
  created_at?: string;
};

type Recommendation = {
  id: string;
  entity_type: "lead" | "opportunity";
  entity_name?: string;
  score: number;
  priority: string;
  recommendation: string;
  rationale: string;
  risk_flags?: string[] | string;
  created_at?: string;
};

const providerIcon = (category: string) => {
  if (category === "email") return Mail;
  if (category === "calendar") return Calendar;
  if (category === "messaging") return MessageSquare;
  if (category === "field_sales") return MapPin;
  if (category === "finance") return ShieldCheck;
  return Plug;
};

const syncTypeForProvider = (provider: string) => {
  if (provider.includes("calendar")) return "calendar";
  if (provider === "whatsapp") return "messages";
  if (provider === "documents") return "documents";
  if (provider === "accounting") return "accounting";
  return "email";
};

const parseFlags = (value: Recommendation["risk_flags"]) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

export default function CrmIntegrationsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mailboxDrafts, setMailboxDrafts] = useState<Record<string, { email: string; appPassword: string; smtpPort: string }>>({});

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [providersRes, accountsRes, jobsRes, recsRes] = await Promise.allSettled([
        getCrmIntegrationProviders(),
        getCrmConnectedAccounts(),
        getCrmIntegrationSyncJobs({ limit: 20 }),
        getCrmAiRecommendations({ status: "open", limit: 12 }),
      ]);
      if (providersRes.status === "fulfilled" && providersRes.value.success && Array.isArray(providersRes.value.data)) {
        setProviders(providersRes.value.data);
      }
      if (accountsRes.status === "fulfilled" && accountsRes.value.success && Array.isArray(accountsRes.value.data)) {
        setAccounts(accountsRes.value.data);
      }
      if (jobsRes.status === "fulfilled" && jobsRes.value.success && Array.isArray(jobsRes.value.data)) {
        setJobs(jobsRes.value.data);
      }
      if (recsRes.status === "fulfilled" && recsRes.value.success && Array.isArray(recsRes.value.data)) {
        setRecommendations(recsRes.value.data);
      }
      if (providersRes.status === "rejected" || accountsRes.status === "rejected") {
        setError("Connected Apps could not load from the CRM service.");
      }
    } catch {
      setError("Connected Apps could not load from the CRM service.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const accountsByProvider = useMemo(() => {
    const map = new Map<string, ConnectedAccount>();
    accounts.forEach((account) => {
      if (!map.has(account.provider)) map.set(account.provider, account);
    });
    return map;
  }, [accounts]);

  const connectedCount = accounts.filter((account) => account.status === "connected").length;
  const configuredCount = providers.filter((provider) => provider.configured).length;
  const blockedJobs = jobs.filter((job) => job.status === "blocked" || job.status === "failed").length;
  const urgentRecommendations = recommendations.filter((rec) => rec.priority === "urgent" || rec.score >= 85).length;

  const connectProvider = async (provider: Provider) => {
    setIsWorking(provider.provider);
    setNotice(null);
    setError(null);
    try {
      const mailboxDraft = mailboxDrafts[provider.provider] || { email: "", appPassword: "", smtpPort: "465" };
      if (provider.provider === "namecheap_private_email" && (!mailboxDraft.email || !mailboxDraft.appPassword)) {
        setError("Enter the Namecheap mailbox address and app password before connecting.");
        setIsWorking(null);
        return;
      }
      const res = await saveCrmConnectedAccount({
        provider: provider.provider,
        account_label: provider.label,
        ...(provider.provider === "namecheap_private_email" ? {
          account_email: mailboxDraft.email,
          app_password: mailboxDraft.appPassword,
          settings: {
            imap_host: "mail.privateemail.com",
            imap_port: 993,
            imap_security: "ssl",
            smtp_host: "mail.privateemail.com",
            smtp_port: Number(mailboxDraft.smtpPort || 465),
            smtp_security: mailboxDraft.smtpPort === "587" ? "starttls" : "ssl",
            sync_folder: "INBOX",
          },
        } : {}),
        scopes: provider.capabilities,
      });
      if (!res.success) throw new Error("connect failed");
      setNotice(provider.configured ? `${provider.label} connected for sync.` : `${provider.label} saved. Add provider credentials to enable live sync.`);
      if (provider.provider === "namecheap_private_email") {
        setMailboxDrafts((current) => ({ ...current, [provider.provider]: { email: mailboxDraft.email, appPassword: "", smtpPort: mailboxDraft.smtpPort } }));
      }
      await loadData();
    } catch {
      setError(`${provider.label} was not saved. Check permissions and retry.`);
    } finally {
      setIsWorking(null);
    }
  };

  const disconnectProvider = async (account: ConnectedAccount) => {
    setIsWorking(account.provider);
    setNotice(null);
    setError(null);
    try {
      const res = await disconnectCrmConnectedAccount(account.id);
      if (!res.success) throw new Error("disconnect failed");
      setNotice("Connected app disconnected.");
      await loadData();
    } catch {
      setError("Connected app was not disconnected. Check permissions and retry.");
    } finally {
      setIsWorking(null);
    }
  };

  const runSync = async (provider: Provider, account: ConnectedAccount) => {
    setIsWorking(`${provider.provider}:sync`);
    setNotice(null);
    setError(null);
    try {
      const res = await queueCrmIntegrationSync(account.id, {
        sync_type: syncTypeForProvider(provider.provider),
        direction: provider.category === "email" || provider.category === "calendar" ? "bidirectional" : "pull",
      });
      if (!res.success) throw new Error("sync failed");
      setNotice(res.data?.status === "blocked" ? "Sync was recorded but provider credentials are not connected yet." : res.data?.status === "completed" ? "Mailbox sync completed." : "Sync job queued.");
      await loadData();
    } catch {
      setError("Sync job was not recorded. Check permissions and retry.");
    } finally {
      setIsWorking(null);
    }
  };

  const runScoring = async () => {
    setIsWorking("ai-scoring");
    setNotice(null);
    setError(null);
    try {
      const res = await runCrmAiScoring();
      if (!res.success) throw new Error("scoring failed");
      setNotice(`Scoring complete: ${res.data?.leads_scored ?? 0} leads and ${res.data?.opportunities_scored ?? 0} opportunities reviewed.`);
      await loadData();
    } catch {
      setError("AI scoring was not completed. Check permissions and retry.");
    } finally {
      setIsWorking(null);
    }
  };

  const closeRecommendation = async (rec: Recommendation, status: "accepted" | "dismissed" | "completed") => {
    setIsWorking(rec.id);
    try {
      const res = await updateCrmAiRecommendation(rec.id, { status });
      if (!res.success) throw new Error("recommendation update failed");
      await loadData();
    } catch {
      setError("Recommendation was not updated.");
    } finally {
      setIsWorking(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-paper p-6">
      <header className="mb-6 flex items-end justify-between border-b border-white/5 pb-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Plug className="h-4 w-4 text-[#D4AF37]" />
            <span className="font-mono text-[9px] uppercase tracking-widest text-[#D4AF37]">CRM operating layer</span>
          </div>
          <h1 className="font-sans text-2xl font-black uppercase tracking-tight">Connected Apps</h1>
        </div>
        <Link href="/dashboard/crm" className="flex items-center gap-1.5 border border-white/10 bg-white/[0.02] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-light hover:bg-white/[0.05]">
          <ArrowLeft className="h-3.5 w-3.5" />
          CRM Command
        </Link>
      </header>

      {(notice || error) && (
        <div className={`mb-4 flex items-start gap-2 border px-4 py-3 text-sm ${error ? "border-red-500/25 bg-red-950/20 text-red-100" : "border-emerald-500/25 bg-emerald-950/20 text-emerald-100"}`}>
          {error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <p>{error || notice}</p>
        </div>
      )}

      <section className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="border border-white/5 bg-[#0A0A0A] p-3">
          <p className="font-mono text-[9px] uppercase tracking-wider text-slate-light">Connected</p>
          <p className="mt-1 font-mono text-xl font-bold">{connectedCount}</p>
        </div>
        <div className="border border-white/5 bg-[#0A0A0A] p-3">
          <p className="font-mono text-[9px] uppercase tracking-wider text-slate-light">Configured Providers</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#3B82F6]">{configuredCount}/{providers.length || 9}</p>
        </div>
        <div className="border border-white/5 bg-[#0A0A0A] p-3">
          <p className="font-mono text-[9px] uppercase tracking-wider text-slate-light">Sync Issues</p>
          <p className={`mt-1 font-mono text-xl font-bold ${blockedJobs ? "text-amber-300" : "text-paper"}`}>{blockedJobs}</p>
        </div>
        <button
          type="button"
          onClick={runScoring}
          disabled={isWorking === "ai-scoring"}
          className="border border-[#D4AF37]/30 bg-[#D4AF37]/10 p-3 text-left transition hover:bg-[#D4AF37]/15 disabled:opacity-50"
        >
          <p className="font-mono text-[9px] uppercase tracking-wider text-[#D4AF37]">AI Actions</p>
          <p className="mt-1 flex items-center gap-2 font-mono text-xl font-bold">
            {urgentRecommendations}
            <RefreshCw className={`h-4 w-4 ${isWorking === "ai-scoring" ? "animate-spin" : ""}`} />
          </p>
        </button>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_0.9fr]">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-slate-light">Provider Marketplace</h2>
            {isLoading && <RefreshCw className="h-4 w-4 animate-spin text-slate-light" />}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {providers.map((provider) => {
              const account = accountsByProvider.get(provider.provider);
              const Icon = providerIcon(provider.category);
              const connected = account?.status === "connected";
              const working = isWorking === provider.provider || isWorking === `${provider.provider}:sync`;
              return (
                <article key={provider.provider} className="border border-white/5 bg-[#0A0A0A] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className={`flex h-9 w-9 items-center justify-center border ${provider.configured ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-white/10 bg-white/5 text-slate-light"}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-wide">{provider.label}</h3>
                        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-slate-light">{provider.category.replace("_", " ")} · {provider.auth_type}</p>
                      </div>
                    </div>
                    <span className={`border px-2 py-0.5 font-mono text-[8px] uppercase ${connected ? "border-emerald-500/30 text-emerald-300" : provider.configured ? "border-[#3B82F6]/30 text-[#3B82F6]" : "border-amber-500/30 text-amber-300"}`}>
                      {connected ? "Connected" : provider.configured ? "Ready" : "Needs config"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {provider.capabilities.slice(0, 4).map((capability) => (
                      <span key={capability} className="border border-white/10 bg-white/[0.02] px-1.5 py-0.5 font-mono text-[8px] uppercase text-slate-light">
                        {capability.replaceAll("_", " ")}
                      </span>
                    ))}
                  </div>

                  {!provider.configured && provider.required_env.length > 0 && (
                    <p className="mt-3 line-clamp-2 font-mono text-[9px] text-amber-200">
                      Missing backend credentials: {provider.required_env.join(", ")}
                    </p>
                  )}

                  {provider.provider === "namecheap_private_email" && !account && (
                    <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
                      <div>
                        <label className="mb-1 block font-mono text-[8px] uppercase tracking-wider text-slate-light">Mailbox address</label>
                        <input
                          type="email"
                          value={mailboxDrafts[provider.provider]?.email || ""}
                          onChange={(event) => setMailboxDrafts((current) => ({
                            ...current,
                            [provider.provider]: {
                              email: event.target.value,
                              appPassword: current[provider.provider]?.appPassword || "",
                              smtpPort: current[provider.provider]?.smtpPort || "465",
                            },
                          }))}
                          placeholder="you@yourdomain.com"
                          className="w-full border border-white/10 bg-black px-2.5 py-2 text-xs text-paper outline-none focus:border-[#D4AF37]"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block font-mono text-[8px] uppercase tracking-wider text-slate-light">Mailbox / app password</label>
                        <input
                          type="password"
                          value={mailboxDrafts[provider.provider]?.appPassword || ""}
                          onChange={(event) => setMailboxDrafts((current) => ({
                            ...current,
                            [provider.provider]: {
                              email: current[provider.provider]?.email || "",
                              appPassword: event.target.value,
                              smtpPort: current[provider.provider]?.smtpPort || "465",
                            },
                          }))}
                          placeholder="Namecheap mailbox password"
                          className="w-full border border-white/10 bg-black px-2.5 py-2 text-xs text-paper outline-none focus:border-[#D4AF37]"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block font-mono text-[8px] uppercase tracking-wider text-slate-light">SMTP mode</label>
                        <select
                          value={mailboxDrafts[provider.provider]?.smtpPort || "465"}
                          onChange={(event) => setMailboxDrafts((current) => ({
                            ...current,
                            [provider.provider]: {
                              email: current[provider.provider]?.email || "",
                              appPassword: current[provider.provider]?.appPassword || "",
                              smtpPort: event.target.value,
                            },
                          }))}
                          className="w-full border border-white/10 bg-black px-2.5 py-2 text-xs text-paper outline-none focus:border-[#D4AF37]"
                        >
                          <option value="465">SSL/TLS on 465</option>
                          <option value="587">STARTTLS on 587</option>
                        </select>
                        <p className="mt-1 font-mono text-[8px] leading-relaxed text-slate">
                          Namecheap uses mail.privateemail.com for both IMAP and SMTP. IMAP is SSL on 993.
                        </p>
                      </div>
                    </div>
                  )}

                  {account && (
                    <div className="mt-3 border-t border-white/5 pt-3 font-mono text-[9px] text-slate-light">
                      <p>{account.account_email || account.account_label || provider.label}</p>
                      <p>Token: {account.token_status} · Last sync: {account.last_sync_at ? new Date(account.last_sync_at).toLocaleString() : "not yet"}</p>
                      {account.last_error && <p className="mt-1 text-red-300">{account.last_error}</p>}
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {account ? (
                      <>
                        <button
                          type="button"
                          onClick={() => runSync(provider, account)}
                          disabled={working}
                          className="flex items-center justify-center gap-1.5 border border-[#3B82F6]/30 bg-[#3B82F6]/10 px-3 py-2 font-mono text-[9px] uppercase text-[#3B82F6] disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${working ? "animate-spin" : ""}`} />
                          Sync
                        </button>
                        <button
                          type="button"
                          onClick={() => disconnectProvider(account)}
                          disabled={working}
                          className="flex items-center justify-center gap-1.5 border border-red-500/25 bg-red-950/20 px-3 py-2 font-mono text-[9px] uppercase text-red-200 disabled:opacity-50"
                        >
                          <Unplug className="h-3.5 w-3.5" />
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => connectProvider(provider)}
                        disabled={working}
                        className="col-span-2 flex items-center justify-center gap-1.5 bg-[#D4AF37] px-3 py-2 font-mono text-[9px] font-bold uppercase text-black disabled:opacity-50"
                      >
                        <Settings className="h-3.5 w-3.5" />
                        Add app
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="border border-white/5 bg-[#0A0A0A] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-slate-light">
                <Bot className="h-4 w-4 text-[#D4AF37]" />
                Next Best Actions
              </h2>
              <button onClick={runScoring} disabled={isWorking === "ai-scoring"} className="font-mono text-[9px] uppercase text-[#D4AF37] disabled:opacity-50">Run</button>
            </div>
            <div className="space-y-2">
              {recommendations.length === 0 ? (
                <div className="border border-dashed border-white/10 p-5 text-center font-mono text-[10px] uppercase text-slate-light">
                  No open AI actions. Run scoring to populate.
                </div>
              ) : recommendations.map((rec) => (
                <div key={rec.id} className="border border-white/5 bg-black/30 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-paper">{rec.entity_name || rec.entity_type}</p>
                      <p className="font-mono text-[8px] uppercase text-slate-light">{rec.entity_type} · {rec.priority}</p>
                    </div>
                    <span className={`font-mono text-lg font-bold ${rec.score >= 85 ? "text-red-300" : rec.score >= 70 ? "text-amber-300" : "text-[#3B82F6]"}`}>{rec.score}</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-light">{rec.recommendation}</p>
                  <p className="mt-1 line-clamp-2 font-mono text-[9px] text-slate">{rec.rationale}</p>
                  {parseFlags(rec.risk_flags).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {parseFlags(rec.risk_flags).map((flag) => (
                        <span key={flag} className="border border-amber-500/25 bg-amber-950/20 px-1.5 py-0.5 font-mono text-[8px] uppercase text-amber-200">{flag}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button onClick={() => closeRecommendation(rec, "accepted")} disabled={isWorking === rec.id} className="border border-emerald-500/25 bg-emerald-950/20 px-2 py-1.5 font-mono text-[9px] uppercase text-emerald-200 disabled:opacity-50">Accept</button>
                    <button onClick={() => closeRecommendation(rec, "dismissed")} disabled={isWorking === rec.id} className="border border-white/10 px-2 py-1.5 font-mono text-[9px] uppercase text-slate-light disabled:opacity-50">Dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-white/5 bg-[#0A0A0A] p-4">
            <h2 className="mb-3 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-slate-light">
              <Workflow className="h-4 w-4 text-[#3B82F6]" />
              Recent Sync Jobs
            </h2>
            <div className="space-y-2">
              {jobs.length === 0 ? (
                <div className="border border-dashed border-white/10 p-5 text-center font-mono text-[10px] uppercase text-slate-light">No sync jobs yet.</div>
              ) : jobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between gap-3 border border-white/5 bg-black/30 p-2">
                  <div>
                    <p className="font-mono text-[10px] uppercase text-paper">{job.provider} · {job.sync_type}</p>
                    <p className="font-mono text-[8px] text-slate-light">{job.account_email || job.account_label || "CRM account"} · {job.created_at ? new Date(job.created_at).toLocaleString() : ""}</p>
                    {job.error_summary && <p className="mt-1 font-mono text-[8px] text-amber-200">{job.error_summary}</p>}
                  </div>
                  <span className={`border px-2 py-0.5 font-mono text-[8px] uppercase ${job.status === "completed" ? "border-emerald-500/25 text-emerald-300" : job.status === "failed" || job.status === "blocked" ? "border-amber-500/25 text-amber-300" : "border-[#3B82F6]/25 text-[#3B82F6]"}`}>
                    {job.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
