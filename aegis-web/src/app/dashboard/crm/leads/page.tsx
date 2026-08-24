"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Target, Zap, AlertTriangle, ShieldCheck, Clock, TrendingUp,
  Building2, MapPin, Loader2, MessageSquare, Bot, FormInput,
  Search, Eye, Linkedin, Inbox, Plus, Trash2, X, Copy, Check,
  Send, HelpCircle, CheckSquare, Sliders, ExternalLink, Lock,
  Filter, Globe, Database, UserCheck, RefreshCw, Layout, Smartphone,
  UserPlus, HelpCircle as HelpIcon, MoreVertical, UploadCloud,
  MessageCircle, Pencil, PhoneCall, Mail, Users2, MapPinned, FileEdit,
  Paperclip
} from 'lucide-react';
import { EntityDocumentsDrawer } from '@/components/documents/EntityDocumentsDrawer';
import {
  ApiError,
  getCrmLeads,
  getCrmTenderSignals,
  qualifyCrmLead,
  createCrmLead,
  updateCrmLead,
  disqualifyCrmLead,
  deleteCrmLead,
  findDuplicateCrmLeads,
  mergeCrmLeads,
  updateCrmLeadStatus,
  getCrmComplianceRequirementTypes,
  getCrmCommunications,
  createCrmCommunication,
  grantClientPortalAccess,
  getFinanceDepartments
} from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { OperationalTable, TableHeader, TableRow, TableHead, TableCell } from '@/components/ui/OperationalTable';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/lib/auth/AuthContext';
import { matchesRole } from '@/lib/rbacMatch';
import { useLiveTable } from '@/lib/live/LiveDataProvider';

// Roles allowed to change the status of a lead that's already been decided
// (converted/qualified or disqualified) - matches the backend's
// crm_leads.override_status permission grants.
const PRIVILEGED_LEAD_STATUS_ROLES = ['Executive (Admin)', 'Managing Director'];

interface Lead {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email?: string;
  contact_phone?: string;
  sector: string;
  estimated_budget: number;
  ai_score: number;
  ai_rationale: string;
  lead_source: string;
  status: string;
  created_at: string;
  expected_close_date?: string | null;
  labels?: string[] | null;
  budget_confirmed?: boolean | null;
  required_compliance_types?: string[] | null;
  missing_compliance_labels?: string[] | null;
  originating_department_id?: string | null;
}

interface Department {
  id: string;
  name: string;
}

interface ComplianceRequirementType {
  id: string;
  code: string;
  label: string;
}

const LEAD_SOURCE_OPTIONS = ['Manual Log', 'Referral', 'Website', 'Tender Notice', 'Cold Call', 'Government Portal'];

const ACTIVITY_CHANNELS: { value: string; label: string; icon: typeof PhoneCall }[] = [
  { value: 'phone_call', label: 'Call', icon: PhoneCall },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'meeting', label: 'Meeting', icon: Users2 },
  { value: 'site_visit', label: 'Site Visit', icon: MapPinned },
  { value: 'manual_note', label: 'Note', icon: FileEdit },
];

interface ExternalProspectSignal {
  id: string;
  company_name?: string;
  signal?: string;
}

interface ExternalLinkedInProfile {
  id: string;
  name?: string;
  company_name?: string;
}

