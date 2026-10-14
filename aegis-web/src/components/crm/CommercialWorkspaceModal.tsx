"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  X,
  ExternalLink,
  DollarSign,
  TrendingUp,
  FileSpreadsheet,
  FileText,
  Activity,
  Layers,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Clock,
  Phone,
  MessageSquare,
  Mail,
  Users,
  Calendar,
  Lock,
  Loader2,
  ChevronRight,
  Eye,
  Download,
  Printer,
  ShieldAlert,
  ArrowRight,
  Sparkles,
  Award,
  Ban,
  Check,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { DealDocumentsPanel } from "@/components/crm/DealDocumentsPanel";
import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import {
  updateCrmOpportunity,
  markCrmOpportunityWon,
  markCrmOpportunityLost,
  updateCrmTender,
} from "@/lib/api/crm";
import { createCrmActivity, getCrmActivities } from "@/lib/api";

export type CommercialEntityKind = "opportunity" | "tender";

export interface CommercialEntityData {
  id: string;
  kind?: CommercialEntityKind;
  name: string;
  stage: string;
  budget?: number;
  deal_value?: number;
  probability?: number;
  expected_margin?: number;
  risk_level?: string;
  client_name?: string;
  organization_name?: string;
  sales_owner_id?: string;
  sales_owner_name?: string;
  expected_close_date?: string;
  next_activity_due_at?: string;
  quote_id?: string;
  quote_status?: string;
  quote_amount?: number;
  project_id?: string;
  project_name?: string;
  is_stale?: boolean;
  approval_status?: string;
  originating_department_id?: string;
  region?: string;
  // Tender-specific
  bid_number?: string;
  submission_deadline?: string;
  submission_method?: string;
  bid_bond_required?: boolean;
  bid_bond_amount?: number;
}

export interface CommercialWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  entity: CommercialEntityData | null;
  kind: CommercialEntityKind;
  onEntityUpdated?: (updated: CommercialEntityData) => void;
}

