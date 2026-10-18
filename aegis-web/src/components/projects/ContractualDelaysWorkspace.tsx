"use client";

import React, { useState, useEffect } from "react";
import {
  Clock,
  AlertTriangle,
  FileText,
  Calendar,
  CheckCircle2,
  XCircle,
  Plus,
  Loader2,
  RefreshCw,
  Scale,
  ShieldAlert,
  ArrowRight,
  X,
  FileCheck2,
  CloudRain,
} from "lucide-react";
import {
  listProjectDelays,
  createProjectDelay,
  listProjectEotClaims,
  createProjectEotClaim,
  determineProjectEotClaim,
  listProjectMilestones,
  type ContractualDelayItem,
  type ExtensionOfTimeClaimItem,
  type ProjectMilestoneItem,
} from "@/lib/api/projects";
import { formatCurrency, formatDate } from "@/lib/utils";

interface ContractualDelaysWorkspaceProps {
  projectId: string;
}

export function ContractualDelaysWorkspace({ projectId }: ContractualDelaysWorkspaceProps) {
  const [loading, setLoading] = useState(true);
  const [delays, setDelays] = useState<ContractualDelayItem[]>([]);
  const [claims, setClaims] = useState<ExtensionOfTimeClaimItem[]>([]);
  const [milestones, setMilestones] = useState<ProjectMilestoneItem[]>([]);

  // Modals
  const [isDelayModalOpen, setIsDelayModalOpen] = useState(false);
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [isDetermineModalOpen, setIsDetermineModalOpen] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<ExtensionOfTimeClaimItem | null>(null);

  // Delay Form
  const [eventNumber, setEventNumber] = useState("");
  const [delayTitle, setDelayTitle] = useState("");
  const [causeCategory, setCauseCategory] = useState("employer_delay");
  const [clauseRef, setClauseRef] = useState("FIDIC Red Book Cl. 8.4");
  const [occurredDate, setOccurredDate] = useState(new Date().toISOString().split("T")[0]);
  const [noticeDays, setNoticeDays] = useState("28");
  const [servedDate, setServedDate] = useState("");
  const [estimatedDays, setEstimatedDays] = useState("14");
  const [delayDesc, setDelayDesc] = useState("");
  const [mitigation, setMitigation] = useState("");
  const [submittingDelay, setSubmittingDelay] = useState(false);

  // Claim Form
  const [claimRef, setClaimRef] = useState("");
  const [claimTitle, setClaimTitle] = useState("");
  const [selectedDelayId, setSelectedDelayId] = useState("");
  const [daysRequested, setDaysRequested] = useState("14");
  const [selectedMilestoneId, setSelectedMilestoneId] = useState("");
  const [prolongationClaimed, setProlongationClaimed] = useState("0");
  const [submittingClaim, setSubmittingClaim] = useState(false);

  // Determination Form
  const [daysGranted, setDaysGranted] = useState("");
  const [prolongationApproved, setProlongationApproved] = useState("");
  const [determinationNotes, setDeterminationNotes] = useState("");
  const [engineerName, setEngineerName] = useState("");
  const [determinationStatus, setDeterminationStatus] = useState("determined");
  const [submittingDetermination, setSubmittingDetermination] = useState(false);

  const [message, setMessage] = useState<string | null>(null);

  const loadAll = async () => {
    try {
      const [dRes, cRes, mRes] = await Promise.all([
        listProjectDelays(projectId),
        listProjectEotClaims(projectId),
        listProjectMilestones(projectId),
      ]);
      if (dRes.data) setDelays(dRes.data);
      if (cRes.data) setClaims(cRes.data);
      if (mRes.data) setMilestones(mRes.data);
    } catch (err) {
      console.error("Failed to load delay events & EOT claims", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) {
      void loadAll();
    }
  }, [projectId]);

  // Handle Delay Creation
  const handleCreateDelay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventNumber.trim() || !delayTitle.trim()) return;
    setSubmittingDelay(true);
    setMessage(null);
    try {
      await createProjectDelay(projectId, {
        event_number: eventNumber.trim(),
        title: delayTitle.trim(),
        cause_category: causeCategory,
        contract_clause_reference: clauseRef.trim() || undefined,
        event_occurred_date: occurredDate,
        notice_required_days: Number(noticeDays) || 28,
        notice_served_date: servedDate || undefined,
        estimated_days_impact: Number(estimatedDays) || 0,
        description: delayDesc.trim() || undefined,
        mitigation_actions: mitigation.trim() || undefined,
      });
      setIsDelayModalOpen(false);
      setEventNumber("");
      setDelayTitle("");
      setMessage("Contractual delay event recorded with statutory notice timeline.");
      await loadAll();
    } catch (err: any) {
      setMessage(err?.message || "Failed to record delay event.");
    } finally {
      setSubmittingDelay(false);
    }
  };

  // Handle EOT Claim Submission
  const handleCreateClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimRef.trim() || !claimTitle.trim() || !daysRequested) return;
    setSubmittingClaim(true);
    setMessage(null);
    try {
      await createProjectEotClaim(projectId, {
        claim_reference: claimRef.trim(),
        title: claimTitle.trim(),
        delay_event_id: selectedDelayId || undefined,
        days_requested: Number(daysRequested) || 1,
        impacted_milestone_id: selectedMilestoneId || undefined,
        prolongation_cost_claimed: Number(prolongationClaimed) || 0,
      });
      setIsClaimModalOpen(false);
      setClaimRef("");
      setClaimTitle("");
      setMessage("Extension of Time claim submitted.");
      await loadAll();
    } catch (err: any) {
      setMessage(err?.message || "Failed to submit EOT claim.");
    } finally {
      setSubmittingClaim(false);
    }
  };

  // Handle Determination
  const handleDetermineClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClaim) return;
    setSubmittingDetermination(true);
    setMessage(null);
    try {
      await determineProjectEotClaim(projectId, selectedClaim.id, {
        days_granted: Number(daysGranted) || 0,
        prolongation_cost_approved: Number(prolongationApproved) || 0,
        determination_notes: determinationNotes.trim() || undefined,
        engineer_representative_name: engineerName.trim() || undefined,
        status: determinationStatus,
      });
      setIsDetermineModalOpen(false);
      setSelectedClaim(null);
      setMessage("Engineer determination registered and milestone adjusted.");
      await loadAll();
    } catch (err: any) {
      setMessage(err?.message || "Failed to determine EOT claim.");
    } finally {
      setSubmittingDetermination(false);
    }
  };

  const openDetermineModal = (claim: ExtensionOfTimeClaimItem) => {
    setSelectedClaim(claim);
    setDaysGranted(String(claim.days_requested));
    setProlongationApproved(String(claim.prolongation_cost_claimed));
    setDeterminationNotes("");
    setEngineerName("");
    setDeterminationStatus("determined");
    setIsDetermineModalOpen(true);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 text-slate-light font-mono text-sm">
        <Loader2 className="h-5 w-5 animate-spin text-signal" />
        Auditing contractual delay events &amp; EOT claims...
      </div>
    );
  }

  // KPI calculations
  const totalClaimedDays = claims.reduce((acc, c) => acc + (c.days_requested || 0), 0);
  const totalApprovedDays = claims.reduce((acc, c) => acc + (c.days_granted || 0), 0);
  const totalProlongationClaimed = claims.reduce((acc, c) => acc + (c.prolongation_cost_claimed || 0), 0);
  const totalProlongationApproved = claims.reduce((acc, c) => acc + (c.prolongation_cost_approved || 0), 0);
  const timeBarredDelays = delays.filter((d) => d.is_time_barred).length;

  const openWeatherDelayModal = () => {
    const todayStr = new Date().toISOString().split("T")[0];
    setEventNumber(`WEATHER-${Date.now().toString().slice(-4)}`);
    setDelayTitle("Adverse Climatic Event - Precipitation & Storm Standdown");
    setCauseCategory("weather");
    setClauseRef("FIDIC Cl. 8.4(c) / NEC4 Cl. 60.1(13)");
    setOccurredDate(todayStr);
    setNoticeDays("28");
    setServedDate(todayStr);
    setEstimatedDays("5");
    setDelayDesc("Torrential rainfall exceeding historical 10-year meteorological return threshold. Saturated ground conditions halted earthworks, tower crane operations, and structural concrete pouring.");
    setMitigation("Mobilised dewatering diesel pumps, re-routed site haul roads, and shifted labor to covered interior drainage works.");
    setIsDelayModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="h-6 w-6 text-signal" />
            <h3 className="font-display text-xl font-bold text-paper sm:text-2xl">
              Contractual Delay Events &amp; Extension of Time (EOT)
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-light">
            Enforces FIDIC / NEC / JBCC claims protocols: statutory notice time-bar tracking, critical path impact validation, and prolongation cost adjudication.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAll()}
            className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink px-3 py-1.5 font-mono text-xs text-slate-light hover:text-paper"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={openWeatherDelayModal}
            className="inline-flex items-center gap-1.5 border border-sky-500/50 bg-sky-950/20 px-3.5 py-1.5 font-mono text-xs font-semibold text-sky-300 hover:bg-sky-500 hover:text-ink active:scale-[0.98] transition-all"
            title="Auto-generate contractual delay claim for adverse weather under FIDIC Cl. 8.4(c) / NEC4 Cl. 60.1(13)"
          >
            <CloudRain className="h-3.5 w-3.5" />
            <span>Adverse Weather Notice</span>
          </button>
          <button
            type="button"
            onClick={() => setIsDelayModalOpen(true)}
            className="inline-flex items-center gap-1.5 border border-amber-500/50 bg-amber-950/20 px-3.5 py-1.5 font-mono text-xs font-semibold text-amber-300 hover:bg-amber-500 hover:text-ink active:scale-[0.98] transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Record Delay Event</span>
          </button>
          <button
            type="button"
            onClick={() => setIsClaimModalOpen(true)}
            className="inline-flex items-center gap-1.5 border border-signal bg-signal px-3.5 py-1.5 font-mono text-xs font-bold text-ink hover:bg-signal/90 active:scale-[0.98] transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Submit EOT Claim</span>
          </button>
        </div>
      </div>

      {message && (
        <div className="flex items-center justify-between border border-signal/40 bg-signal/10 px-4 py-2.5 font-mono text-xs text-paper">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} className="text-slate hover:text-paper">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Commercial Delay KPIs */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Delay Events */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Notified Delay Events</span>
          <p className="mt-1 font-mono text-2xl font-bold text-paper">{delays.length}</p>
          <div className="mt-1 flex items-center gap-2 font-mono text-[11px]">
            {timeBarredDelays > 0 ? (
              <span className="text-rose-400 font-semibold">{timeBarredDelays} Time-Barred</span>
            ) : (
              <span className="text-emerald-400">All Notices Within Time</span>
            )}
          </div>
        </div>

        {/* Days Claimed vs Granted */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">EOT Days Requested / Granted</span>
          <p className="mt-1 font-mono text-2xl font-bold text-signal">
            {totalApprovedDays} <span className="text-sm font-normal text-slate">/ {totalClaimedDays} days</span>
          </p>
          <span className="text-[11px] text-slate-light">
            Approved: {totalClaimedDays > 0 ? Math.round((totalApprovedDays / totalClaimedDays) * 100) : 0}% success rate
          </span>
        </div>

        {/* Prolongation Claimed */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Prolongation Cost Claimed</span>
          <p className="mt-1 font-mono text-2xl font-bold text-paper">
            {formatCurrency(totalProlongationClaimed)}
          </p>
          <span className="text-[11px] text-slate-light">Site indirect overheads</span>
        </div>

        {/* Prolongation Approved */}
        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Prolongation Certified</span>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">
            {formatCurrency(totalProlongationApproved)}
          </p>
          <span className="text-[11px] text-slate-light">Client determined liability</span>
        </div>
      </section>

      {/* Contractual Delay Event Register */}
      <section className="border border-ink-mid bg-ink/70">
        <div className="flex items-center justify-between border-b border-ink-mid px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-400" />
            <h4 className="font-display text-sm font-bold uppercase tracking-wider text-paper">
              Contractual Delay Event Register &amp; Statutory Notice Countdown
            </h4>
          </div>
          <span className="font-mono text-xs text-slate">{delays.length} Events Logged</span>
        </div>

        {delays.length === 0 ? (
          <div className="p-8 text-center font-mono text-xs text-slate-light">
            No contractual delay events logged. Click &quot;Record Delay Event&quot; when employer delays, weather disruptions, or late site handover occur.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-ink-mid bg-ink-light/50 text-[11px] uppercase tracking-wider text-slate">
                <tr>
                  <th className="p-3">Event Ref &amp; Title</th>
                  <th className="p-3">Clause &amp; Cause</th>
                  <th className="p-3">Occurred Date</th>
                  <th className="p-3">Notice Status &amp; Time-Bar</th>
                  <th className="p-3">Impact Est.</th>
                  <th className="p-3">EOT Claims</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/40">
                {delays.map((d) => (
                  <tr key={d.id} className="hover:bg-ink-light/30 transition-colors">
                    <td className="p-3">
                      <div className="font-bold text-paper">{d.event_number}</div>
                      <div className="text-[11px] text-slate-light">{d.title}</div>
                      {d.mitigation_actions && (
                        <div className="mt-0.5 text-[10px] text-cyan-300">
                          Mitigation: {d.mitigation_actions}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-signal">{d.contract_clause_reference || "Contract Cl. 8.4"}</div>
                      <div className="text-[10px] text-slate uppercase">{d.cause_category.replace(/_/g, " ")}</div>
                    </td>
                    <td className="p-3">
                      <div className="text-paper">{d.event_occurred_date ? formatDate(d.event_occurred_date) : "-"}</div>
                      {d.event_ended_date && (
                        <div className="text-[10px] text-slate">Ended: {formatDate(d.event_ended_date)}</div>
                      )}
                    </td>
                    <td className="p-3">
                      {d.is_time_barred ? (
                        <span className="inline-flex items-center gap-1 border border-rose-500/50 bg-rose-950/30 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-300">
                          <XCircle className="h-3 w-3" />
                          Time-Barred (Late Notice)
                        </span>
                      ) : d.notice_served_date ? (
                        <span className="inline-flex items-center gap-1 border border-emerald-500/50 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          Served ({formatDate(d.notice_served_date)})
                        </span>
                      ) : (
                        <div>
                          <span className="inline-flex items-center gap-1 border border-amber-500/50 bg-amber-950/30 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                            <Clock className="h-3 w-3" />
                            {d.days_remaining_to_notice > 0
                              ? `${d.days_remaining_to_notice}d left to notice`
                              : "Notice Overdue"}
                          </span>
                          <div className="text-[10px] text-slate mt-0.5">Deadline: {formatDate(d.notice_deadline)}</div>
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <span className="font-bold text-paper">{d.estimated_days_impact} days</span>
                    </td>
                    <td className="p-3">
                      <span className="border border-ink-mid px-2 py-0.5 text-[10px] text-slate">
                        {d.eot_claims_count} claim(s)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Extension of Time Claims Ledger */}
      <section className="border border-ink-mid bg-ink/70">
        <div className="flex items-center justify-between border-b border-ink-mid px-4 py-3">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-signal" />
            <h4 className="font-display text-sm font-bold uppercase tracking-wider text-paper">
              Extension of Time (EOT) Claim Ledger &amp; Determinations
            </h4>
          </div>
          <span className="font-mono text-xs text-slate">{claims.length} Claims on Record</span>
        </div>

        {claims.length === 0 ? (
          <div className="p-8 text-center font-mono text-xs text-slate-light">
            No formal EOT claims submitted. Click &quot;Submit EOT Claim&quot; to request contractual completion date adjustments and preliminary prolongation costs.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-ink-mid bg-ink-light/50 text-[11px] uppercase tracking-wider text-slate">
                <tr>
                  <th className="p-3">Claim Reference</th>
                  <th className="p-3">Impacted Milestone</th>
                  <th className="p-3">Critical Path</th>
                  <th className="p-3">Days Req / Granted</th>
                  <th className="p-3">Prolongation ($)</th>
                  <th className="p-3">Determination Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/40">
                {claims.map((c) => {
                  const isDetermined = c.status === "determined";
                  const isRejected = c.status === "rejected";

                  return (
                    <tr key={c.id} className="hover:bg-ink-light/30 transition-colors">
                      <td className="p-3">
                        <div className="font-bold text-paper">{c.claim_reference}</div>
                        <div className="text-[11px] text-slate-light">{c.title}</div>
                        {c.delay_event_number && (
                          <div className="text-[10px] text-amber-300">Linked: {c.delay_event_number}</div>
                        )}
                      </td>

                      <td className="p-3">
                        <div className="text-paper">{c.impacted_milestone_name || "Project Completion"}</div>
                      </td>

                      <td className="p-3">
                        {c.is_critical_path_impact ? (
                          <span className="border border-rose-500/50 bg-rose-950/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-400 uppercase">
                            Critical Path Impact
                          </span>
                        ) : (
                          <span className="border border-ink-mid px-1.5 py-0.5 text-[10px] text-slate uppercase">
                            Non-Critical
                          </span>
                        )}
                      </td>

                      <td className="p-3">
                        <div className="font-bold text-paper">
                          {c.days_granted > 0 ? (
                            <span className="text-emerald-400">{c.days_granted} granted</span>
                          ) : (
                            <span>{c.days_requested} requested</span>
                          )}
                        </div>
                        {c.days_granted > 0 && (
                          <div className="text-[10px] text-slate">Req: {c.days_requested} days</div>
                        )}
                      </td>

                      <td className="p-3">
                        <div className="font-semibold text-paper">
                          {formatCurrency(c.prolongation_cost_claimed)}
                        </div>
                        {c.prolongation_cost_approved > 0 && (
                          <div className="text-[11px] text-emerald-400">
                            Cert: {formatCurrency(c.prolongation_cost_approved)}
                          </div>
                        )}
                      </td>

                      <td className="p-3">
                        <span className={`inline-block border px-2 py-0.5 text-[10px] font-bold uppercase ${
                          isDetermined
                            ? "border-emerald-500/50 bg-emerald-950/20 text-emerald-400"
                            : isRejected
                            ? "border-rose-500/50 bg-rose-950/20 text-rose-400"
                            : "border-sky-500/50 bg-sky-950/20 text-sky-300"
                        }`}>
                          {c.status.replace(/_/g, " ")}
                        </span>
                        {c.determination_date && (
                          <div className="text-[10px] text-slate mt-0.5">
                            {formatDate(c.determination_date)} {c.engineer_representative_name ? `by ${c.engineer_representative_name}` : ""}
                          </div>
                        )}
                      </td>

                      <td className="p-3 text-right">
                        {!isDetermined && !isRejected ? (
                          <button
                            type="button"
                            onClick={() => openDetermineModal(c)}
                            className="inline-flex items-center gap-1 border border-emerald-500/60 bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500 hover:text-ink transition-colors"
                          >
                            <FileCheck2 className="h-3 w-3" />
                            <span>Determine</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate">Closed</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal: Record Delay Event */}
      {isDelayModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-amber-500/50 bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-400" />
                <h3 className="font-display text-lg font-bold text-paper">Record Contractual Delay Event</h3>
              </div>
              <button type="button" onClick={() => setIsDelayModalOpen(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDelay} className="space-y-3 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Event Reference *</label>
                  <input
                    required
                    value={eventNumber}
                    onChange={(e) => setEventNumber(e.target.value)}
                    placeholder="e.g. DLY-001"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Clause Reference</label>
                  <input
                    value={clauseRef}
                    onChange={(e) => setClauseRef(e.target.value)}
                    placeholder="e.g. FIDIC Cl. 8.4"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate uppercase text-[10px]">Event Title *</label>
                <input
                  required
                  value={delayTitle}
                  onChange={(e) => setDelayTitle(e.target.value)}
                  placeholder="e.g. Employer failure to give site possession of North Wing"
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Cause Category</label>
                  <select
                    value={causeCategory}
                    onChange={(e) => setCauseCategory(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-amber-500"
                  >
                    <option value="employer_delay">Employer / Client Delay</option>
                    <option value="late_drawings_instructions">Late Drawings / Instructions</option>
                    <option value="differing_site_conditions">Differing Site Conditions</option>
                    <option value="adverse_weather">Exceptional Adverse Weather</option>
                    <option value="force_majeure">Force Majeure</option>
                    <option value="regulatory_or_statutory">Regulatory / Statutory Stop</option>
                    <option value="variations_scope_change">Variations / Scope Change</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Occurred Date *</label>
                  <input
                    type="date"
                    required
                    value={occurredDate}
                    onChange={(e) => setOccurredDate(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Notice Window (Days)</label>
                  <input
                    type="number"
                    value={noticeDays}
                    onChange={(e) => setNoticeDays(e.target.value)}
                    placeholder="28"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Date Notice Served</label>
                  <input
                    type="date"
                    value={servedDate}
                    onChange={(e) => setServedDate(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Estimated Days</label>
                  <input
                    type="number"
                    value={estimatedDays}
                    onChange={(e) => setEstimatedDays(e.target.value)}
                    placeholder="14"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate uppercase text-[10px]">Mitigation Actions Taken</label>
                <textarea
                  rows={2}
                  value={mitigation}
                  onChange={(e) => setMitigation(e.target.value)}
                  placeholder="e.g. Reallocated earthmoving team to South Wing to minimize idling..."
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setIsDelayModalOpen(false)}
                  className="border border-ink-mid px-4 py-2 text-slate hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingDelay}
                  className="border border-amber-500 bg-amber-500 px-4 py-2 font-bold text-ink hover:bg-amber-400 disabled:opacity-50"
                >
                  {submittingDelay ? "Saving..." : "Record Delay Event"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Submit EOT Claim */}
      {isClaimModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-signal/50 bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <div className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-signal" />
                <h3 className="font-display text-lg font-bold text-paper">Submit Extension of Time Claim</h3>
              </div>
              <button type="button" onClick={() => setIsClaimModalOpen(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateClaim} className="space-y-3 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Claim Reference *</label>
                  <input
                    required
                    value={claimRef}
                    onChange={(e) => setClaimRef(e.target.value)}
                    placeholder="e.g. EOT-001"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                  />
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Linked Delay Event</label>
                  <select
                    value={selectedDelayId}
                    onChange={(e) => setSelectedDelayId(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                  >
                    <option value="">-- No Direct Link --</option>
                    {delays.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.event_number} - {d.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate uppercase text-[10px]">Claim Title *</label>
                <input
                  required
                  value={claimTitle}
                  onChange={(e) => setClaimTitle(e.target.value)}
                  placeholder="e.g. EOT Claim for 21 Days Delay on Substations Completion"
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Days Requested *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={daysRequested}
                    onChange={(e) => setDaysRequested(e.target.value)}
                    placeholder="21"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                  />
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Prolongation Cost ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={prolongationClaimed}
                    onChange={(e) => setProlongationClaimed(e.target.value)}
                    placeholder="0"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate uppercase text-[10px]">Impacted CPM Milestone</label>
                <select
                  value={selectedMilestoneId}
                  onChange={(e) => setSelectedMilestoneId(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                >
                  <option value="">-- Project Overall Completion --</option>
                  {milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.is_critical ? "★ (Critical Path)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setIsClaimModalOpen(false)}
                  className="border border-ink-mid px-4 py-2 text-slate hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingClaim}
                  className="border border-signal bg-signal px-4 py-2 font-bold text-ink hover:bg-signal/90 disabled:opacity-50"
                >
                  {submittingClaim ? "Submitting..." : "Submit Claim"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Determine EOT Claim */}
      {isDetermineModalOpen && selectedClaim && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-emerald-500/50 bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-emerald-400" />
                <h3 className="font-display text-lg font-bold text-paper">Engineer Determination</h3>
              </div>
              <button type="button" onClick={() => setIsDetermineModalOpen(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleDetermineClaim} className="space-y-3 font-mono text-xs">
              <div className="bg-ink-light/50 p-3 border border-ink-mid space-y-1">
                <div className="font-bold text-paper">{selectedClaim.claim_reference}: {selectedClaim.title}</div>
                <div className="text-slate">Claimed: {selectedClaim.days_requested} days | {formatCurrency(selectedClaim.prolongation_cost_claimed)}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Days Granted *</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={daysGranted}
                    onChange={(e) => setDaysGranted(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Prolongation Approved ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={prolongationApproved}
                    onChange={(e) => setProlongationApproved(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Engineer / Representative</label>
                  <input
                    value={engineerName}
                    onChange={(e) => setEngineerName(e.target.value)}
                    placeholder="e.g. Eng. D. Nkomo (Resident Engineer)"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Determination Verdict</label>
                  <select
                    value={determinationStatus}
                    onChange={(e) => setDeterminationStatus(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-emerald-500"
                  >
                    <option value="determined">Determined / Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="disputed">Disputed / Escalated</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate uppercase text-[10px]">Determination Findings &amp; Rationale</label>
                <textarea
                  rows={3}
                  value={determinationNotes}
                  onChange={(e) => setDeterminationNotes(e.target.value)}
                  placeholder="e.g. Critical path analysis confirms 14 days delay attributable to Employer draw-down delay. Granted 14 days..."
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setIsDetermineModalOpen(false)}
                  className="border border-ink-mid px-4 py-2 text-slate hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingDetermination}
                  className="border border-emerald-500 bg-emerald-500 px-4 py-2 font-bold text-ink hover:bg-emerald-400 disabled:opacity-50"
                >
                  {submittingDetermination ? "Recording..." : "Register Determination"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
