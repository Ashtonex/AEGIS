"use client";
import { GenerateInvoiceModal } from "@/components/invoices/GenerateInvoiceModal";

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
  Trash2,
  ShieldAlert,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  Award,
  Ban,
  Check,
  Landmark,
  User,
  Copy,
  Plus,
  RefreshCw,
  Upload,
  MapPin,
  ClipboardCheck,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { DealDocumentsPanel } from "@/components/crm/DealDocumentsPanel";
import { TenderReviewPanel } from "@/components/crm/tender-workflow/TenderReviewPanel";
import { AssignmentPanel } from "@/components/documents/AssignmentPanel";
import { useFinanceDepartments } from "@/hooks/useFinanceDepartments";
import { supabase } from "@/lib/supabase";
import {
  updateCrmOpportunity,
  deleteCrmOpportunity,
  markCrmOpportunityWon,
  markCrmOpportunityLost,
  updateCrmTender,
  awardCrmTender,
  closeoutCrmTender,
  deleteCrmTender,
  createCrmActivity,
  getCrmActivities,
  createCrmOpportunityQuotation,
  getCrmWinLossReasons,
  createCrmWinLossReason,
  findDuplicateCrmOpportunities,
  mergeCrmOpportunities,
  getTenderRequirements,
  createTenderRequirement,
  deleteTenderRequirement,
  updateTenderRequirement,
  seedTenderRequirementsFromLibrary,
  matchTenderRequirementCredential,
  getTenderComplianceSummary,
  TenderComplianceSummary,
  getDocuments,
  getDocumentsForEntity,
  createDocument,
  linkDocument,
  deleteDocument,
  getDocumentSignedUrl,
  describeActionError,
  ApiError,
} from "@/lib/api";

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
  client_id?: string;
  client_org_id?: string;
  client_name?: string;
  organization_name?: string;
  contact_email?: string;
  contact_phone?: string;
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
  site_visit_at?: string | null;
  site_visit_mandatory?: boolean;
}

export interface CommercialWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  entity: CommercialEntityData | null;
  kind: CommercialEntityKind;
  onEntityUpdated?: (updated: CommercialEntityData) => void;
}

export interface TenderRequirementItem {
  id: string;
  label: string;
  severity: "MANDATORY" | "HIGH" | "MEDIUM" | "LOW";
  status: "PENDING_VERIFICATION" | "PRESENT" | "MISSING" | "EXPIRED" | "WAIVED";
  credential_id?: string | null;
  valid_through_closing?: boolean | null;
  satisfied_document_id?: string | null;
  notes?: string | null;
}

// ISO timestamp -> value for an <input type="datetime-local"> in the viewer's timezone.
function toLocalDateTimeInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// One next step per line; the tender award/close-out endpoints accept 1-12.
function parseNextSteps(raw: string): string[] {
  return raw.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 12);
}

const TENDER_OPEN_STAGES = ["Tender Identified", "Bid Prep", "Submitted", "Adjudication"];
const OPPORTUNITY_STAGES: { value: string; label: string }[] = [
  { value: "Qualification", label: "Qualification" },
  { value: "Site Visit", label: "Site Visit" },
  { value: "Quotation", label: "Proposal / Quotation" },
  { value: "Negotiation", label: "Negotiation" },
  { value: "Contract", label: "Contract (Won)" },
  { value: "Lost", label: "Lost" },
];

const inputCls =
  "h-10 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-paper [color-scheme:dark] placeholder:text-slate transition-colors focus:border-signal/60 focus:outline-none focus:ring-2 focus:ring-signal/15 disabled:cursor-not-allowed disabled:opacity-50";

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-light">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate">{hint}</span>}
    </label>
  );
}

