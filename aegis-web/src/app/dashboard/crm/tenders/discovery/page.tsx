"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { getAssignableUsers } from "@/lib/api";
import { getDiscoveryOverview, getDiscoveryRun, type DiscoveryOverview, type DiscoveryRun } from "@/lib/api/tender-discovery";
import { ConnectionPanel, RunHistory, RunPanel } from "@/components/crm/tender-discovery/ConnectionAndRuns";
import { CandidateQueue, type QueueMode } from "@/components/crm/tender-discovery/CandidateQueue";
import { CandidateDrawer } from "@/components/crm/tender-discovery/CandidateDrawer";
import { ChangesPanel } from "@/components/crm/tender-discovery/ChangesPanel";
import { ProfileEditor } from "@/components/crm/tender-discovery/ProfileEditor";
import { errorMessage } from "@/components/crm/tender-discovery/shared";

type Tab = "queue" | "changes" | "imported" | "rejected" | "runs" | "profile";

export default function TenderDiscoveryPage() {
  const [overview, setOverview] = useState<DiscoveryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("queue");
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [liveRun, setLiveRun] = useState<DiscoveryRun | null>(null);
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await getDiscoveryOverview();
      if (!res.data) throw new Error(res.message || "Empty response from the server.");
      setOverview(res.data);
      setLiveRun(res.data.active_run);
      setError(null);
    } catch (err) {
      setError({ message: errorMessage(err, "Could not load tender discovery."), denied: (err as any)?.status === 403 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    getAssignableUsers().then((r) => setUsers(r.data || [])).catch(() => setUsers([]));
    // Deep link from a change notification: ?candidate=<id>&tab=changes
    const params = new URLSearchParams(window.location.search);
    if (params.get("candidate")) setOpenId(params.get("candidate"));
    if (params.get("tab") === "changes") setTab("changes");
  }, [load]);

  // Progress comes from the run row in the database - polled while active.
  useEffect(() => {
    if (!liveRun || !["queued", "running"].includes(liveRun.status)) return;
    const timer = setInterval(async () => {
      try {
        const res = await getDiscoveryRun(liveRun.id);
        if (!res.data) return;
        setLiveRun(res.data);
        if (!["queued", "running"].includes(res.data.status)) {
          await load();
          setRefreshKey((k) => k + 1);
        }
      } catch {
        // keep the last known state; the next tick retries
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [liveRun, load]);

  const refresh = useCallback(() => { void load(); setRefreshKey((k) => k + 1); }, [load]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    overview?.counts.forEach((c) => { out[c.review_status] = (out[c.review_status] || 0) + Number(c.n); });
    return out;
  }, [overview]);

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "queue", label: "Review queue", badge: (counts.new || 0) + (counts.deferred || 0) + (counts.needs_dedupe_review || 0) },
    { key: "changes", label: "Changes", badge: overview?.pending_changes },
    { key: "imported", label: "Imported", badge: counts.imported },
    { key: "rejected", label: "Rejected", badge: counts.rejected },
    { key: "runs", label: "Run history" },
    { key: "profile", label: "Profile" },
  ];

  const latestRun = liveRun || overview?.runs[0] || null;
  const perms = overview?.permissions || { run: false, import: false, configure: false };

  return (
    <div className="min-h-dvh bg-[#050505] px-4 py-4 text-paper sm:px-6">
      <DashboardPageHeader
        breadcrumbs={[
          { label: "CRM", href: "/dashboard/crm" },
          { label: "Tenders & Bids", href: "/dashboard/crm/tenders" },
          { label: "e-GP Discovery" },
        ]}
        backHref="/dashboard/crm/tenders"
        backLabel="Back to Tenders & Bids"
        eyebrow={{ label: "PRAZ e-GP intake" }}
        title="Tender Discovery"
        subtitle="Find notices on the official Zimbabwe e-GP portal, review the evidence, and import the right ones into the tender pipeline."
      />

      {loading ? (
        <div className="flex h-72 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#D4AF37]" /></div>
      ) : error || !overview ? (
        <div className="mx-auto mt-8 max-w-lg rounded-sm border border-rose-400/20 bg-rose-950/10 p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-rose-300" />
          <p className="text-sm text-rose-200">{error?.denied ? "You don't have access to e-GP tender discovery." : error?.message}</p>
          {!error?.denied && <button onClick={() => { setLoading(true); void load(); }} className="mt-3 text-xs text-[#D4AF37] underline">Retry</button>}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[360px,1fr]">
          <div className="space-y-4">
            <ConnectionPanel source={overview.source} canRun={perms.run} onChanged={refresh} />
            <RunPanel source={overview.source} activeRun={liveRun && ["queued", "running"].includes(liveRun.status) ? liveRun : null}
                      latestRun={latestRun} canRun={perms.run} onChanged={refresh} />
            <details className="rounded-sm border border-white/5 bg-[#0A0A0A] p-4 text-xs">
              <summary className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-light"><Info className="h-3.5 w-3.5" /> Limitations</summary>
              <ul className="mt-2 space-y-2">
                {overview.limitations.map((l) => <li key={l.key}><p className="text-paper">{l.title}</p><p className="text-slate-light">{l.detail}</p></li>)}
                <li><p className="text-paper">SNC credentials in AEGIS</p><p className="text-slate-light">{overview.configured_credentials} configured. Eligibility shows as missing evidence until registrations are recorded in the corporate credentials vault.</p></li>
              </ul>
            </details>
          </div>

          <div className="min-w-0 space-y-3">
            <nav className="flex gap-1 overflow-x-auto border-b border-white/5 pb-px" aria-label="Discovery sections">
              {tabs.map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)}
                        className={`shrink-0 border-b-2 px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition ${tab === t.key ? "border-[#D4AF37] text-[#D4AF37]" : "border-transparent text-slate-light hover:text-paper"}`}>
                  {t.label}{t.badge ? <span className="ml-1.5 rounded-sm bg-white/10 px-1 text-paper">{t.badge}</span> : null}
                </button>
              ))}
            </nav>

            {tab === "queue" && <CandidateQueue mode={"open" as QueueMode} canImport={perms.import} users={users} onOpen={setOpenId} refreshKey={refreshKey} onImported={refresh} />}
            {tab === "imported" && <CandidateQueue mode="imported" canImport={false} users={users} onOpen={setOpenId} refreshKey={refreshKey} onImported={refresh} />}
            {tab === "rejected" && <CandidateQueue mode="rejected" canImport={false} users={users} onOpen={setOpenId} refreshKey={refreshKey} onImported={refresh} />}
            {tab === "changes" && <ChangesPanel canDecide={perms.import} onOpen={setOpenId} refreshKey={refreshKey} onChanged={refresh} />}
            {tab === "runs" && <RunHistory runs={overview.runs} />}
            {tab === "profile" && <ProfileEditor profile={overview.profile} canConfigure={perms.configure} onSaved={refresh} />}
          </div>
        </div>
      )}

      {openId && (
        <CandidateDrawer candidateId={openId} canImport={perms.import} canRun={perms.run} users={users}
                         onClose={() => setOpenId(null)} onChanged={refresh} />
      )}
    </div>
  );
}
