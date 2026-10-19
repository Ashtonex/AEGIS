"use client";

import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import {
  X,
  ExternalLink,
  DollarSign,
  TrendingUp,
  Percent,
  Calendar,
  User,
  Building2,
  Phone,
  Mail,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Plus,
  Send,
  Loader2,
  Trash2,
  Eye,
  Download,
  UploadCloud,
  ArrowRight,
  MessageSquare,
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  FileSpreadsheet,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  updateCrmOpportunity,
  markCrmOpportunityWon,
  markCrmOpportunityLost,
  createCrmOpportunityQuotation,
  getCrmActivities,
  createCrmActivity,
  getDocumentsForEntity,
  createDocument,
  linkDocument,
  deleteDocument,
  unlinkDocumentFromEntity,
  getDocumentSignedUrl,
  getCrmWinLossReasons,
  createCrmWinLossReason,
} from "@/lib/api";
import { useFinanceDepartments } from "@/hooks/useFinanceDepartments";
import { supabase } from "@/lib/supabase";

export interface OpportunityDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  opportunity: {
    id: string;
    name: string;
    stage: string;
    budget?: number | string | null;
    deal_value?: number | string | null;
    probability?: number | string | null;
    expected_margin?: number | string | null;
    risk_level?: string | null;
    client_id?: string | null;
    client_org_id?: string | null;
    client_name?: string | null;
    organization_name?: string | null;
    contact_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    quote_id?: string | null;
    quote_status?: string | null;
    project_id?: string | null;
    project_name?: string | null;
    is_stale?: boolean | null;
    approval_status?: string | null;
    originating_department_id?: string | null;
    next_activity_due_at?: string | null;
    created_at?: string | null;
    region?: string | null;
  } | null;
  onOpportunityUpdated: () => void;
  contacts?: any[];
  organizations?: any[];
  canOverrideStage?: boolean;
}

export type OpportunityDetailData = NonNullable<OpportunityDetailDrawerProps["opportunity"]>;

const STAGES = [
  "Inquiry",
  "Qualification",
  "Site Visit",
  "Proposal",
  "Negotiation",
  "Won",
  "Lost",
];

const BACKEND_TO_CANONICAL_STAGE: Record<string, string> = {
  Inquiry: "Inquiry",
  Qualification: "Qualification",
  "Site Visit": "Site Visit",
  Quotation: "Proposal",
  Proposal: "Proposal",
  Negotiation: "Negotiation",
  Contract: "Won",
  Won: "Won",
  Lost: "Lost",
};

const CANONICAL_TO_BACKEND_STAGE: Record<string, string> = {
  Inquiry: "Inquiry",
  Qualification: "Qualification",
  "Site Visit": "Site Visit",
  Proposal: "Quotation",
  Negotiation: "Negotiation",
  Won: "Contract",
  Lost: "Lost",
};