function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-white/[0.07] bg-white/[0.02] ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-paper">{title}</h3>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function CommercialWorkspaceModal({
  isOpen,
  onClose,
  entity,
  kind,
  onEntityUpdated,
}: CommercialWorkspaceModalProps) {
  const isTender = kind === "tender";
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  // Tenders open on the intake review (documents, site visit, bid bond,
  // review -> QS workflow); opportunities on the commercial overview.
  const [activeTab, setActiveTab] = useState<
    "review" | "overview" | "boq" | "documents" | "compliance" | "assignment" | "activity"
  >(isTender ? "review" : "overview");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Editable Overview Form
  const [dealValue, setDealValue] = useState<number>(0);
  const [probability, setProbability] = useState<number>(50);
  const [riskLevel, setRiskLevel] = useState<string>("Medium");
  const [expectedCloseDate, setExpectedCloseDate] = useState<string>("");
  const [nextActivityDate, setNextActivityDate] = useState<string>("");
  const [stage, setStage] = useState<string>("");
  const [stageNote, setStageNote] = useState<string>("");
  // Tender submission deadline, as a datetime-local value
  const [deadlineLocal, setDeadlineLocal] = useState<string>("");
  // Snapshot of the form as last loaded/saved, for the unsaved-changes indicator
  const [baseline, setBaseline] = useState<string>("");

  // BANT Qualification checklist (for Opportunities)
  const [bantBudget, setBantBudget] = useState(false);
  const [bantAuthority, setBantAuthority] = useState(false);
  const [bantNeed, setBantNeed] = useState(false);
  const [bantTimeline, setBantTimeline] = useState(false);

  // Touchpoint logger state
  const [touchpointType, setTouchpointType] = useState<"call" | "whatsapp" | "email" | "meeting" | "site_visit">("call");
  const [touchpointNotes, setTouchpointNotes] = useState<string>("");
  const [touchpointLogging, setTouchpointLogging] = useState<boolean>(false);
  const [activityTimeline, setActivityTimeline] = useState<any[]>([]);
  const [loadingActivities, setLoadingActivities] = useState<boolean>(false);
  const [timelineFilter, setTimelineFilter] = useState<"all" | "touchpoints" | "system">("all");

  // Win / Loss modal controls
  const [isWinModalOpen, setIsWinModalOpen] = useState(false);
  const [isLostModalOpen, setIsLostModalOpen] = useState(false);
  const [winLossNotes, setWinLossNotes] = useState("");
  const [tenderNextSteps, setTenderNextSteps] = useState("");
  const [winningContractor, setWinningContractor] = useState("");
  const [selectedWinReasonId, setSelectedWinReasonId] = useState("");
  const [selectedLossReasonId, setSelectedLossReasonId] = useState("");
  const [selectedWinDepartmentId, setSelectedWinDepartmentId] = useState("");
  const [selectedWinOriginatingDepartmentId, setSelectedWinOriginatingDepartmentId] = useState("");
  const [winReasonOptions, setWinReasonOptions] = useState<{ id: string; label: string }[]>([]);
  const [lossReasonOptions, setLossReasonOptions] = useState<{ id: string; label: string }[]>([]);
  const { departments } = useFinanceDepartments();

  // Duplicate Opportunities Modal
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);
  const [checkingDups, setCheckingDups] = useState(false);
  const [duplicateOpps, setDuplicateOpps] = useState<any[]>([]);

  // Tender Compliance Requirements & Checklist
  const [requirements, setRequirements] = useState<TenderRequirementItem[]>([]);
  const [loadingRequirements, setLoadingRequirements] = useState(false);
  const [complianceSummary, setComplianceSummary] = useState<TenderComplianceSummary | null>(null);
  const [matchingRequirementId, setMatchingRequirementId] = useState<string | null>(null);
  const [uploadingRequirementId, setUploadingRequirementId] = useState<string | null>(null);
  const [newRequirementLabel, setNewRequirementLabel] = useState("");
  const [isSeedingLibrary, setIsSeedingLibrary] = useState(false);

  // Attached Documents State
  const [entityDocs, setEntityDocs] = useState<any[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [previewDocUrl, setPreviewDocUrl] = useState<string | null>(null);
  const [previewDocName, setPreviewDocName] = useState<string | null>(null);

  // Callers build `entity` inline, so key the form reset on the saved values rather
  // than object identity - otherwise any parent re-render wipes what the user typed.
  const entityKey = entity
    ? JSON.stringify([
        entity.id,
        entity.deal_value,
        entity.budget,
        entity.probability,
        entity.risk_level,
        entity.expected_close_date,
        entity.next_activity_due_at,
        entity.stage,
        entity.submission_deadline,
      ])
    : "";

  // Initialize form state from entity
  useEffect(() => {
    if (entity) {
      const initial = {
        dealValue: Number(entity.deal_value || entity.budget || 0),
        probability: Number(entity.probability || 50),
        riskLevel: entity.risk_level || "Medium",
        expectedCloseDate: entity.expected_close_date ? entity.expected_close_date.slice(0, 10) : "",
        nextActivityDate: entity.next_activity_due_at ? entity.next_activity_due_at.slice(0, 10) : "",
        stage: entity.stage || (isTender ? "Tender Identified" : "Qualification"),
        deadlineLocal: toLocalDateTimeInput(entity.submission_deadline),
      };
      setDealValue(initial.dealValue);
      setProbability(initial.probability);
      setRiskLevel(initial.riskLevel);
      setExpectedCloseDate(initial.expectedCloseDate);
      setNextActivityDate(initial.nextActivityDate);
      setStage(initial.stage);
      setDeadlineLocal(initial.deadlineLocal);
      setStageNote("");
      setBaseline(JSON.stringify(initial));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey, isTender]);

  // A refreshed entity (after a save) keeps the feedback; switching records clears it.
  useEffect(() => {
    setFeedback(null);
    setActiveTab(isTender ? "review" : "overview");
  }, [entity?.id, isTender]);

  // Load activities
  const loadActivities = useCallback(async () => {
    if (!entity?.id) return;
    setLoadingActivities(true);
    try {
      const res = await getCrmActivities();
      if (res.success && Array.isArray(res.data)) {
        const relevant = res.data.filter(
          (a: any) =>
            (!isTender && a.opportunity_id === entity.id) ||
            (isTender && (a.tender_id === entity.id || a.opportunity_id === entity.id))
        );
        setActivityTimeline(relevant);
      }
    } catch (e) {
      console.warn("Failed to load activity timeline", e);
    } finally {
      setLoadingActivities(false);
    }
  }, [entity, isTender]);

  // Load Documents (strictly entity-scoped to prevent leaking global organization documents)
  const loadEntityDocuments = useCallback(async () => {
    if (!entity?.id) {
      setEntityDocs([]);
      return;
    }
    setLoadingDocs(true);
    try {
      const entityType = isTender ? "tender" : "opportunity";
      const res = await getDocumentsForEntity(entityType, entity.id);
      if (res.success && Array.isArray(res.data)) {
        setEntityDocs(res.data);
      } else {
        setEntityDocs([]);
      }
    } catch (e) {
      console.warn("Failed to load entity-scoped documents", e);
      setEntityDocs([]);
    } finally {
      setLoadingDocs(false);
    }
  }, [entity, isTender]);

  // Load Tender Requirements
  const loadTenderRequirementsList = useCallback(async () => {
    if (!isTender || !entity?.id) return;
    setLoadingRequirements(true);
    try {
      const [reqRes, sumRes] = await Promise.allSettled([
        getTenderRequirements(entity.id),
        getTenderComplianceSummary(entity.id),
      ]);
      if (reqRes.status === "fulfilled" && reqRes.value.success && Array.isArray(reqRes.value.data)) {
        setRequirements(reqRes.value.data as TenderRequirementItem[]);
      }
      if (sumRes.status === "fulfilled" && sumRes.value.success) {
        setComplianceSummary(sumRes.value.data as TenderComplianceSummary);
      }
    } catch (e) {
      console.warn("Failed to load tender requirements", e);
    } finally {
      setLoadingRequirements(false);
    }
  }, [entity, isTender]);

  // Load Win/Loss reasons
  useEffect(() => {
    if (!isOpen) return;
    getCrmWinLossReasons("won").then((res) => {
      if (res.success && Array.isArray(res.data)) setWinReasonOptions(res.data);
    }).catch(() => {});
    getCrmWinLossReasons("lost").then((res) => {
      if (res.success && Array.isArray(res.data)) setLossReasonOptions(res.data);
    }).catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && entity?.id) {
      void loadActivities();
      void loadEntityDocuments();
      if (isTender) {
        void loadTenderRequirementsList();
      }
    }
  }, [isOpen, entity?.id, isTender, loadActivities, loadEntityDocuments, loadTenderRequirementsList]);

  // ESC key listener & body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  // Filtered Activity Timeline
  const filteredActivities = useMemo(() => {
    if (timelineFilter === "touchpoints") {
      return activityTimeline.filter((a) => a.activity_type === "communication" || a.activity_type === "meeting");
    }
    if (timelineFilter === "system") {
      return activityTimeline.filter((a) => a.activity_type !== "communication" && a.activity_type !== "meeting");
    }
    return activityTimeline;
  }, [activityTimeline, timelineFilter]);

  if (!isOpen || !entity) return null;

  const canonicalUrl = isTender
    ? `/dashboard/crm/tenders/${entity.id}`
    : `/dashboard/crm/opportunities/${entity.id}`;

  const isWon = stage === "Contract" || stage === "Won" || stage === "Awarded";
  const isLost = stage === "Lost";
  const isLocked = isWon || isLost;

  // Tender site visit countdown calculation
  const siteVisitCountdown = (() => {
    if (!entity.site_visit_at) return null;
    const visitTime = new Date(entity.site_visit_at).getTime();
    const now = Date.now();
    const diff = visitTime - now;
    if (diff <= 0) return { text: "VISIT CONCLUDED / LAPSED", urgency: "critical" };
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days === 0) return { text: `${hours}h until mandatory site visit`, urgency: "critical" };
    if (days <= 2) return { text: `${days}d ${hours}h until mandatory site visit`, urgency: "warning" };
    return { text: `${days}d until site visit`, urgency: "normal" };
  })();

  // Tender deadline countdown
  const deadlineCountdown = (() => {
    if (!entity.submission_deadline) return null;
    const deadline = new Date(entity.submission_deadline).getTime();
    const now = Date.now();
    const diff = deadline - now;
    if (isWon || stage === "Submitted" || stage === "Adjudication") {
      return { text: stage.toUpperCase(), urgency: "submitted" };
    }
    if (diff <= 0) return { text: "DEADLINE LAPSED", urgency: "critical" };
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days === 0) return { text: `${hours}h LEFT TO SUBMIT`, urgency: "critical" };
    if (days <= 3) return { text: `${days}d ${hours}h LEFT`, urgency: "warning" };
    return { text: `${days}d remaining`, urgency: "normal" };
  })();

  const formSnapshot = JSON.stringify({
    dealValue,
    probability,
    riskLevel,
    expectedCloseDate,
    nextActivityDate,
    stage,
    deadlineLocal,
  });
  const savedForm: { stage?: string; deadlineLocal?: string } = baseline ? JSON.parse(baseline) : {};
  const stageChanged = !!savedForm.stage && stage !== savedForm.stage;
  const isDirty = formSnapshot !== baseline || stageNote.trim() !== "";

  // Save commercial overview updates
  const handleSaveOverview = async () => {
    if (stageChanged && !stageNote.trim()) {
      setFeedback({ type: "error", message: "Add a stage change note before moving this record to a new stage." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      if (isTender) {
        const payload: Record<string, any> = {
          bid_amount: dealValue,
          stage,
          ...(stageNote.trim() ? { stage_note: stageNote.trim() } : {}),
          ...(deadlineLocal !== savedForm.deadlineLocal
            ? { submission_deadline: deadlineLocal ? new Date(deadlineLocal).toISOString() : null }
            : {}),
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
          ...(stageNote.trim() ? { stage_note: stageNote.trim() } : {}),
        };
        await updateCrmOpportunity(entity.id, payload);
      }

      setFeedback({ type: "success", message: "Changes saved." });
      setStageNote("");
      setBaseline(formSnapshot);
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
          ...(isTender
            ? { submission_deadline: deadlineLocal ? new Date(deadlineLocal).toISOString() : undefined }
            : {}),
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
        touchpointType === "email" ? "Email Correspondence" :
        touchpointType === "site_visit" ? "Site Inspection" : "In-Person Meeting";

      await createCrmActivity({
        opportunity_id: isTender ? undefined : entity.id,
        type: touchpointType === "meeting" || touchpointType === "site_visit" ? "meeting" : "communication",
        subject: `${typeLabel} logged on ${entity.name}`,
        description: touchpointNotes.trim(),
        status: "completed",
        activity_date: new Date().toISOString(),
      });

      setTouchpointNotes("");
      setFeedback({ type: "success", message: `${typeLabel} recorded to timeline.` });
      await loadActivities();
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to log touchpoint." });
    } finally {
      setTouchpointLogging(false);
    }
  };

  // Create Quote Action
  const handleCreateQuotation = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const response = await createCrmOpportunityQuotation(entity.id, {
        quote_amount: dealValue || Number(entity.budget || 0),
        status: "draft",
        stage_note: "Quotation created from Commercial Console",
      });
      const quoteId = response?.data?.id;
      setFeedback({ type: "success", message: `Quotation created and linked: ${quoteId || "Active"}` });
      if (onEntityUpdated) {
        onEntityUpdated({ ...entity, quote_id: quoteId, quote_status: "draft" });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to create quote." });
    } finally {
      setSaving(false);
    }
  };

  // Confirm Deal Win
  const openOutcomeDialog = (outcome: "won" | "lost") => {
    setFeedback(null);
    setWinLossNotes("");
    setWinningContractor("");
    setTenderNextSteps(
      outcome === "lost" && isTender
        ? "Find out who won the tender\nApproach the winning contractor for subcontract or supply work\nRecord lessons learned and update the next bid strategy"
        : ""
    );
    if (outcome === "won") setIsWinModalOpen(true);
    else setIsLostModalOpen(true);
  };

  const handleConfirmWin = async () => {
    if (isTender) {
      const nextSteps = parseNextSteps(tenderNextSteps);
      if (winLossNotes.trim().length < 3 || nextSteps.length === 0) {
        setFeedback({ type: "error", message: "Record why this tender was won and at least one next step." });
        return;
      }
      setSaving(true);
      setFeedback(null);
      try {
        const result = await awardCrmTender(entity.id, {
          create_project: true,
          department_id: selectedWinDepartmentId || undefined,
          originating_department_id: selectedWinOriginatingDepartmentId || undefined,
          closeout_reason: winLossNotes.trim(),
          next_steps: nextSteps,
        });
        setIsWinModalOpen(false);
        setStage("Awarded");
        const budgetPendingReason = result?.data?.budget_pending_reason;
        setFeedback({
          type: "success",
          message: budgetPendingReason
            ? `Tender awarded and project created. Budget not yet seeded: ${budgetPendingReason}`
            : "Tender awarded and project created.",
        });
        onEntityUpdated?.({ ...entity, stage: "Awarded" });
      } catch (e: any) {
        setFeedback({
          type: "error",
          message: describeActionError(
            e,
            "You don't have permission to award this tender - awarding creates a real project commitment, so it needs sign-off from a manager or exec.",
            "Tender was not awarded. Check the CRM service connection and retry."
          ),
        });
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      let reasonId = selectedWinReasonId || undefined;
      if (!reasonId && winLossNotes.trim()) {
        const created = await createCrmWinLossReason({ reason_type: "won", label: winLossNotes.trim() });
        if (created.success) reasonId = created.data?.id;
      }

      await markCrmOpportunityWon(entity.id, {
        create_project: true,
        win_loss_reason: winLossNotes.trim() || undefined,
        win_loss_reason_id: reasonId,
        department_id: selectedWinDepartmentId || undefined,
        originating_department_id: selectedWinOriginatingDepartmentId || undefined,
      });

      setIsWinModalOpen(false);
      setStage("Contract");
      setFeedback({ type: "success", message: "Deal marked as WON! Operational project deployment initiated." });
      if (onEntityUpdated) {
        onEntityUpdated({ ...entity, stage: "Contract" });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to mark deal as won." });
    } finally {
      setSaving(false);
    }
  };

  // Confirm Deal Lost
  const handleConfirmLost = async () => {
    if (isTender) {
      const nextSteps = parseNextSteps(tenderNextSteps);
      if (winLossNotes.trim().length < 3 || nextSteps.length === 0) {
        setFeedback({ type: "error", message: "Record why this tender was lost and at least one next step." });
        return;
      }
      setSaving(true);
      setFeedback(null);
      try {
        const res = await closeoutCrmTender(entity.id, {
          status: "lost",
          reason: winLossNotes.trim(),
          next_steps: nextSteps,
          winning_contractor: winningContractor.trim() || undefined,
        });
        if (!res.success) throw new Error(res.message || "Tender close-out did not save.");
        setIsLostModalOpen(false);
        setStage("Lost");
        setFeedback({ type: "success", message: "Tender closed out as lost. Follow-up steps were recorded." });
        onEntityUpdated?.({ ...entity, stage: "Lost" });
      } catch (e: any) {
        setFeedback({
          type: "error",
          message: describeActionError(
            e,
            "You don't have permission to close out this tender.",
            e instanceof ApiError ? e.message : "Tender close-out did not save. Check the CRM service connection and retry."
          ),
        });
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      let reasonId = selectedLossReasonId || undefined;
      if (!reasonId && winLossNotes.trim()) {
        const created = await createCrmWinLossReason({ reason_type: "lost", label: winLossNotes.trim() });
        if (created.success) reasonId = created.data?.id;
      }

      await markCrmOpportunityLost(entity.id, {
        win_loss_reason: winLossNotes.trim() || "Loss confirmed in commercial review",
        win_loss_reason_id: reasonId,
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

  const handleDeleteRecord = async () => {
    const noun = isTender ? "tender" : "deal";
    if (!window.confirm(`Delete the ${noun} "${entity.name}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      if (isTender) await deleteCrmTender(entity.id);
      else await deleteCrmOpportunity(entity.id);
      onClose();
      onEntityUpdated?.({ ...entity, stage: "closed_lost" });
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || `Failed to delete ${noun}.` });
    } finally {
      setSaving(false);
    }
  };

  // Duplicate Check
  const handleCheckDuplicates = async () => {
    setCheckingDups(true);
    try {
      const res = await findDuplicateCrmOpportunities({ name: entity.name });
      if (res.success && Array.isArray(res.data)) {
        setDuplicateOpps(res.data.filter((d: any) => d.id !== entity.id));
        setIsDupModalOpen(true);
      }
    } catch (e) {
      console.warn("Failed to check duplicate opportunities", e);
    } finally {
      setCheckingDups(false);
    }
  };

  const handleMergeDuplicate = async (targetId: string) => {
    setSaving(true);
    try {
      const res = await mergeCrmOpportunities(targetId, [entity.id]);
      if (res.success) {
        setIsDupModalOpen(false);
        setFeedback({ type: "success", message: "Merged into target opportunity." });
        onClose();
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to merge deals." });
    } finally {
      setSaving(false);
    }
  };

  // Document Upload Handler
  const handleUploadDocument = async (file: File) => {
    setUploadingDoc(true);
    try {
      const fileExt = file.name.split(".").pop();
      const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${fileExt ? `.${fileExt}` : ""}`;
      const filePath = `documents/${storedName}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      const created = await createDocument({
        title: file.name,
        category: isTender ? "tender" : "contract",
        tender_id: isTender ? entity.id : undefined,
        opportunity_id: isTender ? undefined : entity.id,
        file_name: file.name,
        file_size_bytes: file.size,
        storage_path: filePath,
        mime_type: file.type || undefined,
      });

      if (created.success && created.data?.id) {
        await linkDocument(created.data.id, {
          entity_type: isTender ? "tender" : "opportunity",
          entity_id: entity.id,
          link_role: "attachment",
        }).catch((err) => {
          console.warn("Document auto-link warning:", err);
        });
      }

      setFeedback({ type: "success", message: `Uploaded ${file.name} to deal registry.` });
      await loadEntityDocuments();
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to upload document." });
    } finally {
      setUploadingDoc(false);
    }
  };

  // Document Download Handler
  const handleDownloadDocument = async (docId: string) => {
    try {
      const res = await getDocumentSignedUrl(docId);
      if (res.success && res.data?.url) {
        window.open(res.data.url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      console.warn("Failed to download document", e);
    }
  };

  // Document Preview Handler
  const handlePreviewDocument = async (doc: any) => {
    try {
      const res = await getDocumentSignedUrl(doc.id);
      if (res.success && res.data?.url) {
        setPreviewDocUrl(res.data.url);
        setPreviewDocName(doc.title || doc.file_name);
      }
    } catch (e) {
      console.warn("Failed to preview document", e);
    }
  };

  // Document Delete Handler
  const handleDeleteDocument = async (docId: string) => {
    if (!window.confirm("Are you sure you want to remove this document from this record?")) return;
    try {
      const res = await deleteDocument(docId);
      if (res.success) {
        setFeedback({ type: "success", message: "Document removed." });
        await loadEntityDocuments();
      } else {
        setFeedback({ type: "error", message: res.message || "Failed to delete document." });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to delete document." });
    }
  };

  // Tender Requirement Actions
  const handleAddTenderRequirement = async () => {
    const label = newRequirementLabel.trim();
    if (!label) return;
    setNewRequirementLabel("");
    try {
      const res = await createTenderRequirement(entity.id, label);
      if (res.success) {
        await loadTenderRequirementsList();
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to add requirement." });
    }
  };

  const handleMatchVaultCredential = async (req: TenderRequirementItem) => {
    setMatchingRequirementId(req.id);
    try {
      const res = await matchTenderRequirementCredential(entity.id, req.id);
      if (res.success) {
        setFeedback({ type: "success", message: `Matched credential from vault for ${req.label}!` });
        await loadTenderRequirementsList();
      } else {
        setFeedback({ type: "error", message: "No matching valid credential found in corporate vault." });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Credential matching failed." });
    } finally {
      setMatchingRequirementId(null);
    }
  };

  const handleUploadRequirementProof = async (req: TenderRequirementItem, file: File) => {
    setUploadingRequirementId(req.id);
    try {
      const fileExt = file.name.split(".").pop();
      const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${fileExt ? `.${fileExt}` : ""}`;
      const filePath = `documents/${storedName}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      const docRes = await createDocument({
        title: `${req.label} - Proof`,
        category: "tender",
        tender_id: entity.id,
        file_name: file.name,
        file_size_bytes: file.size,
        storage_path: filePath,
        mime_type: file.type || undefined,
      });

      const docId = (docRes.data as any)?.id;
      if (docId) {
        await updateTenderRequirement(entity.id, req.id, { satisfied_document_id: docId, status: "PRESENT" });
      }
      await loadTenderRequirementsList();
      await loadEntityDocuments();
      setFeedback({ type: "success", message: `Proof attached for ${req.label}!` });
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to attach requirement proof." });
    } finally {
      setUploadingRequirementId(null);
    }
  };


  const formatDate = (value?: string | null, withTime = false) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return withTime
      ? d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };

  const clientName = entity.organization_name || entity.client_name;
  // The tenders list passes the tender name as the client when no issuing authority is linked.
  const distinctClient = clientName && clientName !== entity.name ? clientName : null;

  const stageTone = isWon
    ? { pill: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", dot: "bg-emerald-400" }
    : isLost
    ? { pill: "border-red-500/30 bg-red-500/10 text-red-300", dot: "bg-red-400" }
    : { pill: "border-amber-500/30 bg-amber-500/10 text-amber-200", dot: "bg-amber-400" };

  const deadlineTone =
    deadlineCountdown?.urgency === "critical"
      ? "text-red-400"
      : deadlineCountdown?.urgency === "warning"
      ? "text-amber-300"
      : deadlineCountdown?.urgency === "submitted"
      ? "text-emerald-300"
      : "text-slate-light";

  const metrics: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean }[] = isTender
    ? [
        { label: "Bid amount", value: formatCurrency(dealValue), accent: true },
        {
          label: "Submission deadline",
          value: formatDate(entity.submission_deadline, true) || "Not set",
          sub: deadlineCountdown && <span className={deadlineTone}>{deadlineCountdown.text}</span>,
        },
        { label: "Quotation", value: entity.quote_status || (entity.quote_id ? "Linked" : "None yet") },
        { label: "Project", value: entity.project_name || (entity.project_id ? "Linked" : "Not handed over") },
      ]
    : [
        { label: "Contract value", value: formatCurrency(dealValue), accent: true },
        { label: "Win probability", value: `${probability}%` },
        ...(entity.expected_margin != null ? [{ label: "Expected margin", value: `${entity.expected_margin}%` }] : []),
        { label: "Quotation", value: entity.quote_status || (entity.quote_id ? "Linked" : "None yet") },
        { label: "Project", value: entity.project_name || (entity.project_id ? "Linked" : "Not handed over") },
        { label: "Next action", value: formatDate(entity.next_activity_due_at) || "Not set" },
      ];

  const tabs: { id: typeof activeTab; label: string; icon: React.ElementType; count?: number }[] = [
    ...(isTender ? [{ id: "review" as const, label: "Review", icon: ClipboardCheck }] : []),
    { id: "overview", label: "Overview", icon: Layers },
    { id: "boq", label: "BOQ & Quotes", icon: FileSpreadsheet },
    { id: "documents", label: "Files", icon: FileText, count: entityDocs.length },
    { id: "compliance", label: isTender ? "Compliance" : "Readiness", icon: ShieldCheck, count: isTender ? requirements.length : undefined },
    { id: "assignment", label: "Team", icon: Users },
    { id: "activity", label: "Activity", icon: Activity, count: activityTimeline.length },
  ];

  const stageOptions: { value: string; label: string }[] = isTender
    ? (TENDER_OPEN_STAGES.includes(stage) ? TENDER_OPEN_STAGES : [...TENDER_OPEN_STAGES, stage]).map((s) => ({ value: s, label: s }))
    : OPPORTUNITY_STAGES.some((s) => s.value === stage)
    ? OPPORTUNITY_STAGES
    : [...OPPORTUNITY_STAGES, { value: stage, label: stage }];

  const detailRows: { label: string; value: React.ReactNode }[] = [
    ...(isTender ? [{ label: "Bid number", value: entity.bid_number || "—" }] : []),
    { label: isTender ? "Issuing authority" : "Client", value: distinctClient || "—" },
    { label: "Region", value: entity.region || "—" },
    { label: "Owner", value: entity.sales_owner_name || "Unassigned" },
    ...(isTender
      ? [
          {
            label: entity.site_visit_mandatory ? "Site visit (mandatory)" : "Site visit",
            value: formatDate(entity.site_visit_at) || "None scheduled",
          },
          {
            label: "Bid bond",
            value: entity.bid_bond_required
              ? entity.bid_bond_amount
                ? formatCurrency(entity.bid_bond_amount)
                : "Required"
              : "Not required",
          },
        ]
      : []),
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/80 backdrop-blur-sm p-2 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entity.name}
        className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden border border-white/10 bg-[#0C0C0C] shadow-2xl outline-none sm:h-[90vh] sm:rounded-xl"
      >
        {/* ======================================================================
            1. HEADER: identity, key figures, tabs
        ====================================================================== */}
        <header className="shrink-0 border-b border-white/10 bg-[#111111]">
          <div className="flex items-start justify-between gap-4 px-6 pt-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-light">
                <span className="text-signal">{isTender ? "Tender" : "Opportunity"}</span>
                {isTender && entity.bid_number && (
                  <>
                    <span className="text-white/20">/</span>
                    <span className="font-mono normal-case tracking-normal">{entity.bid_number}</span>
                  </>
                )}
              </div>
              <h1 className="mt-1 line-clamp-2 font-display text-xl font-bold leading-tight text-paper sm:text-2xl">
                {entity.name}
              </h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-light">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium ${stageTone.pill}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${stageTone.dot}`} />
                  {stage}
                </span>
                {!isTender && (
                  <span className="rounded-full border border-white/10 px-2.5 py-0.5">{riskLevel} risk</span>
                )}
                {entity.is_stale && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-amber-300">Stale</span>
                )}
                {distinctClient && (
                  <span className="inline-flex items-center gap-1.5">
                    <Landmark className="h-3.5 w-3.5 text-slate" />
                    {distinctClient}
                  </span>
                )}
                {entity.region && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-slate" />
                    {entity.region}
                  </span>
                )}
                {entity.sales_owner_name && (
                  <span className="inline-flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-slate" />
                    {entity.sales_owner_name}
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={canonicalUrl}
                target="_blank"
                className="hidden h-9 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-medium text-slate-light transition-colors hover:bg-white/10 hover:text-paper sm:inline-flex"
                title="Open in dedicated full page"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Full page</span>
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-light transition-colors hover:bg-white/10 hover:text-paper"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Key figures */}
          <div className="mx-6 mt-5 overflow-hidden rounded-lg border border-white/[0.07] bg-black/30">
            <dl
              className={`grid grid-cols-2 divide-white/[0.07] max-lg:gap-px max-lg:bg-white/[0.07] lg:divide-x ${
                metrics.length === 4 ? "lg:grid-cols-4" : metrics.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-6"
              }`}
            >
              {metrics.map((m) => (
                <div key={m.label} className="min-w-0 bg-[#0E0E0E] px-4 py-3 lg:bg-transparent">
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-light">{m.label}</dt>
                  <dd
                    className={`mt-1 truncate tabular-nums ${
                      m.accent ? "text-lg font-bold text-signal" : "text-sm font-semibold text-paper"
                    }`}
                  >
                    {m.value}
                  </dd>
                  {m.sub && <dd className="mt-0.5 truncate text-[11px] font-medium">{m.sub}</dd>}
                </div>
              ))}
            </dl>
          </div>

          {isTender && siteVisitCountdown && siteVisitCountdown.urgency !== "normal" && (
            <div
              className={`mx-6 mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs ${
                siteVisitCountdown.urgency === "critical"
                  ? "border-red-500/30 bg-red-500/10 text-red-200"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-200"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" />
                {entity.site_visit_mandatory ? "Mandatory site visit" : "Site visit"}: {formatDate(entity.site_visit_at, true)}
              </span>
              <span className="font-semibold">{siteVisitCountdown.text}</span>
            </div>
          )}

          {/* Tabs */}
          <nav className="mt-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none]" role="tablist">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-3 pb-3 pt-2 text-sm font-medium transition-colors ${
                    active ? "text-paper" : "text-slate-light hover:text-paper"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-signal" : ""}`} />
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${
                        active ? "bg-signal/20 text-signal" : "bg-white/10 text-slate-light"
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                  {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-signal" />}
                </button>
              );
            })}
          </nav>
        </header>

        {/* FEEDBACK BANNER */}
        {feedback && (
          <div
            role="status"
            className={`flex shrink-0 items-center justify-between gap-3 border-b px-6 py-2.5 text-sm ${
              feedback.type === "success"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                : "border-red-500/20 bg-red-500/10 text-red-200"
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
              type="button"
              onClick={() => setFeedback(null)}
              className="rounded p-1 text-current opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* ======================================================================
            2. SCROLLABLE TAB BODY
        ====================================================================== */}
        <div className="custom-scrollbar flex-1 overflow-y-auto bg-[#0A0A0A] px-6 py-6">
          {/* TENDERS: INTAKE REVIEW -> QS WORKFLOW */}
          {activeTab === "review" && isTender && (
            <TenderReviewPanel tenderId={entity.id} onChanged={() => onEntityUpdated?.(entity)} />
          )}

          {/* TAB 1: COMMERCIAL OVERVIEW */}
          {activeTab === "overview" && (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-5">
                <Panel title="Commercial terms">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={isTender ? "Bid amount" : "Contract value"}>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={dealValue}
                          onChange={(e) => setDealValue(parseFloat(e.target.value) || 0)}
                          disabled={isLocked}
                          className={`${inputCls} pl-7 tabular-nums`}
                        />
                      </div>
                    </Field>

                    <Field
                      label="Pipeline stage"
                      hint={isTender && !isLocked ? "Award or close out from the Outcome panel." : undefined}
                    >
                      <select
                        value={stage}
                        onChange={(e) => setStage(e.target.value)}
                        disabled={isLocked}
                        className={inputCls}
                      >
                        {stageOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </Field>

                    {!isTender && (
                      <>
                        <Field label="Win probability">
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={probability}
                              onChange={(e) => setProbability(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                              disabled={isLocked}
                              className={`${inputCls} pr-8 tabular-nums`}
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate">%</span>
                          </div>
                        </Field>
                        <Field label="Risk rating">
                          <select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} className={inputCls}>
                            <option value="Low">Low risk</option>
                            <option value="Medium">Medium risk</option>
                            <option value="High">High risk</option>
                          </select>
                        </Field>
                      </>
                    )}
                  </div>
                </Panel>

                <Panel title="Dates">
                  {isTender ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Submission deadline"
                        hint={deadlineCountdown ? <span className={deadlineTone}>{deadlineCountdown.text}</span> : undefined}
                      >
                        <input
                          type="datetime-local"
                          value={deadlineLocal}
                          onChange={(e) => setDeadlineLocal(e.target.value)}
                          disabled={isLocked}
                          className={inputCls}
                        />
                      </Field>
                      <Field label={entity.site_visit_mandatory ? "Site visit (mandatory)" : "Site visit"}>
                        <div className={`${inputCls} flex items-center text-slate-light`}>
                          {formatDate(entity.site_visit_at, true) || "None scheduled"}
                        </div>
                      </Field>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Expected close date">
                        <input
                          type="date"
                          value={expectedCloseDate}
                          onChange={(e) => setExpectedCloseDate(e.target.value)}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Next action due">
                        <input
                          type="date"
                          value={nextActivityDate}
                          onChange={(e) => setNextActivityDate(e.target.value)}
                          className={inputCls}
                        />
                      </Field>
                    </div>
                  )}
                </Panel>

                <Panel
                  title="Stage change note"
                  aside={
                    stageChanged ? (
                      <span className="text-[11px] font-medium text-amber-300">Required: stage changed</span>
                    ) : (
                      <span className="text-[11px] text-slate">Optional</span>
                    )
                  }
                >
                  <textarea
                    rows={3}
                    value={stageNote}
                    onChange={(e) => setStageNote(e.target.value)}
                    placeholder="Why is this moving stage, or where does the negotiation stand? Saved to the audit trail."
                    className={`${inputCls} h-auto resize-y py-2.5 leading-relaxed ${
                      stageChanged && !stageNote.trim() ? "border-amber-500/50" : ""
                    }`}
                  />
                </Panel>

                {/* BANT Qualification (Opportunities Only) */}
                {!isTender && (
                  <Panel
                    title="BANT qualification"
                    aside={
                      <span className="text-[11px] tabular-nums text-slate-light">
                        {[bantBudget, bantAuthority, bantNeed, bantTimeline].filter(Boolean).length}/4 verified
                      </span>
                    }
                  >
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(
                        [
                          ["Budget confirmed", bantBudget, setBantBudget],
                          ["Authority identified", bantAuthority, setBantAuthority],
                          ["Need established", bantNeed, setBantNeed],
                          ["Timeline defined", bantTimeline, setBantTimeline],
                        ] as const
                      ).map(([label, checked, setChecked]) => (
                        <label
                          key={label}
                          className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2.5 text-xs transition-colors ${
                            checked
                              ? "border-signal/40 bg-signal/10 text-signal"
                              : "border-white/10 bg-black/30 text-slate-light hover:text-paper"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setChecked(e.target.checked)}
                            className="accent-[#C8960C]"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </Panel>
                )}
              </div>

              {/* Sidebar */}
              <aside className="space-y-5">
                <Panel title="Details">
                  <dl className="space-y-2.5 text-sm">
                    {detailRows.map((row) => (
                      <div key={row.label} className="flex items-baseline justify-between gap-3">
                        <dt className="shrink-0 text-xs text-slate-light">{row.label}</dt>
                        <dd className="min-w-0 break-words text-right font-medium text-paper">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {(entity.client_org_id || !isTender) && (
                    <div className="mt-4 grid gap-2 border-t border-white/[0.06] pt-4">
                      {entity.client_org_id && (
                        <Link
                          href={`/dashboard/crm/organizations/${entity.client_org_id}`}
                          target="_blank"
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/5 text-xs font-medium text-paper transition-colors hover:bg-white/10"
                        >
                          <ExternalLink className="h-3.5 w-3.5 text-signal" />
                          Customer 360
                        </Link>
                      )}
                      {!isTender && (
                        <button
                          type="button"
                          onClick={handleCheckDuplicates}
                          disabled={checkingDups}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/5 text-xs font-medium text-slate-light transition-colors hover:bg-white/10 hover:text-paper disabled:opacity-50"
                        >
                          <Copy className="h-3.5 w-3.5 text-amber-300" />
                          {checkingDups ? "Scanning..." : "Check duplicates"}
                        </button>
                      )}
                    </div>
                  )}
                </Panel>

                <Panel title="Outcome">
                  {isLocked ? (
                    <div
                      className={`flex items-start gap-2.5 rounded-md border p-3 text-sm ${
                        isWon
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : "border-red-500/30 bg-red-500/10 text-red-200"
                      }`}
                    >
                      {isWon ? <Award className="mt-0.5 h-4 w-4 shrink-0" /> : <Ban className="mt-0.5 h-4 w-4 shrink-0" />}
                      <span>
                        {isWon
                          ? isTender
                            ? "Awarded. Commercial terms are locked."
                            : "Won. Commercial terms are locked."
                          : "Closed as lost. Commercial terms are locked."}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="mb-3 text-xs leading-relaxed text-slate-light">
                        {isTender
                          ? "Award to create the execution project, or close out with the reason and follow-ups."
                          : "Mark won to start the project handover, or lost with a reason."}
                      </p>
                      <button
                        type="button"
                        onClick={() => openOutcomeDialog("won")}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                      >
                        <Award className="h-4 w-4" />
                        {isTender ? "Award tender" : "Mark deal won"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openOutcomeDialog("lost")}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-red-500/40 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/10"
                      >
                        <Ban className="h-4 w-4" />
                        {isTender ? "Close out as lost" : "Mark lost"}
                      </button>
                    </div>
                  )}
                  <div className="mt-4 border-t border-white/[0.06] pt-3">
                    <button
                      type="button"
                      onClick={handleDeleteRecord}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 text-xs text-slate transition-colors hover:text-red-400 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete {isTender ? "tender" : "deal"}
                    </button>
                  </div>
                </Panel>
              </aside>
            </div>
          )}

          {/* TAB 2: BOQ & ESTIMATION */}
          {activeTab === "boq" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div>
                  <h3 className="font-sans text-sm font-bold uppercase tracking-wider text-paper">
                    Authoritative BOQ Integration &amp; Pricing
                  </h3>
                  <p className="text-xs text-slate-light mt-0.5">
                    Upload an Excel Bill of Quantities. Multiple tabs are automatically differentiated to exclude summary rollups and prevent inflated figures.
                  </p>
                </div>
                {entity.quote_id ? (
                  <Link
                    href={`/dashboard/quotations/builder?id=${entity.quote_id}`}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 border border-signal/50 bg-signal/10 px-3 py-1.5 font-mono text-xs text-signal hover:bg-signal hover:text-ink transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Open in Quotations Editor</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={handleCreateQuotation}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 border border-signal bg-signal px-3 py-1.5 font-mono text-xs text-ink font-bold hover:bg-signal/90 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Initialize Quotation</span>
                  </button>
                )}
              </div>

              {/* Deal Documents Panel with BOQ Uploader */}
              <DealDocumentsPanel
                opportunityId={entity.id}
                dealValue={dealValue}
                dealClosed={isLocked}
                onDealChanged={onEntityUpdated ? () => onEntityUpdated(entity) : undefined}
              />
            </div>
          )}

          {/* TAB 3: FILES & ATTACHMENTS */}
          {activeTab === "documents" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div>
                  <h3 className="font-sans text-sm font-bold uppercase tracking-wider text-paper">
                    Deal Files &amp; Technical Drawings
                  </h3>
                  <p className="text-xs text-slate-light mt-0.5">
                    Store contract awards, client RFQs, drawings, formal quotations, and addenda.
                  </p>
                </div>
                <label className={`inline-flex items-center gap-1.5 border border-signal/40 bg-signal/10 px-3 py-1.5 font-mono text-xs text-signal hover:bg-signal hover:text-ink transition-colors rounded-sm cursor-pointer ${
                  uploadingDoc ? "opacity-50 pointer-events-none" : ""
                }`}>
                  <Upload className="w-3.5 h-3.5" />
                  <span>{uploadingDoc ? "Uploading..." : "Upload File"}</span>
                  <input
                    type="file"
                    className="hidden"
                    disabled={uploadingDoc}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadDocument(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              {/* Quotation PDF Banner (if linked) */}
              {entity.quote_id && (
                <div className="border border-white/10 bg-black/60 p-3.5 rounded-sm flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-7 w-7 text-signal shrink-0" />
                    <div>
                      <p className="font-sans text-sm font-bold text-paper">
                        Formal Client Quotation Document
                      </p>
                      <p className="font-mono text-xs text-slate-light">
                        Quotation ID: {entity.quote_id} · Value: {formatCurrency(dealValue)} · Status: {entity.quote_status || "draft"}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/quotations/builder?id=${entity.quote_id}`}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 border border-signal bg-signal/15 px-3 py-1.5 font-mono text-xs text-signal hover:bg-signal hover:text-ink transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>View / Export PDF</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setShowInvoiceModal(true)}
                    className="inline-flex items-center gap-1.5 border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 font-mono text-xs text-amber-300 hover:bg-amber-500/30 transition-colors font-bold"
                  >
                    <FileText className="h-3.5 w-3.5 text-amber-300" />
                    <span>Generate Invoice (PDF)</span>
                  </button>
                </div>
              )}

              {/* Documents List */}
              {loadingDocs ? (
                <div className="flex items-center justify-center py-8 text-slate-light">
                  <Loader2 className="w-5 h-5 animate-spin text-signal" />
                </div>
              ) : entityDocs.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-white/10 rounded-sm text-xs font-mono text-slate-light">
                  No documents attached yet. Click &quot;Upload File&quot; above to attach RFQs, drawings, or specifications.
                </div>
              ) : (
                <div className="space-y-2">
                  {entityDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-3 border border-white/5 bg-black/40 rounded-sm hover:border-signal/30 transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="w-4 h-4 text-signal shrink-0" />
                        <div className="min-w-0">
                          <p className="font-sans text-xs font-semibold text-paper truncate">
                            {doc.title || doc.file_name}
                          </p>
                          <p className="font-mono text-[10px] text-slate-light">
                            {doc.file_size_bytes ? `${Math.round(doc.file_size_bytes / 1024)} KB` : "Document"} · {new Date(doc.created_at || Date.now()).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handlePreviewDocument(doc)}
                          className="p-1.5 text-slate-light hover:text-paper hover:bg-white/5 rounded-sm"
                          title="Preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadDocument(doc.id)}
                          className="p-1.5 text-slate-light hover:text-paper hover:bg-white/5 rounded-sm"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDocument(doc.id)}
                          className="p-1.5 text-slate-light hover:text-rose-400 hover:bg-rose-500/10 rounded-sm transition-colors"
                          title="Remove document"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: COMPLIANCE & REQUIREMENTS (TENDERS) / READINESS (OPPORTUNITIES) */}
          {activeTab === "compliance" && (
            <div className="space-y-6">
              {isTender ? (
                <>
                  {/* Compliance Summary Metric Cards */}
                  {complianceSummary && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="border border-white/5 bg-black/40 p-3 rounded-sm">
                        <span className="font-mono text-[9px] uppercase text-slate-light block">Satisfied / Applicable</span>
                        <span className={`font-mono text-base font-bold ${
                          complianceSummary.satisfied_count >= complianceSummary.applicable_count
                            ? "text-emerald-400"
                            : "text-amber-400"
                        }`}>
                          {complianceSummary.satisfied_count} / {complianceSummary.applicable_count}
                        </span>
                      </div>
                      <div className="border border-white/5 bg-black/40 p-3 rounded-sm">
                        <span className="font-mono text-[9px] uppercase text-slate-light block">Readiness Rate</span>
                        <span className="font-mono text-base font-bold text-paper">
                          {complianceSummary.percent !== null ? `${complianceSummary.percent}%` : "0%"}
                        </span>
                      </div>
                      <div className="border border-white/5 bg-black/40 p-3 rounded-sm">
                        <span className="font-mono text-[9px] uppercase text-slate-light block">Open Deficiencies</span>
                        <span className={`font-mono text-base font-bold ${
                          complianceSummary.fatal_open > 0 ? "text-red-400" : complianceSummary.critical_open > 0 ? "text-amber-400" : "text-emerald-400"
                        }`}>
                          {complianceSummary.fatal_open} fatal / {complianceSummary.critical_open} crit
                        </span>
                      </div>
                      <div className="border border-white/5 bg-black/40 p-3 rounded-sm">
                        <span className="font-mono text-[9px] uppercase text-slate-light block">Bid Gate Decision</span>
                        <span className={`font-mono text-xs font-bold uppercase ${
                          complianceSummary.bid_gate_signal === "BID"
                            ? "text-emerald-400"
                            : complianceSummary.bid_gate_signal === "REVIEW"
                            ? "text-amber-400"
                            : "text-red-400"
                        }`}>
                          {complianceSummary.bid_gate_signal}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Add Requirement & Library Seeding */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newRequirementLabel}
                      onChange={(e) => setNewRequirementLabel(e.target.value)}
                      placeholder="Add compliance prerequisite (e.g. ZIMRA ITF263, NSSA, PRAZ Category A)..."
                      className="flex-1 border border-white/10 bg-black/60 px-3 py-1.5 font-mono text-xs text-paper focus:border-signal focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddTenderRequirement}
                      disabled={!newRequirementLabel.trim()}
                      className="px-3 py-1.5 bg-signal font-mono text-xs font-bold text-ink hover:bg-signal/90 disabled:opacity-40"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setIsSeedingLibrary(true);
                        try {
                          await seedTenderRequirementsFromLibrary(entity.id);
                          await loadTenderRequirementsList();
                        } finally {
                          setIsSeedingLibrary(false);
                        }
                      }}
                      disabled={isSeedingLibrary}
                      className="px-3 py-1.5 border border-white/10 bg-white/5 font-mono text-xs text-slate-light hover:text-paper"
                    >
                      {isSeedingLibrary ? "Seeding..." : "Seed from Vault"}
                    </button>
                  </div>

                  {/* Requirements List */}
                  {loadingRequirements ? (
                    <div className="flex items-center justify-center py-8 text-slate-light">
                      <Loader2 className="w-5 h-5 animate-spin text-signal" />
                    </div>
                  ) : requirements.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-white/10 rounded-sm text-xs font-mono text-slate-light">
                      No mandatory tender requirements defined yet. Add requirements or click &quot;Seed from Vault&quot;.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {requirements.map((req) => (
                        <div
                          key={req.id}
                          className="flex items-center justify-between p-3 border border-white/5 bg-black/40 rounded-sm gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`font-mono text-[9px] uppercase px-1.5 py-0.2 rounded-sm border ${
                                req.severity === "MANDATORY"
                                  ? "border-red-500/40 bg-red-950/40 text-red-300"
                                  : "border-amber-500/40 bg-amber-950/40 text-amber-300"
                              }`}>
                                {req.severity}
                              </span>
                              <span className={`font-mono text-[9px] uppercase px-1.5 py-0.2 rounded-sm border ${
                                req.status === "PRESENT"
                                  ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                                  : "border-white/10 bg-white/5 text-slate-light"
                              }`}>
                                {req.status}
                              </span>
                            </div>
                            <p className="font-sans text-xs font-semibold text-paper mt-1">
                              {req.label}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleMatchVaultCredential(req)}
                              disabled={matchingRequirementId === req.id}
                              className="px-2.5 py-1 bg-signal/10 border border-signal/30 text-signal font-mono text-[10px] hover:bg-signal hover:text-ink transition-colors rounded-sm"
                            >
                              {matchingRequirementId === req.id ? "Checking..." : req.credential_id ? "Matched ✓" : "Match Vault"}
                            </button>

                            <label className="px-2.5 py-1 border border-white/10 bg-white/5 hover:bg-white/10 text-paper font-mono text-[10px] rounded-sm cursor-pointer">
                              {uploadingRequirementId === req.id ? "Uploading..." : "Attach Proof"}
                              <input
                                type="file"
                                className="hidden"
                                disabled={uploadingRequirementId === req.id}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleUploadRequirementProof(req, f);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                /* Opportunity Commercial-to-Project Readiness Handoff */
                <div className="space-y-4">
                  <div className="border border-white/10 bg-black/60 p-4 rounded-sm">
                    <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-signal">
                      Commercial Readiness &amp; Project Handover
                    </h3>
                    <p className="text-xs text-slate-light mt-1">
                      Once commercial negotiations conclude and the deal is marked Won, project execution handover unlocks.
                    </p>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="border border-white/5 bg-black/40 p-3">
                        <span className="font-mono text-[9px] uppercase text-slate-light block">Deal Status</span>
                        <span className={`font-mono text-sm font-bold ${
                          isWon ? "text-emerald-400" : "text-amber-400"
                        }`}>
                          {isWon ? "COMMERCIALLY WON" : "PIPELINE ACTIVE"}
                        </span>
                      </div>
                      <div className="border border-white/5 bg-black/40 p-3">
                        <span className="font-mono text-[9px] uppercase text-slate-light block">Execution Project</span>
                        <span className="font-mono text-sm font-bold text-paper">
                          {entity.project_name || "Pending Win Confirmation"}
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
          )}

          {/* TAB 5: TEAM & ASSIGNMENT */}
          {activeTab === "assignment" && (
            <div className="space-y-6 max-w-3xl">
              <div className="border-b border-white/5 pb-3">
                <h3 className="font-sans text-sm font-bold uppercase tracking-wider text-paper">
                  Account Ownership &amp; Pursuit Team
                </h3>
                <p className="text-xs text-slate-light mt-0.5">
                  Assign this {isTender ? "tender" : "deal"} to an individual commercial executive or pursuit team.
                </p>
              </div>

              {/* AssignmentPanel Component */}
              <div className="border border-white/10 bg-[#111111] p-4 rounded-sm">
                <AssignmentPanel
                  entityType={isTender ? "tender" : "opportunity"}
                  entityId={entity.id}
                />
              </div>
            </div>
          )}

          {/* TAB 6: ACTIVITY TIMELINE & TOUCHPOINTS */}
          {activeTab === "activity" && (
            <div className="space-y-6">
              {/* Quick Touchpoint Bar */}
              <section className="border border-white/10 bg-[#111111] p-4 rounded-sm space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-signal">
                    Fast Interaction Logger
                  </span>
                  <div className="flex items-center gap-1 flex-wrap">
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
                    <button
                      type="button"
                      onClick={() => setTouchpointType("site_visit")}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 font-mono text-xs rounded-sm transition-colors ${
                        touchpointType === "site_visit" ? "bg-signal text-ink font-semibold" : "border border-white/10 text-slate-light hover:text-paper"
                      }`}
                    >
                      <Calendar className="h-3 w-3" />
                      <span>Site Visit</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <textarea
                    rows={2}
                    value={touchpointNotes}
                    onChange={(e) => setTouchpointNotes(e.target.value)}
                    placeholder={`Log summary of ${touchpointType}... (e.g. Discussed revised bill quantities, client confirmed approval)`}
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
                      <span>Append Log</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* Timeline Header & Filter */}
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="font-mono text-xs uppercase tracking-wider text-paper font-semibold">
                  Activity Stream ({filteredActivities.length})
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
                    System Logs
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
                  No interactions recorded yet. Use the logger above to log touchpoints.
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
                          {act.type || act.activity_type}
                        </span>
                      </div>
                      <p className="font-sans text-xs text-paper font-medium">{act.subject}</p>
                      {act.description && (
                        <p className="font-sans text-xs text-slate-light bg-black/40 border border-white/5 p-2 rounded-sm">
                          {act.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>

        {/* ======================================================================
            3. OVERVIEW FOOTER (save bar)
        ====================================================================== */}
        {activeTab === "overview" && (
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#111111] px-6 py-3">
            <span className="inline-flex items-center gap-2 text-xs text-slate-light">
              {isDirty ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  Unsaved changes
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  All changes saved
                </>
              )}
            </span>
            <div className="flex items-center gap-2">
              {!isTender && (
                <button
                  type="button"
                  onClick={handleCreateQuotation}
                  disabled={saving}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3.5 text-sm font-medium text-paper transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  <FileSpreadsheet className="h-4 w-4 text-signal" />
                  {entity.quote_id ? "Sync quotation" : "Create quote"}
                </button>
              )}
              <button
                type="button"
                onClick={handleSaveOverview}
                disabled={saving || !isDirty}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-signal px-4 text-sm font-semibold text-ink transition-colors hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save changes
              </button>
            </div>
          </footer>
        )}

        {/* ======================================================================
            4. WIN / AWARD CONFIRMATION
        ====================================================================== */}
        {isWinModalOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-[#111111] shadow-2xl">
              <div className="flex items-start gap-3 border-b border-white/[0.07] px-5 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
                  <Award className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-paper">{isTender ? "Award tender" : "Mark deal as won"}</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-light">
                    {isTender
                      ? "Creates the execution project and records why the bid won and what happens next."
                      : "Advances the stage, locks the contract margin and starts the project handover."}
                  </p>
                </div>
              </div>

              <div className="space-y-4 p-5">
                {!isTender && winReasonOptions.length > 0 && (
                  <Field label="Win category">
                    <select value={selectedWinReasonId} onChange={(e) => setSelectedWinReasonId(e.target.value)} className={inputCls}>
                      <option value="">Custom (use notes below)</option>
                      {winReasonOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </Field>
                )}

                {departments.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Delivered by">
                      <select value={selectedWinDepartmentId} onChange={(e) => setSelectedWinDepartmentId(e.target.value)} className={inputCls}>
                        <option value="">Unassigned</option>
                        {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Sourced by">
                      <select
                        value={selectedWinOriginatingDepartmentId}
                        onChange={(e) => setSelectedWinOriginatingDepartmentId(e.target.value)}
                        className={inputCls}
                      >
                        <option value="">Unassigned</option>
                        {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </Field>
                  </div>
                )}

                <Field label={isTender ? "Why we won (required)" : "Notes"}>
                  <textarea
                    rows={3}
                    value={winLossNotes}
                    onChange={(e) => setWinLossNotes(e.target.value)}
                    placeholder={
                      isTender
                        ? "e.g. Lowest compliant bid, strong technical score"
                        : "Execution kick-off, site inspection dates, contract terms..."
                    }
                    className={`${inputCls} h-auto resize-y py-2.5`}
                  />
                </Field>

                {isTender && (
                  <Field label="Next steps (one per line, required)">
                    <textarea
                      rows={3}
                      value={tenderNextSteps}
                      onChange={(e) => setTenderNextSteps(e.target.value)}
                      placeholder={"Collect award letter\nRequest bid bond release\nSchedule kick-off meeting"}
                      className={`${inputCls} h-auto resize-y py-2.5`}
                    />
                  </Field>
                )}

                {feedback?.type === "error" && <p className="text-xs text-red-300">{feedback.message}</p>}
              </div>

              <div className="flex justify-end gap-2 border-t border-white/[0.07] bg-black/20 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setIsWinModalOpen(false)}
                  className="h-9 rounded-md border border-white/10 px-3.5 text-sm text-slate-light transition-colors hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmWin}
                  disabled={
                    saving ||
                    (isTender && (winLossNotes.trim().length < 3 || parseNextSteps(tenderNextSteps).length === 0))
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isTender ? "Award & create project" : "Confirm win"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================
            5. LOSS / CLOSE-OUT CONFIRMATION
        ====================================================================== */}
        {isLostModalOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-[#111111] shadow-2xl">
              <div className="flex items-start gap-3 border-b border-white/[0.07] px-5 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300">
                  <Ban className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-paper">
                    {isTender ? "Close out tender as lost" : "Mark deal as lost"}
                  </h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-light">
                    {isTender
                      ? "Records the reason and creates follow-up tasks so the loss still feeds the next bid."
                      : "Record the reason for the loss so forecasting and post-mortems stay accurate."}
                  </p>
                </div>
              </div>

              <div className="space-y-4 p-5">
                {!isTender && lossReasonOptions.length > 0 && (
                  <Field label="Loss category">
                    <select value={selectedLossReasonId} onChange={(e) => setSelectedLossReasonId(e.target.value)} className={inputCls}>
                      <option value="">Custom (use notes below)</option>
                      {lossReasonOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </Field>
                )}

                <Field label={isTender ? "Why we lost (required)" : "Reason"}>
                  <textarea
                    rows={2}
                    value={winLossNotes}
                    onChange={(e) => setWinLossNotes(e.target.value)}
                    placeholder="e.g. Price undercut by competitor, scope misalignment, project shelved"
                    className={`${inputCls} h-auto resize-y py-2.5`}
                  />
                </Field>

                {isTender && (
                  <>
                    <Field label="Winning contractor">
                      <input
                        type="text"
                        value={winningContractor}
                        onChange={(e) => setWinningContractor(e.target.value)}
                        placeholder="If known"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Next steps (one per line, required)">
                      <textarea
                        rows={3}
                        value={tenderNextSteps}
                        onChange={(e) => setTenderNextSteps(e.target.value)}
                        className={`${inputCls} h-auto resize-y py-2.5`}
                      />
                    </Field>
                  </>
                )}

                {feedback?.type === "error" && <p className="text-xs text-red-300">{feedback.message}</p>}
              </div>

              <div className="flex justify-end gap-2 border-t border-white/[0.07] bg-black/20 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setIsLostModalOpen(false)}
                  className="h-9 rounded-md border border-white/10 px-3.5 text-sm text-slate-light transition-colors hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmLost}
                  disabled={
                    saving ||
                    (isTender
                      ? winLossNotes.trim().length < 3 || parseNextSteps(tenderNextSteps).length === 0
                      : !winLossNotes.trim() && !selectedLossReasonId)
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isTender ? "Close out as lost" : "Confirm loss"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================
            6. DUPLICATE OPPORTUNITIES MODAL
        ====================================================================== */}
        {isDupModalOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4">
            <div className="border border-white/10 bg-[#111111] p-5 max-w-lg w-full rounded-sm space-y-4">
              <h3 className="font-display text-base font-bold text-amber-300 uppercase">
                Duplicate Potential Deals
              </h3>
              <p className="text-xs text-slate-light">
                Matching records found for <strong className="text-paper">{entity.name}</strong>.
              </p>
              <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                {duplicateOpps.length === 0 ? (
                  <p className="text-xs text-slate font-mono italic">No duplicate matches detected.</p>
                ) : (
                  duplicateOpps.map((dup) => (
                    <div
                      key={dup.id}
                      className="flex items-center justify-between p-3 border border-white/5 bg-black/40 rounded-sm text-xs"
                    >
                      <div>
                        <p className="font-bold text-paper">{dup.name}</p>
                        <p className="font-mono text-[10px] text-slate-light">
                          {dup.stage} · {formatCurrency(dup.budget || dup.deal_value || 0)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleMergeDuplicate(dup.id)}
                        disabled={saving}
                        className="px-2.5 py-1 bg-signal/15 border border-signal/40 text-signal font-mono text-[10px] uppercase font-bold hover:bg-signal hover:text-ink transition-colors"
                      >
                        Merge
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsDupModalOpen(false)}
                  className="px-3 py-1.5 border border-white/10 font-mono text-xs text-slate-light hover:text-paper"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================
            7. DOCUMENT INLINE PREVIEW MODAL
        ====================================================================== */}
        {previewDocUrl && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-4">
            <div className="relative border border-white/10 bg-[#111111] w-full max-w-4xl h-[85vh] rounded-sm flex flex-col overflow-hidden">
              <div className="flex items-center justify-between p-3 border-b border-white/10 bg-black">
                <span className="font-mono text-xs text-paper truncate font-bold">
                  {previewDocName}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewDocUrl(null);
                    setPreviewDocName(null);
                  }}
                  className="p-1 text-slate-light hover:text-paper"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 bg-black p-2">
                <iframe
                  src={previewDocUrl}
                  title="Document Preview"
                  className="w-full h-full border-none rounded-sm"
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <GenerateInvoiceModal
        isOpen={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
        initialData={{
          invoiceType: "PROFORMA INVOICE",
          subject: `40% deposit — ${entity.name || "Commercial Opportunity"}`,
          clientName: entity.client_name || entity.organization_name || "",
          quotationRef: entity.quote_id ? `QT-${String(entity.quote_id).slice(0, 8)}` : "",
          depositPercentage: 40,
          items: [
            {
              item_no: "1",
              description: `Scope of works and deliverables for ${entity.name || "Project"}`,
              amount_excl_vat: Number(entity.deal_value || 0),
            }
          ]
        }}
      />
    </div>
  );
}
