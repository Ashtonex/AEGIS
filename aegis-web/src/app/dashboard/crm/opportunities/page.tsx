"use client";

import React, { useCallback, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

import {
  Briefcase, Plus, X, ChevronLeft, ChevronRight,
  DollarSign, Activity, AlertTriangle, ShieldCheck,
  MessageSquare, User, Mail, Calendar, Loader2, Save,
  ArrowRight, Landmark, Clock, ArrowLeft, Filter, Search,
  Trash2, Copy, Lock
} from 'lucide-react';
import {
  getCrmOpportunities,
  createCrmOpportunity,
  updateCrmOpportunity,
  deleteCrmOpportunity,
  findDuplicateCrmOpportunities,
  mergeCrmOpportunities,
  getCrmContacts,
  createCrmContact,
  getCrmOrganizations,
  getCrmActivities,
  createCrmActivity,
  createCrmOpportunityQuotation,
  markCrmOpportunityWon,
  markCrmOpportunityLost,
  getCrmWinLossReasons,
  createCrmWinLossReason,
  getFinanceDepartments,
  describeActionError,
} from '@/lib/api';
import { useLiveTable } from '@/lib/live/LiveDataProvider';
import { useAuth } from '@/lib/auth/AuthContext';
import { matchesRole } from '@/lib/rbacMatch';
import { EntityDocumentsPanel } from '@/components/documents/EntityDocumentsPanel';
import { AssignmentPanel } from '@/components/documents/AssignmentPanel';

// A deal that's already won (Contract) or lost is a decided deal - only
// these roles can reopen/re-stage it (matches the backend's
// crm.opportunities.override_stage permission grants).
const PRIVILEGED_STAGE_OVERRIDE_ROLES = ['Executive (Admin)', 'Managing Director'];
const LOCKED_BACKEND_STAGES = ['Contract', 'Lost'];

// Stages definition requested by user
const STAGES = [
  'Qualification',
  'Proposal',
  'Negotiation',
  'Won',
  'Lost'
];

// Bidirectional mappings to bridge the requested frontend stages to strict backend database schemas
const FRONTEND_TO_BACKEND_STAGE: Record<string, string> = {
  'Qualification': 'Qualification',
  'Proposal': 'Quotation',
  'Negotiation': 'Negotiation',
  'Won': 'Contract',
  'Lost': 'Lost'
};

const BACKEND_TO_FRONTEND_STAGE: Record<string, string> = {
  'Inquiry': 'Qualification',
  'Site Visit': 'Qualification',
  'Qualification': 'Qualification',
  'Quotation': 'Proposal',
  'Negotiation': 'Negotiation',
  'Contract': 'Won',
  'Lost': 'Lost'
};

const formatCurrency = (value: number | string) => {
  const amount = Number(value || 0);
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

// crm.activities requires a non-empty `subject` (<=255 chars) and has no `notes`
// column - the free-text body belongs in `description`.
const activityLogFields = (message: string) => ({
  subject: message.length > 100 ? `${message.slice(0, 97)}...` : message,
  description: message,
});

interface Opportunity {
  id: string;
  name: string;
  stage: string;
  budget: number | string;
  probability: number;
  expected_margin?: number | string;
  risk_level?: string;
  client_id?: string;
  client_name?: string;
  client_org_id?: string;
  organization_name?: string;
  quote_id?: string;
  quote_status?: string;
  project_id?: string;
  project_name?: string;
  weighted_value?: number | string;
  next_activity_due_at?: string;
  win_loss_status?: string;
  approval_status?: string;
  margin_approval_required?: boolean;
  risk_approval_required?: boolean;
  is_stale?: boolean;
  created_at: string;
}

interface Contact {
  id: string;
  contact_name: string;
  email?: string;
}

interface CrmOrganization {
  id: string;
  name: string;
}

interface ActivityLog {
  id: string;
  type: string;
  subject?: string;
  description?: string;
  opportunity_id?: string;
  activity_date?: string;
  contact_name?: string;
}

export default function OpportunitiesKanban() {
  const { role } = useAuth();
  const canOverrideStage = role ? matchesRole(role, PRIVILEGED_STAGE_OVERRIDE_ROLES) : false;
  const isOpportunityLocked = (opp: Opportunity) => LOCKED_BACKEND_STAGES.includes(opp.stage);

  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [organizations, setOrganizations] = useState<CrmOrganization[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);

  // Close Win/Loss and Forecast States
  const [showForecast, setShowForecast] = useState(false);
  const [isCloseLossModalOpen, setIsCloseLossModalOpen] = useState(false);
  const [lossReason, setLossReason] = useState('');
  const [lossReasonOptions, setLossReasonOptions] = useState<any[]>([]);
  const [selectedLossReasonId, setSelectedLossReasonId] = useState('');
  const [isCloseWinModalOpen, setIsCloseWinModalOpen] = useState(false);
  const [winNotes, setWinNotes] = useState('');
  const [winReasonOptions, setWinReasonOptions] = useState<any[]>([]);
  const [selectedWinReasonId, setSelectedWinReasonId] = useState('');
  const [winDepartmentOptions, setWinDepartmentOptions] = useState<any[]>([]);
  const [selectedWinDepartmentId, setSelectedWinDepartmentId] = useState('');
  const [selectedWinOriginatingDepartmentId, setSelectedWinOriginatingDepartmentId] = useState('');

  // Duplicate Check States
  const [isDuplicateChecking, setIsDuplicateChecking] = useState(false);
  const [duplicateOpps, setDuplicateOpps] = useState<Opportunity[]>([]);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);


  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [minBudget, setMinBudget] = useState<number | ''>('');
  const [selectedRisk, setSelectedRisk] = useState<string>('All');
  const [valueRange, setValueRange] = useState<string>('All');

  // Drag and Drop Hover Effect State
  const [draggedOverStage, setDraggedOverStage] = useState<string | null>(null);

  // Form State
  const [newDeal, setNewDeal] = useState({
    name: '',
    stage: 'Qualification',
    budget: '',
    probability: '20',
    expected_margin: '15',
    risk_level: 'Low',
    client_id: '',
    client_org_id: '',
    new_contact_name: '',
    new_contact_email: ''
  });

  const [showNewContactFields, setShowNewContactFields] = useState(false);

  // Edit Drawer Form State
  const [editForm, setEditForm] = useState<{
    name: string;
    stage: string;
    budget: string;
    probability: string;
    expected_margin: string;
    risk_level: string;
    client_id: string;
    client_org_id: string;
  } | null>(null);

  // New Note State
  const [newNote, setNewNote] = useState({
    type: 'Meeting',
    notes: ''
  });

  const loadFailureMessage = (reason: unknown) => {
    const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
    const normalizedMessage = rawMessage.toLowerCase();
    if (
      normalizedMessage.includes("signal is aborted") ||
      normalizedMessage.includes("operation was aborted") ||
      normalizedMessage.includes("aborterror") ||
      normalizedMessage.includes("timeouterror")
    ) {
      return "The CRM feed is still synchronizing. Please retry once the connection is ready.";
    }
    return "Error loading CRM opportunities data.";
  };

  const normalizeActionError = (reason: unknown, fallback: string) => {
    const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
    if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
      return fallback;
    }
    return fallback;
  };

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [oppsRes, contactsRes, activitiesRes, orgsRes] = await Promise.allSettled([
        getCrmOpportunities(),
        getCrmContacts(),
        getCrmActivities(),
        getCrmOrganizations()
      ]);

      const warnings: string[] = [];
      if (oppsRes.status === "fulfilled" && oppsRes.value.success && Array.isArray(oppsRes.value.data)) {
        setOpportunities(oppsRes.value.data);
      } else {
        warnings.push("Opportunities could not be loaded.");
      }
      if (contactsRes.status === "fulfilled" && contactsRes.value.success && Array.isArray(contactsRes.value.data)) {
        setContacts(contactsRes.value.data);
      } else {
        warnings.push("Contacts could not be loaded.");
      }
      if (activitiesRes.status === "fulfilled" && activitiesRes.value.success && Array.isArray(activitiesRes.value.data)) {
        setActivities(activitiesRes.value.data);
      } else {
        warnings.push("Activity log could not be loaded.");
      }
      if (orgsRes.status === "fulfilled" && orgsRes.value.success && Array.isArray(orgsRes.value.data)) {
        setOrganizations(orgsRes.value.data);
      } else {
        warnings.push("Organizations could not be loaded.");
      }
      setSourceWarnings(warnings);
      if (oppsRes.status === "rejected") {
        throw new Error(loadFailureMessage(oppsRes.reason));
      }
    } catch (error) {
      console.error('Error loading CRM opportunities data:', error);
      setLoadError(loadFailureMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // loadData() already fetches opportunities/contacts/activities together,
  // so a change to any of the three just triggers the same refetch - safe
  // to call plainly since this page only blanks to a spinner on a genuine
  // first load (isLoading && opportunities.length === 0), not on this kind
  // of background refresh.
  useLiveTable("crm.opportunities", () => void loadData());
  useLiveTable("crm.contacts", () => void loadData());
  useLiveTable("crm.activities", () => void loadData());
  useLiveTable("crm.organizations", () => void loadData());

  // Drag and Drop Event Handlers
  const handleDragStart = (e: React.DragEvent, oppId: string) => {
    e.dataTransfer.setData('text/plain', oppId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
  };

  const handleDragEnter = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    setDraggedOverStage(stage);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDraggedOverStage(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    setDraggedOverStage(null);
    const oppId = e.dataTransfer.getData('text/plain');
    if (!oppId) return;

    const opp = opportunities.find(o => o.id === oppId);
    if (!opp) return;

    const currentFrontendStage = BACKEND_TO_FRONTEND_STAGE[opp.stage] || 'Qualification';
    if (currentFrontendStage === targetStage) return;

    if (isOpportunityLocked(opp) && !canOverrideStage) {
      alert("This deal is already won or lost - only Admin, Executive, or Managing Director can change its stage further.");
      return;
    }

    const backendStage = FRONTEND_TO_BACKEND_STAGE[targetStage] || targetStage;

    // Optimistically update local state
    setOpportunities(prev => prev.map(o => o.id === oppId ? { ...o, stage: backendStage } : o));

    try {
      const res = await updateCrmOpportunity(oppId, { stage: backendStage });
      if (!res.success) {
        // Rollback on failure
        loadData();
      } else {
        try {
          await createCrmActivity({
            type: 'System Log',
            ...activityLogFields(`Stage moved from ${currentFrontendStage} to ${targetStage} (via drag & drop)`),
            opportunity_id: oppId
          });
          const actRes = await getCrmActivities();
          if (actRes.success && Array.isArray(actRes.data)) {
            setActivities(actRes.data);
          }
        } catch (logErr) {
          // The stage move already succeeded - a logging hiccup shouldn't roll it back or surface as an error.
          console.warn('Failed to log stage-move activity:', logErr);
        }
      }
    } catch (err) {
      console.error('Failed to drag-drop stage:', err);
      setLoadError(normalizeActionError(err, "The opportunity board is still synchronizing. Please retry once the connection is ready."));
      loadData();
    }
  };

  // Quick fallback step mover
  const handleStageMove = async (oppId: string, currentFrontendStage: string, direction: 'prev' | 'next') => {
    const opp = opportunities.find(o => o.id === oppId);
    if (opp && isOpportunityLocked(opp) && !canOverrideStage) {
      alert("This deal is already won or lost - only Admin, Executive, or Managing Director can change its stage further.");
      return;
    }

    const currentIndex = STAGES.indexOf(currentFrontendStage);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (direction === 'prev' && currentIndex > 0) nextIndex--;
    if (direction === 'next' && currentIndex < STAGES.length - 1) nextIndex++;

    if (nextIndex === currentIndex) return;
    const nextFrontendStage = STAGES[nextIndex];
    const backendStage = FRONTEND_TO_BACKEND_STAGE[nextFrontendStage];

    // Optimistically update state
    setOpportunities(prev => prev.map(o => o.id === oppId ? { ...o, stage: backendStage } : o));

    try {
      const res = await updateCrmOpportunity(oppId, { stage: backendStage });
      if (!res.success) {
        loadData();
      } else {
        try {
          await createCrmActivity({
            type: 'System Log',
            ...activityLogFields(`Stage moved from ${currentFrontendStage} to ${nextFrontendStage}`),
            opportunity_id: oppId
          });
          const actRes = await getCrmActivities();
          if (actRes.success && Array.isArray(actRes.data)) {
            setActivities(actRes.data);
          }
        } catch (logErr) {
          console.warn('Failed to log stage-move activity:', logErr);
        }
      }
    } catch (err) {
      console.error('Failed to update stage:', err);
      setLoadError(normalizeActionError(err, "The opportunity board is still synchronizing. Please retry once the connection is ready."));
      loadData();
    }
  };

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeal.name.trim()) return;

    setIsSubmitting(true);
    try {
      let finalClientId = newDeal.client_id;

      if (showNewContactFields && newDeal.new_contact_name.trim()) {
        const contactRes = await createCrmContact({
          contact_name: newDeal.new_contact_name.trim(),
          email: newDeal.new_contact_email.trim() || undefined
        });
        if (contactRes.success && contactRes.data?.id) {
          finalClientId = contactRes.data.id;
        }
      }

      const budgetVal = Number(newDeal.budget) || 0;
      const probVal = Number(newDeal.probability) || 0;
      const marginVal = Number(newDeal.expected_margin) || 0;

      const oppPayload: any = {
        name: newDeal.name.trim(),
        stage: FRONTEND_TO_BACKEND_STAGE[newDeal.stage] || 'Qualification',
        budget: budgetVal,
        probability: probVal
      };

      if (finalClientId) oppPayload.client_id = finalClientId;
      if (newDeal.client_org_id) oppPayload.client_org_id = newDeal.client_org_id;
      if (marginVal) oppPayload.expected_margin = marginVal;
      if (newDeal.risk_level) oppPayload.risk_level = newDeal.risk_level;

      const res = await createCrmOpportunity(oppPayload);

      if (res.success) {
        if ((res.data as any)?.id && (marginVal || newDeal.risk_level || finalClientId)) {
          const enrichPayload: any = {};
          if (marginVal) enrichPayload.expected_margin = marginVal;
          if (newDeal.risk_level) enrichPayload.risk_level = newDeal.risk_level;
          if (finalClientId) enrichPayload.client_id = finalClientId;
          await updateCrmOpportunity((res.data as any).id, enrichPayload);
        }

        setNewDeal({
          name: '',
          stage: 'Qualification',
          budget: '',
          probability: '20',
          expected_margin: '15',
          risk_level: 'Low',
          client_id: '',
          client_org_id: '',
          new_contact_name: '',
          new_contact_email: ''
        });
        setShowNewContactFields(false);
        setIsModalOpen(false);
        await loadData();
      }
    } catch (err) {
      console.error('Failed to create opportunity:', err);
      setLoadError(normalizeActionError(err, "The opportunity board is still synchronizing. Please retry once the connection is ready."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateDealDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOpportunityId || !editForm) return;

    setIsSubmitting(true);
    try {
      const budgetVal = Number(editForm.budget) || 0;
      const probVal = Number(editForm.probability) || 0;
      const marginVal = Number(editForm.expected_margin) || 0;

      const updatePayload = {
        name: editForm.name,
        stage: FRONTEND_TO_BACKEND_STAGE[editForm.stage] || 'Qualification',
        budget: budgetVal,
        probability: probVal,
        expected_margin: marginVal,
        risk_level: editForm.risk_level,
        client_id: editForm.client_id || null,
        client_org_id: editForm.client_org_id || null
      };

      const res = await updateCrmOpportunity(selectedOpportunityId, updatePayload);
      if (res.success) {
        await loadData();
        try {
          await createCrmActivity({
            type: 'Update',
            ...activityLogFields(`Updated deal parameters: Stage: ${editForm.stage}, Win Prob ${probVal}%, Est Margin ${marginVal}%, Risk: ${editForm.risk_level}`),
            opportunity_id: selectedOpportunityId
          });
          const actRes = await getCrmActivities();
          if (actRes.success && Array.isArray(actRes.data)) {
            setActivities(actRes.data);
          }
        } catch (logErr) {
          // The deal update already succeeded - a logging hiccup shouldn't surface as an error.
          console.warn('Failed to log deal-update activity:', logErr);
        }
      }
    } catch (err) {
      console.error('Failed to update opportunity details:', err);
      setLoadError(normalizeActionError(err, "The opportunity board is still synchronizing. Please retry once the connection is ready."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOpportunityId || !newNote.notes.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await createCrmActivity({
        type: newNote.type,
        ...activityLogFields(newNote.notes.trim()),
        opportunity_id: selectedOpportunityId
      });
      if (res.success) {
        setNewNote(prev => ({ ...prev, notes: '' }));
        const actRes = await getCrmActivities();
        if (actRes.success && Array.isArray(actRes.data)) {
          setActivities(actRes.data);
        }
      }
    } catch (err) {
      console.error('Failed to add note:', err);
      setLoadError(normalizeActionError(err, "The opportunity board is still synchronizing. Please retry once the connection is ready."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateQuotation = async () => {
    if (!selectedOpportunityId || !selectedOpp) return;
    setIsSubmitting(true);
    try {
      const response = await createCrmOpportunityQuotation(selectedOpportunityId, {
        quote_amount: Number(selectedOpp.budget || selectedOpp.weighted_value || 0),
        status: "sent"
      });
      if (!response?.data?.id) throw new Error("CRM quotation response did not include an id.");
      await loadData();
    } catch (error) {
      console.warn("Quotation handoff failed", error);
      alert("Quotation was not created. Check the CRM service connection and retry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkWon = async () => {
    setWinNotes('');
    setSelectedWinReasonId('');
    setSelectedWinDepartmentId('');
    setSelectedWinOriginatingDepartmentId('');
    setIsCloseWinModalOpen(true);
    try {
      const res = await getCrmWinLossReasons('won');
      if (res.success && Array.isArray(res.data)) setWinReasonOptions(res.data);
    } catch {
      setWinReasonOptions([]);
    }
    try {
      const res = await getFinanceDepartments();
      if (res.success && Array.isArray(res.data)) setWinDepartmentOptions(res.data);
    } catch {
      setWinDepartmentOptions([]);
    }
  };

  const handleConfirmMarkWon = async () => {
    if (!selectedOpportunityId) return;
    setIsSubmitting(true);
    try {
      let reasonId = selectedWinReasonId || undefined;
      if (!reasonId && winNotes.trim()) {
        const created = await createCrmWinLossReason({ reason_type: 'won', label: winNotes.trim() });
        if (created.success) reasonId = created.data?.id;
      }
      const wonResult = await markCrmOpportunityWon(selectedOpportunityId, {
        create_project: true,
        win_loss_reason: winNotes.trim() || undefined,
        win_loss_reason_id: reasonId,
        department_id: selectedWinDepartmentId || undefined,
        originating_department_id: selectedWinOriginatingDepartmentId || undefined,
      });
      setIsCloseWinModalOpen(false);
      const budgetPendingReason = wonResult?.data?.budget_pending_reason;
      if (budgetPendingReason) {
        // The win itself always goes through - this only flags that the
        // project's execution budget wasn't auto-seeded (segregation of
        // duties, or an unpriced BOQ) and still needs a second person to
        // confirm it via Quotations > Decision.
        alert(`Deal marked won. Budget not yet seeded: ${budgetPendingReason}`);
      }
      try {
        await createCrmActivity({
          type: 'System Log',
          ...activityLogFields(`Deal Closed Won! Notes: ${winNotes}`),
          opportunity_id: selectedOpportunityId
        });
      } catch (logErr) {
        // The win handoff already succeeded - a logging hiccup shouldn't mask that.
        console.warn('Failed to log won-deal activity:', logErr);
      }
      await loadData();
    } catch (error) {
      console.warn("Project handoff failed", error);
      alert(describeActionError(
        error,
        "You don't have permission to close this deal as Won - closing a deal creates a real project commitment, so it needs sign-off from a manager or exec. Ask them to close it, or hand it off.",
        "Opportunity was not marked won. Check the CRM service connection and retry."
      ));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkLost = async () => {
    setLossReason('');
    setSelectedLossReasonId('');
    setIsCloseLossModalOpen(true);
    try {
      const res = await getCrmWinLossReasons('lost');
      if (res.success && Array.isArray(res.data)) setLossReasonOptions(res.data);
    } catch {
      setLossReasonOptions([]);
    }
  };

  const handleConfirmMarkLost = async () => {
    if (!selectedOpportunityId) return;
    setIsSubmitting(true);
    try {
      let reasonId = selectedLossReasonId || undefined;
      if (!reasonId && lossReason.trim()) {
        const created = await createCrmWinLossReason({ reason_type: 'lost', label: lossReason.trim() });
        if (created.success) reasonId = created.data?.id;
      }
      await markCrmOpportunityLost(selectedOpportunityId, { win_loss_reason: lossReason.trim(), win_loss_reason_id: reasonId });
      setIsCloseLossModalOpen(false);
      try {
        await createCrmActivity({
          type: 'System Log',
          ...activityLogFields(`Deal Closed Lost. Reason: ${lossReason}`),
          opportunity_id: selectedOpportunityId
        });
      } catch (logErr) {
        // The loss was already recorded - a logging hiccup shouldn't mask that.
        console.warn('Failed to log lost-deal activity:', logErr);
      }
      await loadData();
    } catch (error) {
      console.warn("Lost opportunity update failed", error);
      alert(describeActionError(
        error,
        "You don't have permission to close this deal as Lost.",
        "Opportunity was not marked lost. Check the CRM service connection and retry."
      ));
    } finally {
      setIsSubmitting(false);
    }
  };


  const handleCheckDuplicateOpportunities = async (opp: Opportunity) => {
    setIsDuplicateChecking(true);
    try {
      const res = await findDuplicateCrmOpportunities({ name: opp.name, client_id: opp.client_id });
      if (res.success && Array.isArray(res.data)) {
        setDuplicateOpps(res.data.filter((o: Opportunity) => o.id !== opp.id));
      } else {
        setDuplicateOpps([]);
      }
      setIsDupModalOpen(true);
    } catch (err) {
      console.error('Duplicate check failed:', err);
      alert("Duplicate check failed. Check the CRM service connection and retry.");
    } finally {
      setIsDuplicateChecking(false);
    }
  };

  const handleMergeIntoExisting = async (existingOppId: string) => {
    if (!selectedOpportunityId) return;
    setIsSubmitting(true);
    try {
      const res = await mergeCrmOpportunities(existingOppId, [selectedOpportunityId]);
      if (res.success) {
        setIsDupModalOpen(false);
        setSelectedOpportunityId(null);
        await loadData();
      } else {
        alert("Deals were not merged. Check the CRM service connection and retry.");
      }
    } catch (err) {
      console.error('Merge failed:', err);
      alert("Deals were not merged. Check the CRM service connection and retry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteOpportunity = async (opp: Opportunity) => {
    if (!window.confirm(`Delete "${opp.name}"? This can't be undone from this screen.`)) return;
    setIsSubmitting(true);
    try {
      const res = await deleteCrmOpportunity(opp.id);
      if (res.success) {
        setSelectedOpportunityId(null);
        await loadData();
      } else {
        alert("Deal was not deleted. Check the CRM service connection and retry.");
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert("Deal was not deleted. Check the CRM service connection and retry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter application
  const filteredOpportunities = opportunities.filter(opp => {
    // Search filter
    const searchLower = searchQuery.toLowerCase();
    const nameMatch = opp.name.toLowerCase().includes(searchLower);
    const clientMatch = opp.client_name?.toLowerCase().includes(searchLower) ||
                       (opp.client_id ? (contacts.find(c => c.id === opp.client_id)?.contact_name.toLowerCase().includes(searchLower)) : false);
    const matchesSearch = searchQuery === '' || nameMatch || clientMatch;

    // Minimum budget filter
    const oppBudget = Number(opp.budget) || 0;
    const matchesMinBudget = minBudget === '' || oppBudget >= minBudget;

    // Value Range filter
    let matchesRange = true;
    if (valueRange === 'Under 50k') {
      matchesRange = oppBudget < 50000;
    } else if (valueRange === '50k-250k') {
      matchesRange = oppBudget >= 50000 && oppBudget <= 250000;
    } else if (valueRange === 'Over 250k') {
      matchesRange = oppBudget > 250000;
    }

    // Risk level filter
    const matchesRisk = selectedRisk === 'All' || opp.risk_level === selectedRisk;

    return matchesSearch && matchesMinBudget && matchesRange && matchesRisk;
  });

  // Contacts list is a raw, unjoined SELECT with no uniqueness guard on the
  // backend - the "+ New Client Contact" quick-add historically produced
  // duplicate rows for the same person. Backend dedup/merge now exists, but
  // the picker still de-dupes client-side (keyed on lowercased email, else
  // lowercased name) so a stray duplicate never shows twice here regardless.
  const dedupedContacts = useMemo(() => {
    const seen = new Set<string>();
    return contacts.filter((c) => {
      const key = (c.email && c.email.trim().toLowerCase()) || c.contact_name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [contacts]);

  const selectedOpp = opportunities.find(o => o.id === selectedOpportunityId);
  const selectedOppActivities = activities.filter(a => a.opportunity_id === selectedOpportunityId);
  const selectedOppContact = selectedOpp?.client_id
    ? contacts.find(c => c.id === selectedOpp.client_id)
    : null;
  const selectedOppOrganization = selectedOpp?.client_org_id
    ? organizations.find(o => o.id === selectedOpp.client_org_id)
    : null;

  // Initialize edit drawer form when drawer opens
  useEffect(() => {
    if (selectedOpp) {
      setEditForm({
        name: selectedOpp.name,
        stage: BACKEND_TO_FRONTEND_STAGE[selectedOpp.stage] || 'Qualification',
        budget: String(selectedOpp.budget || ''),
        probability: String(selectedOpp.probability || ''),
        expected_margin: String(selectedOpp.expected_margin || ''),
        risk_level: selectedOpp.risk_level || 'Low',
        client_id: selectedOpp.client_id || '',
        client_org_id: selectedOpp.client_org_id || ''
      });
    } else {
      setEditForm(null);
    }
  }, [selectedOpp]);

  if (isLoading && opportunities.length === 0) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#D4AF37] animate-spin mb-4" />
        <span className="font-mono text-xs text-slate-light tracking-widest uppercase">Syncing Kanban Pipeline...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-paper p-6 relative overflow-hidden flex flex-col">

      {/* Header */}
      <header className="flex justify-between items-end border-b border-white/5 pb-4 mb-6 relative z-10 shrink-0">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-pulse"></span>
            <span className="font-mono text-[9px] text-[#3B82F6] uppercase tracking-widest">Active Pipeline telemetry</span>
          </div>
          <h1 className="font-sans font-black text-2xl tracking-tight text-paper uppercase">
            Deal Opportunities
          </h1>
        </div>

        <div className="flex items-center space-x-4">
          <Link
            href="/dashboard/crm"
            className="px-3.5 py-1.5 border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] rounded-sm text-[10px] font-mono tracking-widest text-slate-light uppercase transition-all"
          >
            ← Back to Command
          </Link>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center space-x-1.5 px-4 py-1.5 bg-[#D4AF37] text-black hover:bg-[#D4AF37]/90 rounded-sm text-[10px] font-mono tracking-widest uppercase font-bold transition-all shadow-[0_0_15px_rgba(212,175,55,0.2)]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Deal</span>
          </button>
        </div>
      </header>

      {loadError && (
        <div className="mb-6 rounded-sm border border-amber-500/20 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <p>{loadError}</p>
          </div>
        </div>
      )}

      {sourceWarnings.length > 0 && (
        <div className="mb-6 space-y-2 rounded border border-amber-500/20 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          {sourceWarnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p>{warning}</p>
            </div>
          ))}
        </div>
      )}

      {/* Pipeline stats banner */}
      <div className="grid grid-cols-4 gap-2 mb-6 shrink-0 z-10">
        <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
          <span className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1">Pipeline Total</span>
          <span className="font-mono text-lg font-bold text-paper tabular-nums">
            ${opportunities.reduce((sum, o) => sum + (Number(o.budget) || 0), 0).toLocaleString()}
          </span>
        </div>
        <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
          <span className="block font-mono text-[9px] text-[#3B82F6] uppercase tracking-wider mb-1">Weighted Value</span>
          <span className="font-mono text-lg font-bold text-[#3B82F6] tabular-nums">
            ${opportunities.reduce((sum, o) => sum + ((Number(o.budget) || 0) * (Number(o.probability) || 0) / 100), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
        <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
          <span className="block font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider mb-1">Average Margin</span>
          <span className="font-mono text-lg font-bold text-[#D4AF37] tabular-nums">
            {(opportunities.reduce((sum, o) => sum + (Number(o.expected_margin) || 0), 0) / (opportunities.filter(o => o.expected_margin).length || 1)).toFixed(1)}%
          </span>
        </div>
        <button
          onClick={() => setShowForecast(prev => !prev)}
          className={`border p-3 rounded-sm text-left transition-all ${
            showForecast ? 'bg-[#3B82F6]/10 border-[#3B82F6]/40 text-[#3B82F6]' : 'bg-[#0A0A0A] border-white/5 text-slate-light hover:border-white/10'
          }`}
        >
          <span className="block font-mono text-[9px] uppercase tracking-wider mb-1">Forecasting</span>
          <span className="font-mono text-xs font-bold block mt-1">
            {showForecast ? 'Hide Analysis' : 'Show Analysis'}
          </span>
        </button>
      </div>

      {showForecast && (
        <div className="bg-[#0B0F17]/95 border border-white/5 p-5 rounded-sm mb-6 animate-in slide-in-from-top duration-300">
          <h3 className="font-mono text-xs uppercase tracking-widest text-[#3B82F6] font-bold mb-4">Weighted Sales Forecasting Analysis</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-black/40 border border-white/5 p-4 rounded-sm">
              <h4 className="text-[10px] font-mono text-slate uppercase tracking-wider mb-2">High Risk Weighted Exposure</h4>
              <span className="text-xl font-mono text-rose-400 font-bold block">
                ${opportunities.filter(o => o.risk_level === 'High').reduce((sum, o) => sum + ((Number(o.budget) || 0) * (Number(o.probability) || 0) / 100), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <p className="text-[9px] text-slate mt-1 italic">High risk pipelines require stricter milestone clearance reviews.</p>
            </div>
            <div className="bg-black/40 border border-white/5 p-4 rounded-sm">
              <h4 className="text-[10px] font-mono text-slate uppercase tracking-wider mb-2">Medium Risk Forecast</h4>
              <span className="text-xl font-mono text-amber-400 font-bold block">
                ${opportunities.filter(o => o.risk_level === 'Medium' || !o.risk_level).reduce((sum, o) => sum + ((Number(o.budget) || 0) * (Number(o.probability) || 0) / 100), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <p className="text-[9px] text-slate mt-1 italic">Balanced deals currently in negotiation or quotation phase.</p>
            </div>
            <div className="bg-black/40 border border-white/5 p-4 rounded-sm">
              <h4 className="text-[10px] font-mono text-slate uppercase tracking-wider mb-2">Low Risk Secure Pipeline</h4>
              <span className="text-xl font-mono text-emerald-400 font-bold block">
                ${opportunities.filter(o => o.risk_level === 'Low').reduce((sum, o) => sum + ((Number(o.budget) || 0) * (Number(o.probability) || 0) / 100), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <p className="text-[9px] text-slate mt-1 italic">Highly probable closures aligned with secure public tenders.</p>
            </div>
          </div>
        </div>
      )}


      {/* Search and Filters panel */}
      <div className="bg-[#0A0A0A] border border-white/5 p-4 rounded-sm mb-6 flex flex-col lg:flex-row gap-4 justify-between items-center shrink-0 z-10">
        <div className="w-full lg:w-1/3 relative">
          <input
            type="text"
            placeholder="Search deals or clients..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-black border border-white/10 rounded-sm pl-9 pr-8 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all placeholder:text-slate"
          />
          <Search className="w-4 h-4 text-slate absolute left-3 top-2.5" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-slate hover:text-paper"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
          {/* Minimum Budget Filter */}
          <div className="flex items-center space-x-2 bg-black border border-white/10 rounded-sm px-3 py-1.5 min-w-[160px]">
            <span className="font-mono text-[8px] text-slate-light uppercase">Min Value ($):</span>
            <input
              type="number"
              placeholder="0"
              value={minBudget}
              onChange={e => setMinBudget(e.target.value !== '' ? Number(e.target.value) : '')}
              className="bg-transparent text-paper font-mono text-xs w-full focus:outline-none placeholder:text-slate"
            />
          </div>

          {/* Quick Value Range Buttons */}
          <div className="flex bg-black border border-white/10 p-0.5 rounded-sm">
            {['All', 'Under 50k', '50k-250k', 'Over 250k'].map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setValueRange(range)}
                className={`px-2.5 py-1 text-[9px] font-mono rounded-sm transition-all ${
                  valueRange === range
                    ? 'bg-[#D4AF37] text-black font-bold'
                    : 'text-slate-light hover:text-paper hover:bg-white/5'
                }`}
              >
                {range.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Risk Level filter */}
          <select
            value={selectedRisk}
            onChange={e => setSelectedRisk(e.target.value)}
            className="bg-black border border-white/10 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none"
          >
            <option value="All">All Risks</option>
            <option value="Low">Low Risk</option>
            <option value="Medium">Medium Risk</option>
            <option value="High">High Risk</option>
          </select>

          {/* Clear Filters Button */}
          {(searchQuery || minBudget !== '' || selectedRisk !== 'All' || valueRange !== 'All') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setMinBudget('');
                setSelectedRisk('All');
                setValueRange('All');
              }}
              className="text-[9px] font-mono text-[#D4AF37] hover:underline uppercase transition-all px-2 py-1.5"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Kanban Board Container */}
      <div className="flex-1 overflow-x-auto flex gap-4 pb-4 items-start min-h-0 select-none">
        {STAGES.map(stage => {
          const stageOpps = filteredOpportunities.filter(o => {
            const displayStage = BACKEND_TO_FRONTEND_STAGE[o.stage] || 'Qualification';
            return displayStage === stage;
          });
          const stageSum = stageOpps.reduce((sum, o) => sum + (Number(o.budget) || 0), 0);

          return (
            <div
              key={stage}
              onDragOver={(e) => handleDragOver(e, stage)}
              onDragEnter={(e) => handleDragEnter(e, stage)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage)}
              className={`flex-1 min-w-[280px] max-w-[320px] rounded-sm p-3 flex flex-col max-h-full min-h-[400px] transition-all duration-200 ${
                draggedOverStage === stage
                  ? 'bg-[#1a170f] border border-[#D4AF37]/40 shadow-[0_0_20px_rgba(212,175,55,0.08)] scale-[1.01]'
                  : 'bg-[#0A0A0A]/80 border border-white/5'
              }`}
            >
              {/* Stage header */}
              <div className="flex justify-between items-center pb-2.5 mb-3 border-b border-white/5 shrink-0">
                <div>
                  <h3 className="font-sans font-bold text-xs text-paper uppercase tracking-wider">{stage}</h3>
                  <span className="font-mono text-[9px] text-[#3B82F6] tabular-nums tracking-widest mt-0.5 block">
                    ${stageSum.toLocaleString()}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-slate bg-white/5 px-2 py-0.5 rounded-full">{stageOpps.length}</span>
              </div>

              {/* Cards Container */}
              <div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1 min-h-0">
                {stageOpps.map(opp => {
                  const oppContact = opp.client_id ? contacts.find(c => c.id === opp.client_id) : null;
                  const locked = isOpportunityLocked(opp);
                  const canMoveStage = !locked || canOverrideStage;

                  return (
                    <div
                      key={opp.id}
                      draggable={canMoveStage}
                      onDragStart={(e) => handleDragStart(e, opp.id)}
                      onClick={() => setSelectedOpportunityId(opp.id)}
                      className={`group bg-[#111111] border border-white/5 hover:border-[#D4AF37]/30 p-3 rounded-sm transition-all hover:shadow-[0_4px_20px_rgba(0,0,0,0.5)] transform hover:-translate-y-0.5 duration-150 relative overflow-hidden ${canMoveStage ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
                    >
                      {/* Top border colored by risk */}
                      <div className={`absolute top-0 left-0 w-full h-[2px] ${
                        opp.risk_level === 'High' ? 'bg-red-500' :
                        opp.risk_level === 'Medium' ? 'bg-[#D4AF37]' : 'bg-[#3B82F6]'
                      }`} />

                      <div className="flex justify-between items-start mb-1 pt-1">
                        <h4 className="text-xs font-semibold text-paper truncate pr-2 group-hover:text-[#D4AF37] transition-colors flex items-center gap-1">
                          {locked && <Lock className="w-2.5 h-2.5 text-slate shrink-0" />}
                          <span className="truncate">{opp.name}</span>
                        </h4>
                        <span className="font-mono text-[9px] text-slate-light bg-white/5 px-1 py-0.5 rounded-sm shrink-0">{opp.probability}%</span>
                      </div>

                      {oppContact && (
                        <span className="block font-mono text-[9px] text-slate-light mb-2">{oppContact.contact_name}</span>
                      )}

                      <div className="flex justify-between items-end border-t border-white/5 pt-2 mt-2">
                        <span className="font-mono text-[10px] font-bold text-[#3B82F6] tabular-nums">
                          ${(Number(opp.budget) || 0).toLocaleString()}
                        </span>

                        {/* Quick stage move control buttons */}
                        <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                          <button
                            disabled={STAGES.indexOf(stage) === 0 || !canMoveStage}
                            onClick={() => handleStageMove(opp.id, stage, 'prev')}
                            className="w-5 h-5 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none rounded-sm flex items-center justify-center transition-all text-slate-light"
                          >
                            <ChevronLeft className="w-3 h-3" />
                          </button>
                          <button
                            disabled={STAGES.indexOf(stage) === STAGES.length - 1 || !canMoveStage}
                            onClick={() => handleStageMove(opp.id, stage, 'next')}
                            className="w-5 h-5 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none rounded-sm flex items-center justify-center transition-all text-slate-light"
                          >
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {stageOpps.length === 0 && (
                  <div className="h-28 border border-dashed border-white/5 rounded-sm flex flex-col items-center justify-center opacity-40">
                    <span className="font-mono text-[9px] text-slate uppercase">Drop deal here</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CREATE DEAL MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />

          <div className="relative bg-[#0A0A0A] border border-white/10 w-full max-w-lg rounded-sm shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
              <div className="flex items-center space-x-2">
                <Briefcase className="w-4 h-4 text-[#D4AF37]" />
                <h2 className="font-sans font-bold text-sm text-paper uppercase tracking-wider">Initialize New Opportunity</h2>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-7 h-7 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-slate-light hover:text-paper transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDeal} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Opportunity Name</label>
                <input
                  required
                  type="text"
                  value={newDeal.name}
                  onChange={e => setNewDeal({ ...newDeal, name: e.target.value })}
                  className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all placeholder:text-slate"
                  placeholder="e.g. Zimplats Haulage Road construction"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Pipeline Stage</label>
                  <select
                    value={newDeal.stage}
                    onChange={e => setNewDeal({ ...newDeal, stage: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                  >
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Risk Classification</label>
                  <select
                    value={newDeal.risk_level}
                    onChange={e => setNewDeal({ ...newDeal, risk_level: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                  >
                    <option value="Low">Low Risk</option>
                    <option value="Medium">Medium Risk</option>
                    <option value="High">High Risk</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Expected Value ($)</label>
                  <input
                    required
                    type="number"
                    value={newDeal.budget}
                    onChange={e => setNewDeal({ ...newDeal, budget: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono"
                    placeholder="Value in USD"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Win Prob. (%)</label>
                  <input
                    required
                    type="number"
                    min="0"
                    max="100"
                    value={newDeal.probability}
                    onChange={e => setNewDeal({ ...newDeal, probability: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono"
                    placeholder="20"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Est Margin (%)</label>
                  <input
                    required
                    type="number"
                    min="0"
                    max="100"
                    value={newDeal.expected_margin}
                    onChange={e => setNewDeal({ ...newDeal, expected_margin: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono"
                    placeholder="15"
                  />
                </div>
              </div>

              {/* Organization Selection */}
              <div className="border-t border-white/5 pt-3 space-y-1">
                <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Client Organization</label>
                <select
                  value={newDeal.client_org_id}
                  onChange={e => setNewDeal({ ...newDeal, client_org_id: e.target.value })}
                  className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                >
                  <option value="">-- No Organization Associated --</option>
                  {organizations.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <p className="text-[9px] font-mono text-slate-light/70">A deal can carry its own name while still rolling up under one organization on Customer 360.</p>
              </div>

              {/* Client Selection */}
              <div className="border-t border-white/5 pt-3 space-y-3">
                <div className="flex justify-between items-center">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Client Contact Link</label>
                  <button
                    type="button"
                    onClick={() => setShowNewContactFields(!showNewContactFields)}
                    className="text-[9px] font-mono text-[#D4AF37] hover:underline uppercase"
                  >
                    {showNewContactFields ? 'Select Existing Contact' : '+ New Client Contact'}
                  </button>
                </div>

                {!showNewContactFields ? (
                  <select
                    value={newDeal.client_id}
                    onChange={e => setNewDeal({ ...newDeal, client_id: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                  >
                    <option value="">-- No Contact Associated --</option>
                    {dedupedContacts.map(c => (
                      <option key={c.id} value={c.id}>{c.contact_name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="grid grid-cols-2 gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-sm">
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Contact Name</label>
                      <input
                        type="text"
                        value={newDeal.new_contact_name}
                        onChange={e => setNewDeal({ ...newDeal, new_contact_name: e.target.value })}
                        className="w-full bg-black border border-white/10 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none font-sans"
                        placeholder="e.g. John Doe"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Email Address</label>
                      <input
                        type="email"
                        value={newDeal.new_contact_email}
                        onChange={e => setNewDeal({ ...newDeal, new_contact_email: e.target.value })}
                        className="w-full bg-black border border-white/10 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none font-sans"
                        placeholder="john@company.com"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-white/5 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 font-mono text-[10px] text-slate-light hover:text-paper hover:bg-white/5 rounded-sm transition-all"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-[#D4AF37] text-black font-bold font-mono text-[10px] rounded-sm hover:bg-[#D4AF37]/90 disabled:opacity-50 transition-all uppercase"
                >
                  {isSubmitting ? 'PROCESSING...' : 'INITIALIZE DEAL'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DETAILED SLIDE-OUT SIDE DRAWER */}
      <div className={`fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-[#0A0A0A] border-l border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.9)] transform transition-transform duration-300 ease-out flex flex-col ${
        selectedOpportunityId ? 'translate-x-0' : 'translate-x-full'
      }`}>
        {selectedOpp ? (
          <>
            {/* Drawer Header */}
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
              <div className="flex items-center space-x-2.5">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  selectedOpp.risk_level === 'High' ? 'bg-red-500' :
                  selectedOpp.risk_level === 'Medium' ? 'bg-[#D4AF37]' : 'bg-[#3B82F6]'
                }`} />
                <div>
                  <span className="font-mono text-[8px] text-slate-light uppercase tracking-wider block">OPPORTUNITY CONSOLE</span>
                  <h2 className="font-sans font-bold text-sm text-paper uppercase truncate max-w-[280px]">{selectedOpp.name}</h2>
                </div>
              </div>
              <button
                onClick={() => setSelectedOpportunityId(null)}
                className="w-7 h-7 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-slate-light hover:text-paper transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body - Split into edit form and activity log */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
              <section className="space-y-3 bg-white/[0.01] border border-white/5 p-4 rounded-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider">Quote & Project Handoff</span>
                  <div className="flex items-center gap-1.5">
                    {selectedOpp.is_stale && (
                      <span className="font-mono text-[8px] uppercase text-amber-300 border border-amber-500/30 px-1.5 py-0.5">Stale deal</span>
                    )}
                    {isOpportunityLocked(selectedOpp) && (
                      <span className="font-mono text-[8px] uppercase text-slate-light border border-white/10 px-1.5 py-0.5 flex items-center gap-1">
                        <Lock className="w-2.5 h-2.5" /> {selectedOpp.stage === 'Contract' ? 'Won' : 'Lost'} - locked
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-light">
                  <div className="bg-black/40 border border-white/5 p-2">
                    <div className="uppercase">Quote status</div>
                    <div className="mt-1 text-paper">{selectedOpp.quote_status || (selectedOpp.quote_id ? "linked" : "not created")}</div>
                  </div>
                  <div className="bg-black/40 border border-white/5 p-2">
                    <div className="uppercase">Project handoff</div>
                    <div className="mt-1 text-paper">{selectedOpp.project_name || (selectedOpp.project_id ? "linked" : "pending")}</div>
                  </div>
                  <div className="bg-black/40 border border-white/5 p-2">
                    <div className="uppercase">Weighted forecast</div>
                    <div className="mt-1 text-[#D4AF37]">{formatCurrency(selectedOpp.weighted_value || 0)}</div>
                  </div>
                  <div className="bg-black/40 border border-white/5 p-2">
                    <div className="uppercase">Approval</div>
                    <div className="mt-1 text-paper">{selectedOpp.approval_status || "not_required"}</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={handleCreateQuotation}
                    disabled={isSubmitting}
                    className="px-2 py-2 bg-white/5 hover:bg-white/10 border border-white/10 font-mono text-[9px] uppercase text-paper disabled:opacity-40"
                  >
                    Create quote
                  </button>
                  {(!isOpportunityLocked(selectedOpp) || canOverrideStage) && (
                    <>
                      <button
                        type="button"
                        onClick={handleMarkWon}
                        disabled={isSubmitting}
                        className="px-2 py-2 bg-[#D4AF37] hover:bg-[#D4AF37]/90 font-mono text-[9px] font-bold uppercase text-black disabled:opacity-40"
                      >
                        Mark won
                      </button>
                      <button
                        type="button"
                        onClick={handleMarkLost}
                        disabled={isSubmitting}
                        className="px-2 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 font-mono text-[9px] uppercase text-red-200 disabled:opacity-40"
                      >
                        Mark lost
                      </button>
                    </>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => handleCheckDuplicateOpportunities(selectedOpp)}
                    disabled={isDuplicateChecking}
                    className="px-2 py-2 bg-white/5 hover:bg-white/10 border border-white/10 font-mono text-[9px] uppercase text-paper disabled:opacity-40 flex items-center justify-center gap-1.5"
                  >
                    <Copy className="w-3 h-3" /> Find duplicates
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteOpportunity(selectedOpp)}
                    disabled={isSubmitting}
                    className="px-2 py-2 bg-red-950/40 hover:bg-red-900/40 border border-red-900/40 font-mono text-[9px] uppercase text-rose-400 disabled:opacity-40 flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3 h-3" /> Delete deal
                  </button>
                </div>
              </section>

              {/* DOCUMENTS */}
              <section className="space-y-3 bg-white/[0.01] border border-white/5 p-4 rounded-sm">
                <span className="font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider">Documents</span>
                <EntityDocumentsPanel entityType="opportunity" entityId={selectedOpp.id} />
              </section>

              {/* ASSIGNMENT */}
              <section className="space-y-3 bg-white/[0.01] border border-white/5 p-4 rounded-sm">
                <span className="font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider">Assigned To</span>
                <AssignmentPanel entityType="opportunity" entityId={selectedOpp.id} />
              </section>

              {/* EDIT FORM BLOCK */}
              {editForm && (
                <form onSubmit={handleUpdateDealDetails} className="space-y-4 bg-white/[0.01] border border-white/5 p-4 rounded-sm">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider">Deal Parameters</span>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex items-center space-x-1 text-[9px] font-mono bg-white/5 hover:bg-[#D4AF37] hover:text-black border border-white/10 px-2 py-0.5 rounded-sm uppercase transition-all"
                    >
                      <Save className="w-3 h-3" />
                      <span>{isSubmitting ? 'Saving' : 'Save Params'}</span>
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label className="block font-mono text-[8px] text-slate-light uppercase">Opportunity Title</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Pipeline Stage</label>
                      <select
                        value={editForm.stage}
                        onChange={e => setEditForm({ ...editForm, stage: e.target.value })}
                        disabled={isOpportunityLocked(selectedOpp) && !canOverrideStage}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Risk Classification</label>
                      <select
                        value={editForm.risk_level}
                        onChange={e => setEditForm({ ...editForm, risk_level: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                      >
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Est Value ($)</label>
                      <input
                        type="number"
                        value={editForm.budget}
                        onChange={e => setEditForm({ ...editForm, budget: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Win Prob (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={editForm.probability}
                        onChange={e => setEditForm({ ...editForm, probability: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Margin (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={editForm.expected_margin}
                        onChange={e => setEditForm({ ...editForm, expected_margin: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono"
                      />
                    </div>
                  </div>

                  {/* Linked organization display/change */}
                  <div className="space-y-1">
                    <label className="block font-mono text-[8px] text-slate-light uppercase">Client Organization</label>
                    <select
                      value={editForm.client_org_id}
                      onChange={e => setEditForm({ ...editForm, client_org_id: e.target.value })}
                      className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                    >
                      <option value="">-- No Organization --</option>
                      {organizations.map(o => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Linked client display/change */}
                  <div className="space-y-1">
                    <label className="block font-mono text-[8px] text-slate-light uppercase">Client Contact Link</label>
                    <select
                      value={editForm.client_id}
                      onChange={e => setEditForm({ ...editForm, client_id: e.target.value })}
                      className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                    >
                      <option value="">-- No Contact --</option>
                      {dedupedContacts.map(c => (
                        <option key={c.id} value={c.id}>{c.contact_name}</option>
                      ))}
                    </select>
                  </div>
                </form>
              )}

              {/* LINKED CONTACT DETAIL BLOCK */}
              <div className="space-y-2 bg-[#0C0C0C] border border-white/5 p-4 rounded-sm">
                <span className="block font-mono text-[9px] text-[#3B82F6] uppercase tracking-wider">Associated client profile</span>

                {selectedOppOrganization && (
                  <Link
                    href={`/dashboard/crm/organizations/${selectedOppOrganization.id}`}
                    className="flex items-center space-x-3 pt-1 pb-2 border-b border-white/5 hover:bg-white/[0.02] -mx-1 px-1 rounded-sm transition-all"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-slate-light">
                      <Landmark className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-paper leading-tight">{selectedOppOrganization.name}</h4>
                      <span className="font-mono text-[9px] text-slate">View Customer 360 &rarr;</span>
                    </div>
                  </Link>
                )}

                {selectedOppContact ? (
                  <div className="flex items-center space-x-3 pt-1">
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-slate-light">
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-paper leading-tight">{selectedOppContact.contact_name}</h4>
                      {selectedOppContact.email && (
                        <span className="font-mono text-[9px] text-slate flex items-center mt-1">
                          <Mail className="w-3 h-3 mr-1 text-slate" />
                          {selectedOppContact.email}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="py-2 text-center text-[10px] font-mono text-slate border border-dashed border-white/5 rounded-sm">
                    No client contact profile linked. Add above.
                  </div>
                )}
              </div>

              {/* NOTES HISTORY / LOG SECTION */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-[9px] text-slate-light uppercase tracking-wider">Timeline / Activity Log</span>
                  <span className="font-mono text-[9px] text-[#3B82F6] tabular-nums">{selectedOppActivities.length} logs cached</span>
                </div>

                {/* Add note inline form */}
                <form onSubmit={handleAddNote} className="space-y-2 bg-white/[0.01] border border-white/5 p-3 rounded-sm">
                  <div className="flex items-center justify-between gap-2">
                    <select
                      value={newNote.type}
                      onChange={e => setNewNote({ ...newNote, type: e.target.value })}
                      className="bg-black border border-white/5 rounded-sm px-2.5 py-1 text-[10px] font-mono text-slate-light outline-none"
                    >
                      <option value="Call">Call</option>
                      <option value="Meeting">Meeting</option>
                      <option value="WhatsApp">WhatsApp</option>
                      <option value="Email">Email</option>
                      <option value="Site Visit">Site Visit</option>
                      <option value="System Log">System Log</option>
                    </select>

                    <button
                      type="submit"
                      disabled={isSubmitting || !newNote.notes.trim()}
                      className="px-3 py-1 bg-[#D4AF37] hover:bg-[#D4AF37]/90 disabled:opacity-40 text-black font-mono font-bold text-[9px] rounded-sm transition-all"
                    >
                      APPEND LOG
                    </button>
                  </div>

                  <textarea
                    rows={2}
                    value={newNote.notes}
                    onChange={e => setNewNote({ ...newNote, notes: e.target.value })}
                    className="w-full bg-black border border-white/5 rounded-sm p-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all resize-none placeholder:text-slate"
                    placeholder="Enter activity log summary or meeting details..."
                  />
                </form>

                {/* Interaction list */}
                <div className="space-y-3 relative before:absolute before:left-[17px] before:top-2 before:bottom-2 before:w-[1px] before:bg-white/5">
                  {selectedOppActivities.length > 0 ? (
                    selectedOppActivities.map((act) => (
                      <div key={act.id} className="flex items-start space-x-3 relative">
                        <div className="w-9 h-9 rounded-full border border-white/5 bg-[#0A0A0A] flex items-center justify-center shrink-0 text-slate-light relative z-10">
                          <MessageSquare className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-mono text-[9px] text-[#D4AF37] uppercase">{act.type}</span>
                            {act.activity_date && (
                              <span className="font-mono text-[8px] text-slate">
                                {new Date(act.activity_date).toLocaleDateString()} {new Date(act.activity_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-light leading-relaxed whitespace-pre-wrap">{act.description}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-8 text-center text-[10px] font-mono text-slate border border-dashed border-white/5 rounded-sm">
                      No interaction logs found. Initialize log append above.
                    </div>
                  )}
                </div>

              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate">
            <span className="font-mono text-xs uppercase">No telemetry loaded.</span>
          </div>
        )}
      </div>

      {/* DUPLICATE RESOLUTION MODAL */}
      {isDupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setIsDupModalOpen(false)} />
          <div className="relative bg-[#0A0A0A] border border-white/10 w-full max-w-lg rounded-sm p-6 shadow-2xl z-10">
            <h3 className="font-mono text-sm text-[#3B82F6] uppercase font-bold tracking-wider mb-2">Duplicate Resolution Engine</h3>
            <p className="text-xs text-slate-light mb-4">
              Potential matches for <span className="text-paper font-bold">{selectedOpp?.name}</span>.
            </p>
            <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
              {duplicateOpps.length === 0 ? (
                <p className="text-[11px] text-slate italic">No duplicate matches found. This deal looks clean.</p>
              ) : (
                duplicateOpps.map((dup) => (
                  <div key={dup.id} className="bg-black/40 border border-white/5 p-3 rounded-sm flex items-center justify-between text-xs">
                    <div>
                      <h4 className="font-bold text-paper">{dup.name}</h4>
                      <p className="text-slate-light font-mono text-[10px]">{dup.stage} | ${(Number(dup.budget) || 0).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => handleMergeIntoExisting(dup.id)}
                      disabled={isSubmitting}
                      className="px-3 py-1 bg-[#3B82F6]/10 text-[#3B82F6] hover:bg-[#3B82F6]/20 rounded-sm font-mono text-[9px] font-semibold uppercase disabled:opacity-40"
                    >
                      Merge into existing
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setIsDupModalOpen(false)}
                className="px-4 py-2 border border-white/5 rounded-sm text-slate-light text-[10px] font-mono uppercase hover:bg-white/5"
              >
                Close view
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CLOSE WIN MODAL */}
      {isCloseWinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setIsCloseWinModalOpen(false)} />
          <div className="relative bg-[#0A0A0A] border border-white/10 w-full max-w-md rounded-sm p-6 shadow-2xl z-10">
            <h3 className="font-mono text-sm text-[#3B82F6] uppercase font-bold tracking-wider mb-2">Close Deal: Mark Won</h3>
            <p className="text-xs text-slate-light mb-4">Complete the handoff notes to trigger target project deployment structures.</p>
            <div className="space-y-4 text-xs">
              {winReasonOptions.length > 0 && (
                <div>
                  <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Win Reason Category</label>
                  <select
                    value={selectedWinReasonId}
                    onChange={(e) => setSelectedWinReasonId(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-sm p-2 text-white outline-none"
                  >
                    <option value="">Custom (use notes below)</option>
                    {winReasonOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
              )}
              {winDepartmentOptions.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Delivered by</label>
                    <select
                      value={selectedWinDepartmentId}
                      onChange={(e) => setSelectedWinDepartmentId(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-sm p-2 text-white outline-none"
                    >
                      <option value="">Unassigned</option>
                      {winDepartmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Sourced by</label>
                    <select
                      value={selectedWinOriginatingDepartmentId}
                      onChange={(e) => setSelectedWinOriginatingDepartmentId(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-sm p-2 text-white outline-none"
                    >
                      <option value="">Unassigned</option>
                      {winDepartmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Handoff Notes / Specs</label>
                <textarea
                  value={winNotes}
                  onChange={(e) => setWinNotes(e.target.value)}
                  placeholder="Details regarding execution kick-off, site inspection dates, and contract terms..."
                  rows={4}
                  className="w-full bg-black border border-white/10 rounded-sm p-2 text-white outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setIsCloseWinModalOpen(false)} className="px-3 py-1.5 border border-white/5 text-slate-light hover:text-white font-mono text-[10px] uppercase">Cancel</button>
                <button onClick={handleConfirmMarkWon} className="px-3 py-1.5 bg-emerald-600 text-white font-mono text-[10px] uppercase font-bold">Confirm Win & Release Project</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CLOSE LOSS MODAL */}
      {isCloseLossModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setIsCloseLossModalOpen(false)} />
          <div className="relative bg-[#0A0A0A] border border-white/10 w-full max-w-md rounded-sm p-6 shadow-2xl z-10">
            <h3 className="font-mono text-sm text-rose-400 uppercase font-bold tracking-wider mb-2">Close Deal: Mark Lost</h3>
            <p className="text-xs text-slate-light mb-4">Specify the reason for the loss to optimize ML prediction engines.</p>
            <div className="space-y-4 text-xs">
              {lossReasonOptions.length > 0 && (
                <div>
                  <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Loss Reason Category</label>
                  <select
                    value={selectedLossReasonId}
                    onChange={(e) => setSelectedLossReasonId(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-sm p-2 text-white outline-none"
                  >
                    <option value="">Custom (use notes below)</option>
                    {lossReasonOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Loss Reason</label>
                <textarea
                  value={lossReason}
                  onChange={(e) => setLossReason(e.target.value)}
                  placeholder="Competitor price undercut, scope misalignment, or project cancelled..."
                  rows={4}
                  className="w-full bg-black border border-white/10 rounded-sm p-2 text-white outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setIsCloseLossModalOpen(false)} className="px-3 py-1.5 border border-white/5 text-slate-light hover:text-white font-mono text-[10px] uppercase">Cancel</button>
                <button onClick={handleConfirmMarkLost} className="px-3 py-1.5 bg-rose-600 text-white font-mono text-[10px] uppercase font-bold">Confirm Loss</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
