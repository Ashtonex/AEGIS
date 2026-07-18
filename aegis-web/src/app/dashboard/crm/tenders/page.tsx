"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  FileText, Plus, X, ChevronLeft, ChevronRight, 
  DollarSign, Clock, ShieldCheck, CheckSquare, 
  Briefcase, UserCheck, AlertTriangle, Loader2, Save,
  Calendar, Users, Info, ToggleLeft, ToggleRight, Search, Landmark, ShieldAlert
} from 'lucide-react';
import { 
  getCrmTenders, 
  createCrmTender, 
  updateCrmTender 
} from '@/lib/api';

// Stages definition
const STAGES = [
  'Tender Identified',
  'Bid Prep',
  'Submitted',
  'Adjudication',
  'Awarded/Lost'
];

const CATEGORIES = [
  'Civil Works',
  'Mechanical Engineering',
  'Electrical Installation',
  'Structural Steel',
  'Supply & Delivery',
  'General Building'
];

interface Tender {
  id: string;
  tender_name: string;
  bid_number?: string;
  category?: string;
  bid_amount: number | string;
  stage: string;
  submission_deadline?: string;
  bid_bond_secured: boolean;
  jv_partners?: string;
  bond_amount?: number | string;
  technical_proposal: boolean;
  financial_proposal: boolean;
  nssa_clearance: boolean;
  praz_registration: boolean;
  tax_clearance: boolean;
  created_at: string;
}