export function OpportunityDetailDrawer({
  isOpen,
  onClose,
  opportunity,
  onOpportunityUpdated,
  contacts = [],
  organizations = [],
  canOverrideStage = false,
}: OpportunityDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "quotation" | "documents" | "activity">("overview");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Editable Form State
  const [editName, setEditName] = useState("");
  const [editBudget, setEditBudget] = useState<number>(0);
  const [editProbability, setEditProbability] = useState<number>(50);
  const [editExpectedMargin, setEditExpectedMargin] = useState<string>("");
  const [editRiskLevel, setEditRiskLevel] = useState("Low");
  const [editClientId, setEditClientId] = useState("");
  const [editClientOrgId, setEditClientOrgId] = useState("");
  const [editNextActivityDueAt, setEditNextActivityDueAt] = useState("");
  const [editOriginatingDeptId, setEditOriginatingDeptId] = useState("");

  // Scoped Documents State (strictly deal-scoped via /api/v1/documents/for-entity)
  const [documents, setDocuments] = useState<any[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Activity & Notes State
  const [activities, setActivities] = useState<any[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [newNoteType, setNewNoteType] = useState<"note" | "call" | "meeting" | "email">("note");
  const [loggingNote, setLoggingNote] = useState(false);

  // Win / Loss modal controls
  const [isWinModalOpen, setIsWinModalOpen] = useState(false);
  const [isLostModalOpen, setIsLostModalOpen] = useState(false);
  const [lossReason, setLossReason] = useState("");
  const [lossReasonNotes, setLossReasonNotes] = useState("");
  const [lossReasonsList, setLossReasonsList] = useState<{ id: string; label: string }[]>([]);
  const [winDepartmentId, setWinDepartmentId] = useState("");
  const [winNotes, setWinNotes] = useState("");
  const [isSubmittingOutcome, setIsSubmittingOutcome] = useState(false);

  const { departments } = useFinanceDepartments();

  // Sync state whenever opportunity prop changes
  useEffect(() => {
    if (!opportunity) return;
    setEditName(opportunity.name || "");
    setEditBudget(Number(opportunity.budget || opportunity.deal_value || 0));
    setEditProbability(Number(opportunity.probability ?? 50));
    setEditExpectedMargin(
      typeof opportunity.expected_margin === "number"
        ? String(opportunity.expected_margin)
        : opportunity.expected_margin || ""
    );
    setEditRiskLevel(opportunity.risk_level || "Low");
    setEditClientId(opportunity.client_id || "");
    setEditClientOrgId(opportunity.client_org_id || "");
    setEditNextActivityDueAt(
      opportunity.next_activity_due_at
        ? new Date(opportunity.next_activity_due_at).toISOString().slice(0, 10)
        : ""
    );
    setEditOriginatingDeptId(opportunity.originating_department_id || "");
    setIsEditing(false);
    setFeedback(null);
  }, [opportunity]);

  const currentOppIdRef = useRef<string | undefined>(undefined);
  currentOppIdRef.current = opportunity?.id;
  const [unlinkingDocId, setUnlinkingDocId] = useState<string | null>(null);

  // Load strictly deal-scoped documents with stale-response protection
  const loadDealDocuments = useCallback(async (targetId: string) => {
    setLoadingDocs(true);
    try {
      const res = await getDocumentsForEntity("opportunity", targetId);
      if (currentOppIdRef.current === targetId) {
        if (res.success && Array.isArray(res.data)) {
          setDocuments(res.data);
        } else {
          setDocuments([]);
        }
      }
    } catch {
      if (currentOppIdRef.current === targetId) {
        setDocuments([]);
      }
    } finally {
      if (currentOppIdRef.current === targetId) {
        setLoadingDocs(false);
      }
    }
  }, []);

  // Load activities for this deal with stale-response protection
  const loadDealActivities = useCallback(async (targetId: string) => {
    setLoadingActivities(true);
    try {
      const res = await getCrmActivities({ opportunity_id: targetId, limit: 50 });
      if (currentOppIdRef.current === targetId) {
        if (res.success && Array.isArray(res.data)) {
          setActivities(res.data);
        } else {
          setActivities([]);
        }
      }
    } catch {
      if (currentOppIdRef.current === targetId) {
        setActivities([]);
      }
    } finally {
      if (currentOppIdRef.current === targetId) {
        setLoadingActivities(false);
      }
    }
  }, []);

  useEffect(() => {
    if (isOpen && opportunity?.id) {
      // Clear previous deal documents and activities immediately to prevent displaying stale data
      setDocuments([]);
      setActivities([]);
      void loadDealDocuments(opportunity.id);
      void loadDealActivities(opportunity.id);
    } else {
      setDocuments([]);
      setActivities([]);
    }
  }, [isOpen, opportunity?.id, loadDealDocuments, loadDealActivities]);

  const handleUnlinkDoc = async (documentId: string) => {
    if (!opportunity?.id) return;
    if (!window.confirm("Unlink this document from this opportunity? The source file remains available in the company document repository.")) {
      return;
    }
    setUnlinkingDocId(documentId);
    try {
      const res = await unlinkDocumentFromEntity(documentId, "opportunity", opportunity.id);
      if (res.success) {
        setFeedback({ type: "success", message: "Document unlinked from deal." });
        void loadDealDocuments(opportunity.id);
      } else {
        setFeedback({ type: "error", message: res.message || "Failed to unlink document." });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Failed to unlink document." });
    } finally {
      setUnlinkingDocId(null);
    }
  };

  // Handle stage change
  const currentCanonicalStage = opportunity?.stage
    ? BACKEND_TO_CANONICAL_STAGE[opportunity.stage] || opportunity.stage
    : "Inquiry";
  const isWon = currentCanonicalStage === "Won";
  const isLost = currentCanonicalStage === "Lost";
  const isDecided = isWon || isLost;

  const handleStageSelect = async (newCanonicalStage: string) => {
    if (!opportunity?.id || newCanonicalStage === currentCanonicalStage) return;
    if (isDecided && !canOverrideStage) {
      setFeedback({ type: "error", message: "Only Executive Admin can reopen decided contracts." });
      return;
    }
    if (newCanonicalStage === "Won") {
      setIsWinModalOpen(true);
      return;
    }
    if (newCanonicalStage === "Lost") {
      try {
        const res = await getCrmWinLossReasons("lost");
        if (res.success && Array.isArray(res.data)) setLossReasonsList(res.data);
      } catch {}
      setIsLostModalOpen(true);
      return;
    }

    const backendStage = CANONICAL_TO_BACKEND_STAGE[newCanonicalStage] || newCanonicalStage;
    setIsSaving(true);
    try {
      const res = await updateCrmOpportunity(opportunity.id, { stage: backendStage });
      if (res.success) {
        setFeedback({ type: "success", message: `Moved to ${newCanonicalStage}.` });
        onOpportunityUpdated();
      } else {
        setFeedback({ type: "error", message: "Failed to update pipeline stage." });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to update stage." });
    } finally {
      setIsSaving(false);
    }
  };

  // Save deal fields
  const handleSaveFields = async () => {
    if (!opportunity?.id) return;
    if (!editName.trim()) {
      setFeedback({ type: "error", message: "Deal name is required." });
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const payload: Record<string, any> = {
        name: editName.trim(),
        budget: editBudget,
        probability: editProbability,
        risk_level: editRiskLevel,
        client_id: editClientId || null,
        client_org_id: editClientOrgId || null,
        originating_department_id: editOriginatingDeptId || null,
        next_activity_due_at: editNextActivityDueAt ? new Date(editNextActivityDueAt).toISOString() : null,
      };
      if (editExpectedMargin !== "") {
        payload.expected_margin = Number(editExpectedMargin);
      }
      const res = await updateCrmOpportunity(opportunity.id, payload);
      if (res.success) {
        setFeedback({ type: "success", message: "Deal parameters updated." });
        setIsEditing(false);
        onOpportunityUpdated();
      } else {
        setFeedback({ type: "error", message: "Could not save deal changes." });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Error saving changes." });
    } finally {
      setIsSaving(false);
    }
  };

  // Log note or touchpoint
  const handleLogNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opportunity?.id || !newNote.trim()) return;
    setLoggingNote(true);
    try {
      const typeLabel = newNoteType === "note" ? "Manual Note" : newNoteType === "call" ? "Phone Call" : newNoteType === "meeting" ? "Meeting" : "Email";
      const res = await createCrmActivity({
        opportunity_id: opportunity.id,
        type: typeLabel,
        subject: `${typeLabel}: ${editName}`,
        description: newNote.trim(),
        status: "Completed",
        activity_date: new Date().toISOString(),
      });
      if (res.success) {
        setNewNote("");
        void loadDealActivities(opportunity.id);
        setFeedback({ type: "success", message: "Activity logged to deal history." });
      } else {
        setFeedback({ type: "error", message: "Could not record activity." });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to log note." });
    } finally {
      setLoggingNote(false);
    }
  };

  // Upload deal attachment strictly scoped to this opportunity
  const handleUploadAttachment = async (file: File) => {
    if (!opportunity?.id) return;
    setUploadingDoc(true);
    setFeedback(null);
    try {
      const fileExt = file.name.split(".").pop();
      const storagePath = `portal-uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${fileExt ? `.${fileExt}` : ""}`;
      
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storagePath, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      const created = await createDocument({
        title: file.name,
        category: "contract",
        opportunity_id: opportunity.id,
        file_name: file.name,
        file_size_bytes: file.size,
        storage_path: storagePath,
        mime_type: file.type || undefined,
      });

      if (created.success && created.data?.id) {
        await linkDocument(created.data.id, {
          entity_type: "opportunity",
          entity_id: opportunity.id,
          link_role: "attachment",
        });
      }

      setFeedback({ type: "success", message: `Attached ${file.name} to this deal.` });
      await loadDealDocuments(opportunity.id);
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to attach document." });
    } finally {
      setUploadingDoc(false);
    }
  };

  // Download / preview attachment
  const handlePreviewDoc = async (docId: string) => {
    try {
      const res = await getDocumentSignedUrl(docId);
      if (res.success && res.data?.url) {
        window.open(res.data.url, "_blank");
      }
    } catch {
      setFeedback({ type: "error", message: "Could not open document preview." });
    }
  };

  // Initialize quotation
  const handleCreateQuotation = async () => {
    if (!opportunity?.id) return;
    setIsSaving(true);
    try {
      const res = await createCrmOpportunityQuotation(opportunity.id, {
        quote_amount: Number(opportunity.budget || opportunity.deal_value || 0),
        notes: `Commercial quote initialized from opportunity: ${opportunity.name}`,
      });
      if (res.success) {
        setFeedback({ type: "success", message: "Quotation created. Opening builder..." });
        onOpportunityUpdated();
        const quoteId = res.data?.id || (res.data as any)?.quote_id;
        if (quoteId) {
          window.open(`/dashboard/quotations/builder?id=${quoteId}`, "_blank");
        }
      } else {
        setFeedback({ type: "error", message: "Could not initialize quotation." });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to initialize quote." });
    } finally {
      setIsSaving(false);
    }
  };

  // Confirm Won
  const handleConfirmWon = async () => {
    if (!opportunity?.id) return;
    setIsSubmittingOutcome(true);
    try {
      const res = await markCrmOpportunityWon(opportunity.id, {
        project_name: opportunity.name,
        notes: winNotes.trim() || undefined,
        department_id: winDepartmentId || undefined,
      });
      if (res.success) {
        setIsWinModalOpen(false);
        setFeedback({ type: "success", message: "Deal marked Won and project record generated!" });
        onOpportunityUpdated();
      } else {
        setFeedback({ type: "error", message: "Could not confirm Won status." });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to mark deal Won." });
    } finally {
      setIsSubmittingOutcome(false);
    }
  };

  // Confirm Lost
  const handleConfirmLost = async () => {
    if (!opportunity?.id) return;
    if (!lossReason.trim()) {
      setFeedback({ type: "error", message: "Loss reason is required." });
      return;
    }
    setIsSubmittingOutcome(true);
    try {
      const res = await markCrmOpportunityLost(opportunity.id, {
        win_loss_reason: lossReason.trim(),
        win_loss_notes: lossReasonNotes.trim() || undefined,
      });
      if (res.success) {
        setIsLostModalOpen(false);
        setFeedback({ type: "success", message: "Deal marked Lost." });
        onOpportunityUpdated();
      } else {
        setFeedback({ type: "error", message: "Could not record Lost status." });
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e?.message || "Failed to mark deal Lost." });
    } finally {
      setIsSubmittingOutcome(false);
    }
  };

  const matchedOrg = organizations.find((o) => o.id === (opportunity?.client_org_id || editClientOrgId));
  const matchedContact = contacts.find((c) => c.id === (opportunity?.client_id || editClientId));

  if (!isOpen || !opportunity) return null;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-Over Drawer Container */}
      <div className="relative w-full max-w-2xl bg-[#0C0F17] border-l border-white/10 shadow-2xl flex flex-col h-full z-10 animate-in slide-in-from-right duration-200">
        
        {/* Top Header */}
        <div className="p-4 border-b border-white/10 bg-white/[0.02] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-sm bg-signal/10 border border-signal/30 flex items-center justify-center shrink-0">
              <DollarSign className="w-4 h-4 text-signal" />
            </div>
            <div className="min-w-0">
              <span className="font-mono text-[9px] uppercase tracking-widest text-slate-light block">
                Commercial Deal Console
              </span>
              <h2 className="font-sans font-bold text-sm text-paper truncate pr-2" title={opportunity.name}>
                {opportunity.name}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Quick Stage Pill */}
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
              isWon
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : isLost
                ? "bg-red-500/20 text-red-300 border border-red-500/30"
                : "bg-signal/20 text-signal border border-signal/30"
            }`}>
              {currentCanonicalStage}
            </span>

            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-sm bg-white/5 border border-white/10 flex items-center justify-center text-slate hover:text-paper hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div className={`px-4 py-2 text-xs font-mono border-b flex items-center justify-between ${
            feedback.type === "success"
              ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
              : "bg-red-950/40 border-red-500/30 text-red-300"
          }`}>
            <span>{feedback.message}</span>
            <button type="button" onClick={() => setFeedback(null)} className="opacity-70 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Pipeline Stage Bar */}
        <div className="px-4 py-2 bg-black/40 border-b border-white/5 flex items-center justify-between gap-1 overflow-x-auto text-[10px] font-mono shrink-0">
          <span className="text-slate-light mr-1 uppercase text-[8px] tracking-wider">Stage:</span>
          {STAGES.map((s) => {
            const isActive = s === currentCanonicalStage;
            return (
              <button
                key={s}
                type="button"
                onClick={() => handleStageSelect(s)}
                disabled={isSaving}
                className={`px-2 py-1 rounded-sm transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-signal text-ink font-bold shadow"
                    : "text-slate-light hover:text-paper hover:bg-white/5"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-white/10 bg-white/[0.01] shrink-0 text-xs font-mono">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`flex-1 py-2.5 text-center border-b-2 font-semibold transition-colors ${
              activeTab === "overview"
                ? "border-signal text-signal bg-signal/5"
                : "border-transparent text-slate-light hover:text-paper"
            }`}
          >
            Overview &amp; Terms
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("quotation")}
            className={`flex-1 py-2.5 text-center border-b-2 font-semibold transition-colors ${
              activeTab === "quotation"
                ? "border-signal text-signal bg-signal/5"
                : "border-transparent text-slate-light hover:text-paper"
            }`}
          >
            Quotation &amp; Project
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("documents")}
            className={`flex-1 py-2.5 text-center border-b-2 font-semibold transition-colors ${
              activeTab === "documents"
                ? "border-signal text-signal bg-signal/5"
                : "border-transparent text-slate-light hover:text-paper"
            }`}
          >
            Attachments ({documents.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("activity")}
            className={`flex-1 py-2.5 text-center border-b-2 font-semibold transition-colors ${
              activeTab === "activity"
                ? "border-signal text-signal bg-signal/5"
                : "border-transparent text-slate-light hover:text-paper"
            }`}
          >
            Timeline ({activities.length})
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          
          {/* TAB 1: OVERVIEW & TERMS */}
          {activeTab === "overview" && (
            <div className="space-y-4">
              {/* Top Key Metrics Banner */}
              <div className="grid grid-cols-3 gap-2 bg-black/40 border border-white/5 p-3 rounded-sm">
                <div>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-slate-light block">Deal Value</span>
                  <span className="font-display text-lg text-paper font-bold mt-0.5 block">
                    {formatCurrency(Number(opportunity.budget || opportunity.deal_value || 0))}
                  </span>
                </div>
                <div>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-slate-light block">Win Probability</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-display text-lg text-signal font-bold">
                      {opportunity.probability ?? 50}%
                    </span>
                  </div>
                </div>
                <div>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-slate-light block">Expected Margin</span>
                  <span className="font-display text-sm text-paper font-semibold mt-1 block">
                    {opportunity.expected_margin !== null && opportunity.expected_margin !== undefined && opportunity.expected_margin !== ""
                      ? `${opportunity.expected_margin}%`
                      : "Unlinked estimate"}
                  </span>
                </div>
              </div>

              {/* Account & Primary Contact Card */}
              <div className="border border-white/10 bg-white/[0.02] p-3.5 rounded-sm space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-signal" /> Customer &amp; Stakeholder Profile
                  </span>
                  {opportunity.client_org_id && (
                    <Link
                      href="/dashboard/crm/organizations"
                      className="font-mono text-[9px] text-signal hover:underline flex items-center gap-1"
                    >
                      <span>Organization Dossier</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </Link>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-light text-[10px] block">Client Organization</span>
                    <span className="text-paper font-semibold block mt-0.5">
                      {opportunity.organization_name || opportunity.client_name || matchedOrg?.name || "No linked organization"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-light text-[10px] block">Primary Contact</span>
                    <span className="text-paper font-semibold block mt-0.5">
                      {opportunity.contact_name || matchedContact?.contact_name || "Unassigned contact"}
                    </span>
                    {(opportunity.contact_email || matchedContact?.email) && (
                      <span className="text-slate text-[10px] font-mono block">
                        {opportunity.contact_email || matchedContact?.email}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Editable Fields Section */}
              <div className="border border-white/10 bg-white/[0.02] p-3.5 rounded-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">
                    Commercial Parameters
                  </span>
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="font-mono text-[10px] text-signal hover:underline uppercase"
                    >
                      Edit Parameters
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="font-mono text-[10px] text-slate hover:text-paper uppercase"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveFields}
                        disabled={isSaving}
                        className="font-mono text-[10px] bg-signal text-ink px-2.5 py-0.5 font-bold uppercase rounded-sm hover:bg-signal/90"
                      >
                        {isSaving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div>
                    <label className="text-[10px] text-slate-light block mb-1">Deal Name</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full bg-black/60 border border-white/10 px-2 py-1 text-paper rounded-sm outline-none focus:border-signal"
                      />
                    ) : (
                      <span className="text-paper font-sans font-semibold">{opportunity.name}</span>
                    )}
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-light block mb-1">Budget / Value ($)</label>
                    {isEditing ? (
                      <input
                        type="number"
                        min="0"
                        value={editBudget}
                        onChange={(e) => setEditBudget(Number(e.target.value))}
                        className="w-full bg-black/60 border border-white/10 px-2 py-1 text-paper rounded-sm outline-none focus:border-signal"
                      />
                    ) : (
                      <span className="text-paper">${Number(opportunity.budget || 0).toLocaleString()}</span>
                    )}
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-light block mb-1">Win Probability (%)</label>
                    {isEditing ? (
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={editProbability}
                        onChange={(e) => setEditProbability(Number(e.target.value))}
                        className="w-full bg-black/60 border border-white/10 px-2 py-1 text-paper rounded-sm outline-none focus:border-signal"
                      />
                    ) : (
                      <span className="text-paper">{opportunity.probability ?? 50}%</span>
                    )}
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-light block mb-1">Target Margin (%)</label>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.1"
                        placeholder="e.g. 22.5"
                        value={editExpectedMargin}
                        onChange={(e) => setEditExpectedMargin(e.target.value)}
                        className="w-full bg-black/60 border border-white/10 px-2 py-1 text-paper rounded-sm outline-none focus:border-signal"
                      />
                    ) : (
                      <span className="text-paper">
                        {opportunity.expected_margin !== null && opportunity.expected_margin !== undefined && opportunity.expected_margin !== ""
                          ? `${opportunity.expected_margin}%`
                          : "Unset"}
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-light block mb-1">Risk Profile</label>
                    {isEditing ? (
                      <select
                        value={editRiskLevel}
                        onChange={(e) => setEditRiskLevel(e.target.value)}
                        className="w-full bg-black/60 border border-white/10 px-2 py-1 text-paper rounded-sm outline-none focus:border-signal text-xs"
                      >
                        <option value="Low">Low Risk</option>
                        <option value="Medium">Medium Risk</option>
                        <option value="High">High Risk</option>
                      </select>
                    ) : (
                      <span className={`font-semibold ${
                        opportunity.risk_level === "High" ? "text-red-400" : opportunity.risk_level === "Medium" ? "text-amber-400" : "text-emerald-400"
                      }`}>
                        {opportunity.risk_level || "Low"}
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-light block mb-1">Next Follow-up Due</label>
                    {isEditing ? (
                      <input
                        type="date"
                        value={editNextActivityDueAt}
                        onChange={(e) => setEditNextActivityDueAt(e.target.value)}
                        className="w-full bg-black/60 border border-white/10 px-2 py-1 text-paper rounded-sm outline-none focus:border-signal"
                      />
                    ) : (
                      <span className="text-paper">
                        {opportunity.next_activity_due_at
                          ? new Date(opportunity.next_activity_due_at).toLocaleDateString()
                          : "No follow-up set"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: QUOTATION & PROJECT INTEGRATION */}
          {activeTab === "quotation" && (
            <div className="space-y-4">
              {/* Quotation Status Card */}
              <div className="border border-white/10 bg-white/[0.02] p-4 rounded-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-signal" />
                    <h3 className="font-sans font-bold text-xs text-paper uppercase tracking-wider">
                      Commercial Quotation
                    </h3>
                  </div>
                  {opportunity.quote_id ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                      Quote: {opportunity.quote_status || "Active"}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-slate-light border border-white/10">
                      Unquoted
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-light">
                  {opportunity.quote_id
                    ? "This opportunity is formally tied to an estimate workbook in Quotations & Estimations."
                    : "Initialize a formal client quotation to compute rates, markup, and export a client-ready PDF."}
                </p>

                {opportunity.quote_id ? (
                  <div className="pt-2 flex items-center gap-3">
                    <Link
                      href={`/dashboard/quotations/builder?id=${opportunity.quote_id}`}
                      target="_blank"
                      className="inline-flex items-center gap-1.5 bg-signal px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 rounded-sm transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open in Quotations Builder</span>
                    </Link>
                  </div>
                ) : (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleCreateQuotation}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1.5 bg-signal px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 rounded-sm transition-colors disabled:opacity-50"
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      <span>Initialize Formal Quotation</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Execution Project Card (Handoff) */}
              <div className="border border-white/10 bg-white/[0.02] p-4 rounded-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-sans font-bold text-xs text-paper uppercase tracking-wider">
                      Execution Project Handoff
                    </h3>
                  </div>
                  {opportunity.project_id ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Live Project Active
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-slate-light border border-white/10">
                      Awaiting Contract Won
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-light">
                  {opportunity.project_id
                    ? `Awarded deal handed off to Delivery operations under project "${opportunity.project_name || opportunity.name}".`
                    : "Confirming this deal as Won automatically spawns the project record and preserves commercial provenance."}
                </p>

                {opportunity.project_id && (
                  <div className="pt-2">
                    <Link
                      href={`/dashboard/projects/${opportunity.project_id}`}
                      target="_blank"
                      className="inline-flex items-center gap-1.5 border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-xs text-emerald-300 hover:bg-emerald-500/20 rounded-sm transition-colors"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>View Delivery Project Console</span>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: DEAL-SCOPED ATTACHMENTS (STRICTLY ISOLATED) */}
          {activeTab === "documents" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-sans font-bold text-xs text-paper uppercase tracking-wider">
                    Deal Files &amp; Technical Drawings
                  </h3>
                  <p className="text-[11px] text-slate-light mt-0.5">
                    Supporting files attached strictly to this specific deal.
                  </p>
                </div>

                <label className={`inline-flex items-center gap-1.5 border border-signal/40 bg-signal/10 px-3 py-1.5 font-mono text-xs text-signal hover:bg-signal hover:text-ink rounded-sm cursor-pointer transition-colors ${
                  uploadingDoc ? "opacity-50 pointer-events-none" : ""
                }`}>
                  {uploadingDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                  <span>{uploadingDoc ? "Uploading..." : "Attach File"}</span>
                  <input
                    type="file"
                    className="hidden"
                    disabled={uploadingDoc}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadAttachment(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              {/* Scoped Documents List */}
              {loadingDocs ? (
                <div className="flex items-center justify-center py-8 text-slate-light">
                  <Loader2 className="w-5 h-5 animate-spin text-signal" />
                </div>
              ) : documents.length === 0 ? (
                <div className="border border-dashed border-white/10 p-8 rounded-sm text-center">
                  <FileText className="w-8 h-8 text-slate-light/40 mx-auto mb-2" />
                  <p className="text-xs text-paper font-semibold">No attachments on this deal yet</p>
                  <p className="text-[10px] text-slate-light mt-1">
                    Upload customer specifications, RFQ documents, or sketches. Only files attached to this opportunity appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-2.5 bg-black/40 border border-white/5 rounded-sm hover:border-white/20 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-signal shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-paper font-medium truncate">{doc.title || doc.file_name}</p>
                          <p className="font-mono text-[9px] text-slate-light">
                            {doc.file_size_bytes ? `${Math.round(doc.file_size_bytes / 1024)} KB` : "File"} · {new Date(doc.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handlePreviewDoc(doc.id)}
                          className="p-1 text-slate-light hover:text-paper hover:bg-white/5 rounded-sm"
                          title="Preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUnlinkDoc(doc.id)}
                          className="p-1 text-slate-light hover:text-rose-400 hover:bg-rose-500/10 rounded-sm"
                          title="Unlink from opportunity"
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

          {/* TAB 4: ACTIVITY & TOUCHPOINTS */}
          {activeTab === "activity" && (
            <div className="space-y-4">
              {/* Log Note Form */}
              <form onSubmit={handleLogNote} className="border border-white/10 bg-white/[0.02] p-3 rounded-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">
                    Record Touchpoint
                  </span>
                  <div className="flex gap-1 font-mono text-[9px]">
                    {(["note", "call", "meeting", "email"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setNewNoteType(t)}
                        className={`px-2 py-0.5 rounded-sm uppercase ${
                          newNoteType === t ? "bg-signal text-ink font-bold" : "text-slate hover:text-paper"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  rows={2}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Record summary of discussion, agreed price points, or client requests..."
                  className="w-full bg-black/60 border border-white/10 p-2 text-xs text-paper rounded-sm outline-none focus:border-signal font-sans placeholder:text-slate"
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={loggingNote || !newNote.trim()}
                    className="inline-flex items-center gap-1.5 bg-signal px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-ink rounded-sm hover:bg-signal/90 disabled:opacity-40"
                  >
                    {loggingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    <span>Record Activity</span>
                  </button>
                </div>
              </form>

              {/* Timeline Feed */}
              {loadingActivities ? (
                <div className="flex justify-center py-6 text-slate-light">
                  <Loader2 className="w-5 h-5 animate-spin text-signal" />
                </div>
              ) : activities.length === 0 ? (
                <p className="text-center py-6 text-xs font-mono text-slate-light">No activity recorded for this deal yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {activities.map((act) => (
                    <div key={act.id} className="p-2.5 border-l-2 border-signal bg-black/30 border-t border-r border-b border-white/5 rounded-r-sm text-xs">
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="font-mono text-[9px] uppercase tracking-wider text-signal font-bold">
                          {act.type}
                        </span>
                        <span className="font-mono text-[9px] text-slate-light">
                          {new Date(act.activity_date || act.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-paper/90 whitespace-pre-wrap">{act.notes || act.description || act.subject}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Bottom Action Footer */}
        <div className="p-3 bg-black/80 border-t border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {!isWon && (
              <button
                type="button"
                onClick={() => setIsWinModalOpen(true)}
                className="inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-ink px-3 py-1.5 rounded-sm font-mono text-xs font-bold uppercase tracking-wider transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Mark Won</span>
              </button>
            )}

            {!isLost && (
              <button
                type="button"
                onClick={() => setIsLostModalOpen(true)}
                className="inline-flex items-center gap-1.5 bg-white/5 hover:bg-red-500/20 text-slate hover:text-red-300 border border-white/10 hover:border-red-500/30 px-3 py-1.5 rounded-sm font-mono text-xs font-bold uppercase tracking-wider transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>Mark Lost</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 font-mono text-xs uppercase tracking-wider text-slate-light hover:text-paper"
          >
            Close
          </button>
        </div>
      </div>

      {/* WIN MODAL */}
      {isWinModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0C0F17] border border-emerald-500/40 p-5 rounded-sm max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-white/10 pb-2">
              <h3 className="font-sans font-bold text-sm text-paper flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Confirm Opportunity Win
              </h3>
              <button type="button" onClick={() => setIsWinModalOpen(false)} className="text-slate hover:text-paper">✕</button>
            </div>

            <p className="text-xs text-slate-light">
              Marking <strong className="text-paper">{opportunity.name}</strong> as Won commits this deal, records commercial revenue, and prepares project initialization.
            </p>

            <div className="space-y-2 text-xs font-mono">
              <label className="text-slate-light block">Execution Department</label>
              <select
                value={winDepartmentId}
                onChange={(e) => setWinDepartmentId(e.target.value)}
                className="w-full bg-black border border-white/10 p-2 text-paper rounded-sm outline-none focus:border-emerald-500 text-xs"
              >
                <option value="">-- Use default department --</option>
                {departments.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>

              <label className="text-slate-light block mt-2">Handoff Notes (optional)</label>
              <textarea
                rows={2}
                value={winNotes}
                onChange={(e) => setWinNotes(e.target.value)}
                placeholder="Client specifications, handover date, or payment agreements..."
                className="w-full bg-black border border-white/10 p-2 text-paper rounded-sm outline-none focus:border-emerald-500 font-sans"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setIsWinModalOpen(false)}
                className="px-3 py-1 font-mono text-xs uppercase text-slate hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmWon}
                disabled={isSubmittingOutcome}
                className="bg-emerald-500 hover:bg-emerald-600 text-ink font-bold font-mono text-xs px-4 py-1.5 uppercase rounded-sm flex items-center gap-1.5"
              >
                {isSubmittingOutcome ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>Confirm Win</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LOST MODAL */}
      {isLostModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0C0F17] border border-red-500/40 p-5 rounded-sm max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-white/10 pb-2">
              <h3 className="font-sans font-bold text-sm text-paper flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-400" /> Record Opportunity Loss
              </h3>
              <button type="button" onClick={() => setIsLostModalOpen(false)} className="text-slate hover:text-paper">✕</button>
            </div>

            <p className="text-xs text-slate-light">
              Identify why <strong className="text-paper">{opportunity.name}</strong> was lost to calibrate commercial win/loss diagnostics.
            </p>

            <div className="space-y-2 text-xs font-mono">
              <label className="text-slate-light block">Primary Loss Reason</label>
              <select
                value={lossReason}
                onChange={(e) => setLossReason(e.target.value)}
                className="w-full bg-black border border-white/10 p-2 text-paper rounded-sm outline-none focus:border-red-500 text-xs"
              >
                <option value="">-- Select Loss Reason --</option>
                {lossReasonsList.map((r) => (
                  <option key={r.id} value={r.label}>{r.label}</option>
                ))}
                <option value="Price Too High">Price Too High / Pricing Pressure</option>
                <option value="Competitor Selected">Competitor Selected</option>
                <option value="Project Cancelled">Client Cancelled / Scope Shelved</option>
                <option value="Compliance Gap">Compliance or Certification Gap</option>
                <option value="Timeline Unfeasible">Timeline / Resource Unfeasible</option>
                <option value="Other">Other Reason</option>
              </select>

              <label className="text-slate-light block mt-2">Loss Diagnosis Details</label>
              <textarea
                rows={2}
                value={lossReasonNotes}
                onChange={(e) => setLossReasonNotes(e.target.value)}
                placeholder="Competitor name, price delta, or client debrief feedback..."
                className="w-full bg-black border border-white/10 p-2 text-paper rounded-sm outline-none focus:border-red-500 font-sans"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setIsLostModalOpen(false)}
                className="px-3 py-1 font-mono text-xs uppercase text-slate hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLost}
                disabled={isSubmittingOutcome || !lossReason.trim()}
                className="bg-red-500 hover:bg-red-600 text-white font-bold font-mono text-xs px-4 py-1.5 uppercase rounded-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmittingOutcome ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                <span>Record Loss</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