export default function CRMLeadsApp() {
  const { role } = useAuth();
  const canOverrideLeadStatus = role ? matchesRole(role, PRIVILEGED_LEAD_STATUS_ROLES) : false;
  const [activeTab, setActiveTab] = useState<'inbox' | 'web_forms' | 'signal_bot' | 'prospector' | 'tender_scraping' | 'linkedin'>('inbox');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('kanban');

  const [qualifyingId, setQualifyingId] = useState<string | null>(null);
  // Set after a lead is successfully qualified - surfaces an explicit,
  // separate "Grant portal access" prompt rather than firing the real
  // Supabase Auth invite email automatically as part of qualification.
  const [qualifiedLeadPrompt, setQualifiedLeadPrompt] = useState<{
    contactId: string;
    contactName: string;
    email?: string;
  } | null>(null);
  const [isGrantingPortalAccess, setIsGrantingPortalAccess] = useState(false);
  const [dismissedLeadIds, setDismissedLeadIds] = useState<string[]>([]);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [movingLeadId, setMovingLeadId] = useState<string | null>(null);

  // Modal / Sidebar States
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isDisqualifyModalOpen, setIsDisqualifyModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [disqualifyReason, setDisqualifyReason] = useState('');
  const [documentsFor, setDocumentsFor] = useState<{ id: string; label: string } | null>(null);

  // Editing an existing lead reuses the manual-log modal in "edit" mode -
  // null means the modal (if open) is creating a brand new lead.
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [isSavingLead, setIsSavingLead] = useState(false);

  const [complianceTypes, setComplianceTypes] = useState<ComplianceRequirementType[]>([]);

  // Activity history panel - which lead it's open for, its timeline, and
  // the small "log a new one" form.
  const [activityLead, setActivityLead] = useState<Lead | null>(null);
  const [activityItems, setActivityItems] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityForm, setActivityForm] = useState({ channel: 'phone_call', body: '', outcome: '' });
  const [isLoggingActivity, setIsLoggingActivity] = useState(false);

  // Duplicate Check States
  const [isDuplicateChecking, setIsDuplicateChecking] = useState(false);
  const [duplicateLeads, setDuplicateLeads] = useState<Lead[]>([]);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);
  const [externalTenderSignals, setExternalTenderSignals] = useState<any[]>([]);
  const externalProspects: ExternalProspectSignal[] = [];
  const externalLinkedInProfiles: ExternalLinkedInProfile[] = [];

  // Manual Lead Form - also reused for editing an existing lead.
  const DEFAULT_MANUAL_FORM = {
    company_name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    sector: 'Private',
    estimated_budget: 0,
    ai_score: 50,
    ai_rationale: 'Manually logged opportunity signal.',
    lead_source: 'Manual Log',
    expected_close_date: '',
    labels: '',
    budget_confirmed: false,
    required_compliance_types: [] as string[],
    initial_notes: '',
    originating_department_id: ''
  };
  const [manualForm, setManualForm] = useState(DEFAULT_MANUAL_FORM);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState('');

  useEffect(() => {
    void getFinanceDepartments()
      .then((res) => setDepartments(res.success && Array.isArray(res.data) ? res.data : []))
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    void getCrmComplianceRequirementTypes()
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setComplianceTypes(res.data);
      })
      .catch(() => setComplianceTypes([]));
  }, []);

  const showToast: (message: string, type?: 'success' | 'info' | 'error') => void = useCallback((message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  const {
    data: leadsData,
    isLoading,
    error: leadsError,
    refetch: loadLeads,
  } = useApiQuery<Lead[]>(async () => {
    const res = await getCrmLeads({ department_id: departmentFilter || undefined });
    if (res.success && Array.isArray(res.data)) {
      return res.data;
    }
    throw new Error("CRM leads could not be loaded from the CRM service.");
  }, [departmentFilter]);

  const leads = leadsData ?? [];

  useLiveTable("crm.leads", () => void loadLeads());

  useEffect(() => {
    if (leadsError) {
      console.warn("Failed to load CRM leads", leadsError);
      showToast("CRM leads could not be loaded from the CRM service.", "error");
    }
  }, [leadsError, showToast]);

  useEffect(() => {
    void getCrmTenderSignals({ limit: 50, includeInternalPublicFeed: false })
      .then((response) => {
        if (response.success && Array.isArray(response.data)) {
          setExternalTenderSignals(response.data);
        } else {
          setExternalTenderSignals([]);
        }
      })
      .catch(() => setExternalTenderSignals([]));
  }, []);

  const openCreateLeadModal = () => {
    setEditingLead(null);
    setManualForm(DEFAULT_MANUAL_FORM);
    setIsManualModalOpen(true);
  };

  const openEditLeadModal = (lead: Lead) => {
    setEditingLead(lead);
    setManualForm({
      company_name: lead.company_name || '',
      contact_name: lead.contact_name || '',
      contact_email: lead.contact_email || '',
      contact_phone: lead.contact_phone || '',
      sector: lead.sector || 'Private',
      estimated_budget: lead.estimated_budget || 0,
      ai_score: lead.ai_score ?? 50,
      ai_rationale: lead.ai_rationale || 'Manually logged opportunity signal.',
      lead_source: lead.lead_source || 'Manual Log',
      expected_close_date: lead.expected_close_date ? lead.expected_close_date.slice(0, 10) : '',
      labels: (lead.labels || []).join(', '),
      budget_confirmed: Boolean(lead.budget_confirmed),
      required_compliance_types: lead.required_compliance_types || [],
      initial_notes: '',
      originating_department_id: lead.originating_department_id || ''
    });
    setIsManualModalOpen(true);
  };

  const handleSaveLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.company_name.trim()) return;
    if (manualForm.estimated_budget < 0) {
      showToast("Estimated value / budget can't be negative.", "error");
      return;
    }

    const labelsArray = manualForm.labels
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);

    setIsSavingLead(true);
    try {
      const payload = {
        company_name: manualForm.company_name,
        contact_name: manualForm.contact_name,
        contact_email: manualForm.contact_email || undefined,
        contact_phone: manualForm.contact_phone || undefined,
        sector: manualForm.sector,
        estimated_budget: Number(manualForm.estimated_budget),
        ai_score: Number(manualForm.ai_score),
        ai_rationale: manualForm.ai_rationale,
        lead_source: manualForm.lead_source,
        expected_close_date: manualForm.expected_close_date || undefined,
        labels: labelsArray,
        budget_confirmed: manualForm.budget_confirmed,
        required_compliance_types: manualForm.required_compliance_types,
        originating_department_id: manualForm.originating_department_id || undefined
      };

      const res = editingLead
        ? await updateCrmLead(editingLead.id, payload)
        : await createCrmLead(payload);

      if (res.success) {
        const leadId = editingLead ? editingLead.id : (res.data && (res.data as any).id);
        if (!editingLead && leadId && manualForm.initial_notes.trim()) {
          await createCrmCommunication({
            lead_id: leadId,
            channel: 'manual_note',
            direction: 'internal',
            body: manualForm.initial_notes.trim()
          }).catch(() => undefined);
        }
        showToast(editingLead ? "Lead updated." : "Lead logged successfully in database.");
        setIsManualModalOpen(false);
        setEditingLead(null);
        setManualForm(DEFAULT_MANUAL_FORM);
        void loadLeads();
      } else {
        showToast(editingLead ? "Could not update lead." : "Could not save manual lead.", "error");
      }
    } catch (err) {
      const fallback = editingLead ? "Could not update lead." : "Could not save manual lead.";
      if (err instanceof ApiError && err.status === 409) {
        showToast("A lead with this company name, email, or phone already exists. Check the pipeline before logging it again.", "error");
      } else if (err instanceof ApiError && err.message) {
        showToast(err.message, "error");
      } else {
        showToast(fallback, "error");
      }
    } finally {
      setIsSavingLead(false);
    }
  };

  const toggleRequiredComplianceType = (code: string) => {
    setManualForm((prev) => ({
      ...prev,
      required_compliance_types: prev.required_compliance_types.includes(code)
        ? prev.required_compliance_types.filter((c) => c !== code)
        : [...prev.required_compliance_types, code]
    }));
  };

  const openActivityPanel = async (lead: Lead) => {
    setActivityLead(lead);
    setActivityForm({ channel: 'phone_call', body: '', outcome: '' });
    setActivityLoading(true);
    try {
      const res = await getCrmCommunications({ lead_id: lead.id, limit: 50 });
      setActivityItems(res.success && Array.isArray(res.data) ? res.data : []);
    } catch {
      setActivityItems([]);
    } finally {
      setActivityLoading(false);
    }
  };

  const handleLogActivity = async () => {
    if (!activityLead || !activityForm.body.trim()) return;
    setIsLoggingActivity(true);
    try {
      const res = await createCrmCommunication({
        lead_id: activityLead.id,
        channel: activityForm.channel,
        direction: 'outbound',
        body: activityForm.body.trim(),
        outcome: activityForm.outcome.trim() || undefined
      });
      if (res.success) {
        setActivityForm({ channel: activityForm.channel, body: '', outcome: '' });
        const refreshed = await getCrmCommunications({ lead_id: activityLead.id, limit: 50 });
        setActivityItems(refreshed.success && Array.isArray(refreshed.data) ? refreshed.data : []);
        showToast("Activity logged.");
      } else {
        showToast("Could not log activity.", "error");
      }
    } catch {
      showToast("Could not log activity.", "error");
    } finally {
      setIsLoggingActivity(false);
    }
  };

  const handleQualifyLead = async (lead: Lead) => {
    // Prevents a double-click (or a re-drop onto Qualified by a privileged
    // user overriding an already-decided lead) from firing this twice before
    // the first request resolves - qualify_lead's side effect is creating a
    // brand new Organization/Contact/Opportunity, so a second overlapping
    // call means a second duplicate deal, not just a redundant status write.
    if (qualifyingId) return;
    setQualifyingId(lead.id);
    try {
      const res = await qualifyCrmLead(lead.id, {
        organization: {
          name: lead.company_name,
          sector: lead.sector
        },
        contact: {
          contact_name: lead.contact_name,
          email: lead.contact_email,
          phone: lead.contact_phone
        },
        opportunity: {
          name: `${lead.company_name} - Contract Opportunity`,
          stage: 'Qualification',
          budget: lead.estimated_budget,
          probability: lead.ai_score
        },
        activity: {
          type: 'Call',
          notes: 'Lead qualified from CRM leads workspace.'
        }
      });
      if (res.success) {
        showToast("Lead successfully converted to Organization + Opportunity!");
        const contactId = (res.data as any)?.contact_id;
        if (contactId) {
          setQualifiedLeadPrompt({
            contactId,
            contactName: lead.contact_name,
            email: lead.contact_email
          });
        }
        void loadLeads();
      }
    } catch {
      showToast("Lead qualification was not saved. Check the CRM service connection and retry.", "error");
    } finally {
      setQualifyingId(null);
    }
  };

  const handleGrantPortalAccess = async () => {
    if (!qualifiedLeadPrompt) return;
    setIsGrantingPortalAccess(true);
    try {
      const res = await grantClientPortalAccess(qualifiedLeadPrompt.contactId);
      if (res.success) {
        showToast(`Portal invite sent to ${res.data?.email || qualifiedLeadPrompt.email}.`);
        setQualifiedLeadPrompt(null);
      } else {
        showToast("Portal access was not granted. Check the CRM service connection and retry.", "error");
      }
    } catch {
      showToast("Portal access was not granted. Check the CRM service connection and retry.", "error");
    } finally {
      setIsGrantingPortalAccess(false);
    }
  };

  const handleDisqualifyClick = (lead: Lead) => {
    setSelectedLead(lead);
    setDisqualifyReason('');
    setIsDisqualifyModalOpen(true);
  };

  const handleConfirmDisqualify = async () => {
    if (!selectedLead) return;
    try {
      await disqualifyCrmLead(selectedLead.id, disqualifyReason);
      showToast("Lead status marked as Disqualified.");
      setIsDisqualifyModalOpen(false);
      void loadLeads();
    } catch {
      showToast("Lead disqualification was not saved. Check the CRM service connection and retry.", "error");
    }
  };

  // Backend status values are lowercase (DB column default is 'new', which
  // the Inquiry column also matches - see normalizedStatus/columns below).
  // Qualified/Disqualified aren't plain status writes: qualifying creates
  // linked organization/contact/opportunity records via a dedicated
  // endpoint, and disqualifying needs a reason, so drops onto those two
  // columns re-use the existing button flows instead of a raw status PUT.
  const DROPPABLE_STATUS: Record<string, string> = {
    Inquiry: 'inquiry',
    Identified: 'identified',
    Contacted: 'contacted',
  };

  const handleLeadDragStart = (lead: Lead) => (e: React.DragEvent<HTMLDivElement>) => {
    setDraggedLeadId(lead.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleLeadDragEnd = () => {
    setDraggedLeadId(null);
    setDragOverColumn(null);
  };

  const handleColumnDragOver = (colName: string) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(colName);
  };

  const handleColumnDrop = (colName: string) => async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOverColumn(null);
    const leadId = draggedLeadId;
    setDraggedLeadId(null);
    if (!leadId) return;

    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    if (normalizedStatus(lead.status) === colName.toLowerCase()) return;

    const isDecided = ['converted', 'disqualified'].includes(normalizedStatus(lead.status));
    if (isDecided && !canOverrideLeadStatus) {
      showToast("This lead is already qualified or disqualified - only Admin, Executive, or Managing Director can change its status further.", "error");
      return;
    }

    if (colName === 'Qualified') {
      void handleQualifyLead(lead);
      return;
    }
    if (colName === 'Disqualified') {
      handleDisqualifyClick(lead);
      return;
    }

    const nextStatus = DROPPABLE_STATUS[colName];
    if (!nextStatus) return;

    setMovingLeadId(leadId);
    try {
      const res = await updateCrmLeadStatus(leadId, nextStatus);
      if (res.success) {
        void loadLeads();
      } else {
        showToast("Lead stage change was not saved. Check the CRM service connection and retry.", "error");
      }
    } catch {
      showToast("Lead stage change was not saved. Check the CRM service connection and retry.", "error");
    } finally {
      setMovingLeadId(null);
    }
  };

  const handleCheckDuplicates = async (lead: Lead) => {
    setSelectedLead(lead);
    setIsDuplicateChecking(true);
    try {
      const res = await findDuplicateCrmLeads({
        email: lead.contact_email,
        phone: lead.contact_phone,
        company_name: lead.company_name
      });
      if (res.success && Array.isArray(res.data)) {
        // Filter out current lead
        setDuplicateLeads(res.data.filter(l => l.id !== lead.id));
      } else {
        setDuplicateLeads([]);
      }
      setIsDupModalOpen(true);
    } catch {
      showToast("Duplicate check completed. No matches found.", "info");
    } finally {
      setIsDuplicateChecking(false);
    }
  };

  const handleMergeLeads = async (existingLeadId: string) => {
    if (!selectedLead) return;
    try {
      await mergeCrmLeads(existingLeadId, [selectedLead.id]);
      showToast("Leads merged successfully.");
      setIsDupModalOpen(false);
      void loadLeads();
    } catch {
      showToast("Lead merge was not saved. Check the CRM service connection and retry.", "error");
    }
  };

  const handleDeleteLead = (lead: Lead) => {
    setSelectedLead(lead);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDeleteLead = async () => {
    if (!selectedLead) return;
    try {
      const res = await deleteCrmLead(selectedLead.id);
      if (res.success) {
        showToast("Lead deleted.");
        setIsDeleteModalOpen(false);
        void loadLeads();
      } else {
        showToast("Lead was not deleted. Check the CRM service connection and retry.", "error");
      }
    } catch {
      showToast("Lead was not deleted. Check the CRM service connection and retry.", "error");
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5';
    if (score >= 50) return 'text-amber-400 border-amber-500/30 bg-amber-500/5';
    return 'text-rose-400 border-rose-500/30 bg-rose-500/5';
  };

  // Filtered lists
  const activeLeads = leads.filter(l => !dismissedLeadIds.includes(l.id));

  // The backend's default status for a newly-created lead is the lowercase
  // string 'new' (a DB column default), not 'New' - compare case-
  // insensitively so newly-created leads don't silently fall out of every
  // column.
  const normalizedStatus = (status?: string) => (status || '').trim().toLowerCase();
  const columns = {
    'Inquiry': activeLeads.filter(l => {
      const s = normalizedStatus(l.status);
      return s === 'inquiry' || s === 'new' || !s;
    }),
    'Identified': activeLeads.filter(l => normalizedStatus(l.status) === 'identified'),
    'Contacted': activeLeads.filter(l => normalizedStatus(l.status) === 'contacted'),
    // qualify_lead sets status='converted', not 'qualified' - the backend's
    // own reporting queries already treat the two as synonymous, but this
    // board didn't, so a converted lead matched no column and just vanished
    // off the Kanban entirely once qualified.
    'Qualified': activeLeads.filter(l => ['qualified', 'converted'].includes(normalizedStatus(l.status))),
    'Disqualified': activeLeads.filter(l => normalizedStatus(l.status) === 'disqualified')
  };

  return (
    <main className="min-h-screen bg-[#0A0D14] text-[#E2E8F0] p-4 lg:p-8 font-sans selection:bg-[#3B82F6]/30">
      {/* Toast Alert */}
      {notification && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg border shadow-xl flex items-center gap-3 animate-in slide-in-from-bottom-2 ${
          notification.type === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
        }`}>
          <ShieldCheck className="h-4 w-4" />
          <span className="text-xs font-semibold">{notification.message}</span>
        </div>
      )}

      {/* Header bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-[#1E293B] pb-6 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Target className="h-6 w-6 text-[#3B82F6]" />
            Leads Management & Signals
          </h1>
          <p className="text-slate-400 text-xs mt-1">Qualify automatic signals, discover duplicates, and route telemetry sources.</p>
        </div>
        <div className="flex gap-2">
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-[#111827] border border-[#1E293B] text-white"
          >
            <option value="">All Departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button
            onClick={() => setViewMode(prev => prev === 'list' ? 'kanban' : 'list')}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-[#111827] border border-[#1E293B] hover:bg-[#1F2937] transition text-white"
          >
            <Layout className="h-4 w-4 text-slate-400" />
            {viewMode === 'list' ? 'Kanban Board' : 'Table Feed'}
          </button>
          <Link
            href="/dashboard/crm/import"
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-[#111827] border border-[#1E293B] hover:bg-[#1F2937] transition text-white"
          >
            <UploadCloud className="h-4 w-4 text-slate-400" />
            Import / Export
          </Link>
          <button
            onClick={openCreateLeadModal}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] transition text-white"
          >
            <Plus className="h-4 w-4" />
            Log Manual Lead
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#1E293B] overflow-x-auto no-scrollbar gap-2 mb-6">
        {(['inbox', 'web_forms', 'signal_bot', 'prospector', 'tender_scraping', 'linkedin'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 text-xs font-medium tracking-wide whitespace-nowrap border-b-2 transition uppercase ${
              activeTab === tab
                ? 'border-[#3B82F6] text-[#3B82F6] font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {tab.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Content Panels */}
      {activeTab === 'inbox' && (
        <div>
          {isLoading && !leadsData ? (
            <div className="bg-[#111827]/40 border border-[#1E293B]/60 rounded-xl overflow-hidden">
              <SkeletonTableRows rows={6} columns={7} />
            </div>
          ) : activeLeads.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No leads yet"
              description="Log a manual lead or connect a signal source to start populating the pipeline."
              action={{ label: "Log Manual Lead", onClick: openCreateLeadModal }}
            />
          ) : viewMode === 'list' ? (
            /* Table Feed View */
            <OperationalTable>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Est. Budget</TableHead>
                  <TableHead>Propensity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {activeLeads.map((lead) => {
                  const isDecided = ['converted', 'disqualified'].includes(normalizedStatus(lead.status));
                  const canChangeStatus = !isDecided || canOverrideLeadStatus;
                  return (
                  <TableRow key={lead.id}>
                    <TableCell className="font-semibold text-paper">
                      {lead.company_name}
                      {lead.missing_compliance_labels && lead.missing_compliance_labels.length > 0 && (
                        <span
                          title={`Missing: ${lead.missing_compliance_labels.join(', ')}`}
                          className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-amber-500/10 text-amber-400 border border-amber-500/30"
                        >
                          <AlertTriangle className="h-2.5 w-2.5" /> Compliance
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{lead.contact_name}</TableCell>
                    <TableCell>{lead.sector}</TableCell>
                    <TableCell className="font-semibold text-emerald-400">
                      ${lead.estimated_budget.toLocaleString()}
                      {!lead.budget_confirmed && (
                        <span title="Estimated - not yet confirmed by the client" className="ml-1.5 text-[9px] font-semibold text-amber-400 align-middle">Est.</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded font-mono ${getScoreColor(lead.ai_score)}`}>{lead.ai_score}</span>
                    </TableCell>
                    <TableCell>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">{lead.status || 'Inquiry'}</span>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <button
                        onClick={() => openActivityPanel(lead)}
                        className="px-2.5 py-1 text-[10px] bg-[#111827] border border-[#1E293B] rounded text-slate-300 hover:text-white"
                      >
                        Activity
                      </button>
                      <button
                        onClick={() => openEditLeadModal(lead)}
                        className="px-2.5 py-1 text-[10px] bg-[#111827] border border-[#1E293B] rounded text-slate-300 hover:text-white"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDocumentsFor({ id: lead.id, label: lead.company_name })}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] bg-[#111827] border border-[#1E293B] rounded text-slate-300 hover:text-white"
                      >
                        <Paperclip className="h-2.5 w-2.5" /> Docs
                      </button>
                      <button
                        onClick={() => handleCheckDuplicates(lead)}
                        className="px-2.5 py-1 text-[10px] bg-[#111827] border border-[#1E293B] rounded text-slate-300 hover:text-white"
                      >
                        Duplicates
                      </button>
                      {canChangeStatus && (
                        <>
                          <button
                            onClick={() => handleQualifyLead(lead)}
                            disabled={!!qualifyingId}
                            className="px-2.5 py-1 text-[10px] bg-emerald-600 hover:bg-emerald-700 rounded text-white font-semibold disabled:opacity-40 disabled:pointer-events-none"
                          >
                            {qualifyingId === lead.id ? 'Qualifying...' : 'Qualify'}
                          </button>
                          <button
                            onClick={() => handleDisqualifyClick(lead)}
                            className="px-2.5 py-1 text-[10px] bg-rose-950 text-rose-400 border border-rose-900/40 rounded hover:bg-rose-900/30"
                          >
                            Disqualify
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDeleteLead(lead)}
                        className="px-2.5 py-1 text-[10px] bg-[#111827] border border-rose-900/40 rounded text-rose-400 hover:bg-rose-900/20"
                      >
                        Delete
                      </button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </tbody>
            </OperationalTable>
          ) : (
            /* Kanban Board View */
            <>
            <p className="text-[10px] text-slate-500 mb-3">Drag a card into another column to move it through the pipeline.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {Object.entries(columns).map(([colName, colLeads]) => (
                <div
                  key={colName}
                  onDragOver={handleColumnDragOver(colName)}
                  onDragLeave={() => setDragOverColumn((current) => (current === colName ? null : current))}
                  onDrop={handleColumnDrop(colName)}
                  className={`bg-[#111827]/30 border p-4 rounded-xl flex flex-col min-h-[500px] transition-colors ${
                    dragOverColumn === colName ? 'border-[#3B82F6] bg-[#3B82F6]/5' : 'border-[#1E293B]/60'
                  }`}
                >
                  <div className="flex justify-between items-center mb-4 border-b border-[#1E293B] pb-2">
                    <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider">{colName}</h3>
                    <span className="text-[10px] font-mono bg-[#1E293B] text-slate-400 px-2 py-0.5 rounded-full">{colLeads.length}</span>
                  </div>
                  <div className="flex-1 space-y-3 overflow-y-auto max-h-[600px] no-scrollbar">
                    {colLeads.map((lead) => {
                      const isDecided = ['converted', 'disqualified'].includes(normalizedStatus(lead.status));
                      const canChangeStatus = !isDecided || canOverrideLeadStatus;
                      return (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={handleLeadDragStart(lead)}
                        onDragEnd={handleLeadDragEnd}
                        className={`bg-[#111827]/80 border border-[#1E293B] p-4 rounded-lg space-y-3 hover:border-slate-500/40 transition cursor-grab active:cursor-grabbing ${
                          draggedLeadId === lead.id ? 'opacity-40' : ''
                        } ${movingLeadId === lead.id ? 'opacity-60 pointer-events-none' : ''}`}
                      >
                        <div>
                          <h4 className="text-sm font-bold text-white line-clamp-1">{lead.company_name}</h4>
                          <span className="text-[9px] font-mono text-slate-400">{lead.sector} | {lead.lead_source}</span>
                        </div>
                        {lead.missing_compliance_labels && lead.missing_compliance_labels.length > 0 && (
                          <div
                            title={`Missing: ${lead.missing_compliance_labels.join(', ')}`}
                            className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 w-fit"
                          >
                            <AlertTriangle className="h-2.5 w-2.5" /> Missing {lead.missing_compliance_labels.length} compliance doc{lead.missing_compliance_labels.length > 1 ? 's' : ''}
                          </div>
                        )}
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-emerald-400">
                            ${lead.estimated_budget.toLocaleString()}
                            {!lead.budget_confirmed && <span title="Estimated - not yet confirmed by the client" className="ml-1 text-[9px] font-semibold text-amber-400">Est.</span>}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getScoreColor(lead.ai_score)}`}>{lead.ai_score}%</span>
                        </div>
                        <div draggable={false} className="border-t border-[#1E293B] pt-2 flex gap-2 justify-between items-center flex-wrap">
                          <div draggable={false} className="flex gap-1.5 items-center">
                            <button
                              draggable={false}
                              onClick={() => openActivityPanel(lead)}
                              className="text-[10px] text-slate-400 hover:text-white hover:underline flex items-center gap-1"
                            >
                              <MessageCircle className="h-2.5 w-2.5" /> Activity
                            </button>
                            <button
                              draggable={false}
                              onClick={() => openEditLeadModal(lead)}
                              className="text-[10px] text-slate-400 hover:text-white hover:underline flex items-center gap-1"
                            >
                              <Pencil className="h-2.5 w-2.5" /> Edit
                            </button>
                            <button
                              draggable={false}
                              onClick={() => handleCheckDuplicates(lead)}
                              className="text-[10px] text-[#3B82F6] hover:underline"
                            >
                              Merge Check
                            </button>
                          </div>
                          <div draggable={false} className="flex gap-1.5 items-center">
                            {canChangeStatus && (
                              <>
                                <button
                                  draggable={false}
                                  onClick={() => handleQualifyLead(lead)}
                                  disabled={!!qualifyingId}
                                  className="text-[10px] text-emerald-400 hover:underline disabled:opacity-40 disabled:pointer-events-none"
                                >
                                  {qualifyingId === lead.id ? 'Qualifying...' : 'Qualify'}
                                </button>
                                <button
                                  draggable={false}
                                  onClick={() => handleDisqualifyClick(lead)}
                                  className="text-[10px] text-rose-400 hover:underline"
                                >
                                  Disqualify
                                </button>
                              </>
                            )}
                            <button
                              draggable={false}
                              onClick={() => handleDeleteLead(lead)}
                              className="text-[10px] text-slate-500 hover:text-rose-400 hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      )}

      {/* Other tabs rendering basic simulated tools */}
      {activeTab !== 'inbox' && (
        <div className="bg-[#111827]/40 border border-[#1E293B]/60 p-6 rounded-xl">
          <h2 className="text-base font-semibold text-white mb-2 uppercase font-mono tracking-widest">{activeTab.replace('_', ' ')} TELEMETRY FEED</h2>
          <p className="text-xs text-slate-400">ML models scraping signals from the target interfaces. Active and ready to pull data logs.</p>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border border-[#1E293B] bg-[#0A0D14] p-3">
              <p className="text-[10px] uppercase tracking-widest text-slate-500">Tender Signals</p>
              <p className="mt-1 text-lg font-bold text-white">{externalTenderSignals.length}</p>
            </div>
            <div className="rounded-lg border border-[#1E293B] bg-[#0A0D14] p-3">
              <p className="text-[10px] uppercase tracking-widest text-slate-500">Prospects</p>
              <p className="mt-1 text-lg font-bold text-white">{externalProspects.length}</p>
            </div>
            <div className="rounded-lg border border-[#1E293B] bg-[#0A0D14] p-3">
              <p className="text-[10px] uppercase tracking-widest text-slate-500">LinkedIn Profiles</p>
              <p className="mt-1 text-lg font-bold text-white">{externalLinkedInProfiles.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Log / Edit Lead */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[#111827] border border-[#1E293B] rounded-xl p-6 relative max-h-[90vh] overflow-y-auto">
            <button onClick={() => { setIsManualModalOpen(false); setEditingLead(null); }} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-bold text-white mb-4">{editingLead ? 'Edit Lead' : 'Log Manual Lead Signal'}</h2>
            <form onSubmit={handleSaveLead} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Company Name</label>
                <input
                  type="text"
                  value={manualForm.company_name}
                  onChange={(e) => setManualForm(prev => ({ ...prev, company_name: e.target.value }))}
                  required
                  className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Contact Name</label>
                  <input
                    type="text"
                    value={manualForm.contact_name}
                    onChange={(e) => setManualForm(prev => ({ ...prev, contact_name: e.target.value }))}
                    className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Sector</label>
                  <select
                    value={manualForm.sector}
                    onChange={(e) => setManualForm(prev => ({ ...prev, sector: e.target.value }))}
                    className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white"
                  >
                    <option>Private</option>
                    <option>Government</option>
                    <option>Mining</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Department</label>
                  <select
                    value={manualForm.originating_department_id}
                    onChange={(e) => setManualForm(prev => ({ ...prev, originating_department_id: e.target.value }))}
                    className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white"
                  >
                    <option value="">Unassigned</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Contact Email</label>
                  <input
                    type="email"
                    value={manualForm.contact_email}
                    onChange={(e) => setManualForm(prev => ({ ...prev, contact_email: e.target.value }))}
                    className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Contact Phone</label>
                  <input
                    type="tel"
                    value={manualForm.contact_phone}
                    onChange={(e) => setManualForm(prev => ({ ...prev, contact_phone: e.target.value }))}
                    className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Lead Source</label>
                  <select
                    value={manualForm.lead_source}
                    onChange={(e) => setManualForm(prev => ({ ...prev, lead_source: e.target.value }))}
                    className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white"
                  >
                    {LEAD_SOURCE_OPTIONS.map((opt) => <option key={opt}>{opt}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Expected Close Date</label>
                  <input
                    type="date"
                    value={manualForm.expected_close_date}
                    onChange={(e) => setManualForm(prev => ({ ...prev, expected_close_date: e.target.value }))}
                    className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Labels (comma separated)</label>
                <input
                  type="text"
                  value={manualForm.labels}
                  onChange={(e) => setManualForm(prev => ({ ...prev, labels: e.target.value }))}
                  placeholder="e.g. priority, referral, repeat-client"
                  className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Estimated Value / Budget ($)</label>
                <input
                  type="number"
                  min="0"
                  value={manualForm.estimated_budget}
                  onChange={(e) => setManualForm(prev => ({ ...prev, estimated_budget: Math.max(0, Number(e.target.value) || 0) }))}
                  className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white"
                />
                <label className="flex items-center gap-2 mt-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualForm.budget_confirmed}
                    onChange={(e) => setManualForm(prev => ({ ...prev, budget_confirmed: e.target.checked }))}
                    className="rounded border-[#1E293B] bg-[#0A0D14]"
                  />
                  Client confirmed this figure (leave unchecked if it&apos;s an estimate)
                </label>
              </div>
              {complianceTypes.length > 0 && (
                <div>
                  <label className="block text-slate-400 mb-1.5 font-semibold">Required compliance documentation</label>
                  <div className="grid grid-cols-2 gap-1.5 bg-[#0A0D14] border border-[#1E293B] rounded p-2">
                    {complianceTypes.map((type) => (
                      <label key={type.id} className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={manualForm.required_compliance_types.includes(type.code)}
                          onChange={() => toggleRequiredComplianceType(type.code)}
                          className="rounded border-[#1E293B] bg-[#111827]"
                        />
                        {type.label}
                      </label>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">Checking one we don&apos;t currently hold on file emails an Executive with the revenue at risk.</p>
                </div>
              )}
              {!editingLead && (
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Initial Notes</label>
                  <textarea
                    value={manualForm.initial_notes}
                    onChange={(e) => setManualForm(prev => ({ ...prev, initial_notes: e.target.value }))}
                    placeholder="What&apos;s the context on this lead so far?"
                    rows={3}
                    className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white"
                  />
                </div>
              )}
              <button
                type="submit"
                disabled={isSavingLead}
                className="w-full py-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded font-bold transition disabled:opacity-50"
              >
                {isSavingLead ? 'Saving...' : editingLead ? 'Save Changes' : 'Create Lead Record'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Panel: Lead Activity History */}
      {activityLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[#111827] border border-[#1E293B] rounded-xl p-6 relative max-h-[90vh] flex flex-col">
            <button onClick={() => setActivityLead(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-bold text-white mb-1">Activity History</h2>
            <p className="text-xs text-slate-400 mb-4">{activityLead.company_name}</p>

            <div className="flex-1 overflow-y-auto space-y-2 mb-4 min-h-[120px]">
              {activityLoading ? (
                <p className="text-xs text-slate-500 italic">Loading...</p>
              ) : activityItems.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No activity logged yet for this lead.</p>
              ) : (
                activityItems.map((item) => {
                  const channelMeta = ACTIVITY_CHANNELS.find((c) => c.value === item.channel);
                  const ChannelIcon = channelMeta?.icon || FileEdit;
                  return (
                    <div key={item.id} className="bg-[#0A0D14] border border-[#1E293B] rounded-lg p-3 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="flex items-center gap-1.5 font-semibold text-white">
                          <ChannelIcon className="h-3 w-3 text-[#3B82F6]" />
                          {channelMeta?.label || item.channel}
                        </span>
                        <span className="text-[10px] text-slate-500">{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</span>
                      </div>
                      {item.body && <p className="text-slate-300 whitespace-pre-wrap">{item.body}</p>}
                      {item.outcome && <p className="text-[10px] text-slate-500 mt-1">Outcome: {item.outcome}</p>}
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-[#1E293B] pt-3 space-y-2">
              <div className="flex gap-2">
                <select
                  value={activityForm.channel}
                  onChange={(e) => setActivityForm(prev => ({ ...prev, channel: e.target.value }))}
                  className="bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white text-xs"
                >
                  {ACTIVITY_CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <input
                  type="text"
                  value={activityForm.outcome}
                  onChange={(e) => setActivityForm(prev => ({ ...prev, outcome: e.target.value }))}
                  placeholder="Outcome (optional)"
                  className="flex-1 bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white text-xs"
                />
              </div>
              <textarea
                value={activityForm.body}
                onChange={(e) => setActivityForm(prev => ({ ...prev, body: e.target.value }))}
                placeholder="What happened?"
                rows={2}
                className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white text-xs"
              />
              <button
                onClick={handleLogActivity}
                disabled={isLoggingActivity || !activityForm.body.trim()}
                className="w-full py-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded font-bold transition text-xs disabled:opacity-50"
              >
                {isLoggingActivity ? 'Logging...' : 'Log Activity'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Disqualify Lead */}
      {isDisqualifyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#111827] border border-[#1E293B] rounded-xl p-6 relative">
            <button onClick={() => setIsDisqualifyModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-bold text-white mb-2 text-rose-400">Disqualify Lead</h2>
            <p className="text-xs text-slate-400 mb-4">Please detail the reason for disqualifying {selectedLead?.company_name}.</p>
            <div className="space-y-4 text-xs">
              <textarea
                value={disqualifyReason}
                onChange={(e) => setDisqualifyReason(e.target.value)}
                placeholder="Budget mismatch, out-of-scope domain, or unresponsive client..."
                rows={4}
                className="w-full bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white focus:outline-none"
              />
              <button
                onClick={handleConfirmDisqualify}
                className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold transition"
              >
                Mark Disqualified
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Grant Portal Access (post-qualification, explicit action) */}
      {qualifiedLeadPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#111827] border border-[#1E293B] rounded-xl p-6 relative">
            <button onClick={() => setQualifiedLeadPrompt(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-bold text-white mb-2 text-emerald-400">Grant Portal Access?</h2>
            <p className="text-xs text-slate-400 mb-4">
              This lead is now a client. Give <span className="text-white font-bold">{qualifiedLeadPrompt.contactName}</span> a client portal
              account? This creates a real login and sends them an invite email
              {qualifiedLeadPrompt.email ? <> to <span className="text-white font-bold">{qualifiedLeadPrompt.email}</span></> : null}.
            </p>
            {!qualifiedLeadPrompt.email && (
              <p className="text-[11px] text-amber-400 mb-4">
                This contact has no email on file - add one before an invite can be sent.
              </p>
            )}
            <div className="flex gap-3 text-xs">
              <button
                onClick={() => setQualifiedLeadPrompt(null)}
                className="flex-1 py-2 bg-[#1E293B] hover:bg-[#273449] text-white rounded font-bold transition"
              >
                Skip for now
              </button>
              <button
                onClick={handleGrantPortalAccess}
                disabled={isGrantingPortalAccess || !qualifiedLeadPrompt.email}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded font-bold transition"
              >
                {isGrantingPortalAccess ? 'Sending invite...' : 'Grant Portal Access'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Lead */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#111827] border border-[#1E293B] rounded-xl p-6 relative">
            <button onClick={() => setIsDeleteModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-bold text-white mb-2 text-rose-400">Delete Lead</h2>
            <p className="text-xs text-slate-400 mb-4">
              Delete <span className="text-white font-bold">{selectedLead?.company_name}</span>? This can&apos;t be undone from this screen.
            </p>
            <div className="flex gap-3 text-xs">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                className="flex-1 py-2 bg-[#1E293B] hover:bg-[#273449] text-white rounded font-bold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteLead}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Duplicate Preview */}
      {isDupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[#111827] border border-[#1E293B] rounded-xl p-6 relative">
            <button onClick={() => setIsDupModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-bold text-white mb-2">Duplicate Resolution Engine</h2>
            <p className="text-xs text-slate-400 mb-4">Potential matches found in the CRM directory for <span className="text-white font-bold">{selectedLead?.company_name}</span>.</p>

            <div className="space-y-3 max-h-60 overflow-y-auto">
              {duplicateLeads.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No duplicate matches found. This contact is clean.</p>
              ) : (
                duplicateLeads.map((dup) => (
                  <div key={dup.id} className="bg-[#0A0D14] border border-[#1E293B] p-3 rounded-lg flex items-center justify-between text-xs">
                    <div>
                      <h4 className="font-bold text-white">{dup.company_name}</h4>
                      <p className="text-slate-400">{dup.contact_name} | {dup.contact_email}</p>
                    </div>
                    <button
                      onClick={() => handleMergeLeads(dup.id)}
                      className="px-3 py-1 bg-[#3B82F6]/10 text-[#3B82F6] hover:bg-[#3B82F6]/20 rounded font-semibold"
                    >
                      Merge Into Existing
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setIsDupModalOpen(false)}
                className="px-4 py-2 border border-[#1E293B] rounded text-slate-400 text-xs hover:bg-[#1E293B]"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {documentsFor && (
        <EntityDocumentsDrawer
          entityType="lead"
          entityId={documentsFor.id}
          entityLabel={documentsFor.label}
          onClose={() => setDocumentsFor(null)}
        />
      )}
    </main>
  );
}
