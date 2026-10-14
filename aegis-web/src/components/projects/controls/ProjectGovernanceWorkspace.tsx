"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  Loader2,
  FileText,
  DollarSign,
  Send,
  AlertCircle,
  HelpCircle,
  Layers,
  Check,
  ChevronRight,
} from "lucide-react";
import {
  getProjectLifecycle,
  updateProjectPreMobilisationCheck,
  approveProjectPreMobilisation,
  clearProjectCommercialReadiness,
  confirmProjectDeposit,
} from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { PreMobilisationCheck, CommercialReadiness } from "@/lib/projects/types";

export function ProjectGovernanceWorkspace({
  projectId,
  status = "planning",
  contractValue = 0,
  onStatusUpdated,
}: {
  projectId: string;
  status?: string;
  contractValue?: number;
  onStatusUpdated?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<PreMobilisationCheck[]>([]);
  const [commercial, setCommercial] = useState<CommercialReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Fast-track modal state
  const [isFastTrackOpen, setIsFastTrackOpen] = useState(false);
  const [fastTrackReason, setFastTrackReason] = useState("");
  const [fastTrackBudget, setFastTrackBudget] = useState(contractValue > 0 ? String(contractValue) : "");
  const [submittingFastTrack, setSubmittingFastTrack] = useState(false);

  // Deposit confirmation state
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositRef, setDepositRef] = useState("");
  const [submittingDeposit, setSubmittingDeposit] = useState(false);

  const loadGovernanceData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getProjectLifecycle(projectId);
      const data = (res.data || {}) as any;
      if (data?.pre_mobilisation && Array.isArray(data.pre_mobilisation.checks)) {
        setChecks(data.pre_mobilisation.checks);
      }
      if (data?.commercial_readiness) {
        setCommercial(data.commercial_readiness as CommercialReadiness);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load governance checks.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadGovernanceData();
  }, [loadGovernanceData]);

  // Check status update handler
  const handleToggleCheck = async (check: PreMobilisationCheck, nextStatus: string) => {
    try {
      await updateProjectPreMobilisationCheck(projectId, check.id, {
        status: nextStatus as any,
        evidence_reference: check.evidence_reference || `Updated manually by Project Controls`,
      });
      setChecks((prev) =>
        prev.map((c) => (c.id === check.id ? { ...c, status: nextStatus } : c))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update check.");
    }
  };

  // Fast-track mobilization execution
  const handleExecuteFastTrack = async () => {
    if (!fastTrackReason.trim()) {
      setError("Please provide an executive authorization rationale for fast-tracking.");
      return;
    }
    setSubmittingFastTrack(true);
    setError(null);
    setActionSuccess(null);

    try {
      // 1. Clear commercial readiness with executive waiver statement
      try {
        await clearProjectCommercialReadiness(projectId, {
          authority_relied_upon: `Executive fast-track authorization: ${fastTrackReason.trim()}`,
          approved_contract_value: contractValue || Number(fastTrackBudget) || 0,
        });
      } catch {
        // If already cleared, continue
      }

      // 2. Mark any remaining incomplete checks as 'complete_with_conditions'
      for (const chk of checks) {
        if (!chk.status || chk.status === "incomplete") {
          await updateProjectPreMobilisationCheck(projectId, chk.id, {
            status: "complete_with_conditions",
            evidence_reference: `Fast-track waiver: ${fastTrackReason.trim()}`,
          });
        }
      }

      // 3. Authorize mobilisation
      const today = new Date().toISOString().split("T")[0];
      const res = await approveProjectPreMobilisation(projectId, {
        mobilisation_date: today,
        mobilisation_budget: Number(fastTrackBudget) || contractValue || 0,
        conditions: fastTrackReason.trim(),
        residual_risk_notes: "Mobilized under fast-track governance protocol with outstanding checks conditional.",
      });

      if (res.success) {
        setActionSuccess("Project has been successfully authorized and transitioned to ACTIVE delivery!");
        setIsFastTrackOpen(false);
        if (onStatusUpdated) onStatusUpdated();
        void loadGovernanceData();
      } else {
        throw new Error(res.message || "Failed to authorise mobilisation.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute fast-track mobilisation.");
    } finally {
      setSubmittingFastTrack(false);
    }
  };

  // Deposit confirmation
  const handleConfirmDeposit = async () => {
    const amt = Number(depositAmount);
    if (!amt || amt <= 0) {
      setError("Please enter a valid deposit amount received.");
      return;
    }
    setSubmittingDeposit(true);
    setError(null);
    try {
      const res = await confirmProjectDeposit(projectId, {
        deposit_received_amount: amt,
        deposit_reference: depositRef || "Wire transfer confirmed",
        notes: "Confirmed through Project Controls",
      });
      if (res.success) {
        setActionSuccess("Deposit confirmed! Project moved to Pre-Mobilisation phase.");
        setIsDepositOpen(false);
        if (onStatusUpdated) onStatusUpdated();
        void loadGovernanceData();
      } else {
        throw new Error(res.message || "Deposit confirmation failed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm deposit.");
    } finally {
      setSubmittingDeposit(false);
    }
  };

  const readyChecksCount = useMemo(() => {
    return checks.filter((c) =>
      ["complete", "complete_with_conditions", "not_applicable"].includes(c.status || "")
    ).length;
  }, [checks]);

  const readyPct = checks.length > 0 ? Math.round((readyChecksCount / checks.length) * 100) : 0;
  const isCurrentlyActive = status.toLowerCase() === "active";
  const isPendingDeposit = status.toLowerCase() === "pending_deposit";

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 text-slate-light font-mono text-sm">
        <Loader2 className="h-5 w-5 animate-spin text-signal" />
        Loading governance and readiness checks...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Fast-Track Bar */}
      <section className="border border-ink-mid bg-gradient-to-r from-ink via-ink-light/20 to-ink p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-wider text-signal flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" />
                Delivery Governance & Mobilisation Control
              </span>
              <span className="border border-ink-mid bg-ink px-2 py-0.5 font-mono text-[10px] text-paper">
                STAGE: {status.toUpperCase()}
              </span>
            </div>
            <h2 className="mt-1 text-xl font-bold font-display text-paper">
              {isCurrentlyActive ? "Project in Active Delivery" : "Mobilisation Readiness Gateway"}
            </h2>
            <p className="mt-1 text-xs text-slate-light max-w-2xl">
              Track statutory, commercial, and operational readiness items. Authorized project managers can utilize
              Fast-Track Mobilisation to begin site execution without bureaucratic stalls.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isPendingDeposit && (
              <button
                type="button"
                onClick={() => setIsDepositOpen(true)}
                className="inline-flex items-center gap-1.5 border border-sky-500/50 bg-sky-950/30 px-3.5 py-2 font-mono text-xs text-sky-300 hover:bg-sky-500 hover:text-ink transition-colors"
              >
                <DollarSign className="h-4 w-4" />
                <span>Confirm Deposit</span>
              </button>
            )}

            {!isCurrentlyActive && (
              <button
                type="button"
                onClick={() => setIsFastTrackOpen(true)}
                className="inline-flex items-center gap-1.5 border border-signal bg-signal px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 transition-colors shadow-lg"
              >
                <Sparkles className="h-4 w-4" />
                <span>Fast-Track to Active</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Action / Error Banner */}
      {actionSuccess && (
        <div className="flex items-center gap-2 border border-emerald-500/40 bg-emerald-950/20 p-3 text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 border border-red-500/40 bg-red-950/20 p-3 text-xs text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Readiness Progress Meter */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Readiness Score</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-signal">{readyPct}%</span>
            <span className="text-xs text-slate-light">({readyChecksCount} of {checks.length} ready)</span>
          </div>
          <div className="mt-2 h-1.5 w-full bg-ink-light rounded-full overflow-hidden">
            <div className="h-full bg-signal transition-all" style={{ width: `${readyPct}%` }} />
          </div>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Commercial Authority</span>
          <p className="mt-1 font-mono text-lg font-bold text-paper">
            {commercial?.authority_status ? commercial.authority_status.replace(/_/g, " ").toUpperCase() : "VERIFIED"}
          </p>
          <span className="text-[11px] text-slate-light">
            Status: {commercial?.status ? commercial.status.toUpperCase() : "READY"}
          </span>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Mobilisation Budget</span>
          <p className="mt-1 font-mono text-lg font-bold text-emerald-400">
            {contractValue > 0 ? formatCurrency(contractValue) : "Available"}
          </p>
          <span className="text-[11px] text-slate-light">Initial operational ceiling</span>
        </div>
      </section>

      {/* Interactive Pre-Mobilisation Checklist */}
      <section className="border border-ink-mid bg-ink">
        <div className="border-b border-ink-mid p-4 flex items-center justify-between">
          <div>
            <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">
              Pre-Mobilisation Gateway Checklist
            </h3>
            <p className="mt-0.5 text-xs text-slate-light">
              Review and toggle mandatory vs conditional operational checks.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-light">
            {readyChecksCount} / {checks.length} Approved
          </span>
        </div>

        <div className="divide-y divide-ink-mid/40">
          {checks.map((chk) => {
            const isDone = ["complete", "complete_with_conditions", "not_applicable"].includes(chk.status || "");
            const isConditional = chk.status === "complete_with_conditions";

            return (
              <div key={chk.id} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between hover:bg-ink-light/20 transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 p-1 rounded-sm border ${
                    isConditional
                      ? "border-amber-500/40 bg-amber-950/20 text-amber-300"
                      : isDone
                      ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-400"
                      : "border-slate-500/40 bg-slate-950/20 text-slate-400"
                  }`}>
                    {isDone ? <Check className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-paper text-sm">{chk.check_name}</span>
                      <span className={`font-mono text-[10px] uppercase px-1.5 py-0.2 rounded-sm border ${
                        isConditional
                          ? "border-amber-500/30 text-amber-300 bg-amber-950/20"
                          : isDone
                          ? "border-emerald-500/30 text-emerald-300 bg-emerald-950/20"
                          : "border-slate-600 text-slate-400 bg-ink-light/50"
                      }`}>
                        {chk.status || "Incomplete"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-light font-mono">
                      Evidence: {chk.evidence_reference || "No documentary evidence attached yet"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 font-mono text-xs">
                  <button
                    type="button"
                    onClick={() => handleToggleCheck(chk, "complete")}
                    className={`px-2.5 py-1 border transition-colors ${
                      chk.status === "complete"
                        ? "border-emerald-500 bg-emerald-500/20 text-emerald-300 font-bold"
                        : "border-ink-mid bg-ink-light text-slate-light hover:text-paper"
                    }`}
                  >
                    Complete
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleCheck(chk, "complete_with_conditions")}
                    className={`px-2.5 py-1 border transition-colors ${
                      chk.status === "complete_with_conditions"
                        ? "border-amber-500 bg-amber-500/20 text-amber-300 font-bold"
                        : "border-ink-mid bg-ink-light text-slate-light hover:text-paper"
                    }`}
                  >
                    Conditional
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleCheck(chk, "not_applicable")}
                    className={`px-2.5 py-1 border transition-colors ${
                      chk.status === "not_applicable"
                        ? "border-slate-400 bg-slate-500/20 text-slate-200 font-bold"
                        : "border-ink-mid bg-ink-light text-slate-light hover:text-paper"
                    }`}
                  >
                    N/A
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Fast-Track Modal */}
      {isFastTrackOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl border border-signal/60 bg-ink p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-signal font-mono text-xs uppercase tracking-wider">
              <Sparkles className="h-4 w-4" />
              <span>Fast-Track Project Mobilisation</span>
            </div>

            <h3 className="font-display text-xl font-bold text-paper">
              Authorize Instant Active Delivery
            </h3>

            <p className="text-xs text-slate-light leading-relaxed">
              This action waives pending administrative checklists under executive discretion, clears commercial readiness,
              and immediately moves the project to <strong className="text-emerald-400">ACTIVE</strong> status so site operations,
              procurement, and labour booking can begin at once.
            </p>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">
                Authorization Rationale / Contract Instruction *
              </label>
              <textarea
                rows={3}
                value={fastTrackReason}
                onChange={(e) => setFastTrackReason(e.target.value)}
                placeholder="e.g. Urgent site mobilization approved per client Letter of Intent #LOI-884, signed contract in circulation..."
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-xs text-paper outline-none focus:border-signal font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">
                Approved Initial Mobilisation Ceiling ($)
              </label>
              <input
                type="number"
                value={fastTrackBudget}
                onChange={(e) => setFastTrackBudget(e.target.value)}
                placeholder="Total ceiling amount"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsFastTrackOpen(false)}
                className="border border-ink-mid px-4 py-2 font-mono text-xs uppercase text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteFastTrack}
                disabled={submittingFastTrack || !fastTrackReason.trim()}
                className="inline-flex items-center gap-2 border border-signal bg-signal px-5 py-2 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 disabled:opacity-50"
              >
                {submittingFastTrack ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                <span>Authorize & Mobilise</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Confirmation Modal */}
      {isDepositOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md border border-sky-500/50 bg-ink p-6 shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-bold text-paper">
              Confirm Received Project Deposit
            </h3>
            <p className="text-xs text-slate-light">
              Record verified bank wire or cash payment to advance from Pending Deposit.
            </p>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Deposit Amount ($) *</label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Amount in USD"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Deposit Reference / Bank Code</label>
              <input
                value={depositRef}
                onChange={(e) => setDepositRef(e.target.value)}
                placeholder="e.g. TT-94021 / CBZ Bank Deposit"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-xs text-paper outline-none focus:border-signal font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsDepositOpen(false)}
                className="border border-ink-mid px-4 py-2 font-mono text-xs uppercase text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeposit}
                disabled={submittingDeposit || !depositAmount}
                className="border border-sky-500 bg-sky-500 px-4 py-2 font-mono text-xs font-bold uppercase text-ink hover:bg-sky-400 disabled:opacity-50"
              >
                {submittingDeposit ? "Recording..." : "Confirm Deposit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
