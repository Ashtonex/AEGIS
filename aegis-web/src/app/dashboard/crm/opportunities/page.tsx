"use client";

import React, { useCallback, useState, useEffect } from 'react';
import Link from 'next/link';

import { 
  Briefcase, Plus, X, ChevronLeft, ChevronRight, 
  DollarSign, Activity, AlertTriangle, ShieldCheck, 
  MessageSquare, User, Mail, Calendar, Loader2, Save,
  ArrowRight, Landmark, Clock, ArrowLeft, Filter, Search
} from 'lucide-react';
import { 
  getCrmOpportunities, 
  createCrmOpportunity, 
  updateCrmOpportunity, 
  getCrmContacts, 
  createCrmContact,
  getCrmActivities,
  createCrmActivity
} from '@/lib/api';

// Stages definition requested by user
const STAGES = [
  'Qualification',
  'Proposal',
  'Negotiation',
  'Won'
];

// Bidirectional mappings to bridge the requested frontend stages to strict backend database schemas
const FRONTEND_TO_BACKEND_STAGE: Record<string, string> = {
  'Qualification': 'Qualification',
  'Proposal': 'Quotation',
  'Negotiation': 'Negotiation',
  'Won': 'Contract'
};

const BACKEND_TO_FRONTEND_STAGE: Record<string, string> = {
  'Inquiry': 'Qualification',
  'Site Visit': 'Qualification',
  'Qualification': 'Qualification',
  'Quotation': 'Proposal',
  'Negotiation': 'Negotiation',
  'Contract': 'Won'
};

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
  created_at: string;
}

interface Contact {
  id: string;
  contact_name: string;
  email?: string;
}

interface ActivityLog {
  id: string;
  type: string;
  notes: string;
  opportunity_id?: string;
  activity_date?: string;
  contact_name?: string;
}

export default function OpportunitiesKanban() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);

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
      const [oppsRes, contactsRes, activitiesRes] = await Promise.allSettled([
        getCrmOpportunities(),
        getCrmContacts(),
        getCrmActivities()
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

    const backendStage = FRONTEND_TO_BACKEND_STAGE[targetStage] || targetStage;

    // Optimistically update local state
    setOpportunities(prev => prev.map(o => o.id === oppId ? { ...o, stage: backendStage } : o));

    try {
      const res = await updateCrmOpportunity(oppId, { stage: backendStage });
      if (!res.success) {
        // Rollback on failure
        loadData();
      } else {
        await createCrmActivity({
          type: 'System Log',
          notes: `Stage moved from ${currentFrontendStage} to ${targetStage} (via drag & drop)`,
          opportunity_id: oppId
        });
        const actRes = await getCrmActivities();
        if (actRes.success && Array.isArray(actRes.data)) {
          setActivities(actRes.data);
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
        await createCrmActivity({
          type: 'System Log',
          notes: `Stage moved from ${currentFrontendStage} to ${nextFrontendStage}`,
          opportunity_id: oppId
        });
        const actRes = await getCrmActivities();
        if (actRes.success && Array.isArray(actRes.data)) {
          setActivities(actRes.data);
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
      if (marginVal) oppPayload.expected_margin = marginVal;
      if (newDeal.risk_level) oppPayload.risk_level = newDeal.risk_level;

      const res = await createCrmOpportunity(oppPayload);

      if (res.success) {
        if ((res.data as any)?.id && (marginVal || newDeal.risk_level || finalClientId)) {
          await updateCrmOpportunity((res.data as any).id, {
            expected_margin: marginVal,
            risk_level: newDeal.risk_level,
            client_id: finalClientId
          });
        }

        setNewDeal({
          name: '',
          stage: 'Qualification',
          budget: '',
          probability: '20',
          expected_margin: '15',
          risk_level: 'Low',
          client_id: '',
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
        client_id: editForm.client_id || null
      };

      const res = await updateCrmOpportunity(selectedOpportunityId, updatePayload);
      if (res.success) {
        await loadData();
        await createCrmActivity({
          type: 'Update',
          notes: `Updated deal parameters: Stage: ${editForm.stage}, Win Prob ${probVal}%, Est Margin ${marginVal}%, Risk: ${editForm.risk_level}`,
          opportunity_id: selectedOpportunityId
        });
        const actRes = await getCrmActivities();
        if (actRes.success && Array.isArray(actRes.data)) {
          setActivities(actRes.data);
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
        notes: newNote.notes.trim(),
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

  const selectedOpp = opportunities.find(o => o.id === selectedOpportunityId);
  const selectedOppActivities = activities.filter(a => a.opportunity_id === selectedOpportunityId);
  const selectedOppContact = selectedOpp?.client_id 
    ? contacts.find(c => c.id === selectedOpp.client_id)
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
        client_id: selectedOpp.client_id || ''
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
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{
        backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
        backgroundSize: '32px 32px'
      }} />

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
      <div className="grid grid-cols-3 gap-2 mb-6 shrink-0 z-10">
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
      </div>

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
                  
                  return (
                    <div 
                      key={opp.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, opp.id)}
                      onClick={() => setSelectedOpportunityId(opp.id)}
                      className="group bg-[#111111] border border-white/5 hover:border-[#D4AF37]/30 p-3 rounded-sm transition-all cursor-grab active:cursor-grabbing hover:shadow-[0_4px_20px_rgba(0,0,0,0.5)] transform hover:-translate-y-0.5 duration-150 relative overflow-hidden"
                    >
                      {/* Top border colored by risk */}
                      <div className={`absolute top-0 left-0 w-full h-[2px] ${
                        opp.risk_level === 'High' ? 'bg-red-500' :
                        opp.risk_level === 'Medium' ? 'bg-[#D4AF37]' : 'bg-[#3B82F6]'
                      }`} />

                      <div className="flex justify-between items-start mb-1 pt-1">
                        <h4 className="text-xs font-semibold text-paper truncate pr-2 group-hover:text-[#D4AF37] transition-colors">{opp.name}</h4>
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
                            disabled={STAGES.indexOf(stage) === 0}
                            onClick={() => handleStageMove(opp.id, stage, 'prev')}
                            className="w-5 h-5 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none rounded-sm flex items-center justify-center transition-all text-slate-light"
                          >
                            <ChevronLeft className="w-3 h-3" />
                          </button>
                          <button 
                            disabled={STAGES.indexOf(stage) === STAGES.length - 1}
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
                    {contacts.map(c => (
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
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
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

                  {/* Linked client display/change */}
                  <div className="space-y-1">
                    <label className="block font-mono text-[8px] text-slate-light uppercase">Client Contact Link</label>
                    <select 
                      value={editForm.client_id} 
                      onChange={e => setEditForm({ ...editForm, client_id: e.target.value })}
                      className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                    >
                      <option value="">-- No Contact --</option>
                      {contacts.map(c => (
                        <option key={c.id} value={c.id}>{c.contact_name}</option>
                      ))}
                    </select>
                  </div>
                </form>
              )}

              {/* LINKED CONTACT DETAIL BLOCK */}
              <div className="space-y-2 bg-[#0C0C0C] border border-white/5 p-4 rounded-sm">
                <span className="block font-mono text-[9px] text-[#3B82F6] uppercase tracking-wider">Associated client profile</span>
                
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
                          <p className="text-[11px] text-slate-light leading-relaxed whitespace-pre-wrap">{act.notes}</p>
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
    </div>
  );
}