export function CommercialWorkspaceModal({
  isOpen,
  onClose,
  entity,
  kind,
  onEntityUpdated,
}: CommercialWorkspaceModalProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "boq" | "documents" | "activity" | "tender" | "readiness">("overview");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Editable Form fields
  const [dealValue, setDealValue] = useState<number>(0);
  const [probability, setProbability] = useState<number>(50);
  const [riskLevel, setRiskLevel] = useState<string>("Medium");
  const [expectedCloseDate, setExpectedCloseDate] = useState<string>("");
  const [nextActivityDate, setNextActivityDate] = useState<string>("");
  const [stage, setStage] = useState<string>("");

  // Touchpoint logger state
  const [touchpointType, setTouchpointType] = useState<"call" | "whatsapp" | "email" | "meeting">("call");
  const [touchpointNotes, setTouchpointNotes] = useState<string>("");
  const [touchpointLogging, setTouchpointLogging] = useState<boolean>(false);
  const [activityTimeline, setActivityTimeline] = useState<any[]>([]);
  const [loadingActivities, setLoadingActivities] = useState<boolean>(false);
  const [timelineFilter, setTimelineFilter] = useState<"all" | "touchpoints" | "system">("all");

  // Win / Loss modal controls inside workspace
  const [isWinModalOpen, setIsWinModalOpen] = useState(false);
  const [isLostModalOpen, setIsLostModalOpen] = useState(false);
  const [winLossNotes, setWinLossNotes] = useState("");
  const [lossReason, setLossReason] = useState("");

  // Initialize form state from entity
  useEffect(() => {
    if (entity) {
      setDealValue(Number(entity.deal_value || entity.budget || 0));
      setProbability(Number(entity.probability || 50));
      setRiskLevel(entity.risk_level || "Medium");
      setExpectedCloseDate(entity.expected_close_date ? entity.expected_close_date.slice(0, 10) : "");
      setNextActivityDate(entity.next_activity_due_at ? entity.next_activity_due_at.slice(0, 10) : "");
      setStage(entity.stage || "Qualification");
      setFeedback(null);
    }
  }, [entity]);

  // Load activities
  const loadActivities = useCallback(async () => {
    if (!entity?.id) return;
    setLoadingActivities(true);
    try {
      const res = await getCrmActivities();
      if (res.success && Array.isArray(res.data)) {
        const relevant = res.data.filter(
          (a: any) =>
            (kind === "opportunity" && a.opportunity_id === entity.id) ||
            (kind === "tender" && (a.tender_id === entity.id || a.opportunity_id === entity.id))
        );
        setActivityTimeline(relevant);
      }
    } catch (e) {
      console.warn("Failed to load activity timeline", e);
    } finally {
      setLoadingActivities(false);
    }
  }, [entity?.id, kind]);

  useEffect(() => {
    if (isOpen && entity?.id) {
      void loadActivities();
    }
  }, [isOpen, entity?.id, loadActivities]);

  // Handle ESC key press and body overflow lock
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen || !entity) return null;

  const isTender = kind === "tender";
  const canonicalUrl = isTender
    ? `/dashboard/crm/tenders/${entity.id}`
    : `/dashboard/crm/opportunities/${entity.id}`;

  const isWon = stage === "Contract" || stage === "Won" || stage === "Awarded";
  const isLost = stage === "Lost";
  const isLocked = isWon || isLost;

  // Save commercial overview updates
  const handleSaveOverview = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      if (isTender) {
        const payload: Record<string, any> = {
          bid_amount: dealValue,
          stage,
        };
        await updateCrmTender(entity.id, payload);
      } else {
        const payload: Record<string, any> = {
          deal_value: dealValue,
          probability,
          risk_level: riskLevel,
          expected_close_date: expectedCloseDate || null,
          next_activity_due_at: nextActivityDate ? `${nextActivityDate}T12:00:00Z` : null,
          stage,
        };
        await updateCrmOpportunity(entity.id, payload);
      }

      setFeedback({ type: "success", message: "Commercial details saved successfully." });
      if (onEntityUpdated) {
        onEntityUpdated({
          ...entity,
          deal_value: dealValue,
          budget: dealValue,
          probability,
          risk_level: riskLevel,
          stage,
          expected_close_date: expectedCloseDate,
          next_activity_due_at: nextActivityDate,
        });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Failed to update record." });
    } finally {
      setSaving(false);
    }
  };

  // Fast touchpoint logger
  const handleLogTouchpoint = async () => {
    if (!touchpointNotes.trim()) return;
    setTouchpointLogging(true);
    try {
      const typeLabel =
        touchpointType === "call" ? "Phone Call" :
        touchpointType === "whatsapp" ? "WhatsApp Message" :
        touchpointType === "email" ? "Email Correspondence" : "In-Person Meeting";

      await createCrmActivity({
        opportunity_id: isTender ? undefined : entity.id,
        type: touchpointType === "meeting" ? "meeting" : "communication",
        subject: `${typeLabel} touchpoint logged`,
        description: touchpointNotes.trim(),
        status: "completed",
        activity_date: new Date().toISOString(),
      });

      setTouchpointNotes("");
      setFeedback({ type: "success", message: `${typeLabel} logged to activity timeline.` });
      await loadActivities();
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to log touchpoint." });
    } finally {
      setTouchpointLogging(false);
    }
  };

  // Mark Won
  const handleConfirmWin = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await markCrmOpportunityWon(entity.id, {
        win_notes: winLossNotes.trim() || "Commercial negotiation concluded and contract green-lit.",
      });
      setIsWinModalOpen(false);
      setStage("Contract");
      setFeedback({ type: "success", message: "Deal marked as WON! Project handoff initiated." });
      if (onEntityUpdated) {
        onEntityUpdated({ ...entity, stage: "Contract" });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to mark deal as won." });
    } finally {
      setSaving(false);
    }
  };

  // Mark Lost
  const handleConfirmLost = async () => {
    if (!lossReason.trim()) {
      setFeedback({ type: "error", message: "Please specify a reason for marking this deal lost." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await markCrmOpportunityLost(entity.id, {
        win_loss_reason: lossReason.trim(),
      });
      setIsLostModalOpen(false);
      setStage("Lost");
      setFeedback({ type: "success", message: "Deal marked as LOST and archived." });
      if (onEntityUpdated) {
        onEntityUpdated({ ...entity, stage: "Lost" });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to mark deal as lost." });
    } finally {
      setSaving(false);
    }
  };

  // Filtered activity timeline
  const filteredActivities = useMemo(() => {
    if (timelineFilter === "touchpoints") {
      return activityTimeline.filter((a) => a.activity_type === "communication" || a.activity_type === "meeting");
    }
    if (timelineFilter === "system") {
      return activityTimeline.filter((a) => a.activity_type !== "communication" && a.activity_type !== "meeting");
    }
    return activityTimeline;
  }, [activityTimeline, timelineFilter]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4 md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entity.name}
        className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden border border-white/10 bg-[#0C0C0C] shadow-2xl outline-none sm:h-[90vh] sm:rounded-lg"
      >
        {/* ======================================================================
            1. TOP HEADER & CONSOLE CONTROLS (ALWAYS VISIBLE, NEVER CLIPPED)
        ====================================================================== */}
        <header className="shrink-0 border-b border-white/10 bg-[#111111] px-5 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm border border-signal/40 bg-signal/10 text-signal">
                  {isTender ? "TENDER & BID CONSOLE" : "OPPORTUNITY CONSOLE"}
                </span>
                <span
                  className={`font-mono text-[9px] font-semibold uppercase px-2 py-0.5 rounded-sm border ${
                    isWon
                      ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                      : isLost
                      ? "border-red-500/40 bg-red-950/40 text-red-300"
                      : "border-amber-500/40 bg-amber-950/40 text-amber-300"
                  }`}
                >
                  Stage: {stage}
                </span>
                <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded-sm border border-white/10 text-slate-light">
                  Risk: {riskLevel}
                </span>
              </div>
              <h1 className="mt-1 font-display text-lg font-bold text-paper truncate max-w-2xl sm:text-xl">
                {entity.name}
              </h1>
              <p className="mt-0.5 text-xs text-slate-light truncate">
                Client: <strong className="text-paper font-normal">{entity.organization_name || entity.client_name || "Unassigned Client"}</strong>
                {entity.region ? ` · Location: ${entity.region}` : ""}
                {entity.sales_owner_name ? ` · Lead Rep: ${entity.sales_owner_name}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Link
                href={canonicalUrl}
                target="_blank"
                className="hidden sm:inline-flex items-center gap-1.5 border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-xs text-slate-light hover:text-paper hover:bg-white/10 transition-colors rounded-sm"
                title="Open in dedicated full page"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Full Page</span>
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="flex items-center justify-center h-8 w-8 rounded-full border border-white/10 bg-white/5 text-slate-light hover:text-paper hover:bg-white/15 transition-colors"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ======================================================================
              2. HIGH-LEVEL FINANCIAL STRIP
          ====================================================================== */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 border-t border-white/5 pt-3">
            <div className="border border-white/5 bg-black/40 p-2 rounded-sm">
              <span className="font-mono text-[8px] uppercase tracking-wider text-slate-light block">Quoted Revenue</span>
              <span className="font-mono text-sm font-bold text-signal">
                {formatCurrency(dealValue)}
              </span>
            </div>
            <div className="border border-white/5 bg-black/40 p-2 rounded-sm">
              <span className="font-mono text-[8px] uppercase tracking-wider text-slate-light block">Execution Cost</span>
              <span className="font-mono text-sm font-semibold text-paper">
                {entity.quote_amount ? formatCurrency(entity.quote_amount) : formatCurrency(dealValue * 0.78)}
              </span>
            </div>
            <div className="border border-white/5 bg-black/40 p-2 rounded-sm">
              <span className="font-mono text-[8px] uppercase tracking-wider text-slate-light block">Expected Margin</span>
              <span className="font-mono text-sm font-semibold text-emerald-400">
                {entity.expected_margin || 18.5}%
              </span>
            </div>
            <div className="border border-white/5 bg-black/40 p-2 rounded-sm">
              <span className="font-mono text-[8px] uppercase tracking-wider text-slate-light block">Quotation State</span>
              <span className="font-mono text-xs font-semibold text-paper truncate block mt-0.5">
                {entity.quote_status || (entity.quote_id ? "Linked" : "No Quote")}
              </span>
            </div>
            <div className="border border-white/5 bg-black/40 p-2 rounded-sm">
              <span className="font-mono text-[8px] uppercase tracking-wider text-slate-light block">Project Handoff</span>
              <span className="font-mono text-xs font-semibold text-paper truncate block mt-0.5">
                {entity.project_name || (entity.project_id ? "Linked" : "Pending")}
              </span>
            </div>
            <div className="border border-white/5 bg-black/40 p-2 rounded-sm">
              <span className="font-mono text-[8px] uppercase tracking-wider text-slate-light block">Next Required Action</span>
              <span className="font-mono text-xs font-semibold text-amber-300 truncate block mt-0.5">
                {entity.next_activity_due_at ? new Date(entity.next_activity_due_at).toLocaleDateString() : "Due: Set Date"}
              </span>
            </div>
          </div>

          {/* ======================================================================
              3. TABS BAR
          ====================================================================== */}
          <nav className="mt-3 flex items-center gap-1 border-t border-white/5 pt-2 overflow-x-auto custom-scrollbar">
            <button
              onClick={() => setActiveTab("overview")}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors rounded-sm ${
                activeTab === "overview"
                  ? "bg-signal text-ink font-semibold"
                  : "text-slate-light hover:text-paper hover:bg-white/5"
              }`}
            >
              <DollarSign className="h-3.5 w-3.5" />
              <span>Commercial Overview</span>
            </button>
            <button
              onClick={() => setActiveTab("boq")}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors rounded-sm ${
                activeTab === "boq"
                  ? "bg-signal text-ink font-semibold"
                  : "text-slate-light hover:text-paper hover:bg-white/5"
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>BOQ &amp; Estimation</span>
            </button>
            <button
              onClick={() => setActiveTab("documents")}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors rounded-sm ${
                activeTab === "documents"
                  ? "bg-signal text-ink font-semibold"
                  : "text-slate-light hover:text-paper hover:bg-white/5"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Quotation &amp; Files</span>
            </button>
            <button
              onClick={() => setActiveTab("activity")}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors rounded-sm ${
                activeTab === "activity"
                  ? "bg-signal text-ink font-semibold"
                  : "text-slate-light hover:text-paper hover:bg-white/5"
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>Activity &amp; Logs</span>
            </button>
            {isTender && (
              <button
                onClick={() => setActiveTab("tender")}
                className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors rounded-sm ${
                  activeTab === "tender"
                    ? "bg-signal text-ink font-semibold"
                    : "text-slate-light hover:text-paper hover:bg-white/5"
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Tender Compliance</span>
              </button>
            )}
            <button
              onClick={() => setActiveTab("readiness")}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors rounded-sm ${
                activeTab === "readiness"
                  ? "bg-signal text-ink font-semibold"
                  : "text-slate-light hover:text-paper hover:bg-white/5"
              }`}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>Project Readiness</span>
            </button>
          </nav>
        </header>

        {/* ======================================================================
            4. FEEDBACK ALERT BANNER
        ====================================================================== */}
        {feedback && (
          <div
            className={`px-5 py-2.5 text-xs font-mono flex items-center justify-between border-b ${
              feedback.type === "success"
                ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                : "border-red-500/40 bg-red-950/40 text-red-300"
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              )}
              <span>{feedback.message}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="text-slate-light hover:text-paper text-[10px] uppercase font-mono tracking-wider"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ======================================================================
            5. SCROLLABLE TAB CONTENT BODY
        ====================================================================== */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar bg-[#0A0A0A]">
          {/* TAB 1: COMMERCIAL OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-6 max-w-4xl">
              <section className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-slate-light block">
                    Agreed Contract / Selling Price ($)
                  </label>
                  <input
                    type="number"
                    value={dealValue}
                    onChange={(e) => setDealValue(parseFloat(e.target.value) || 0)}
                    disabled={isLocked}
                    className="w-full border border-white/10 bg-black/60 px-3 py-2 font-mono text-sm text-paper focus:border-signal focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-slate-light block">
                    Sales Pipeline Stage
                  </label>
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                    disabled={isLocked}
                    className="w-full border border-white/10 bg-black/60 px-3 py-2 font-mono text-sm text-paper focus:border-signal focus:outline-none"
                  >
                    <option value="Qualification">Qualification</option>
                    <option value="Site Visit">Site Visit</option>
                    <option value="Quotation">Proposal / Quotation</option>
                    <option value="Negotiation">Negotiation</option>
                    <option value="Contract">Contract (Won)</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-slate-light block">
                    Win Probability (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={probability}
                    onChange={(e) => setProbability(parseInt(e.target.value) || 0)}
                    disabled={isLocked}
                    className="w-full border border-white/10 bg-black/60 px-3 py-2 font-mono text-sm text-paper focus:border-signal focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-slate-light block">
                    Commercial Risk Rating
                  </label>
                  <select
                    value={riskLevel}
                    onChange={(e) => setRiskLevel(e.target.value)}
                    className="w-full border border-white/10 bg-black/60 px-3 py-2 font-mono text-sm text-paper focus:border-signal focus:outline-none"
                  >
                    <option value="Low">Low Risk</option>
                    <option value="Medium">Medium Risk</option>
                    <option value="High">High Risk</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-slate-light block">
                    Expected Close Date
                  </label>
                  <input
                    type="date"
                    value={expectedCloseDate}
                    onChange={(e) => setExpectedCloseDate(e.target.value)}
                    className="w-full border border-white/10 bg-black/60 px-3 py-2 font-mono text-sm text-paper focus:border-signal focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-slate-light block">
                    Next Required Action Deadline
                  </label>
                  <input
                    type="date"
                    value={nextActivityDate}
                    onChange={(e) => setNextActivityDate(e.target.value)}
                    className="w-full border border-white/10 bg-black/60 px-3 py-2 font-mono text-sm text-paper focus:border-signal focus:outline-none"
                  />
                </div>
              </section>

              {/* Fast Action Buttons Bar */}
              <section className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveOverview}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 bg-signal px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-ink hover:bg-signal/90 transition-colors disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    <span>Save Changes</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("boq")}
                    className="inline-flex items-center gap-1.5 border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-slate-light hover:text-paper hover:bg-white/10 transition-colors"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 text-signal" />
                    <span>Upload BOQ (.xlsx)</span>
                  </button>
                </div>

                {!isLocked && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsWinModalOpen(true)}
                      className="inline-flex items-center gap-1.5 border border-emerald-500/50 bg-emerald-950/40 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-emerald-300 hover:bg-emerald-900/50 transition-colors"
                    >
                      <Award className="h-3.5 w-3.5" />
                      <span>Mark Deal Won</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsLostModalOpen(true)}
                      className="inline-flex items-center gap-1.5 border border-red-500/50 bg-red-950/40 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-red-300 hover:bg-red-900/50 transition-colors"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      <span>Mark Lost</span>
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB 2: BOQ & ESTIMATION */}
          {activeTab === "boq" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div>
                  <h3 className="font-sans text-sm font-bold uppercase tracking-wider text-paper">
                    Authoritative BOQ Integration
                  </h3>
                  <p className="text-xs text-slate-light mt-0.5">
                    Upload an authoritative Excel Bill of Quantities. Sections, items, and unit rates will be parsed directly into Quotations &amp; Estimations.
                  </p>
                </div>
                {entity.quote_id && (
                  <Link
                    href={`/dashboard/quotations/builder?id=${entity.quote_id}`}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 border border-signal/50 bg-signal/10 px-3 py-1.5 font-mono text-xs text-signal hover:bg-signal hover:text-ink transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Open in Quotations Editor</span>
                  </Link>
                )}
              </div>

              {/* Deal Documents Panel with BOQ Uploader */}
              {!isTender ? (
                <DealDocumentsPanel
                  opportunityId={entity.id}
                  dealValue={dealValue}
                  dealClosed={isLocked}
                  onDealChanged={onEntityUpdated ? () => onEntityUpdated(entity) : undefined}
                />
              ) : (
                <EntityDocumentsPanel
                  entityType="tender"
                  entityId={entity.id}
                />
              )}
            </div>
          )}

          {/* TAB 3: QUOTATION & DOCUMENTS */}
          {activeTab === "documents" && (
            <div className="space-y-5">
              <div className="border-b border-white/5 pb-3">
                <h3 className="font-sans text-sm font-bold uppercase tracking-wider text-paper">
                  Commercial Documents &amp; Quotation PDF Viewer
                </h3>
                <p className="text-xs text-slate-light mt-0.5">
                  View uploaded PDF quotations, contract awards, client RFQs, drawings, and correspondence.
                </p>
              </div>

              {/* PDF Preview Notice */}
              {entity.quote_id && (
                <div className="border border-white/10 bg-black/60 p-4 rounded-sm flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-signal shrink-0" />
                    <div>
                      <p className="font-sans text-sm font-bold text-paper">
                        Formal Client Quotation Document
                      </p>
                      <p className="font-mono text-xs text-slate-light">
                        Quotation ID: {entity.quote_id} · Value: {formatCurrency(dealValue)}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/quotations/builder?id=${entity.quote_id}`}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 border border-signal bg-signal/15 px-3.5 py-1.5 font-mono text-xs text-signal hover:bg-signal hover:text-ink transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>View / Export PDF</span>
                  </Link>
                </div>
              )}

              {/* Attached Documents Register */}
              <EntityDocumentsPanel
                entityType={isTender ? "tender" : "opportunity"}
                entityId={entity.id}
              />
            </div>
          )}

          {/* TAB 4: ACTIVITY LOG & FAST TOUCHPOINTS */}
          {activeTab === "activity" && (
            <div className="space-y-6 max-w-4xl">
              {/* Quick Touchpoint Bar */}
              <section className="border border-white/10 bg-[#111111] p-4 rounded-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-signal">
                    Fast Touchpoint Logger
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setTouchpointType("call")}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 font-mono text-xs rounded-sm transition-colors ${
                        touchpointType === "call" ? "bg-signal text-ink font-semibold" : "border border-white/10 text-slate-light hover:text-paper"
                      }`}
                    >
                      <Phone className="h-3 w-3" />
                      <span>Call</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTouchpointType("whatsapp")}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 font-mono text-xs rounded-sm transition-colors ${
                        touchpointType === "whatsapp" ? "bg-signal text-ink font-semibold" : "border border-white/10 text-slate-light hover:text-paper"
                      }`}
                    >
                      <MessageSquare className="h-3 w-3" />
                      <span>WhatsApp</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTouchpointType("email")}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 font-mono text-xs rounded-sm transition-colors ${
                        touchpointType === "email" ? "bg-signal text-ink font-semibold" : "border border-white/10 text-slate-light hover:text-paper"
                      }`}
                    >
                      <Mail className="h-3 w-3" />
                      <span>Email</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTouchpointType("meeting")}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 font-mono text-xs rounded-sm transition-colors ${
                        touchpointType === "meeting" ? "bg-signal text-ink font-semibold" : "border border-white/10 text-slate-light hover:text-paper"
                      }`}
                    >
                      <Users className="h-3 w-3" />
                      <span>Meeting</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <textarea
                    rows={2}
                    value={touchpointNotes}
                    onChange={(e) => setTouchpointNotes(e.target.value)}
                    placeholder={`Log notes from this ${touchpointType}... (e.g. Discussed site mobilization, agreed on revised timber specs)`}
                    className="w-full border border-white/10 bg-black/60 p-2.5 font-sans text-xs text-paper focus:border-signal focus:outline-none"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleLogTouchpoint}
                      disabled={touchpointLogging || !touchpointNotes.trim()}
                      className="inline-flex items-center gap-1.5 bg-signal px-3.5 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-ink hover:bg-signal/90 transition-colors disabled:opacity-40"
                    >
                      {touchpointLogging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      <span>Log Touchpoint</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* Timeline Filter */}
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="font-mono text-xs uppercase tracking-wider text-paper font-semibold">
                  Activity Timeline ({filteredActivities.length})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTimelineFilter("all")}
                    className={`font-mono text-[10px] uppercase px-2 py-0.5 rounded-sm ${
                      timelineFilter === "all" ? "bg-white/20 text-paper font-bold" : "text-slate-light hover:text-paper"
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setTimelineFilter("touchpoints")}
                    className={`font-mono text-[10px] uppercase px-2 py-0.5 rounded-sm ${
                      timelineFilter === "touchpoints" ? "bg-white/20 text-paper font-bold" : "text-slate-light hover:text-paper"
                    }`}
                  >
                    Touchpoints
                  </button>
                  <button
                    onClick={() => setTimelineFilter("system")}
                    className={`font-mono text-[10px] uppercase px-2 py-0.5 rounded-sm ${
                      timelineFilter === "system" ? "bg-white/20 text-paper font-bold" : "text-slate-light hover:text-paper"
                    }`}
                  >
                    Audit Events
                  </button>
                </div>
              </div>

              {/* Activities Stream */}
              {loadingActivities ? (
                <div className="flex items-center justify-center py-8 text-slate-light">
                  <Loader2 className="h-5 w-5 animate-spin text-signal" />
                </div>
              ) : filteredActivities.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-light font-mono">
                  No activity logged yet. Use the logger above to record customer touchpoints.
                </p>
              ) : (
                <ol className="space-y-3 border-l border-white/10 pl-4">
                  {filteredActivities.map((act) => (
                    <li key={act.id} className="relative space-y-1">
                      <div className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border border-black bg-signal" />
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-slate-light">
                          {new Date(act.activity_date || act.created_at).toLocaleString()}
                        </span>
                        <span className="font-mono text-[9px] uppercase px-1.5 py-0.2 rounded-sm border border-white/10 text-paper bg-white/5">
                          {act.activity_type}
                        </span>
                      </div>
                      <p className="font-sans text-xs text-paper font-medium">{act.subject}</p>
                      {act.notes && (
                        <p className="font-sans text-xs text-slate-light bg-black/40 border border-white/5 p-2 rounded-sm">
                          {act.notes}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* TAB 5: TENDER EXTENSIONS (FOR TENDERS) */}
          {isTender && activeTab === "tender" && (
            <div className="space-y-6 max-w-4xl">
              <section className="border border-white/10 bg-black/40 p-4 rounded-sm space-y-3">
                <h3 className="font-mono text-xs uppercase tracking-wider text-signal font-bold">
                  Tender Submission Telemetry
                </h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <span className="font-mono text-[9px] uppercase text-slate-light block">Submission Deadline</span>
                    <span className="font-mono text-sm font-bold text-amber-300">
                      {entity.submission_deadline ? new Date(entity.submission_deadline).toLocaleString() : "Unspecified"}
                    </span>
                  </div>
                  <div>
                    <span className="font-mono text-[9px] uppercase text-slate-light block">Submission Method</span>
                    <span className="font-mono text-sm text-paper">
                      {entity.submission_method || "Online Portal / Physical Delivery"}
                    </span>
                  </div>
                  <div>
                    <span className="font-mono text-[9px] uppercase text-slate-light block">Bid Bond Required</span>
                    <span className="font-mono text-sm text-paper">
                      {entity.bid_bond_required ? `Yes (${formatCurrency(entity.bid_bond_amount || 0)})` : "No"}
                    </span>
                  </div>
                </div>
              </section>

              {/* Compliance Checklist */}
              <section className="border border-white/10 bg-black/40 p-4 rounded-sm space-y-3">
                <h3 className="font-mono text-xs uppercase tracking-wider text-paper font-bold">
                  Mandatory Compliance Checklist
                </h3>
                <ul className="space-y-2 text-xs font-mono">
                  <li className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-paper">1. Valid ZIMRA Tax Clearance Certificate (ITF 263)</span>
                    <span className="text-emerald-400 font-bold">VERIFIED</span>
                  </li>
                  <li className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-paper">2. NSSA Compliance Clearance</span>
                    <span className="text-emerald-400 font-bold">VERIFIED</span>
                  </li>
                  <li className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-paper">3. PRAZ / CIFOZ Category A Registration</span>
                    <span className="text-emerald-400 font-bold">ACTIVE</span>
                  </li>
                  <li className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-paper">4. Certified Audited Financial Statements</span>
                    <span className="text-amber-300">ATTACHED</span>
                  </li>
                </ul>
              </section>
            </div>
          )}

          {/* TAB 6: PROJECT READINESS & HANDOVER */}
          {activeTab === "readiness" && (
            <div className="space-y-5 max-w-4xl">
              <div className="border border-white/10 bg-black/60 p-4 rounded-sm">
                <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-signal">
                  Commercial-to-Project Readiness Handoff
                </h3>
                <p className="text-xs text-slate-light mt-1">
                  Once an opportunity is marked Won, commercial baselines lock and execution handoff begins.
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="border border-white/5 bg-black/40 p-3">
                    <span className="font-mono text-[9px] uppercase text-slate-light block">Commercial Readiness</span>
                    <span className="font-mono text-sm font-bold text-emerald-400">
                      {isWon ? "CLEARED & APPROVED" : "PENDING COMMERCIAL WIN"}
                    </span>
                  </div>
                  <div className="border border-white/5 bg-black/40 p-3">
                    <span className="font-mono text-[9px] uppercase text-slate-light block">Execution Project</span>
                    <span className="font-mono text-sm font-bold text-paper">
                      {entity.project_name || "Pending Creation on Win"}
                    </span>
                  </div>
                </div>

                {entity.project_id && (
                  <div className="mt-4 flex justify-end">
                    <Link
                      href={`/dashboard/projects/${entity.project_id}/budget`}
                      target="_blank"
                      className="inline-flex items-center gap-1.5 bg-signal px-3.5 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-ink hover:bg-signal/90 transition-colors"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                      <span>View Project Budget Planner</span>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ======================================================================
            6. MODALS FOR WIN / LOSS CONFIRMATION
        ====================================================================== */}
        {isWinModalOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4">
            <div className="border border-emerald-500/40 bg-[#111111] p-5 max-w-md w-full rounded-sm space-y-4">
              <h3 className="font-display text-base font-bold text-emerald-300 uppercase">
                Confirm Mark Deal as Won
              </h3>
              <p className="text-xs text-slate-light">
                Marking this deal as Won will advance stage to Contract, lock protected profit, and trigger the project readiness gates.
              </p>
              <textarea
                rows={3}
                value={winLossNotes}
                onChange={(e) => setWinLossNotes(e.target.value)}
                placeholder="Enter formal win notes or contract reference..."
                className="w-full border border-white/10 bg-black/60 p-2 font-mono text-xs text-paper focus:border-emerald-500 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsWinModalOpen(false)}
                  className="px-3 py-1.5 border border-white/10 font-mono text-xs text-slate-light hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmWin}
                  disabled={saving}
                  className="px-3 py-1.5 bg-emerald-500 font-mono text-xs font-semibold uppercase text-ink hover:bg-emerald-400"
                >
                  {saving ? "Confirming..." : "Confirm Won"}
                </button>
              </div>
            </div>
          </div>
        )}

        {isLostModalOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4">
            <div className="border border-red-500/40 bg-[#111111] p-5 max-w-md w-full rounded-sm space-y-4">
              <h3 className="font-display text-base font-bold text-red-300 uppercase">
                Confirm Mark Deal as Lost
              </h3>
              <p className="text-xs text-slate-light">
                Please provide the primary reason for marking this deal as lost for pipeline forensics.
              </p>
              <input
                type="text"
                value={lossReason}
                onChange={(e) => setLossReason(e.target.value)}
                placeholder="e.g. Price too high, competitor selected, project shelved"
                className="w-full border border-white/10 bg-black/60 p-2 font-mono text-xs text-paper focus:border-red-500 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsLostModalOpen(false)}
                  className="px-3 py-1.5 border border-white/10 font-mono text-xs text-slate-light hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmLost}
                  disabled={saving || !lossReason.trim()}
                  className="px-3 py-1.5 bg-red-600 font-mono text-xs font-semibold uppercase text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {saving ? "Confirming..." : "Confirm Lost"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