export default function TendersCommand() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedBondStatus, setSelectedBondStatus] = useState('All');
  const [liabilityRange, setLiabilityRange] = useState('All');

  // Drag and Drop hover state
  const [draggedOverStage, setDraggedOverStage] = useState<string | null>(null);

  // Form State
  const [newTender, setNewTender] = useState({
    tender_name: '',
    bid_number: '',
    category: 'Civil Works',
    stage: 'Tender Identified',
    bid_amount: '',
    submission_deadline: '',
    bid_bond_secured: false,
    jv_partners: '',
    bond_amount: '',
    technical_proposal: false,
    financial_proposal: false,
    nssa_clearance: false,
    praz_registration: false,
    tax_clearance: false
  });

  // Edit Drawer Form State
  const [editForm, setEditForm] = useState<Tender | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await getCrmTenders();
      if (res.success && Array.isArray(res.data)) {
        setTenders(res.data);
      }
    } catch (error) {
      console.error('Error loading CRM tenders data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStageBidSum = (stage: string) => {
    return filteredTenders
      .filter(t => t.stage === stage)
      .reduce((sum, t) => sum + (Number(t.bid_amount) || 0), 0);
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, tenderId: string) => {
    e.dataTransfer.setData('text/plain', tenderId);
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
    const tenderId = e.dataTransfer.getData('text/plain');
    if (!tenderId) return;

    const tender = tenders.find(t => t.id === tenderId);
    if (!tender) return;
    if (tender.stage === targetStage) return;

    // Optimistically update local state
    setTenders(prev => prev.map(t => t.id === tenderId ? { ...t, stage: targetStage } : t));

    try {
      const res = await updateCrmTender(tenderId, { stage: targetStage });
      if (!res.success) {
        loadData();
      }
    } catch (err) {
      console.error('Failed to update stage via drag-drop:', err);
      loadData();
    }
  };

  const getCountdown = (deadlineStr?: string) => {
    if (!deadlineStr) return { text: 'N/A', urgency: 'none' };
    
    const deadline = new Date(deadlineStr).getTime();
    const now = new Date().getTime();
    const diff = deadline - now;
    
    if (diff <= 0) return { text: 'LAPSED', urgency: 'critical' };
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days === 0) {
      return { text: `${hours}h remaining`, urgency: 'warning' };
    }
    if (days <= 3) {
      return { text: `${days}d ${hours}h left`, urgency: 'warning' };
    }
    return { text: `${days}d left`, urgency: 'normal' };
  };

  const getChecklistCount = (t: Tender) => {
    let count = 0;
    if (t.technical_proposal) count++;
    if (t.financial_proposal) count++;
    if (t.nssa_clearance) count++;
    if (t.praz_registration) count++;
    if (t.tax_clearance) count++;
    return count;
  };

  const handleStageMove = async (tenderId: string, currentStage: string, direction: 'prev' | 'next') => {
    const currentIndex = STAGES.indexOf(currentStage);
    if (currentIndex === -1) return;
    
    let nextIndex = currentIndex;
    if (direction === 'prev' && currentIndex > 0) nextIndex--;
    if (direction === 'next' && currentIndex < STAGES.length - 1) nextIndex++;
    
    if (nextIndex === currentIndex) return;
    const nextStage = STAGES[nextIndex];

    // Optimistically update state
    setTenders(prev => prev.map(t => t.id === tenderId ? { ...t, stage: nextStage } : t));

    try {
      const res = await updateCrmTender(tenderId, { stage: nextStage });
      if (!res.success) {
        loadData();
      }
    } catch (err) {
      console.error('Failed to update stage:', err);
      loadData();
    }
  };

  const handleCreateTender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTender.tender_name.trim()) return;

    setIsSubmitting(true);
    try {
      const bidAmountVal = Number(newTender.bid_amount) || 0;
      const bondAmountVal = Number(newTender.bond_amount) || 0;

      const payload: any = {
        tender_name: newTender.tender_name.trim(),
        stage: newTender.stage,
        bid_amount: bidAmountVal
      };

      const res = await createCrmTender(payload);

      if (res.success && (res.data as any)?.id) {
        const generatedId = (res.data as any).id;
        
        // Update all specific bid board columns
        const extraPayload: any = {
          bid_number: newTender.bid_number.trim() || `BID-2026-${generatedId.substring(0, 5).toUpperCase()}`,
          category: newTender.category,
          bid_bond_secured: newTender.bid_bond_secured,
          jv_partners: newTender.jv_partners.trim() || null,
          bond_amount: bondAmountVal,
          technical_proposal: newTender.technical_proposal,
          financial_proposal: newTender.financial_proposal,
          nssa_clearance: newTender.nssa_clearance,
          praz_registration: newTender.praz_registration,
          tax_clearance: newTender.tax_clearance
        };

        if (newTender.submission_deadline) {
          extraPayload.submission_deadline = new Date(newTender.submission_deadline).toISOString();
        }

        await updateCrmTender(generatedId, extraPayload);

        // Reset state
        setNewTender({
          tender_name: '',
          bid_number: '',
          category: 'Civil Works',
          stage: 'Tender Identified',
          bid_amount: '',
          submission_deadline: '',
          bid_bond_secured: false,
          jv_partners: '',
          bond_amount: '',
          technical_proposal: false,
          financial_proposal: false,
          nssa_clearance: false,
          praz_registration: false,
          tax_clearance: false
        });
        setIsModalOpen(false);
        await loadData();
      }
    } catch (err) {
      console.error('Failed to create tender:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateTenderDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenderId || !editForm) return;

    setIsSubmitting(true);
    try {
      const bidAmountVal = Number(editForm.bid_amount) || 0;
      const bondAmountVal = Number(editForm.bond_amount) || 0;

      const payload: any = {
        tender_name: editForm.tender_name,
        bid_number: editForm.bid_number || '',
        category: editForm.category || 'Civil Works',
        stage: editForm.stage,
        bid_amount: bidAmountVal,
        bid_bond_secured: editForm.bid_bond_secured,
        jv_partners: editForm.jv_partners || null,
        bond_amount: bondAmountVal,
        technical_proposal: editForm.technical_proposal,
        financial_proposal: editForm.financial_proposal,
        nssa_clearance: editForm.nssa_clearance,
        praz_registration: editForm.praz_registration,
        tax_clearance: editForm.tax_clearance
      };

      if (editForm.submission_deadline) {
        payload.submission_deadline = new Date(editForm.submission_deadline).toISOString();
      } else {
        payload.submission_deadline = null;
      }

      const res = await updateCrmTender(selectedTenderId, payload);
      if (res.success) {
        await loadData();
      }
    } catch (err) {
      console.error('Failed to update tender details:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleChecklistItem = async (tenderId: string, itemKey: keyof Tender) => {
    const tender = tenders.find(t => t.id === tenderId);
    if (!tender) return;

    const currentVal = !!tender[itemKey];
    const newVal = !currentVal;

    // Optimistically update
    setTenders(prev => prev.map(t => t.id === tenderId ? { ...t, [itemKey]: newVal } as Tender : t));
    if (editForm && editForm.id === tenderId) {
      setEditForm(prev => prev ? ({ ...prev, [itemKey]: newVal } as Tender) : null);
    }

    try {
      const res = await updateCrmTender(tenderId, { [itemKey]: newVal });
      if (!res.success) {
        loadData();
      }
    } catch (err) {
      console.error(`Failed to toggle ${itemKey}:`, err);
      loadData();
    }
  };

  // Filter application
  const filteredTenders = tenders.filter(t => {
    // Search query matches title, bid number or JV partners
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = searchQuery === '' || 
      t.tender_name.toLowerCase().includes(searchLower) ||
      (t.bid_number && t.bid_number.toLowerCase().includes(searchLower)) ||
      (t.jv_partners && t.jv_partners.toLowerCase().includes(searchLower));

    // Category filter
    const matchesCategory = selectedCategory === 'All' || t.category === selectedCategory;

    // Bid bond status
    let matchesBond = true;
    if (selectedBondStatus === 'Secured') {
      matchesBond = t.bid_bond_secured;
    } else if (selectedBondStatus === 'Pending') {
      matchesBond = !t.bid_bond_secured;
    }

    // Security liability range
    const bondVal = Number(t.bond_amount) || 0;
    let matchesLiability = true;
    if (liabilityRange === 'Low') {
      matchesLiability = bondVal < 10000;
    } else if (liabilityRange === 'Mid') {
      matchesLiability = bondVal >= 10000 && bondVal <= 50000;
    } else if (liabilityRange === 'High') {
      matchesLiability = bondVal > 50000;
    }

    return matchesSearch && matchesCategory && matchesBond && matchesLiability;
  });

  const selectedTender = tenders.find(t => t.id === selectedTenderId);

  // Initialize edit drawer form when drawer opens
  useEffect(() => {
    if (selectedTender) {
      setEditForm({ ...selectedTender });
    } else {
      setEditForm(null);
    }
  }, [selectedTender]);

  // Analytics helper values
  const totalBidAmount = tenders.reduce((sum, t) => sum + (Number(t.bid_amount) || 0), 0);
  
  // Outstanding liabilities is only active if bid bond is secured AND tender stage is not "Awarded/Lost" (unreleased risk)
  const totalLiabilities = tenders
    .filter(t => t.bid_bond_secured && t.stage !== 'Awarded/Lost')
    .reduce((sum, t) => sum + (Number(t.bond_amount) || 0), 0);

  const activeBondsCount = tenders.filter(t => t.bid_bond_secured).length;

  if (isLoading && tenders.length === 0) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#D4AF37] animate-spin mb-4" />
        <span className="font-mono text-xs text-slate-light tracking-widest uppercase">Syncing Bidding Ledger...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-paper p-6 relative overflow-hidden flex flex-col">
      {/* Grid Pattern overlay */}
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{
        backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
        backgroundSize: '32px 32px'
      }} />

      {/* Header */}
      <header className="flex justify-between items-end border-b border-white/5 pb-4 mb-6 relative z-10 shrink-0">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-pulse"></span>
            <span className="font-mono text-[9px] text-[#3B82F6] uppercase tracking-widest">Construction procurement bids</span>
          </div>
          <h1 className="font-sans font-black text-2xl tracking-tight text-paper uppercase">
            Tenders & Bids Board
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
            <span>Log Tender</span>
          </button>
        </div>
      </header>

      {/* Overview Analytics Row */}
      <div className="grid grid-cols-4 gap-2 mb-6 shrink-0 z-10">
        <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
          <span className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1">Total Bid Book Value</span>
          <span className="font-mono text-lg font-bold text-paper tabular-nums">
            ${totalBidAmount.toLocaleString()}
          </span>
        </div>
        <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
          <span className="block font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider mb-1">Active Bid Bonds</span>
          <span className="font-mono text-lg font-bold text-[#D4AF37] tabular-nums">
            {activeBondsCount} <span className="text-xs text-slate font-normal">secured</span>
          </span>
        </div>
        <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
          <span className="block font-mono text-[9px] text-[#EF4444] uppercase tracking-wider mb-1">Outstanding Liability Risk</span>
          <span className="font-mono text-lg font-bold text-[#EF4444] tabular-nums">
            ${totalLiabilities.toLocaleString()}
          </span>
        </div>
        <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
          <span className="block font-mono text-[9px] text-[#3B82F6] uppercase tracking-wider mb-1">Checklist Compliance</span>
          <span className="font-mono text-lg font-bold text-[#3B82F6] tabular-nums">
            {tenders.length > 0 
              ? `${(tenders.reduce((sum, t) => sum + getChecklistCount(t), 0) / (tenders.length * 5) * 100).toFixed(0)}%`
              : '0%'
            }
          </span>
        </div>
      </div>

      {/* Search and Filters panel */}
      <div className="bg-[#0A0A0A] border border-white/5 p-4 rounded-sm mb-6 flex flex-col lg:flex-row gap-4 justify-between items-center shrink-0 z-10">
        <div className="w-full lg:w-1/4 relative">
          <input
            type="text"
            placeholder="Search bid name, number, JV..."
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
          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="bg-black border border-white/10 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none"
          >
            <option value="All">All Categories</option>
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          {/* Bid Bond Filter */}
          <select
            value={selectedBondStatus}
            onChange={e => setSelectedBondStatus(e.target.value)}
            className="bg-black border border-white/10 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none"
          >
            <option value="All">All Bonds</option>
            <option value="Secured">Bond Secured</option>
            <option value="Pending">Bond Pending</option>
          </select>

          {/* Security Liability Range */}
          <select
            value={liabilityRange}
            onChange={e => setLiabilityRange(e.target.value)}
            className="bg-black border border-white/10 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none"
          >
            <option value="All">All Liabilities</option>
            <option value="Low">Low (&lt;$10k)</option>
            <option value="Mid">Medium ($10k-$50k)</option>
            <option value="High">High (&gt;$50k)</option>
          </select>

          {/* Clear Filters Button */}
          {(searchQuery || selectedCategory !== 'All' || selectedBondStatus !== 'All' || liabilityRange !== 'All') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('All');
                setSelectedBondStatus('All');
                setLiabilityRange('All');
              }}
              className="text-[9px] font-mono text-[#D4AF37] hover:underline uppercase transition-all px-2 py-1.5"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Bid Board Kanban Board */}
      <div className="flex-1 overflow-x-auto flex gap-4 pb-4 items-start min-h-0 select-none">
        {STAGES.map(stage => {
          const stageTenders = filteredTenders.filter(t => t.stage === stage);
          const stageSum = getStageBidSum(stage);

          return (
            <div 
              key={stage}
              onDragOver={(e) => handleDragOver(e, stage)}
              onDragEnter={(e) => handleDragEnter(e, stage)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage)}
              className={`flex-1 min-w-[290px] max-w-[330px] rounded-sm p-3 flex flex-col max-h-full min-h-[400px] transition-all duration-200 ${
                draggedOverStage === stage 
                  ? 'bg-[#181a1f] border border-[#3B82F6]/40 shadow-[0_0_20px_rgba(59,130,246,0.08)] scale-[1.01]' 
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
                <span className="font-mono text-[10px] text-slate bg-white/5 px-2 py-0.5 rounded-full">{stageTenders.length}</span>
              </div>

              {/* Cards list */}
              <div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1 min-h-0">
                {stageTenders.map(t => {
                  const countdown = getCountdown(t.submission_deadline);
                  const progress = getChecklistCount(t);
                  const bondVal = Number(t.bond_amount) || 0;
                  const isLiabilityOutstanding = t.bid_bond_secured && t.stage !== 'Awarded/Lost';

                  return (
                    <div 
                      key={t.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, t.id)}
                      onClick={() => setSelectedTenderId(t.id)}
                      className="group bg-[#111111] border border-white/5 hover:border-[#3B82F6]/30 p-3.5 rounded-sm cursor-grab active:cursor-grabbing hover:shadow-[0_4px_20px_rgba(0,0,0,0.5)] transform hover:-translate-y-0.5 duration-150 transition-all relative"
                    >
                      <div className="flex justify-between items-start mb-1.5 gap-2">
                        <span className="text-[9px] font-mono text-[#D4AF37] tracking-wider block font-bold truncate max-w-[120px]">
                          {t.bid_number || `BID-${t.id.substring(0, 5).toUpperCase()}`}
                        </span>
                        
                        {t.category && (
                          <span className="text-[7.5px] font-mono text-[#3B82F6] border border-[#3B82F6]/20 bg-[#3B82F6]/5 px-1 py-0.5 rounded-sm shrink-0 uppercase tracking-widest">
                            {t.category}
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs font-bold text-paper line-clamp-2 pr-2 group-hover:text-[#D4AF37] transition-colors mb-2">
                        {t.tender_name}
                      </h4>

                      {/* Display Bid details */}
                      <div className="space-y-1.5 my-3 text-[10px] text-slate-light font-mono">
                        <div className="flex justify-between">
                          <span>Bid Value:</span>
                          <span className="text-paper font-bold">${(Number(t.bid_amount) || 0).toLocaleString()}</span>
                        </div>
                        
                        <div className="flex justify-between items-center">
                          <span>Bid Bond Status:</span>
                          <span className={`px-1.5 py-0.2 rounded-sm text-[8px] font-bold ${
                            t.bid_bond_secured 
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>
                            {t.bid_bond_secured ? 'SECURED' : 'PENDING'}
                          </span>
                        </div>

                        {bondVal > 0 && (
                          <div className="flex justify-between items-center">
                            <span>Liability:</span>
                            <span className={`font-semibold flex items-center ${isLiabilityOutstanding ? 'text-[#EF4444]' : 'text-slate-light'}`}>
                              ${bondVal.toLocaleString()}
                              {isLiabilityOutstanding && (
                                <ShieldAlert className="w-3.5 h-3.5 ml-1 text-[#EF4444] animate-pulse" />
                              )}
                            </span>
                          </div>
                        )}

                        {t.jv_partners && (
                          <div className="flex justify-between items-center">
                            <span>JV Partners:</span>
                            <span className="text-paper truncate max-w-[140px]">{t.jv_partners}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span>Checklist:</span>
                          <span className={`px-1.5 py-0.5 rounded-sm text-[9px] ${
                            progress === 5 ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-white/5 text-slate-light'
                          }`}>{progress}/5 complete</span>
                        </div>
                      </div>

                      {/* Footer with deadline countdown */}
                      <div className="flex justify-between items-end border-t border-white/5 pt-2.5 mt-2">
                        {t.submission_deadline ? (
                          <div className="flex items-center space-x-1.5">
                            <Clock className={`w-3.5 h-3.5 ${
                              countdown.urgency === 'critical' ? 'text-red-500 animate-pulse' :
                              countdown.urgency === 'warning' ? 'text-[#D4AF37]' : 'text-[#3B82F6]'
                            }`} />
                            <span className={`font-mono text-[9px] ${
                              countdown.urgency === 'critical' ? 'text-red-400 font-bold' :
                              countdown.urgency === 'warning' ? 'text-[#D4AF37]' : 'text-slate-light'
                            }`}>{countdown.text}</span>
                          </div>
                        ) : (
                          <span className="font-mono text-[8px] text-slate">NO DEADLINE</span>
                        )}

                        {/* Quick stage controllers */}
                        <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                          <button 
                            disabled={STAGES.indexOf(stage) === 0}
                            onClick={() => handleStageMove(t.id, stage, 'prev')}
                            className="w-5 h-5 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none rounded-sm flex items-center justify-center transition-all text-slate-light"
                          >
                            <ChevronLeft className="w-3 h-3" />
                          </button>
                          <button 
                            disabled={STAGES.indexOf(stage) === STAGES.length - 1}
                            onClick={() => handleStageMove(t.id, stage, 'next')}
                            className="w-5 h-5 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none rounded-sm flex items-center justify-center transition-all text-slate-light"
                          >
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {stageTenders.length === 0 && (
                  <div className="h-28 border border-dashed border-white/5 rounded-sm flex flex-col items-center justify-center opacity-40">
                    <span className="font-mono text-[9px] text-slate uppercase">Drag bids here</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* LOG TENDER MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          
          <div className="relative bg-[#0A0A0A] border border-white/10 w-full max-w-lg rounded-sm shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-[#D4AF37]" />
                <h2 className="font-sans font-bold text-sm text-paper uppercase tracking-wider">Log Construction Bid / Tender</h2>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="w-7 h-7 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-slate-light hover:text-paper transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTender} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Tender Name / Reference</label>
                <input 
                  required 
                  type="text" 
                  value={newTender.tender_name} 
                  onChange={e => setNewTender({ ...newTender, tender_name: e.target.value })}
                  className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all placeholder:text-slate" 
                  placeholder="e.g. M.T.C.D Highway reconstruction" 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Bid Reference Number</label>
                  <input 
                    type="text" 
                    value={newTender.bid_number} 
                    onChange={e => setNewTender({ ...newTender, bid_number: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono" 
                    placeholder="e.g. TDR/2026/CIV-102" 
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Category</label>
                  <select
                    value={newTender.category} 
                    onChange={e => setNewTender({ ...newTender, category: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                  >
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Tender Stage</label>
                  <select 
                    value={newTender.stage} 
                    onChange={e => setNewTender({ ...newTender, stage: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                  >
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Submission Deadline</label>
                  <input 
                    type="datetime-local" 
                    value={newTender.submission_deadline} 
                    onChange={e => setNewTender({ ...newTender, submission_deadline: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none font-mono" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Bid Amount ($)</label>
                  <input 
                    required 
                    type="number" 
                    value={newTender.bid_amount} 
                    onChange={e => setNewTender({ ...newTender, bid_amount: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono" 
                    placeholder="Bid budget in USD" 
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider font-bold text-[#D4AF37]">JV Partners</label>
                  <input 
                    type="text" 
                    value={newTender.jv_partners} 
                    onChange={e => setNewTender({ ...newTender, jv_partners: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all" 
                    placeholder="e.g. Group Five Ltd, Stefanutti" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-3">
                <div className="space-y-1.5">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Bid Bond / Security Liability ($)</label>
                  <input 
                    type="number" 
                    value={newTender.bond_amount} 
                    onChange={e => setNewTender({ ...newTender, bond_amount: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none font-mono" 
                    placeholder="Bond liability USD" 
                  />
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center space-x-2.5 cursor-pointer text-xs font-mono select-none text-slate-light py-2">
                    <input 
                      type="checkbox" 
                      checked={newTender.bid_bond_secured} 
                      onChange={e => setNewTender({ ...newTender, bid_bond_secured: e.target.checked })}
                      className="rounded border-white/10 bg-black text-[#D4AF37] focus:ring-0 focus:ring-offset-0 focus:outline-none"
                    />
                    <span className="uppercase text-[9px] tracking-wider font-bold text-[#D4AF37]">Bid Bond Secured</span>
                  </label>
                </div>
              </div>

              {/* Initial Checklist states */}
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Bid Deliverables Checklist</label>
                <div className="grid grid-cols-2 gap-2 bg-white/[0.01] border border-white/5 p-3 rounded-sm">
                  {[
                    { key: 'technical_proposal', label: 'Technical Proposal' },
                    { key: 'financial_proposal', label: 'Financial Proposal' },
                    { key: 'nssa_clearance', label: 'NSSA Clearance' },
                    { key: 'praz_registration', label: 'PRAZ Registration' },
                    { key: 'tax_clearance', label: 'Tax Clearance Certificate' }
                  ].map(item => (
                    <label key={item.key} className="flex items-center space-x-2 text-[10px] text-slate-light font-mono cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={!!(newTender as any)[item.key]} 
                        onChange={e => setNewTender({ ...newTender, [item.key]: e.target.checked })}
                        className="rounded border-white/10 bg-black text-[#D4AF37] focus:ring-0"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
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
                  {isSubmitting ? 'PROCESSING...' : 'INITIALIZE TENDER'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DETAILED SLIDE-OUT EDIT DRAWER & CHECKLIST VALIDATOR */}
      <div className={`fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-[#0A0A0A] border-l border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.9)] transform transition-transform duration-300 ease-out flex flex-col ${
        selectedTenderId ? 'translate-x-0' : 'translate-x-full'
      }`}>
        {selectedTender ? (
          <>
            {/* Drawer Header */}
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
              <div className="flex items-center space-x-2.5">
                <FileText className="w-4 h-4 text-[#D4AF37]" />
                <div>
                  <span className="font-mono text-[8px] text-slate-light uppercase tracking-wider block">Bidding Control Deck</span>
                  <h2 className="font-sans font-bold text-sm text-paper uppercase truncate max-w-[280px]">{selectedTender.tender_name}</h2>
                </div>
              </div>
              <button 
                onClick={() => setSelectedTenderId(null)}
                className="w-7 h-7 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-slate-light hover:text-paper transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
              
              {/* EDIT FORM BLOCK */}
              {editForm && (
                <form onSubmit={handleUpdateTenderDetails} className="space-y-4 bg-white/[0.01] border border-white/5 p-4 rounded-sm">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider font-bold">Bid Parameters</span>
                    <button 
                      type="submit"
                      disabled={isSubmitting}
                      className="flex items-center space-x-1 text-[9px] font-mono bg-white/5 hover:bg-[#D4AF37] hover:text-black border border-white/10 px-2.5 py-0.5 rounded-sm uppercase transition-all"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{isSubmitting ? 'Saving' : 'Save Details'}</span>
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label className="block font-mono text-[8px] text-slate-light uppercase">Tender Title / Reference</label>
                    <input 
                      type="text" 
                      value={editForm.tender_name} 
                      onChange={e => setEditForm({ ...editForm, tender_name: e.target.value })}
                      className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all" 
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Bid Reference Number</label>
                      <input 
                        type="text" 
                        value={editForm.bid_number || ''} 
                        onChange={e => setEditForm({ ...editForm, bid_number: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono" 
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Category</label>
                      <select 
                        value={editForm.category || 'Civil Works'} 
                        onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                      >
                        {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Bidding Stage</label>
                      <select 
                        value={editForm.stage} 
                        onChange={e => setEditForm({ ...editForm, stage: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                      >
                        {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Submission Deadline</label>
                      <input 
                        type="datetime-local" 
                        value={editForm.submission_deadline ? editForm.submission_deadline.substring(0, 16) : ''} 
                        onChange={e => setEditForm({ ...editForm, submission_deadline: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none font-mono" 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Total Bid Amount ($)</label>
                      <input 
                        type="number" 
                        value={editForm.bid_amount} 
                        onChange={e => setEditForm({ ...editForm, bid_amount: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono" 
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase font-bold text-[#D4AF37]">JV Partners</label>
                      <input 
                        type="text" 
                        value={editForm.jv_partners || ''} 
                        onChange={e => setEditForm({ ...editForm, jv_partners: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all" 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Bid Bond / Liability ($)</label>
                      <input 
                        type="number" 
                        value={editForm.bond_amount || ''} 
                        onChange={e => setEditForm({ ...editForm, bond_amount: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none font-mono" 
                      />
                    </div>

                    <div className="flex flex-col justify-end">
                      <label className="flex items-center space-x-2.5 cursor-pointer text-xs font-mono select-none text-slate-light py-2">
                        <input 
                          type="checkbox" 
                          checked={editForm.bid_bond_secured} 
                          onChange={e => setEditForm({ ...editForm, bid_bond_secured: e.target.checked })}
                          className="rounded border-white/5 bg-black text-[#D4AF37] focus:ring-0"
                        />
                        <span className="uppercase text-[8px] font-bold text-[#D4AF37]">Bid Bond Secured</span>
                      </label>
                    </div>
                  </div>
                </form>
              )}

              {/* CHECKLIST VALIDATOR INTERFACE */}
              <div className="space-y-3 bg-[#0C0C0C] border border-white/5 p-4 rounded-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="block font-mono text-[9px] text-[#3B82F6] uppercase tracking-wider">Deliverable Compliance checks</span>
                  <span className="font-mono text-[10px] text-[#3B82F6] tabular-nums font-bold">
                    {((getChecklistCount(selectedTender) / 5) * 100).toFixed(0)}% VALID
                  </span>
                </div>

                <div className="space-y-2">
                  {[
                    { key: 'technical_proposal', label: 'Technical Proposal documentation', desc: 'SNC methodology, engineer CVs, schedule' },
                    { key: 'financial_proposal', label: 'Financial Proposal bill of quantities', desc: 'Fully populated itemized costings' },
                    { key: 'nssa_clearance', label: 'NSSA Compliance clearance letter', desc: 'National Social Security compliance audit' },
                    { key: 'praz_registration', label: 'PRAZ Procurement Authority registration', desc: 'Active category registry' },
                    { key: 'tax_clearance', label: 'ZIMRA Tax Clearance Certificate', desc: 'Valid tax clearance status token' }
                  ].map(item => {
                    const checked = !!(selectedTender as any)[item.key];
                    return (
                      <div 
                        key={item.key}
                        onClick={() => toggleChecklistItem(selectedTender.id, item.key as keyof Tender)}
                        className={`flex items-center justify-between p-2.5 border rounded-sm transition-all cursor-pointer ${
                          checked 
                            ? 'bg-[#D4AF37]/5 border-[#D4AF37]/30 hover:border-[#D4AF37]/50' 
                            : 'bg-black border-white/5 hover:border-white/10'
                        }`}
                      >
                        <div className="pr-3">
                          <h4 className={`text-xs font-semibold font-sans ${checked ? 'text-[#D4AF37]' : 'text-paper'}`}>
                            {item.label}
                          </h4>
                          <p className="text-[9px] font-mono text-slate mt-0.5">{item.desc}</p>
                        </div>
                        <div className="shrink-0">
                          {checked ? (
                            <ToggleRight className="w-7 h-7 text-[#D4AF37]" />
                          ) : (
                            <ToggleLeft className="w-7 h-7 text-slate" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Countdown panel */}
              {selectedTender.submission_deadline && (
                <div className="bg-[#111111] border border-white/5 p-4 rounded-sm font-mono text-xs flex justify-between items-center">
                  <div className="flex items-center space-x-2 text-slate-light">
                    <Clock className="w-4 h-4 text-[#3B82F6]" />
                    <span>Countdown metric:</span>
                  </div>
                  <span className={`font-bold tracking-widest ${
                    getCountdown(selectedTender.submission_deadline).urgency === 'critical' ? 'text-red-500 animate-pulse' : 'text-[#3B82F6]'
                  }`}>
                    {getCountdown(selectedTender.submission_deadline).text.toUpperCase()}
                  </span>
                </div>
              )}

            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate">
            <span className="font-mono text-xs uppercase">Telemetry not loaded.</span>
          </div>
        )}
      </div>
    </div>
  );
}
