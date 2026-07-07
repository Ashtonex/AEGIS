"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Briefcase, FileText, Target, Crosshair, Users, Activity, Loader2, Plus, LayoutDashboard, Building2, Phone, TrendingUp, TrendingDown, Clock, Zap, ArrowRight, ShieldCheck } from 'lucide-react';
import { getCrmOpportunities, getCrmTenders, getAccountabilityMetrics, createCrmOpportunity, createCrmTender } from '@/lib/api';
import { useAuth } from '@/lib/auth/AuthContext';
import { useRouter } from 'next/navigation';

export default function CRMCommercialEngine() {
  const { session } = useAuth();
  const router = useRouter();
  
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'opportunities' | 'tenders'>('dashboard');
  
  const [accountabilityTargets, setAccountabilityTargets] = useState<any[]>([]);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [tenders, setTenders] = useState<any[]>([]);

  // Modals state
  const [isOppModalOpen, setIsOppModalOpen] = useState(false);
  const [isTenderModalOpen, setIsTenderModalOpen] = useState(false);
  
  // Forms state
  const [oppForm, setOppForm] = useState({ name: '', stage: 'Inquiry', budget: 0, probability: 0 });
  const [tenderForm, setTenderForm] = useState({ tender_name: '', stage: 'Tender Identified', bid_amount: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!session) return;
    loadData();
  }, [session]);

  async function loadData() {
    setIsLoading(true);
    try {
      const [accRes, oppsRes, tendersRes] = await Promise.all([
        getAccountabilityMetrics(),
        getCrmOpportunities(),
        getCrmTenders()
      ]);
      
      if (accRes.success && accRes.data) setAccountabilityTargets(accRes.data);
      if (oppsRes.success && oppsRes.data) setOpportunities(oppsRes.data);
      if (tendersRes.success && tendersRes.data) setTenders(tendersRes.data);
    } catch (err) {
      console.error("Failed to load CRM data:", err);
    } finally {
      setIsLoading(false);
    }
  }

  const handleCreateOpportunity = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await createCrmOpportunity({
        name: oppForm.name,
        stage: oppForm.stage,
        budget: Number(oppForm.budget),
        probability: Number(oppForm.probability)
      });
      setIsOppModalOpen(false);
      setOppForm({ name: '', stage: 'Inquiry', budget: 0, probability: 0 });
      await loadData();
    } catch (error) {
      console.error("Error creating opportunity:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTender = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await createCrmTender({
        tender_name: tenderForm.tender_name,
        stage: tenderForm.stage,
        bid_amount: Number(tenderForm.bid_amount)
      });
      setIsTenderModalOpen(false);
      setTenderForm({ tender_name: '', stage: 'Tender Identified', bid_amount: 0 });
      await loadData();
    } catch (error) {
      console.error("Error creating tender:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderDashboard = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {accountabilityTargets.map((target, idx) => (
          <div 
            key={idx} 
            className="group relative overflow-hidden bg-ink/40 backdrop-blur-xl border border-white/5 p-6 rounded-2xl shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgb(0,0,0,0.4)] hover:border-white/10"
          >
            {/* Ambient hover glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-signal/0 via-signal/0 to-signal/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            
            <div className={`absolute top-0 right-0 w-3 h-3 m-4 rounded-full shadow-[0_0_10px_currentColor] ${
              target.status === 'on-track' ? 'bg-green-500 text-green-500' :
              target.status === 'warning' ? 'bg-signal text-signal' : 'bg-red-500 text-red-500'
            } animate-pulse-slow`}></div>
            
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                <Target className="w-4 h-4 text-slate-light" />
              </div>
              <h3 className="font-mono text-[11px] text-slate-light tracking-widest uppercase">{target.name}</h3>
            </div>
            
            <div className="flex items-end justify-between relative z-10">
              <span className="font-display text-4xl text-paper tracking-tight">{target.current}</span>
              <span className="font-mono text-xs text-slate-light bg-black/30 px-2 py-1 rounded-md mb-1 border border-white/5">
                Target: {target.target}
              </span>
            </div>
            
            {/* Micro progress bar */}
            <div className="mt-4 w-full bg-black/40 h-1 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full ${target.status === 'on-track' ? 'bg-green-500' : target.status === 'warning' ? 'bg-signal' : 'bg-red-500'}`}
                style={{ width: `${Math.min(100, (parseInt(target.current) / parseInt(target.target)) * 100)}%` }}
              ></div>
            </div>
          </div>
        ))}
      </div>

      {/* Commercial Briefing Panel */}
      <div className="bg-ink/40 backdrop-blur-xl border border-white/5 rounded-2xl p-8 relative overflow-hidden shadow-2xl">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-signal/5 rounded-full blur-[80px] -mr-32 -mt-32"></div>
        
        <h2 className="font-mono text-sm text-paper tracking-widest uppercase mb-8 flex items-center">
          <div className="w-8 h-8 rounded-full bg-signal/10 flex items-center justify-center mr-3 border border-signal/20">
            <Activity className="w-4 h-4 text-signal" />
          </div>
          Executive Commercial Briefing
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-8">
          {[
            { label: "New Leads", value: "12", trend: "up", percent: "18%", icon: Users },
            { label: "Pipeline Value", value: "$11.8M", trend: "up", percent: "4%", icon: Briefcase },
            { label: "Expected Rev", value: "$4.6M", trend: "down", percent: "2%", icon: Activity },
            { label: "Bid Success", value: "28%", trend: "up", percent: "5%", icon: Target, color: "text-signal" },
            { label: "Relationship Health", value: "89%", trend: "up", percent: "1%", icon: ShieldCheck, color: "text-green-500" },
            { label: "Gov Opportunities", value: "7", trend: "neutral", percent: "0%", icon: Building2 },
          ].map((stat, idx) => (
            <div key={idx} className="relative group">
              <div className="flex items-center space-x-2 mb-3 opacity-70">
                <stat.icon className="w-3.5 h-3.5 text-slate-light" />
                <p className="font-mono text-[10px] text-slate-light uppercase tracking-wider">{stat.label}</p>
              </div>
              <p className={`text-3xl font-display tracking-tight mb-2 ${stat.color || 'text-paper'}`}>{stat.value}</p>
              <div className="flex items-center space-x-1">
                {stat.trend === 'up' && <TrendingUp className="w-3 h-3 text-green-500" />}
                {stat.trend === 'down' && <TrendingDown className="w-3 h-3 text-red-500" />}
                {stat.trend === 'neutral' && <TrendingUp className="w-3 h-3 text-slate" />}
                <span className={`text-[10px] font-mono ${stat.trend === 'up' ? 'text-green-500' : stat.trend === 'down' ? 'text-red-500' : 'text-slate'}`}>
                  {stat.percent} this week
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderOpportunitiesBoard = () => {
    const stages = ['Inquiry', 'Qualification', 'Site Visit', 'Quotation', 'Negotiation'];
    
    return (
      <div className="flex-1 overflow-x-auto overflow-y-hidden animate-in fade-in duration-500 pb-8 custom-scrollbar">
        <div className="flex space-x-6 min-w-max h-[calc(100vh-250px)] pt-2">
          {stages.map((stage) => {
            const oppsInStage = opportunities.filter((opp) => opp.stage === stage.toUpperCase().replace(' ', '_') || opp.stage === stage);
            const totalValue = oppsInStage.reduce((sum, opp) => sum + (Number(opp.budget) || 0), 0);
            
            return (
              <div key={stage} className="w-[360px] flex flex-col bg-ink/30 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                {/* Header */}
                <div className="p-4 border-b border-white/5 flex justify-between items-center bg-black/20 sticky top-0 z-10 backdrop-blur-xl">
                  <div className="flex items-center space-x-3">
                    <div className="w-2 h-2 rounded-full bg-signal"></div>
                    <h3 className="font-sans font-semibold text-sm text-paper tracking-wide">{stage}</h3>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-xs font-mono text-slate-light">${totalValue.toLocaleString()}</span>
                    <span className="text-[9px] font-mono text-slate tracking-widest mt-0.5">{oppsInStage.length} DEALS</span>
                  </div>
                </div>
                
                {/* Cards List */}
                <div className="p-4 flex-1 overflow-y-auto space-y-4 custom-scrollbar">
                  {oppsInStage.map((opp) => (
                    <div 
                      key={opp.id} 
                      className="bg-ink/80 backdrop-blur-sm border border-white/5 p-5 rounded-xl hover:border-signal/40 hover:shadow-[0_4px_20px_rgba(var(--color-signal),0.1)] cursor-grab active:cursor-grabbing group transition-all duration-300 transform hover:-translate-y-0.5"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <p className="font-sans text-sm font-medium text-paper group-hover:text-signal transition-colors leading-tight">{opp.name}</p>
                        <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                          <Briefcase className="w-3 h-3 text-slate-light" />
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2 mb-4">
                        <Building2 className="w-3 h-3 text-slate" />
                        <p className="text-xs text-slate-light truncate">{opp.client_name || 'Pending Client Details'}</p>
                      </div>
                      
                      <div className="flex justify-between items-end pt-3 border-t border-white/5">
                        <span className="font-mono text-[13px] text-paper font-semibold tracking-tight">
                          ${Number(opp.budget || 0).toLocaleString()}
                        </span>
                        <div className="flex items-center space-x-2">
                          {opp.probability > 0 && (
                            <span className="text-[10px] font-mono text-signal bg-signal/10 border border-signal/20 px-2 py-0.5 rounded-full flex items-center">
                              <Crosshair className="w-2.5 h-2.5 mr-1" />
                              {opp.probability}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  <button 
                    onClick={() => { setOppForm({...oppForm, stage}); setIsOppModalOpen(true); }}
                    className="w-full py-3 bg-black/20 border border-dashed border-white/10 rounded-xl text-slate-light text-xs font-mono hover:text-paper hover:bg-white/5 hover:border-signal/30 transition-all flex items-center justify-center group"
                  >
                    <Plus className="w-3 h-3 mr-2 group-hover:text-signal transition-colors" /> ADD DEAL
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTendersBoard = () => {
    const stages = ['Tender Identified', 'Eligibility/IDD', 'Bid Prep', 'Submitted', 'Adjudication'];
    
    return (
      <div className="flex-1 overflow-x-auto overflow-y-hidden animate-in fade-in duration-500 pb-8 custom-scrollbar">
        <div className="flex space-x-6 min-w-max h-[calc(100vh-250px)] pt-2">
          {stages.map((stage) => {
            const tendersInStage = tenders.filter((t) => t.stage === stage.toUpperCase().replace(/[^A-Z]/g, '_') || t.stage === stage);
            const totalValue = tendersInStage.reduce((sum, t) => sum + (Number(t.bid_amount) || 0), 0);
            
            return (
              <div key={stage} className="w-[360px] flex flex-col bg-ink/30 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                <div className="p-4 border-b border-white/5 flex justify-between items-center bg-black/20 sticky top-0 z-10 backdrop-blur-xl">
                  <div className="flex items-center space-x-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <h3 className="font-sans font-semibold text-sm text-paper tracking-wide">{stage}</h3>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-xs font-mono text-slate-light">${totalValue.toLocaleString()}</span>
                    <span className="text-[9px] font-mono text-slate tracking-widest mt-0.5">{tendersInStage.length} TENDERS</span>
                  </div>
                </div>
                
                <div className="p-4 flex-1 overflow-y-auto space-y-4 custom-scrollbar">
                  {tendersInStage.map((tender) => (
                    <div 
                      key={tender.id} 
                      className="bg-ink/80 backdrop-blur-sm border border-white/5 p-5 rounded-xl hover:border-blue-500/40 hover:shadow-[0_4px_20px_rgba(59,130,246,0.1)] cursor-grab group transition-all duration-300 transform hover:-translate-y-0.5"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <p className="font-sans text-sm font-medium text-paper group-hover:text-blue-400 transition-colors leading-snug line-clamp-2 pr-4">{tender.tender_name}</p>
                        <div className="relative flex h-2 w-2 shrink-0 mt-1">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-end pt-3 border-t border-white/5">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-mono text-slate uppercase tracking-wider mb-0.5">Bid Value</span>
                          <span className="font-mono text-[13px] text-paper font-semibold tracking-tight">
                            ${Number(tender.bid_amount || 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-black/30 border border-white/5 flex items-center justify-center">
                          <FileText className="w-3.5 h-3.5 text-slate-light" />
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  <button 
                    onClick={() => { setTenderForm({...tenderForm, stage}); setIsTenderModalOpen(true); }}
                    className="w-full py-3 bg-black/20 border border-dashed border-white/10 rounded-xl text-slate-light text-xs font-mono hover:text-paper hover:bg-white/5 hover:border-blue-500/30 transition-all flex items-center justify-center group"
                  >
                    <Plus className="w-3 h-3 mr-2 group-hover:text-blue-400 transition-colors" /> ADD TENDER
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (isLoading && opportunities.length === 0) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center">
        <div className="relative">
          <div className="absolute inset-0 border-t-2 border-signal rounded-full animate-spin"></div>
          <div className="absolute inset-2 border-r-2 border-blue-500 rounded-full animate-spin-reverse"></div>
          <div className="w-12 h-12 rounded-full border border-white/10 bg-ink flex items-center justify-center z-10 relative">
            <LayoutDashboard className="w-4 h-4 text-slate-light" />
          </div>
        </div>
        <p className="mt-6 font-mono text-xs tracking-widest text-slate-light uppercase animate-pulse">Initializing Interface</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-paper selection:bg-signal selection:text-ink flex flex-col overflow-hidden relative">
      
      {/* 3D Dynamic Background Layers */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-signal/5 blur-[120px] animate-pulse-slow"></div>
        <div className="absolute top-[60%] -right-[10%] w-[40%] h-[40%] rounded-full bg-blue-500/5 blur-[100px]"></div>
        <div 
          className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,1) 1px, transparent 0)', backgroundSize: '40px 40px' }}
        />
      </div>
      
      <div className="relative z-10 w-full px-8 py-8 flex flex-col h-screen">
        
        {/* Header Section */}
        <header className="flex justify-between items-end pb-8 shrink-0">
          <div className="flex items-center space-x-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-ink-light to-ink border border-white/10 flex items-center justify-center shadow-lg">
              <Activity className="w-6 h-6 text-signal" />
            </div>
            <div>
              <h1 className="font-display text-4xl tracking-tight text-paper mb-1">Commercial Engine</h1>
              <p className="text-body-sm text-slate-light font-mono tracking-widest uppercase flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-signal mr-2 animate-pulse-signal"></span>
                Pipeline & Intelligence Matrix
              </p>
            </div>
          </div>
          
          <div className="flex space-x-4">
            <button 
              onClick={() => setIsOppModalOpen(true)}
              className="group flex items-center px-5 py-2.5 rounded-full bg-white/5 border border-white/10 hover:border-signal hover:bg-signal/5 text-xs font-mono tracking-widest text-paper transition-all duration-300"
            >
              <div className="w-6 h-6 rounded-full bg-signal/20 flex items-center justify-center mr-3 group-hover:bg-signal group-hover:text-ink transition-colors">
                <Plus className="w-3 h-3 text-signal group-hover:text-ink" />
              </div>
              NEW DEAL
            </button>
            <button 
              onClick={() => setIsTenderModalOpen(true)}
              className="group flex items-center px-5 py-2.5 rounded-full bg-white/5 border border-white/10 hover:border-blue-500 hover:bg-blue-500/5 text-xs font-mono tracking-widest text-paper transition-all duration-300"
            >
              <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center mr-3 group-hover:bg-blue-500 group-hover:text-ink transition-colors">
                <Plus className="w-3 h-3 text-blue-400 group-hover:text-ink" />
              </div>
              NEW TENDER
            </button>
          </div>
        </header>

        {/* Premium Navigation Tabs */}
        <div className="flex items-center space-x-2 mb-8 shrink-0 bg-ink/40 backdrop-blur-md border border-white/5 p-1.5 rounded-full w-max">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`px-6 py-2.5 rounded-full font-mono text-[11px] tracking-wider uppercase transition-all duration-300 ${
              activeTab === 'dashboard' 
                ? 'bg-signal text-ink font-bold shadow-[0_0_15px_rgba(var(--color-signal),0.4)]' 
                : 'text-slate-light hover:text-paper hover:bg-white/5'
            }`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('opportunities')}
            className={`px-6 py-2.5 rounded-full font-mono text-[11px] tracking-wider uppercase transition-all duration-300 flex items-center ${
              activeTab === 'opportunities' 
                ? 'bg-white/10 text-paper font-bold border border-white/10 shadow-lg' 
                : 'text-slate-light hover:text-paper hover:bg-white/5'
            }`}
          >
            Opportunities
            <span className="ml-2 bg-black/50 text-[9px] px-1.5 py-0.5 rounded-md text-slate">{opportunities.length}</span>
          </button>
          <button 
            onClick={() => setActiveTab('tenders')}
            className={`px-6 py-2.5 rounded-full font-mono text-[11px] tracking-wider uppercase transition-all duration-300 flex items-center ${
              activeTab === 'tenders' 
                ? 'bg-white/10 text-paper font-bold border border-white/10 shadow-lg' 
                : 'text-slate-light hover:text-paper hover:bg-white/5'
            }`}
          >
            Tenders
            <span className="ml-2 bg-black/50 text-[9px] px-1.5 py-0.5 rounded-md text-slate">{tenders.length}</span>
          </button>
          
          <div className="w-px h-4 bg-white/10 mx-2"></div>
          
          <Link href="/dashboard/crm/subcontractors" className="px-5 py-2.5 rounded-full font-mono text-[11px] tracking-wider uppercase text-slate-light hover:text-paper hover:bg-white/5 transition-all flex items-center">
            <Users className="w-3.5 h-3.5 mr-2 opacity-70" />
            Registry
          </Link>
        </div>

        {/* Dynamic Content Area */}
        <div className="flex-1 relative h-full">
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'opportunities' && renderOpportunitiesBoard()}
          {activeTab === 'tenders' && renderTendersBoard()}
        </div>
      </div>

      {/* NEW OPPORTUNITY MODAL - Glassmorphic Redesign */}
      {isOppModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={() => setIsOppModalOpen(false)}></div>
          
          <div className="relative bg-[#0d0d0d] border border-white/10 w-full max-w-lg rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Modal Header */}
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-signal/10 flex items-center justify-center border border-signal/20">
                  <Target className="w-4 h-4 text-signal" />
                </div>
                <div>
                  <h2 className="font-display text-xl text-paper tracking-tight">Create Deal</h2>
                  <p className="font-mono text-[10px] text-slate-light uppercase tracking-widest mt-0.5">Pipeline Entry</p>
                </div>
              </div>
              <button onClick={() => setIsOppModalOpen(false)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-slate hover:text-paper hover:bg-white/10 transition-colors">✕</button>
            </div>
            
            {/* Modal Body */}
            <form onSubmit={handleCreateOpportunity} className="p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Deal Name</label>
                <input required type="text" value={oppForm.name} onChange={e => setOppForm({...oppForm, name: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-paper focus:border-signal focus:ring-1 focus:ring-signal/50 outline-none font-sans transition-all placeholder:text-slate" placeholder="e.g. RioZim Earthworks Expansion" />
              </div>
              
              <div className="space-y-1.5">
                <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Pipeline Stage</label>
                <div className="relative">
                  <select value={oppForm.stage} onChange={e => setOppForm({...oppForm, stage: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-paper focus:border-signal focus:ring-1 focus:ring-signal/50 outline-none font-sans appearance-none transition-all">
                    <option value="Inquiry">Inquiry</option>
                    <option value="Qualification">Qualification</option>
                    <option value="Site Visit">Site Visit</option>
                    <option value="Quotation">Quotation</option>
                    <option value="Negotiation">Negotiation</option>
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                    <ArrowRight className="w-4 h-4 text-slate rotate-90" />
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Expected Value ($)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-light font-mono">$</span>
                    <input required type="number" value={oppForm.budget || ''} onChange={e => setOppForm({...oppForm, budget: Number(e.target.value)})} className="w-full bg-black/50 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-sm text-paper focus:border-signal focus:ring-1 focus:ring-signal/50 outline-none font-mono transition-all" placeholder="0.00" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Win Probability (%)</label>
                  <div className="relative">
                    <input required type="number" min="0" max="100" value={oppForm.probability || ''} onChange={e => setOppForm({...oppForm, probability: Number(e.target.value)})} className="w-full bg-black/50 border border-white/10 rounded-xl pr-8 pl-4 py-3 text-sm text-paper focus:border-signal focus:ring-1 focus:ring-signal/50 outline-none font-mono transition-all" placeholder="0" />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-light font-mono">%</span>
                  </div>
                </div>
              </div>
              
              <div className="pt-6 flex justify-end space-x-3 border-t border-white/5 mt-6">
                <button type="button" onClick={() => setIsOppModalOpen(false)} className="px-6 py-3 font-mono text-xs text-slate-light hover:text-paper hover:bg-white/5 rounded-xl transition-colors">CANCEL</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-3 bg-signal text-ink rounded-xl font-mono text-xs font-bold hover:bg-signal/90 hover:shadow-[0_0_20px_rgba(var(--color-signal),0.4)] disabled:opacity-50 transition-all">
                  {isSubmitting ? 'PROCESSING...' : 'INITIALIZE DEAL'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NEW TENDER MODAL */}
      {isTenderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={() => setIsTenderModalOpen(false)}></div>
          
          <div className="relative bg-[#0d0d0d] border border-white/10 w-full max-w-lg rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <FileText className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h2 className="font-display text-xl text-paper tracking-tight">Log Tender Bid</h2>
                  <p className="font-mono text-[10px] text-slate-light uppercase tracking-widest mt-0.5">Procurement Pipeline</p>
                </div>
              </div>
              <button onClick={() => setIsTenderModalOpen(false)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-slate hover:text-paper hover:bg-white/10 transition-colors">✕</button>
            </div>
            
            <form onSubmit={handleCreateTender} className="p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Tender Name / Reference</label>
                <input required type="text" value={tenderForm.tender_name} onChange={e => setTenderForm({...tenderForm, tender_name: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-paper focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none font-sans transition-all placeholder:text-slate" placeholder="e.g. PRAZ/01/2026 Bridge Construction" />
              </div>
              
              <div className="space-y-1.5">
                <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Tender Stage</label>
                <div className="relative">
                  <select value={tenderForm.stage} onChange={e => setTenderForm({...tenderForm, stage: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-paper focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none font-sans appearance-none transition-all">
                    <option value="Tender Identified">Tender Identified</option>
                    <option value="Eligibility/IDD">Eligibility/IDD</option>
                    <option value="Bid Prep">Bid Prep</option>
                    <option value="Submitted">Submitted</option>
                    <option value="Adjudication">Adjudication</option>
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                    <ArrowRight className="w-4 h-4 text-slate rotate-90" />
                  </div>
                </div>
              </div>
              
              <div className="space-y-1.5">
                <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Total Bid Amount ($)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-light font-mono">$</span>
                  <input required type="number" value={tenderForm.bid_amount || ''} onChange={e => setTenderForm({...tenderForm, bid_amount: Number(e.target.value)})} className="w-full bg-black/50 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-sm text-paper focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none font-mono transition-all" placeholder="0.00" />
                </div>
              </div>
              
              <div className="pt-6 flex justify-end space-x-3 border-t border-white/5 mt-6">
                <button type="button" onClick={() => setIsTenderModalOpen(false)} className="px-6 py-3 font-mono text-xs text-slate-light hover:text-paper hover:bg-white/5 rounded-xl transition-colors">CANCEL</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-3 bg-blue-500 text-white rounded-xl font-mono text-xs font-bold hover:bg-blue-400 hover:shadow-[0_0_20px_rgba(59,130,246,0.4)] disabled:opacity-50 transition-all">
                  {isSubmitting ? 'PROCESSING...' : 'LOG TENDER'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
