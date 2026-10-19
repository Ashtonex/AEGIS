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
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { DealDocumentsPanel } from "@/components/crm/DealDocumentsPanel";
import { AssignmentPanel } from "@/components/documents/AssignmentPanel";
import { useFinanceDepartments } from "@/hooks/useFinanceDepartments";
import { supabase } from "@/lib/supabase";
import {
  updateCrmOpportunity,
  deleteCrmOpportunity,
  markCrmOpportunityWon,
  markCrmOpportunityLost,
  updateCrmTender,
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

export function CommercialWorkspaceModal({
  isOpen,
  onClose,
  entity,
  kind,
  onEntityUpdated,
}: CommercialWorkspaceModalProps) {
  const isTender = kind === "tender";
  const [activeTab, setActiveTab] = useState<
    "overview" | "boq" | "documents" | "compliance" | "assignment" | "activity"
  >("overview");
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

  // Initialize form state from entity
  useEffect(() => {
    if (entity) {
      setDealValue(Number(entity.deal_value || entity.budget || 0));
      setProbability(Number(entity.probability || 50));
      setRiskLevel(entity.risk_level || "Medium");
      setExpectedCloseDate(entity.expected_close_date ? entity.expected_close_date.slice(0, 10) : "");
      setNextActivityDate(entity.next_activity_due_at ? entity.next_activity_due_at.slice(0, 10) : "");
      setStage(entity.stage || (isTender ? "Tender Identified" : "Qualification"));
      setStageNote("");
      setFeedback(null);
    }
  }, [entity, isTender]);

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
  }, [entity?.id, isTender]);

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

  // Save commercial overview updates
  const handleSaveOverview = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      if (isTender) {
        const payload: Record<string, any> = {
          bid_amount: dealValue,
          stage,
          ...(stageNote.trim() ? { stage_note: stageNote.trim() } : {}),
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

      setFeedback({ type: "success", message: "Commercial details saved successfully." });
      setStageNote("");
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
  const handleConfirmWin = async () => {
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


  return (
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entity.name}
        className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden border border-white/10 bg-[#0C0C0C] shadow-2xl outline-none sm:h-[92vh] sm:rounded-lg"
      >
        {/* ======================================================================
            1. TOP HEADER & TELEMETRY CONTROLS
        ====================================================================== */}
        <header className="shrink-0 border-b border-white/10 bg-[#111111] px-5 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm border border-signal/40 bg-signal/10 text-signal">
                  {isTender ? "TENDER & BID CONSOLE" : "OPPORTUNITY WORKSPACE"}
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
                {entity.is_stale && (
                  <span className="font-mono text-[8px] uppercase text-amber-300 border border-amber-500/30 px-1.5 py-0.5 bg-amber-950/30">
                    Stale Deal
                  </span>
                )}
              </div>
              <h1 className="mt-1 font-display text-lg font-bold text-paper truncate max-w-2xl sm:text-xl">
                {entity.name}
              </h1>
              <p className="mt-0.5 text-xs text-slate-light truncate flex items-center gap-2">
                <span>
                  Client: <strong className="text-paper font-semibold">{entity.organization_name || entity.client_name || "Unassigned Client"}</strong>
                </span>
                {entity.region && <span>· Region: {entity.region}</span>}
                {entity.sales_owner_name && <span>· Owner: {entity.sales_owner_name}</span>}
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
              2. FINANCIAL & TIMING METRIC STRIP
          ====================================================================== */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 border-t border-white/5 pt-2.5">
            <div className="border border-white/5 bg-black/40 p-2 rounded-sm">
              <span className="font-mono text-[8px] uppercase tracking-wider text-slate-light block">
                {isTender ? "Bid Amount" : "Contract Value"}
              </span>
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
              <span className="font-mono text-[8px] uppercase tracking-wider text-slate-light block">
                {isTender ? "Bid Submission" : "Next Milestone"}
              </span>
              <span className={`font-mono text-xs font-semibold truncate block mt-0.5 ${
                deadlineCountdown?.urgency === "critical" ? "text-red-400 animate-pulse font-bold" : "text-amber-300"
              }`}>
                {isTender
                  ? deadlineCountdown?.text || "Not Scheduled"
                  : entity.next_activity_due_at ? new Date(entity.next_activity_due_at).toLocaleDateString() : "Set Date"}
              </span>
            </div>
          </div>

          {/* Tender Site Visit Banner (if mandatory or scheduled) */}
          {isTender && siteVisitCountdown && (
            <div className="mt-2 flex items-center justify-between bg-[#161616] border border-[#D4AF37]/30 px-3 py-1.5 rounded-sm text-xs font-mono">
              <div className="flex items-center gap-2 text-slate-light">
                <Calendar className="w-3.5 h-3.5 text-signal" />
                <span>{entity.site_visit_mandatory ? "Mandatory Site Visit:" : "Site Inspection:"}</span>
                <span className="text-paper font-semibold">
                  {entity.site_visit_at ? new Date(entity.site_visit_at).toLocaleString() : ""}
                </span>
              </div>
              <span className={`font-bold uppercase tracking-wider ${
                siteVisitCountdown.urgency === "critical" ? "text-red-400 animate-pulse" : "text-signal"
              }`}>
                {siteVisitCountdown.text}
              </span>
            </div>
          )}

          {/* ======================================================================
              3. TABS NAVIGATION BAR
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
              <span>Overview &amp; Deal</span>
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
              <span>BOQ &amp; Quotations</span>
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
              <span>Files &amp; Attachments ({entityDocs.length})</span>
            </button>
            <button
              onClick={() => setActiveTab("compliance")}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors rounded-sm ${
                activeTab === "compliance"
                  ? "bg-signal text-ink font-semibold"
                  : "text-slate-light hover:text-paper hover:bg-white/5"
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{isTender ? `Compliance Deck (${requirements.length})` : "Readiness Gates"}</span>
            </button>
            <button
              onClick={() => setActiveTab("assignment")}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors rounded-sm ${
                activeTab === "assignment"
                  ? "bg-signal text-ink font-semibold"
                  : "text-slate-light hover:text-paper hover:bg-white/5"
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Team &amp; Assignment</span>
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
              <span>Activity &amp; Touchpoints</span>
            </button>
          </nav>
        </header>

        {/* FEEDBACK BANNER */}
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
            4. SCROLLABLE TAB BODY
        ====================================================================== */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar bg-[#0A0A0A]">
          {/* TAB 1: COMMERCIAL OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-6 max-w-4xl">
              {/* Client & Organization Summary Card */}
              <section className="bg-white/[0.02] border border-white/5 p-4 rounded-sm flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-signal/10 border border-signal/30 flex items-center justify-center text-signal">
                    <Landmark className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-sans font-bold text-sm text-paper">
                      {entity.organization_name || entity.client_name || "Unassigned Account"}
                    </h3>
                    <p className="font-mono text-xs text-slate-light">
                      Account Profile · {isTender ? "Issuing Authority / Client" : "Prospect Entity"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {entity.client_org_id && (
                    <Link
                      href={`/dashboard/crm/organizations/${entity.client_org_id}`}
                      target="_blank"
                      className="px-3 py-1.5 border border-white/10 bg-white/5 hover:bg-white/10 text-paper font-mono text-xs rounded-sm inline-flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-signal" />
                      <span>Customer 360</span>
                    </Link>
                  )}
                  {!isTender && (
                    <button
                      type="button"
                      onClick={handleCheckDuplicates}
                      disabled={checkingDups}
                      className="px-3 py-1.5 border border-white/10 bg-white/5 hover:bg-white/10 text-slate-light hover:text-paper font-mono text-xs rounded-sm inline-flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5 text-amber-300" />
                      <span>{checkingDups ? "Scanning..." : "Check Duplicates"}</span>
                    </button>
                  )}
                </div>
              </section>

              {/* Main Commercial Input Fields */}
              <section className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-slate-light block">
                    {isTender ? "Tender Bid Amount ($)" : "Agreed Contract / Selling Price ($)"}
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
                    Pipeline Stage
                  </label>
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                    disabled={isLocked}
                    className="w-full border border-white/10 bg-black/60 px-3 py-2 font-mono text-sm text-paper focus:border-signal focus:outline-none"
                  >
                    {isTender ? (
                      <>
                        <option value="Tender Identified">Tender Identified</option>
                        <option value="Bid Prep">Bid Prep</option>
                        <option value="Submitted">Submitted</option>
                        <option value="Adjudication">Adjudication</option>
                        <option value="Awarded">Awarded</option>
                        <option value="Lost">Lost</option>
                      </>
                    ) : (
                      <>
                        <option value="Qualification">Qualification</option>
                        <option value="Site Visit">Site Visit</option>
                        <option value="Quotation">Proposal / Quotation</option>
                        <option value="Negotiation">Negotiation</option>
                        <option value="Contract">Contract (Won)</option>
                        <option value="Lost">Lost</option>
                      </>
                    )}
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
                    {isTender ? "Submission Deadline Date" : "Expected Close Date"}
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

                {/* Stage-Move Note Input */}
                <div className="space-y-1 sm:col-span-2">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-slate-light block">
                    Stage Progression Note (Required for Audit Trail)
                  </label>
                  <input
                    type="text"
                    value={stageNote}
                    onChange={(e) => setStageNote(e.target.value)}
                    placeholder="Provide rationale for pipeline milestone change or current negotiation status..."
                    className="w-full border border-white/10 bg-black/60 px-3 py-2 font-mono text-xs text-paper focus:border-signal focus:outline-none placeholder:text-slate"
                  />
                </div>
              </section>

              {/* BANT Qualification Deck (Opportunities Only) */}
              {!isTender && (
                <section className="border border-white/5 bg-white/[0.01] p-4 rounded-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-signal font-bold">
                      BANT Qualification Deck
                    </span>
                    <span className="font-mono text-[9px] text-slate-light">
                      {[bantBudget, bantAuthority, bantNeed, bantTimeline].filter(Boolean).length}/4 Verified
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                    <label className={`flex items-center gap-2 p-2.5 border rounded-sm cursor-pointer transition-colors ${
                      bantBudget ? "border-signal/50 bg-signal/10 text-signal" : "border-white/5 bg-black/40 text-slate-light"
                    }`}>
                      <input
                        type="checkbox"
                        checked={bantBudget}
                        onChange={(e) => setBantBudget(e.target.checked)}
                        className="rounded"
                      />
                      <span>Budget Confirmed</span>
                    </label>
                    <label className={`flex items-center gap-2 p-2.5 border rounded-sm cursor-pointer transition-colors ${
                      bantAuthority ? "border-signal/50 bg-signal/10 text-signal" : "border-white/5 bg-black/40 text-slate-light"
                    }`}>
                      <input
                        type="checkbox"
                        checked={bantAuthority}
                        onChange={(e) => setBantAuthority(e.target.checked)}
                        className="rounded"
                      />
                      <span>Authority Identified</span>
                    </label>
                    <label className={`flex items-center gap-2 p-2.5 border rounded-sm cursor-pointer transition-colors ${
                      bantNeed ? "border-signal/50 bg-signal/10 text-signal" : "border-white/5 bg-black/40 text-slate-light"
                    }`}>
                      <input
                        type="checkbox"
                        checked={bantNeed}
                        onChange={(e) => setBantNeed(e.target.checked)}
                        className="rounded"
                      />
                      <span>Need Established</span>
                    </label>
                    <label className={`flex items-center gap-2 p-2.5 border rounded-sm cursor-pointer transition-colors ${
                      bantTimeline ? "border-signal/50 bg-signal/10 text-signal" : "border-white/5 bg-black/40 text-slate-light"
                    }`}>
                      <input
                        type="checkbox"
                        checked={bantTimeline}
                        onChange={(e) => setBantTimeline(e.target.checked)}
                        className="rounded"
                      />
                      <span>Timeline Defined</span>
                    </label>
                  </div>
                </section>
              )}

              {/* Action Buttons */}
              <section className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
                <div className="flex items-center gap-2 flex-wrap">
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
                    onClick={handleCreateQuotation}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-paper hover:bg-white/10 transition-colors"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 text-signal" />
                    <span>{entity.quote_id ? "Sync Quotation" : "Create Quote"}</span>
                  </button>
                </div>

                {!isLocked && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setIsWinModalOpen(true)}
                      className="inline-flex items-center gap-1.5 border border-emerald-500/50 bg-emerald-950/40 px-3.5 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-emerald-300 hover:bg-emerald-900/50 transition-colors"
                    >
                      <Award className="h-3.5 w-3.5" />
                      <span>{isTender ? "Award Tender" : "Mark Deal Won"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsLostModalOpen(true)}
                      className="inline-flex items-center gap-1.5 border border-red-500/50 bg-red-950/40 px-3.5 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-red-300 hover:bg-red-900/50 transition-colors"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      <span>Mark Lost</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm(`Are you sure you want to delete "${entity.name}"? This cannot be undone.`)) return;
                        try {
                          await deleteCrmOpportunity(entity.id);
                          onClose();
                          if (onEntityUpdated) onEntityUpdated({ ...entity, stage: "closed_lost" });
                        } catch (err) {
                          alert("Failed to delete deal.");
                        }
                      }}
                      className="inline-flex items-center gap-1.5 border border-red-500/30 bg-red-950/20 px-3 py-2 font-mono text-xs text-red-400 hover:bg-red-500/20 hover:border-red-500 transition-colors"
                      title="Permanently delete deal"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Delete Deal</span>
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
            <div className="space-y-6 max-w-4xl">
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
            <div className="space-y-6 max-w-2xl">
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
            <div className="space-y-6 max-w-4xl">
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
            5. WIN CONFIRMATION MODAL
        ====================================================================== */}
        {isWinModalOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4">
            <div className="border border-emerald-500/40 bg-[#111111] p-5 max-w-md w-full rounded-sm space-y-4">
              <h3 className="font-display text-base font-bold text-emerald-300 uppercase">
                {isTender ? "Award Tender & Release Project" : "Confirm Mark Deal as Won"}
              </h3>
              <p className="text-xs text-slate-light">
                Marking this deal as won advances the stage, locks contract margin, and initiates project deployment structures.
              </p>

              {winReasonOptions.length > 0 && (
                <div>
                  <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Win Category</label>
                  <select
                    value={selectedWinReasonId}
                    onChange={(e) => setSelectedWinReasonId(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-sm p-2 text-xs text-paper outline-none"
                  >
                    <option value="">Custom (use notes below)</option>
                    {winReasonOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
              )}

              {departments.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Delivered by</label>
                    <select
                      value={selectedWinDepartmentId}
                      onChange={(e) => setSelectedWinDepartmentId(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-sm p-2 text-xs text-paper outline-none"
                    >
                      <option value="">Unassigned</option>
                      {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Sourced by</label>
                    <select
                      value={selectedWinOriginatingDepartmentId}
                      onChange={(e) => setSelectedWinOriginatingDepartmentId(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-sm p-2 text-xs text-paper outline-none"
                    >
                      <option value="">Unassigned</option>
                      {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <textarea
                rows={3}
                value={winLossNotes}
                onChange={(e) => setWinLossNotes(e.target.value)}
                placeholder="Details regarding execution kick-off, site inspection dates, and contract terms..."
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
                  {saving ? "Confirming..." : "Confirm Win"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================
            6. LOSS CONFIRMATION MODAL
        ====================================================================== */}
        {isLostModalOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4">
            <div className="border border-red-500/40 bg-[#111111] p-5 max-w-md w-full rounded-sm space-y-4">
              <h3 className="font-display text-base font-bold text-red-300 uppercase">
                Confirm Mark Deal as Lost
              </h3>
              <p className="text-xs text-slate-light">
                Please specify the reason for the loss to optimize ML pipeline forecasting and post-mortem analysis.
              </p>

              {lossReasonOptions.length > 0 && (
                <div>
                  <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Loss Category</label>
                  <select
                    value={selectedLossReasonId}
                    onChange={(e) => setSelectedLossReasonId(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-sm p-2 text-xs text-paper outline-none"
                  >
                    <option value="">Custom (use notes below)</option>
                    {lossReasonOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
              )}

              <input
                type="text"
                value={winLossNotes}
                onChange={(e) => setWinLossNotes(e.target.value)}
                placeholder="e.g. Price undercut by competitor, scope misalignment, project shelved"
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
                  disabled={saving || (!winLossNotes.trim() && !selectedLossReasonId)}
                  className="px-3 py-1.5 bg-red-600 font-mono text-xs font-semibold uppercase text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {saving ? "Confirming..." : "Confirm Loss"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================
            7. DUPLICATE OPPORTUNITIES MODAL
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
            8. DOCUMENT INLINE PREVIEW MODAL
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
    </div>
  );
}
