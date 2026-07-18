"use client";

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Briefcase, FileText, Target, Users, Activity, Loader2, Plus, LayoutDashboard, TrendingUp, ShieldCheck, MapPin, AlertTriangle, ChevronRight, Terminal } from 'lucide-react';
import { getCrmOpportunities, getCrmTenders, getAccountabilityMetrics, createCrmOpportunity, createCrmTender, getRiskMatrices } from '@/lib/api';
import { useAuth } from '@/lib/auth/AuthContext';

const getErrorMessage = (error: unknown, fallback: string) => {
  return fallback;
};

const getApiError = (_response: any, fallback: string) => fallback;

export default function CRMCommercialEngine() {
  const { session } = useAuth();
  
  const [isLoading, setIsLoading] = useState(true);
  
  const [accountabilityTargets, setAccountabilityTargets] = useState<any[]>([]);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [tenders, setTenders] = useState<any[]>([]);
  const [riskMatrices, setRiskMatrices] = useState<any>(null);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});

  // Modals state
  const [isOppModalOpen, setIsOppModalOpen] = useState(false);
  const [isTenderModalOpen, setIsTenderModalOpen] = useState(false);
  
  // Forms state
  const [oppForm, setOppForm] = useState({ name: '', stage: 'Inquiry', budget: 0, probability: 0 });
  const [tenderForm, setTenderForm] = useState({ tender_name: '', stage: 'Tender Identified', bid_amount: 0 });
  const [oppFormErrors, setOppFormErrors] = useState<Record<string, string>>({});
  const [tenderFormErrors, setTenderFormErrors] = useState<Record<string, string>>({});
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadLabels: Record<string, string> = {
    accountability: 'Accountability metrics',
    opportunities: 'Opportunities',
    tenders: 'Tenders',
    risk: 'Risk matrices'
  };

  const formatCurrency = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const normalizeStage = (value: unknown) => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const stageMatches = (recordStage: unknown, stageLabel: string) => normalizeStage(recordStage) === normalizeStage(stageLabel);
  const parseProbability = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : null;
  };
  const renderFieldError = (message?: string) => message ? <p className="font-mono text-[10px] text-red-400 pl-1">{message}</p> : null;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadErrors({});
    try {
      const [accRes, oppsRes, tendersRes, riskRes] = await Promise.allSettled([
        getAccountabilityMetrics(),
        getCrmOpportunities(),
        getCrmTenders(),
        getRiskMatrices()
      ]);
      const nextErrors: Record<string, string> = {};

      if (accRes.status === 'fulfilled' && accRes.value.success && Array.isArray(accRes.value.data)) {
        setAccountabilityTargets(accRes.value.data);
      } else {
        nextErrors.accountability = accRes.status === 'rejected'
          ? getErrorMessage(accRes.reason, 'Accountability metrics did not load.')
          : getApiError(accRes.value, 'Accountability metrics did not load.');
      }

      if (oppsRes.status === 'fulfilled' && oppsRes.value.success && Array.isArray(oppsRes.value.data)) {
        setOpportunities(oppsRes.value.data);
      } else {
        nextErrors.opportunities = oppsRes.status === 'rejected'
          ? getErrorMessage(oppsRes.reason, 'Opportunities did not load.')
          : getApiError(oppsRes.value, 'Opportunities did not load.');
      }

      if (tendersRes.status === 'fulfilled' && tendersRes.value.success && Array.isArray(tendersRes.value.data)) {
        setTenders(tendersRes.value.data);
      } else {
        nextErrors.tenders = tendersRes.status === 'rejected'
          ? getErrorMessage(tendersRes.reason, 'Tenders did not load.')
          : getApiError(tendersRes.value, 'Tenders did not load.');
      }

      if (riskRes.status === 'fulfilled' && riskRes.value.success && riskRes.value.data) {
        setRiskMatrices(riskRes.value.data);
      } else {
        nextErrors.risk = riskRes.status === 'rejected'
          ? getErrorMessage(riskRes.reason, 'Risk matrices did not load.')
          : getApiError(riskRes.value, 'Risk matrices did not load.');
      }

      setLoadErrors(nextErrors);
    } catch (error) {
      const message = getErrorMessage(error, 'CRM data did not load.');
      setLoadErrors({ accountability: message, opportunities: message, tenders: message, risk: message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadData();
  }, [session, loadData]);
  const validateOpportunityForm = () => {
    const errors: Record<string, string> = {};
    const budget = Number(oppForm.budget);
    const probability = Number(oppForm.probability);

    if (!oppForm.name.trim()) errors.name = 'Deal name is required.';
    if (!Number.isFinite(budget) || budget <= 0) errors.budget = 'Expected value must be greater than 0.';
    if (!Number.isFinite(probability) || probability < 0 || probability > 100) errors.probability = 'Win probability must be between 0 and 100.';

    return errors;
  };

  const validateTenderForm = () => {
    const errors: Record<string, string> = {};
    const bidAmount = Number(tenderForm.bid_amount);

    if (!tenderForm.tender_name.trim()) errors.tender_name = 'Tender name or reference is required.';
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) errors.bid_amount = 'Bid amount must be greater than 0.';

    return errors;
  };
  const handleCreateOpportunity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const fieldErrors = validateOpportunityForm();
    setOppFormErrors(fieldErrors);
    setCreateErrors((current) => ({ ...current, opportunity: '' }));
    if (Object.keys(fieldErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const response = await createCrmOpportunity({
        name: oppForm.name.trim(),
        stage: oppForm.stage,
        budget: Number(oppForm.budget),
        probability: Number(oppForm.probability)
      });
      if (!response.success) throw new Error(getApiError(response, 'Opportunity was not created.'));

      setIsOppModalOpen(false);
      setOppForm({ name: '', stage: 'Inquiry', budget: 0, probability: 0 });
      await loadData();
    } catch (error) {
      setCreateErrors((current) => ({
        ...current,
        opportunity: getErrorMessage(error, 'Opportunity was not created. Check the fields and try again.')
      }));
    } finally {
      setIsSubmitting(false);
    }
  };
  const handleCreateTender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const fieldErrors = validateTenderForm();
    setTenderFormErrors(fieldErrors);
    setCreateErrors((current) => ({ ...current, tender: '' }));
    if (Object.keys(fieldErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const response = await createCrmTender({
        tender_name: tenderForm.tender_name.trim(),
        stage: tenderForm.stage,
        bid_amount: Number(tenderForm.bid_amount)
      });
      if (!response.success) throw new Error(getApiError(response, 'Tender was not created.'));

      setIsTenderModalOpen(false);
      setTenderForm({ tender_name: '', stage: 'Tender Identified', bid_amount: 0 });
      await loadData();
    } catch (error) {
      setCreateErrors((current) => ({
        ...current,
        tender: getErrorMessage(error, 'Tender was not created. Check the fields and try again.')
      }));
    } finally {
      setIsSubmitting(false);
    }
  };
  const calculateTotalPipeline = () => {
    const oppValue = opportunities.reduce((acc, opp) => acc + (Number(opp.budget) || 0), 0);
    const tenderValue = tenders.reduce((acc, t) => acc + (Number(t.bid_amount) || 0), 0);
    return oppValue + tenderValue;
  };

  const calculateWeightedPipeline = () => {
    let missingProbabilityCount = 0;
    const oppValue = opportunities.reduce((acc, opp) => {
      const budget = Number(opp.budget) || 0;
      const probability = parseProbability(opp.probability ?? opp.win_probability);
      if (budget > 0 && probability === null) missingProbabilityCount += 1;
      return probability === null ? acc : acc + (budget * probability / 100);
    }, 0);
    const tenderValue = tenders.reduce((acc, tender) => {
      const amount = Number(tender.bid_amount) || 0;
      const probability = parseProbability(tender.probability ?? tender.win_probability);
      if (amount > 0 && probability === null) missingProbabilityCount += 1;
      return probability === null ? acc : acc + (amount * probability / 100);
    }, 0);

    return { value: oppValue + tenderValue, missingProbabilityCount };
  };
  // UI Row 1: KPI Cards
  const renderKpiCards = () => (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 shrink-0 mb-2">
      <div className="group relative overflow-hidden bg-ink/40 backdrop-blur-xl border border-white/5 p-2.5 rounded-sm shadow-lg transition-all duration-300 hover:border-white/10 flex flex-col justify-between">
        <div className="flex items-center space-x-2 mb-0.5">
          <Target className="w-3.5 h-3.5 text-slate-light" />
          <h3 className="font-mono text-[9px] text-slate-light tracking-widest uppercase">Total Pipeline</h3>
        </div>
        <span className="font-display text-lg text-paper tracking-tight">${calculateTotalPipeline().toLocaleString()}</span>
      </div>

      <div className="group relative overflow-hidden bg-ink/40 backdrop-blur-xl border border-white/5 p-2.5 rounded-sm shadow-lg transition-all duration-300 hover:border-white/10 flex flex-col justify-between">
        <div className="flex items-center space-x-2 mb-0.5">
          <Activity className="w-3.5 h-3.5 text-slate-light" />
          <h3 className="font-mono text-[9px] text-slate-light tracking-widest uppercase">Weighted Forecast</h3>
        </div>
        <span className="font-display text-lg text-signal tracking-tight">${calculateWeightedPipeline().toLocaleString()}</span>
      </div>

      <div className="group relative overflow-hidden bg-ink/40 backdrop-blur-xl border border-white/5 p-2.5 rounded-sm shadow-lg transition-all duration-300 hover:border-white/10 flex flex-col justify-between">
        <div className="flex items-center space-x-2 mb-0.5">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-light" />
          <h3 className="font-mono text-[9px] text-slate-light tracking-widest uppercase">Expected Margin</h3>
        </div>
        <div className="flex items-end space-x-2">
          <span className="font-display text-lg text-paper tracking-tight">18.5%</span>
          <span className="text-red-500 font-mono text-[8px] mb-0">vs 22% TGT</span>
        </div>
      </div>

      <div className="group relative overflow-hidden bg-ink/40 backdrop-blur-xl border border-white/5 p-2.5 rounded-sm shadow-lg transition-all duration-300 hover:border-white/10 flex flex-col justify-between">
        <div className="flex items-center space-x-2 mb-0.5">
          <TrendingUp className="w-3.5 h-3.5 text-slate-light" />
          <h3 className="font-mono text-[9px] text-slate-light tracking-widest uppercase">Lead Velocity</h3>
        </div>
        <span className="font-display text-lg text-paper tracking-tight">{opportunities.length} <span className="text-xs text-slate-light">NEW / MO</span></span>
      </div>
    </div>
  );

  // Col 1: Opportunity and Tender funnels side-by-side or stacked
  const renderCol1Funnels = () => {
    const oppStages = ['Inquiry', 'Qualification', 'Quotation', 'Negotiation'];
    const tenderStages = ['Tender Identified', 'Bid Prep', 'Submitted', 'Adjudication'];
    
    return (
      <div className="w-[40%] flex flex-col gap-2 min-h-0 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100 ease-out fill-mode-both">
        {/* Left Funnel: Organic Opportunities */}
        <div className="bg-ink/40 backdrop-blur-md border border-white/5 rounded-sm p-2.5 flex flex-col shadow-xl flex-1 min-h-0 animate-in fade-in duration-300">
          <div className="flex justify-between items-center mb-1.5 shrink-0">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 rounded-sm bg-signal/10 flex items-center justify-center border border-signal/20">
                <Briefcase className="w-3 h-3 text-signal" />
              </div>
              <div>
                <h2 className="font-sans font-bold text-sm text-paper tracking-wide">Opportunity Pipeline</h2>
                <p className="font-mono text-[8px] text-slate-light tracking-widest uppercase mt-0.5">Organic & Negotiated</p>
              </div>
            </div>
            <button onClick={() => setIsOppModalOpen(true)} className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-signal/20 hover:text-signal hover:border-signal/30 transition-all">
              <Plus className="w-2.5 h-2.5" />
            </button>
          </div>
          
          <div className="flex space-x-2 overflow-x-auto custom-scrollbar pb-1.5 flex-1 min-h-0">
            {oppStages.map(stage => {
              const items = opportunities.filter((o) => o.stage === stage.toUpperCase().replace(' ', '_') || o.stage === stage);
              return (
                <div key={stage} className="min-w-[115px] flex-1 bg-ink/40 border border-white/5 rounded-sm p-1.5 flex flex-col min-h-0">
                  <h3 className="font-sans text-[10px] font-semibold text-slate-light mb-1 shrink-0">{stage} <span className="float-right text-slate font-mono">{items.length}</span></h3>
                  <div className="space-y-1 flex-1 overflow-y-auto custom-scrollbar min-h-0">
                    {items.slice(0, 5).map(opp => (
                      <div key={opp.id} className="bg-ink/80 border border-white/10 p-1.5 rounded-sm hover:border-signal/40 transition-colors group cursor-pointer">
                        <p className="text-[11px] font-medium text-paper truncate group-hover:text-signal">{opp.name}</p>
                        <p className="text-[9px] font-mono text-slate-light mt-0.5">${Number(opp.budget).toLocaleString()}</p>
                      </div>
                    ))}
                    {items.length === 0 && <div className="text-center py-2 text-[9px] font-mono text-slate-dark">No deals</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Funnel: Competitive Tenders */}
        <div className="bg-ink/40 backdrop-blur-md border border-white/5 rounded-sm p-2.5 flex flex-col shadow-xl flex-1 min-h-0 animate-in fade-in duration-300">
          <div className="flex justify-between items-center mb-1.5 shrink-0">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 rounded-sm bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                <FileText className="w-3 h-3 text-blue-400" />
              </div>
              <div>
                <h2 className="font-sans font-bold text-sm text-paper tracking-wide">Tender Pipeline</h2>
                <p className="font-mono text-[8px] text-slate-light tracking-widest uppercase mt-0.5">Competitive Bids</p>
              </div>
            </div>
            <button onClick={() => setIsTenderModalOpen(true)} className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-blue-500/20 hover:text-blue-400 hover:border-blue-500/30 transition-all">
              <Plus className="w-2.5 h-2.5" />
            </button>
          </div>

          <div className="flex space-x-2 overflow-x-auto custom-scrollbar pb-1.5 flex-1 min-h-0">
            {tenderStages.map(stage => {
              const items = tenders.filter((t) => t.stage === stage.toUpperCase().replace(/[^A-Z]/g, '_') || t.stage === stage);
              return (
                <div key={stage} className="min-w-[115px] flex-1 bg-ink/40 border border-white/5 rounded-sm p-1.5 flex flex-col min-h-0">
                  <h3 className="font-sans text-[10px] font-semibold text-slate-light mb-1 shrink-0">{stage} <span className="float-right text-slate font-mono">{items.length}</span></h3>
                  <div className="space-y-1 flex-1 overflow-y-auto custom-scrollbar min-h-0">
                    {items.slice(0, 5).map(tender => (
                      <div key={tender.id} className="bg-ink/80 border border-white/10 p-1.5 rounded-sm hover:border-blue-400/40 transition-colors group cursor-pointer relative">
                         {stage === 'Bid Prep' && <div className="absolute top-0 right-0 w-1 h-1 m-1.5 rounded-full bg-blue-500 animate-ping"></div>}
                        <p className="text-[11px] font-medium text-paper line-clamp-2 pr-1 group-hover:text-blue-400">{tender.tender_name}</p>
                        <p className="text-[9px] font-mono text-slate-light mt-0.5">${Number(tender.bid_amount).toLocaleString()}</p>
                      </div>
                    ))}
                    {items.length === 0 && <div className="text-center py-2 text-[9px] font-mono text-slate-dark">No bids</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // Col 2: Morning Briefing Terminal (top) and Geographic Intelligence Radar map (bottom) stacked
  const renderCol2Stacked = () => {
    return (
      <div className="w-[30%] flex flex-col gap-2 min-h-0">
        {/* Morning Briefing Terminal */}
        <div className="bg-ink/40 backdrop-blur-xl border border-white/10 p-2.5 rounded-sm shadow-2xl relative overflow-hidden flex flex-col flex-1 min-h-0 animate-in fade-in duration-300">
          <div className="flex items-center space-x-2 mb-1.5 border-b border-white/10 pb-1 shrink-0">
            <Terminal className="w-3.5 h-3.5 text-signal animate-pulse-slow" />
            <h2 className="font-mono text-[10px] text-paper tracking-widest uppercase">Morning Briefing Matrix</h2>
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto custom-scrollbar font-mono text-[9px]">
            <div className="flex items-start space-x-2 text-red-400">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <p>🚨 2 PRAZ Tenders closing this week. Bid Bond missing on Ministry of Transport submission.</p>
            </div>
            <div className="flex items-start space-x-2 text-signal">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <p>⚠️ Relationship Decay: You haven&apos;t spoken to Procurement Director at RioZim in 45 days. They have $4M in active upcoming projects.</p>
            </div>
            <div className="flex items-start space-x-2 text-blue-400">
              <Activity className="w-3 h-3 shrink-0 mt-0.5" />
              <p>ℹ️ $450k sitting in &apos;Negotiation&apos; stage for &gt;30 days. Recommend Director-level intervention.</p>
            </div>
          </div>
        </div>

        {/* Geographic Intelligence Radar Map */}
        <div className="w-full bg-ink-light border border-white/10 rounded-sm p-2.5 shadow-2xl relative overflow-hidden flex flex-col flex-1 min-h-0 animate-in fade-in slide-in-from-bottom-10 duration-700 delay-300 ease-out fill-mode-both">
          {/* Background Radar Grid */}
          <div className="absolute inset-0 z-0 opacity-20"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
              `,
              backgroundSize: '20px 20px'
            }}
          ></div>

          <div className="relative z-10 flex justify-between items-center mb-1.5 shrink-0">
            <h3 className="font-mono text-[10px] text-paper tracking-widest uppercase flex items-center">
              <MapPin className="w-3.5 h-3.5 mr-1.5 text-signal" /> Geographic Intelligence
            </h3>
            <span className="font-mono text-[8px] text-signal animate-pulse">LIVE RADAR ACTIVE</span>
          </div>

          <div className="relative flex-1 z-10 flex items-center justify-center min-h-0">
             {/* Map abstraction using circles and dots for heat clusters */}
             <div className="relative w-full h-full border border-white/5 rounded-sm bg-ink/40 overflow-hidden backdrop-blur-sm">
                {/* Harare Cluster */}
                <div className="absolute top-[30%] right-[30%] group">
                  <div className="w-10 h-10 bg-signal/10 rounded-full animate-pulse-slow absolute -translate-x-1/2 -translate-y-1/2"></div>
                  <div className="w-2.5 h-2.5 bg-signal rounded-full shadow-[0_0_15px_rgba(var(--color-signal),1)] absolute -translate-x-1/2 -translate-y-1/2"></div>
                  <div className="absolute top-4 left-4 bg-ink-light border border-white/10 p-2 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity w-32 pointer-events-none">
                    <p className="font-sans text-[10px] text-paper font-bold">Harare Metro</p>
                    <p className="font-mono text-[9px] text-slate-light mt-1">12 Bids / 4 Active Assets</p>
                  </div>
                </div>

                {/* Mutare/Beira Cluster */}
                <div className="absolute top-[50%] right-[15%] group">
                  <div className="w-8 h-8 bg-blue-500/10 rounded-full animate-pulse absolute -translate-x-1/2 -translate-y-1/2"></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full shadow-[0_0_10px_rgba(59,130,246,1)] absolute -translate-x-1/2 -translate-y-1/2"></div>
                  <div className="absolute top-4 right-4 bg-ink-light border border-white/10 p-2 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity w-32 pointer-events-none z-20">
                    <p className="font-sans text-[10px] text-paper font-bold">Mutare Corridor</p>
                    <p className="font-mono text-[9px] text-slate-light mt-1">3 Gov Tenders / High Sub Risk</p>
                  </div>
                </div>

                {/* Bulawayo Cluster */}
                <div className="absolute bottom-[40%] left-[30%] group">
                  <div className="w-6 h-6 bg-slate-500/10 rounded-full absolute -translate-x-1/2 -translate-y-1/2"></div>
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full absolute -translate-x-1/2 -translate-y-1/2"></div>
                  <div className="absolute top-4 left-4 bg-ink-light border border-white/10 p-2 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity w-32 pointer-events-none">
                    <p className="font-sans text-[10px] text-paper font-bold">Bulawayo</p>
                    <p className="font-mono text-[9px] text-slate-light mt-1">2 Leads / Idle</p>
                  </div>
                </div>
             </div>
          </div>
        </div>
      </div>
    );
  };

  // Col 3: Risk & Diagnostic Matrices stacked
  const renderCol3Stacked = () => {
    if (!riskMatrices) {
      return (
        <div className="w-[30%] bg-ink/40 border border-white/5 rounded-sm p-2.5 flex flex-col justify-center items-center">
          <Loader2 className="w-6 h-6 text-signal animate-spin mb-2" />
          <span className="font-mono text-[10px] text-slate-light uppercase">Loading Matrices</span>
        </div>
      );
    }

    const { client_concentration, subcontractor_risk, win_loss_diagnostic } = riskMatrices;

    return (
      <div className="w-[30%] flex flex-col gap-2 min-h-0">
        {/* Client Concentration */}
        <div className="bg-ink/40 backdrop-blur-xl border border-white/5 rounded-sm p-2.5 shadow-xl relative overflow-hidden group flex-1 min-h-0 flex flex-col justify-between animate-in fade-in duration-300">
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-transparent"></div>
           <h3 className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-1 flex items-center shrink-0">
             <Target className="w-2.5 h-2.5 mr-1.5 text-red-500" /> Client Concentration
           </h3>
           <div className="mb-1 shrink-0">
             <span className="text-xl font-mono text-paper leading-none">{client_concentration.risk_score}</span>
             <span className="font-mono text-[8px] text-red-400 ml-1.5 bg-red-500/10 px-1.5 py-0.5 rounded-full border border-red-500/20">{client_concentration.level} RISK</span>
           </div>
           <p className="text-[10px] text-slate mb-1 line-clamp-2 shrink-0">{client_concentration.directive}</p>
           <div className="space-y-1 flex-1 overflow-y-auto custom-scrollbar">
             {client_concentration.breakdown.map((b: any, i: number) => (
               <div key={i}>
                 <div className="flex justify-between text-[8px] font-mono text-slate-light mb-0">
                   <span>{b.sector}</span>
                   <span>{b.percentage}%</span>
                 </div>
                 <div className="w-full bg-black/50 h-1 rounded-full overflow-hidden">
                   <div className="h-full bg-red-500/70 rounded-full" style={{ width: `${b.percentage}%` }}></div>
                 </div>
               </div>
             ))}
           </div>
        </div>

        {/* Subcontractor Dependency */}
        <div className="bg-ink/40 backdrop-blur-xl border border-white/5 rounded-sm p-2.5 shadow-xl relative overflow-hidden group flex-1 min-h-0 flex flex-col justify-between animate-in fade-in duration-300">
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-signal to-transparent"></div>
           <h3 className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-1 flex items-center shrink-0">
             <Users className="w-2.5 h-2.5 mr-1.5 text-signal" /> Subcontractor Dependency
           </h3>
           <div className="mb-1 shrink-0">
             <span className="text-xl font-mono text-paper leading-none">{subcontractor_risk.risk_score}</span>
             <span className="font-mono text-[8px] text-signal ml-1.5 bg-signal/10 px-1.5 py-0.5 rounded-full border border-signal/20">{subcontractor_risk.level} RISK</span>
           </div>
           <p className="text-[10px] text-slate mb-1 line-clamp-2 shrink-0">{subcontractor_risk.directive}</p>
           <div className="space-y-1 flex-1 overflow-y-auto custom-scrollbar">
             {subcontractor_risk.breakdown.map((b: any, i: number) => (
               <div key={i} className="flex justify-between items-center border-b border-white/5 pb-1 last:border-0 last:pb-0">
                 <span className="text-[10px] text-paper truncate pr-2">{b.name}</span>
                 <span className={`text-[8px] font-mono px-1 py-0.5 rounded-sm shrink-0 ${b.status === 'Warning' ? 'bg-signal/20 text-signal border border-signal/30' : 'text-slate-light'}`}>
                   {b.dependency}% DEP
                 </span>
               </div>
             ))}
           </div>
        </div>

        {/* Win/Loss Diagnostic */}
        <div className="bg-ink/40 backdrop-blur-xl border border-white/5 rounded-sm p-2.5 shadow-xl relative overflow-hidden group flex-1 min-h-0 flex flex-col justify-between animate-in fade-in duration-300">
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-transparent"></div>
           <h3 className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-1 flex items-center shrink-0">
             <Activity className="w-2.5 h-2.5 mr-1.5 text-blue-500" /> Win/Loss Diagnostic
           </h3>
           <div className="mb-1 shrink-0">
             <span className="text-xl font-mono text-paper leading-none">{win_loss_diagnostic.overall_win_rate}%</span>
             <span className="font-mono text-[8px] text-blue-400 ml-1.5 bg-blue-500/10 px-1.5 py-0.5 rounded-full border border-blue-500/20">WIN RATE</span>
           </div>
           <p className="text-[10px] text-slate mb-1 line-clamp-2 shrink-0">{win_loss_diagnostic.directive}</p>
           <div className="space-y-1 flex-1 overflow-y-auto custom-scrollbar">
             {win_loss_diagnostic.stages.map((b: any, i: number) => (
               <div key={i}>
                 <div className="flex justify-between text-[8px] font-mono text-slate-light mb-0">
                   <span>{b.stage}</span>
                   <span>{b.conversion}% Conv</span>
                 </div>
                 <div className="w-full bg-black/50 h-1 rounded-full overflow-hidden">
                   <div className="h-full bg-blue-500/70 rounded-full" style={{ width: `${b.conversion}%` }}></div>
                 </div>
               </div>
             ))}
           </div>
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
    <div className="h-full w-full bg-[#050505] text-paper selection:bg-signal selection:text-ink flex flex-col p-3 overflow-hidden relative">
      
      {/* 3D Dynamic Background Layers */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,1) 1px, transparent 0)', backgroundSize: '40px 40px' }}
        />
      </div>
      
      <div className="relative z-10 flex flex-col flex-1 min-h-0 overflow-hidden">
        
        {/* Header Section */}
        <header className="flex justify-between items-end pb-2 shrink-0">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 rounded-sm bg-gradient-to-br from-ink-light to-ink border border-white/10 flex items-center justify-center shadow-lg">
              <Activity className="w-5 h-5 text-signal" />
            </div>
            <div>
              <h1 className="font-display text-2xl tracking-tight text-paper mb-0.5">Commercial Command</h1>
              <p className="text-[10px] text-slate-light font-mono tracking-widest uppercase flex items-center">
                <span className="w-1 h-1 rounded-full bg-signal mr-1.5 animate-pulse-signal"></span>
                Strategic Engine & Intelligence Matrix
              </p>
            </div>
          </div>
          
          <div className="flex space-x-3">
            <Link 
              href="/dashboard/crm/leads"
              className="group flex items-center px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 hover:border-slate-light hover:bg-white/10 text-[10px] font-mono tracking-widest text-slate-light transition-all duration-300"
            >
              <Users className="w-3.5 h-3.5 mr-1.5" />
              LEADS INBOX
            </Link>
            <Link 
              href="/dashboard/crm/subcontractors"
              className="group flex items-center px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 hover:border-slate-light hover:bg-white/10 text-[10px] font-mono tracking-widest text-slate-light transition-all duration-300"
            >
              <Briefcase className="w-3.5 h-3.5 mr-1.5" />
              REGISTRY
            </Link>
          </div>
        </header>

        {renderKpiCards()}

        {/* 3-column Layout */}
        <div className="flex-1 min-h-0 flex gap-3">
          {renderCol1Funnels()}
          {renderCol2Stacked()}
          {renderCol3Stacked()}
        </div>
      </div>

      {/* NEW OPPORTUNITY MODAL - Glassmorphic Redesign */}
      {isOppModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={() => setIsOppModalOpen(false)}></div>
          
          <div className="relative bg-ink-light border border-white/10 w-full max-w-lg rounded-sm shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-sm bg-signal/10 flex items-center justify-center border border-signal/20">
                  <Target className="w-4 h-4 text-signal" />
                </div>
                <div>
                  <h2 className="font-display text-xl text-paper tracking-tight">Create Deal</h2>
                  <p className="font-mono text-[10px] text-slate-light uppercase tracking-widest mt-0.5">Pipeline Entry</p>
                </div>
              </div>
              <button onClick={() => setIsOppModalOpen(false)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-slate hover:text-paper hover:bg-white/10 transition-colors">✕</button>
            </div>
            
            <form onSubmit={handleCreateOpportunity} className="p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Deal Name</label>
                <input required type="text" value={oppForm.name} onChange={e => setOppForm({...oppForm, name: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-sm px-4 py-3 text-sm text-paper focus:border-signal focus:ring-1 focus:ring-signal/50 outline-none font-sans transition-all placeholder:text-slate" placeholder="e.g. RioZim Earthworks Expansion" />
              </div>
              
              <div className="space-y-1.5">
                <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Pipeline Stage</label>
                <div className="relative">
                  <select value={oppForm.stage} onChange={e => setOppForm({...oppForm, stage: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-sm px-4 py-3 text-sm text-paper focus:border-signal focus:ring-1 focus:ring-signal/50 outline-none font-sans appearance-none transition-all">
                    <option value="Inquiry">Inquiry</option>
                    <option value="Qualification">Qualification</option>
                    <option value="Site Visit">Site Visit</option>
                    <option value="Quotation">Quotation</option>
                    <option value="Negotiation">Negotiation</option>
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                    <ChevronRight className="w-4 h-4 text-slate rotate-90" />
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Expected Value ($)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-light font-mono">$</span>
                    <input required type="number" value={oppForm.budget || ''} onChange={e => setOppForm({...oppForm, budget: Number(e.target.value)})} className="w-full bg-black/50 border border-white/10 rounded-sm pl-8 pr-4 py-3 text-sm text-paper focus:border-signal focus:ring-1 focus:ring-signal/50 outline-none font-mono transition-all" placeholder="0.00" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Win Probability (%)</label>
                  <div className="relative">
                    <input required type="number" min="0" max="100" value={oppForm.probability || ''} onChange={e => setOppForm({...oppForm, probability: Number(e.target.value)})} className="w-full bg-black/50 border border-white/10 rounded-sm pr-8 pl-4 py-3 text-sm text-paper focus:border-signal focus:ring-1 focus:ring-signal/50 outline-none font-mono transition-all" placeholder="0" />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-light font-mono">%</span>
                  </div>
                </div>
              </div>
              
              <div className="pt-6 flex justify-end space-x-3 border-t border-white/5 mt-6">
                <button type="button" onClick={() => setIsOppModalOpen(false)} className="px-6 py-3 font-mono text-xs text-slate-light hover:text-paper hover:bg-white/5 rounded-sm transition-colors">CANCEL</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-3 bg-signal text-ink rounded-sm font-mono text-xs font-bold hover:bg-signal/90 hover:shadow-[0_0_20px_rgba(var(--color-signal),0.4)] disabled:opacity-50 transition-all">
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
          
          <div className="relative bg-ink-light border border-white/10 w-full max-w-lg rounded-sm shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-sm bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
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
                <input required type="text" value={tenderForm.tender_name} onChange={e => setTenderForm({...tenderForm, tender_name: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-sm px-4 py-3 text-sm text-paper focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none font-sans transition-all placeholder:text-slate" placeholder="e.g. PRAZ/01/2026 Bridge Construction" />
              </div>
              
              <div className="space-y-1.5">
                <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Tender Stage</label>
                <div className="relative">
                  <select value={tenderForm.stage} onChange={e => setTenderForm({...tenderForm, stage: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-sm px-4 py-3 text-sm text-paper focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none font-sans appearance-none transition-all">
                    <option value="Tender Identified">Tender Identified</option>
                    <option value="Eligibility/IDD">Eligibility/IDD</option>
                    <option value="Bid Prep">Bid Prep</option>
                    <option value="Submitted">Submitted</option>
                    <option value="Adjudication">Adjudication</option>
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                    <ChevronRight className="w-4 h-4 text-slate rotate-90" />
                  </div>
                </div>
              </div>
              
              <div className="space-y-1.5">
                <label className="block font-mono text-[10px] text-slate-light uppercase tracking-widest pl-1">Total Bid Amount ($)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-light font-mono">$</span>
                  <input required type="number" value={tenderForm.bid_amount || ''} onChange={e => setTenderForm({...tenderForm, bid_amount: Number(e.target.value)})} className="w-full bg-black/50 border border-white/10 rounded-sm pl-8 pr-4 py-3 text-sm text-paper focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none font-mono transition-all" placeholder="0.00" />
                </div>
              </div>
              
              <div className="pt-6 flex justify-end space-x-3 border-t border-white/5 mt-6">
                <button type="button" onClick={() => setIsTenderModalOpen(false)} className="px-6 py-3 font-mono text-xs text-slate-light hover:text-paper hover:bg-white/5 rounded-sm transition-colors">CANCEL</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-3 bg-blue-500 text-white rounded-sm font-mono text-xs font-bold hover:bg-blue-400 hover:shadow-[0_0_20px_rgba(59,130,246,0.4)] disabled:opacity-50 transition-all">
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
