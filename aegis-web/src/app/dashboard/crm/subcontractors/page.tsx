"use client";

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle2, AlertCircle, ShieldAlert, Loader2,
  Search, Plus, ShieldCheck, Star, User, Phone, Mail,
  Briefcase, X, Save, Edit2, Grid, ClipboardList, BarChart2,
  Building2, Calendar, Award
} from 'lucide-react';
import { getSubcontractors, createSubcontractor, updateSubcontractor } from '@/lib/api';
import { useAuth } from '@/lib/auth/AuthContext';

// ---- Types ------------------------------------------------------------------

interface PerformanceEvaluation {
  date: string;
  score: number;
  metric: string;
}

interface CapabilityDomain {
  domain: string;
  tier: 0 | 1 | 2 | 3 | 4;
}

interface AuditEntry {
  date: string;
  auditor: string;
  finding: string;
  status: 'Clear' | 'Minor' | 'Major' | 'Critical';
}

interface ActiveProject {
  id: string;
  name: string;
  role: string;
  start_date: string;
  value: string;
}

interface Subcontractor {
  id: string;
  name: string;
  capability_tags: string[];
  compliance_status: string;
  nssa_number?: string;
  praz_number?: string;
  reliability_score: number;
  authorization_tier: number;
  performance_history?: PerformanceEvaluation[] | string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  physical_address?: string;
  capability_matrix?: CapabilityDomain[];
  audit_log?: AuditEntry[];
  active_projects?: ActiveProject[];
}

const DEFAULT_CAP_MATRIX: CapabilityDomain[] = [
  { domain: "Earthworks", tier: 0 },
  { domain: "Electrical", tier: 0 },
  { domain: "Structural", tier: 0 },
  { domain: "Mechanical", tier: 0 },
  { domain: "Plumbing",   tier: 0 }
];

function blankForm(): Subcontractor {
  return {
    id: '',
    name: '',
    capability_tags: [],
    compliance_status: 'Pending',
    nssa_number: '',
    praz_number: '',
    reliability_score: 75,
    authorization_tier: 3,
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    physical_address: '',
    performance_history: [],
    capability_matrix: DEFAULT_CAP_MATRIX.map(c => ({ ...c })),
    audit_log: [],
    active_projects: []
  };
}

// ---- Helpers ----------------------------------------------------------------

function parseHistory(sub: Subcontractor): PerformanceEvaluation[] {
  if (!sub.performance_history) return [];
  if (typeof sub.performance_history === 'string') {
    try { return JSON.parse(sub.performance_history) as PerformanceEvaluation[]; } catch { return []; }
  }
  return sub.performance_history;
}

function getTierLabel(tier: number): string {
  switch (tier) {
    case 1: return "TIER 1 - STRATEGIC";
    case 2: return "TIER 2 - QUALIFIED";
    case 3: return "TIER 3 - PROVISIONAL";
    case 4: return "TIER 4 - RESTRICTED";
    default: return `TIER ${tier}`;
  }
}

function getTierTextColor(tier: number): string {
  switch (tier) {
    case 1: return "text-yellow-400";
    case 2: return "text-blue-400";
    case 3: return "text-orange-400";
    default: return "text-red-400";
  }
}

function getComplianceCls(status: string): string {
  if (status === 'Compliant')    return "text-green-400 border-green-500/30 bg-green-500/5";
  if (status === 'Pending')      return "text-yellow-400 border-yellow-500/30 bg-yellow-500/5";
  return "text-red-400 border-red-500/30 bg-red-500/5";
}

function getAuditStatusCls(status: AuditEntry['status']): string {
  switch (status) {
    case 'Clear':    return "text-green-400 bg-green-500/10 border-green-500/25";
    case 'Minor':    return "text-yellow-400 bg-yellow-500/10 border-yellow-500/25";
    case 'Major':    return "text-orange-400 bg-orange-500/10 border-orange-500/25";
    case 'Critical': return "text-red-400 bg-red-500/10 border-red-500/25";
  }
}

function getCapTierCls(tier: number): string {
  switch (tier) {
    case 0: return "bg-ink/40 text-slate/40 border-ink-mid/30";
    case 1: return "bg-yellow-500/10 text-yellow-400 border-yellow-500/40";
    case 2: return "bg-blue-500/10 text-blue-400 border-blue-500/35";
    case 3: return "bg-orange-500/10 text-orange-400 border-orange-500/35";
    case 4: return "bg-red-500/10 text-red-400 border-red-500/35";
    default: return "bg-ink/40 text-slate border-ink-mid/40";
  }
}

function getAuditDotCls(status: AuditEntry['status']): string {
  switch (status) {
    case 'Clear':    return "bg-green-500 border-green-400";
    case 'Minor':    return "bg-yellow-500 border-yellow-400";
    case 'Major':    return "bg-orange-500 border-orange-400";
    case 'Critical': return "bg-red-500 border-red-400";
  }
}

// ---- Sub-components ---------------------------------------------------------

function PerformanceChart({ evaluations }: { evaluations: PerformanceEvaluation[] }) {
  if (evaluations.length < 2) {
    return (
      <div className="flex items-center justify-center h-20 text-slate font-mono text-[10px] uppercase tracking-widest">
        Insufficient data points
      </div>
    );
  }
  const W = 400; const H = 76; const PAD = 12;
  const scores = evaluations.map(e => e.score);
  const minS = Math.min(...scores) - 5;
  const maxS = Math.max(...scores) + 5;
  const rangeS = (maxS - minS) || 1;
  const pts = evaluations.map((e, i) => ({
    x: PAD + (i / (evaluations.length - 1)) * (W - PAD * 2),
    y: PAD + ((maxS - e.score) / rangeS) * (H - PAD * 2),
    score: e.score
  }));
  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ');
  const area = `M ${pts[0].x},${H} ` + pts.map(p => `L ${p.x},${p.y}`).join(' ') + ` L ${pts[pts.length - 1].x},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
      <defs>
        <linearGradient id="pgrd" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C8960C" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#C8960C" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#pgrd)" />
      <polyline points={polyline} fill="none" stroke="#C8960C" strokeWidth="1.5" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="#C8960C" stroke="#0A1628" strokeWidth="1.5" />
      ))}
    </svg>
  );
}

function ReliabilityGauge({ score }: { score: number }) {
  const color = score >= 90 ? '#2ECC71' : score >= 75 ? '#C8960C' : '#E74C3C';
  const R = 32; const CX = 40; const CY = 40;
  const circ = Math.PI * R;
  const offset = circ * (1 - Math.min(100, Math.max(0, score)) / 100);
  return (
    <svg width="80" height="46" viewBox="0 0 80 46">
      <path d={`M ${CX - R},${CY} A ${R},${R} 0 0,1 ${CX + R},${CY}`}
        fill="none" stroke="#1E3A5F" strokeWidth="5" strokeLinecap="round" />
      <path d={`M ${CX - R},${CY} A ${R},${R} 0 0,1 ${CX + R},${CY}`}
        fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset} />
      <text x={CX} y={CY - 3} textAnchor="middle" fill={color}
        fontSize="11" fontFamily="monospace" fontWeight="700">{score}%</text>
    </svg>
  );
}

function TierStars({ tier }: { tier: number }) {
  const filled = Math.max(0, 5 - tier);
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4].map(i => (
        <Star key={i} className={`w-3 h-3 ${i <= filled ? 'text-yellow-400 fill-yellow-400' : 'text-ink-mid fill-ink-mid'}`} />
      ))}
    </div>
  );
}

// ---- Main page --------------------------------------------------------------

type DetailTab = 'overview' | 'capability' | 'audit';

export default function SubcontractorRegistry() {
  const { session } = useAuth();
  const [subs, setSubs] = useState<Subcontractor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  const [search, setSearch] = useState('');
  const [complianceFilter, setComplianceFilter] = useState('All');
  const [tierFilter, setTierFilter] = useState('All');
  const [tradeFilter, setTradeFilter] = useState('All');

  const [showModal, setShowModal] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [formData, setFormData] = useState<Subcontractor>(blankForm());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    async function fetchSubs() {
      setIsLoading(true);
      try {
        const response = await getSubcontractors();
        if (response.success && Array.isArray(response.data)) {
          setSubs(response.data as Subcontractor[]);
        } else {
          setSubs([]);
        }
      } catch {
        setSubs([]);
      } finally {
        setIsLoading(false);
      }
    }
    void fetchSubs();
  }, [session]);

  useEffect(() => {
    if (!isLoading && subs.length > 0 && !selectedId) setSelectedId(subs[0].id);
  }, [isLoading, subs, selectedId]);

  const allTradesSet = new Set<string>();
  subs.forEach(s => s.capability_tags?.forEach(t => allTradesSet.add(t)));
  const uniqueTrades = ['All', ...Array.from(allTradesSet)];

  const filteredSubs = subs.filter(sub => {
    const q = search.toLowerCase();
    return (
      (sub.name.toLowerCase().includes(q) ||
       (sub.nssa_number ?? '').toLowerCase().includes(q) ||
       (sub.praz_number ?? '').toLowerCase().includes(q) ||
       (sub.contact_name ?? '').toLowerCase().includes(q)) &&
      (tradeFilter === 'All' || (sub.capability_tags?.includes(tradeFilter) ?? false)) &&
      (complianceFilter === 'All' || sub.compliance_status === complianceFilter) &&
      (tierFilter === 'All' || String(sub.authorization_tier) === tierFilter)
    );
  });

  const selectedSub = subs.find(s => s.id === selectedId) ?? null;
  const evaluations = selectedSub ? parseHistory(selectedSub) : [];
  const capMatrix = selectedSub?.capability_matrix ?? DEFAULT_CAP_MATRIX;

  const compliantCount = subs.filter(s => s.compliance_status === 'Compliant').length;
  const avgReliability = subs.length > 0
    ? Math.round(subs.reduce((a, s) => a + (s.reliability_score || 0), 0) / subs.length)
    : 0;
  const tier1Count = subs.filter(s => s.authorization_tier === 1).length;

  const openAddModal = useCallback(() => {
    setFormData(blankForm()); setIsEditMode(false); setSaveError(null); setTagInput(''); setShowModal(true);
  }, []);

  const openEditModal = useCallback((sub: Subcontractor) => {
    setFormData({ ...sub, performance_history: parseHistory(sub) }); setIsEditMode(true); setSaveError(null); setTagInput(''); setShowModal(true);
  }, []);

  const handleSave = async () => {
    if (!formData.name.trim()) { setSaveError('Company name is required.'); return; }
    setIsSaving(true); setSaveError(null);
    try {
      const payload: Record<string, unknown> = {
        name: formData.name, capability_tags: formData.capability_tags,
        compliance_status: formData.compliance_status, nssa_number: formData.nssa_number,
        praz_number: formData.praz_number, reliability_score: formData.reliability_score,
        authorization_tier: formData.authorization_tier, contact_name: formData.contact_name,
        contact_email: formData.contact_email, contact_phone: formData.contact_phone,
        physical_address: formData.physical_address, capability_matrix: formData.capability_matrix,
      };
      if (isEditMode && formData.id) {
        await updateSubcontractor(formData.id, payload);
        setSubs(prev => prev.map(s => s.id === formData.id ? { ...s, ...formData } : s));
      } else {
        const res = await createSubcontractor(payload);
        const newId = (res.data as { id?: string } | null)?.id;
        if (!newId) throw new Error("Subcontractor response did not include an id.");
        const newSub: Subcontractor = { ...formData, id: newId };
        setSubs(prev => [...prev, newSub]);
        setSelectedId(newSub.id);
      }
      setShowModal(false);
    } catch (err) {
      setSaveError('Save failed. Please retry once the connection is ready.');
    } finally {
      setIsSaving(false);
    }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !formData.capability_tags.includes(t)) setFormData(f => ({ ...f, capability_tags: [...f.capability_tags, t] }));
    setTagInput('');
  };
  const removeTag = (tag: string) => setFormData(f => ({ ...f, capability_tags: f.capability_tags.filter(t => t !== tag) }));
  const updateCapTier = (domain: string, tier: number) => setFormData(f => ({
    ...f, capability_matrix: (f.capability_matrix ?? []).map(c => c.domain === domain ? { ...c, tier: tier as CapabilityDomain['tier'] } : c)
  }));

  return (
    <div className="min-h-screen bg-ink text-paper selection:bg-signal selection:text-ink">
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(200,150,12,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(200,150,12,0.025) 1px,transparent 1px)',
        backgroundSize: '48px 48px'
      }} />

      <div className="relative max-w-[1600px] mx-auto px-4 md:px-6 py-6">

        {/* Header */}
        <header className="mb-6">
          <Link href="/dashboard/crm" className="inline-flex items-center text-data-sm font-mono text-slate hover:text-signal transition-colors mb-4">
            <ArrowLeft className="w-3.5 h-3.5 mr-2" />BACK TO CRM
          </Link>
          <div className="flex items-end justify-between border-b border-ink-mid pb-5">
            <div>
              <div className="font-mono text-[10px] text-signal tracking-widest mb-1">-- VENDOR INTELLIGENCE HUB</div>
              <h1 className="font-display text-headline-xl tracking-tight text-paper">Subcontractor Registry</h1>
              <p className="text-body-sm text-slate-light font-mono tracking-widest uppercase mt-1">Asset-Light Scale Infrastructure</p>
            </div>
            <button onClick={openAddModal}
              className="inline-flex items-center gap-2 bg-signal text-ink font-mono text-data-sm font-bold px-4 py-2.5 hover:bg-yellow-500 transition-colors">
              <Plus className="w-4 h-4" />REGISTER SUBCONTRACTOR
            </button>
          </div>
        </header>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "TOTAL REGISTERED",      value: String(subs.length),              cls: "text-paper"    },
            { label: "CLEARANCE COMPLIANT",   value: `${compliantCount} / ${subs.length}`, cls: "text-green-400" },
            { label: "AVG RELIABILITY INDEX", value: `${avgReliability}%`,             cls: "text-signal"   },
            { label: "STRATEGIC (TIER 1)",    value: String(tier1Count),               cls: "text-blue-400" }
          ].map(s => (
            <div key={s.label} className="bg-ink-light border border-ink-mid px-4 py-3">
              <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-0.5">{s.label}</div>
              <div className={`font-mono text-headline-md font-bold tracking-tight ${s.cls}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Split Panel */}
        {isLoading ? (
          <div className="flex justify-center items-center py-24"><Loader2 className="w-8 h-8 text-signal animate-spin" /></div>
        ) : (
          <div className="flex gap-4" style={{ height: 'calc(100vh - 290px)', minHeight: '580px' }}>

            {/* LEFT: Directory list */}
            <div className="w-[340px] flex-shrink-0 flex flex-col bg-ink-light border border-ink-mid">
              <div className="border-b border-ink-mid p-3 space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate" />
                  <input type="text" placeholder="Search name, NSSA, PRAZ..." value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full bg-ink border border-ink-mid pl-8 pr-3 py-2 font-mono text-[11px] text-paper placeholder:text-slate focus:outline-none focus:border-signal transition-colors" />
                </div>
                <div className="flex gap-2">
                  <select value={complianceFilter} onChange={e => setComplianceFilter(e.target.value)}
                    className="flex-1 bg-ink border border-ink-mid font-mono text-[10px] text-paper p-1.5 focus:outline-none focus:border-signal">
                    <option value="All">ALL STATUS</option>
                    <option value="Compliant">COMPLIANT</option>
                    <option value="Pending">PENDING</option>
                    <option value="Non-Compliant">NON-COMPLIANT</option>
                  </select>
                  <select value={tierFilter} onChange={e => setTierFilter(e.target.value)}
                    className="flex-1 bg-ink border border-ink-mid font-mono text-[10px] text-paper p-1.5 focus:outline-none focus:border-signal">
                    <option value="All">ALL TIERS</option>
                    <option value="1">TIER 1</option>
                    <option value="2">TIER 2</option>
                    <option value="3">TIER 3</option>
                    <option value="4">TIER 4</option>
                  </select>
                </div>
                <div className="flex flex-wrap gap-1">
                  {uniqueTrades.map(trade => (
                    <button key={trade} onClick={() => setTradeFilter(trade)}
                      className={`px-2 py-0.5 font-mono text-[9px] border transition-all ${tradeFilter === trade ? 'border-signal text-signal' : 'border-ink-mid text-slate hover:text-paper'}`}>
                      {trade.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {filteredSubs.length === 0 ? (
                  <div className="p-6 text-center">
                    <ShieldAlert className="w-6 h-6 text-slate mx-auto mb-2" />
                    <p className="font-mono text-[10px] text-slate uppercase">No records match filter</p>
                  </div>
                ) : filteredSubs.map(sub => {
                  const sel = sub.id === selectedId;
                  return (
                    <button key={sub.id} onClick={() => { setSelectedId(sub.id); setActiveTab('overview'); }}
                      className={`w-full text-left p-4 border-b border-ink-mid/50 transition-all group ${sel ? 'bg-ink-mid/40 border-l-2 border-l-signal' : 'hover:bg-ink-mid/20 border-l-2 border-l-transparent'}`}>
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="font-sans text-[13px] font-semibold text-paper group-hover:text-signal transition-colors leading-tight pr-2">{sub.name}</div>
                        <span className={`font-mono text-[8px] px-1.5 py-0.5 border flex-shrink-0 ${getComplianceCls(sub.compliance_status)}`}>
                          {sub.compliance_status === 'Compliant' ? 'OK' : sub.compliance_status === 'Pending' ? 'PEND' : 'NON-C'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {sub.capability_tags?.slice(0, 3).map(tag => (
                          <span key={tag} className="font-mono text-[8px] px-1.5 py-0.5 bg-ink border border-ink-mid text-slate">{tag.toUpperCase()}</span>
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <TierStars tier={sub.authorization_tier} />
                          <span className="font-mono text-[8px] text-slate">T{sub.authorization_tier}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-14 h-1 bg-ink border border-ink-mid/50">
                            <div className={`h-full ${sub.reliability_score >= 90 ? 'bg-green-500' : sub.reliability_score >= 75 ? 'bg-signal' : 'bg-red-500'}`}
                              style={{ width: `${sub.reliability_score}%` }} />
                          </div>
                          <span className="font-mono text-[9px] text-slate">{sub.reliability_score}%</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-ink-mid px-4 py-2">
                <span className="font-mono text-[9px] text-slate-light">{filteredSubs.length} OF {subs.length} PARTNERS</span>
              </div>
            </div>

            {/* RIGHT: Detail */}
            <div className="flex-1 min-w-0 flex flex-col bg-ink-light border border-ink-mid overflow-hidden">
              {!selectedSub ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <Building2 className="w-10 h-10 text-slate mx-auto mb-3" />
                    <p className="font-mono text-[11px] text-slate uppercase tracking-widest">Select a subcontractor to view profile</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Profile bar */}
                  <div className="border-b border-ink-mid p-5 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`font-mono text-[9px] px-2 py-0.5 border border-current ${getTierTextColor(selectedSub.authorization_tier)}`}>
                          {getTierLabel(selectedSub.authorization_tier)}
                        </span>
                        <span className={`font-mono text-[9px] px-2 py-0.5 border ${getComplianceCls(selectedSub.compliance_status)}`}>
                          {selectedSub.compliance_status === 'Compliant'    && <CheckCircle2 className="w-2.5 h-2.5 inline mr-0.5" />}
                          {selectedSub.compliance_status === 'Pending'      && <AlertCircle  className="w-2.5 h-2.5 inline mr-0.5" />}
                          {selectedSub.compliance_status === 'Non-Compliant'&& <ShieldAlert   className="w-2.5 h-2.5 inline mr-0.5" />}
                          {selectedSub.compliance_status.toUpperCase()}
                        </span>
                      </div>
                      <h2 className="font-display text-headline-lg text-paper tracking-tight">{selectedSub.name}</h2>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {selectedSub.capability_tags?.map(tag => (
                          <span key={tag} className="font-mono text-[9px] px-2 py-0.5 bg-ink border border-ink-mid text-slate">{tag.toUpperCase()}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-center">
                        <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-1">RELIABILITY</div>
                        <ReliabilityGauge score={selectedSub.reliability_score} />
                      </div>
                      <button onClick={() => openEditModal(selectedSub)}
                        className="inline-flex items-center gap-1.5 border border-ink-mid text-slate hover:text-signal hover:border-signal font-mono text-[10px] px-3 py-2 transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />EDIT
                      </button>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="border-b border-ink-mid flex">
                    {([
                      { key: 'overview'    as DetailTab, label: 'PROFILE & HISTORY',  Icon: User        },
                      { key: 'capability'  as DetailTab, label: 'CAPABILITY MATRIX',   Icon: Grid        },
                      { key: 'audit'       as DetailTab, label: 'AUDIT LOG',           Icon: ClipboardList }
                    ]).map(({ key, label, Icon }) => (
                      <button key={key} onClick={() => setActiveTab(key)}
                        className={`flex items-center gap-2 px-5 py-3 font-mono text-[10px] border-b-2 transition-all ${activeTab === key ? 'border-b-signal text-signal' : 'border-b-transparent text-slate hover:text-paper'}`}>
                        <Icon className="w-3 h-3" />{label}
                      </button>
                    ))}
                  </div>

                  {/* Tab bodies */}
                  <div className="flex-1 overflow-y-auto p-5 space-y-4">

                    {/* OVERVIEW */}
                    {activeTab === 'overview' && (
                      <>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-ink border border-ink-mid p-4">
                            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-2">REGULATORY STATUS</div>
                            <div className={`font-mono text-[11px] font-bold uppercase flex items-center gap-1.5 ${selectedSub.compliance_status === 'Compliant' ? 'text-green-400' : selectedSub.compliance_status === 'Pending' ? 'text-yellow-400' : 'text-red-400'}`}>
                              {selectedSub.compliance_status === 'Compliant'    && <CheckCircle2 className="w-3.5 h-3.5" />}
                              {selectedSub.compliance_status === 'Pending'      && <AlertCircle  className="w-3.5 h-3.5" />}
                              {selectedSub.compliance_status === 'Non-Compliant'&& <ShieldAlert   className="w-3.5 h-3.5" />}
                              {selectedSub.compliance_status}
                            </div>
                          </div>
                          <div className="bg-ink border border-ink-mid p-4">
                            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-2">NSSA NUMBER</div>
                            <div className="font-mono text-[12px] text-paper font-semibold">{selectedSub.nssa_number || '-- NOT SUBMITTED'}</div>
                          </div>
                          <div className="bg-ink border border-ink-mid p-4">
                            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-2">PRAZ REGISTER</div>
                            <div className="font-mono text-[12px] text-paper font-semibold">{selectedSub.praz_number || '-- NOT REGISTERED'}</div>
                          </div>
                        </div>

                        <div className="bg-ink border border-ink-mid p-4">
                          <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-3 flex items-center gap-1.5">
                            <User className="w-3 h-3 text-signal" />CONTACT DETAILS
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <div className="font-mono text-[9px] text-slate mb-0.5">PRIMARY CONTACT</div>
                              <div className="font-sans text-[13px] text-paper font-semibold">{selectedSub.contact_name || '--'}</div>
                            </div>
                            <div>
                              <div className="font-mono text-[9px] text-slate mb-0.5">ADDRESS</div>
                              <div className="font-sans text-[12px] text-slate-light">{selectedSub.physical_address || '--'}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Mail className="w-3 h-3 text-slate flex-shrink-0" />
                              <span className="font-mono text-[11px] text-paper">{selectedSub.contact_email || '--'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Phone className="w-3 h-3 text-slate flex-shrink-0" />
                              <span className="font-mono text-[11px] text-paper">{selectedSub.contact_phone || '--'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="bg-ink border border-ink-mid p-4">
                          <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-3 flex items-center gap-1.5">
                            <BarChart2 className="w-3 h-3 text-signal" />PERFORMANCE HISTORY TIMELINE
                          </div>
                          <PerformanceChart evaluations={evaluations} />
                          {evaluations.length > 0 && (
                            <div className="mt-3 space-y-2 border-t border-ink-mid/50 pt-3">
                              {evaluations.map((ev, i) => (
                                <div key={i} className="flex items-center justify-between text-[11px]">
                                  <div className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-signal flex-shrink-0" />
                                    <span className="font-sans text-slate-light">{ev.metric}</span>
                                  </div>
                                  <div className="flex items-center gap-3 flex-shrink-0">
                                    <span className="font-mono text-[9px] text-slate">{ev.date}</span>
                                    <span className={`font-mono text-[11px] font-bold ${ev.score >= 90 ? 'text-green-400' : ev.score >= 75 ? 'text-signal' : 'text-red-400'}`}>{ev.score}%</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="bg-ink border border-ink-mid p-4">
                          <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-3 flex items-center gap-1.5">
                            <Briefcase className="w-3 h-3 text-signal" />ACTIVE PROJECTS ({selectedSub.active_projects?.length ?? 0})
                          </div>
                          {(!selectedSub.active_projects || selectedSub.active_projects.length === 0) ? (
                            <p className="font-mono text-[10px] text-slate">No active project assignments</p>
                          ) : (
                            <div className="space-y-2">
                              {selectedSub.active_projects.map(proj => (
                                <div key={proj.id} className="flex items-center justify-between border border-ink-mid/60 px-3 py-2.5 hover:border-ink-mid transition-colors">
                                  <div>
                                    <div className="font-sans text-[12px] text-paper font-semibold">{proj.name}</div>
                                    <div className="font-mono text-[9px] text-slate mt-0.5">{proj.role}</div>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <div className="font-mono text-[11px] text-signal font-bold">{proj.value}</div>
                                    <div className="font-mono text-[9px] text-slate mt-0.5">
                                      <Calendar className="w-2.5 h-2.5 inline mr-0.5" />{proj.start_date}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* CAPABILITY */}
                    {activeTab === 'capability' && (
                      <div className="bg-ink border border-ink-mid p-5">
                        <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-4 flex items-center gap-1.5">
                          <Award className="w-3 h-3 text-signal" />CAPABILITY GRADING MATRIX
                        </div>
                        <div className="flex flex-wrap gap-2 mb-5 pb-4 border-b border-ink-mid/50">
                          {([
                            { t: 1, lbl: 'T1 -- Strategic'   },
                            { t: 2, lbl: 'T2 -- Qualified'   },
                            { t: 3, lbl: 'T3 -- Provisional' },
                            { t: 4, lbl: 'T4 -- Restricted'  },
                            { t: 0, lbl: 'N/A -- Not Offered'}
                          ] as const).map(({ t, lbl }) => (
                            <span key={t} className={`font-mono text-[9px] px-2 py-1 border ${getCapTierCls(t)}`}>{lbl}</span>
                          ))}
                        </div>
                        <div className="space-y-3">
                          {capMatrix.map(cap => (
                            <div key={cap.domain} className="flex items-center gap-4">
                              <div className="w-28 font-mono text-[10px] text-slate-light uppercase flex-shrink-0">{cap.domain}</div>
                              <div className="flex-1 grid grid-cols-5 gap-1">
                                {([1, 2, 3, 4, 0] as const).map(t => (
                                  <div key={t} className={`h-8 flex items-center justify-center font-mono text-[9px] font-bold border ${cap.tier === t ? getCapTierCls(t) : 'border-ink-mid/30 text-slate/25 bg-ink/20'}`}>
                                    {t === 0 ? 'N/A' : `T${t}`}
                                  </div>
                                ))}
                              </div>
                              <div className={`font-mono text-[9px] px-2 py-0.5 border w-24 text-center flex-shrink-0 ${getCapTierCls(cap.tier)}`}>
                                {cap.tier === 0 ? 'NOT OFFERED' : cap.tier === 1 ? 'STRATEGIC' : cap.tier === 2 ? 'QUALIFIED' : cap.tier === 3 ? 'PROVISIONAL' : 'RESTRICTED'}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-6 pt-5 border-t border-ink-mid/50 grid grid-cols-2 gap-3">
                          <div className="bg-ink-light border border-ink-mid p-3">
                            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-1">AUTHORIZATION TIER</div>
                            <div className="flex items-center gap-2">
                              <TierStars tier={selectedSub.authorization_tier} />
                              <span className={`font-mono text-[11px] font-bold ${getTierTextColor(selectedSub.authorization_tier)}`}>{getTierLabel(selectedSub.authorization_tier)}</span>
                            </div>
                          </div>
                          <div className="bg-ink-light border border-ink-mid p-3">
                            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-1">ACTIVE DOMAINS</div>
                            <div className="font-mono text-headline-md font-bold text-signal">
                              {capMatrix.filter(c => c.tier > 0).length}
                              <span className="text-slate font-normal text-[10px] ml-1">/ 5 DOMAINS</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* AUDIT */}
                    {activeTab === 'audit' && (
                      <div className="bg-ink border border-ink-mid p-5">
                        <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-4 flex items-center gap-1.5">
                          <ShieldCheck className="w-3 h-3 text-signal" />COMPLIANCE AUDIT TRAIL
                        </div>
                        {(!selectedSub.audit_log || selectedSub.audit_log.length === 0) ? (
                          <div className="py-8 text-center">
                            <ShieldCheck className="w-8 h-8 text-slate mx-auto mb-2" />
                            <p className="font-mono text-[10px] text-slate uppercase">No audit records on file</p>
                          </div>
                        ) : (
                          <>
                            <div className="relative pl-5 border-l border-ink-mid space-y-0">
                              {selectedSub.audit_log.map((entry, i) => (
                                <div key={i} className="relative pb-4">
                                  <span className={`absolute -left-[22px] top-1 w-2.5 h-2.5 rounded-full border-2 ${getAuditDotCls(entry.status)}`} />
                                  <div className="bg-ink-light border border-ink-mid p-4 ml-2">
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="flex items-center gap-2">
                                        <Calendar className="w-3 h-3 text-slate" />
                                        <span className="font-mono text-[10px] text-slate-light">{entry.date}</span>
                                        <span className="font-mono text-[9px] text-slate">|</span>
                                        <span className="font-mono text-[10px] text-slate">{entry.auditor}</span>
                                      </div>
                                      <span className={`font-mono text-[9px] px-2 py-0.5 border font-bold ${getAuditStatusCls(entry.status)}`}>
                                        {entry.status.toUpperCase()}
                                      </span>
                                    </div>
                                    <p className="font-sans text-[12px] text-slate-light leading-relaxed">{entry.finding}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="mt-3 pt-4 border-t border-ink-mid/50 grid grid-cols-4 gap-2">
                              {(['Clear', 'Minor', 'Major', 'Critical'] as const).map(status => {
                                const count = selectedSub.audit_log!.filter(e => e.status === status).length;
                                return (
                                  <div key={status} className={`border p-2.5 text-center ${getAuditStatusCls(status)}`}>
                                    <div className="font-mono text-headline-md font-bold">{count}</div>
                                    <div className="font-mono text-[8px] uppercase tracking-widest mt-0.5">{status}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-ink/80 backdrop-blur-sm" onClick={() => !isSaving && setShowModal(false)} />
          <div className="relative z-10 w-full max-w-2xl max-h-[90vh] bg-ink-light border border-ink-mid shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-ink-mid px-6 py-4">
              <div>
                <div className="font-mono text-[9px] text-signal tracking-widest uppercase mb-0.5">{isEditMode ? '-- EDIT RECORD' : '-- NEW REGISTRATION'}</div>
                <h3 className="font-display text-headline-md text-paper">{isEditMode ? 'Edit Subcontractor' : 'Register Subcontractor'}</h3>
              </div>
              <button onClick={() => !isSaving && setShowModal(false)} className="text-slate hover:text-paper transition-colors p-1"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {saveError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 font-mono text-[11px] px-4 py-2.5 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />{saveError}
                </div>
              )}

              <div>
                <label className="font-mono text-[9px] text-slate-light tracking-widest uppercase block mb-1">COMPANY NAME *</label>
                <input type="text" value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Registered civil works subcontractor"
                  className="w-full bg-ink border border-ink-mid px-3 py-2 font-sans text-[13px] text-paper focus:outline-none focus:border-signal transition-colors" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-mono text-[9px] text-slate-light tracking-widest uppercase block mb-1">AUTHORIZATION TIER</label>
                  <select value={formData.authorization_tier} onChange={e => setFormData(f => ({ ...f, authorization_tier: Number(e.target.value) }))}
                    className="w-full bg-ink border border-ink-mid px-3 py-2 font-mono text-[11px] text-paper focus:outline-none focus:border-signal">
                    <option value={1}>TIER 1 -- STRATEGIC</option>
                    <option value={2}>TIER 2 -- QUALIFIED</option>
                    <option value={3}>TIER 3 -- PROVISIONAL</option>
                    <option value={4}>TIER 4 -- RESTRICTED</option>
                  </select>
                </div>
                <div>
                  <label className="font-mono text-[9px] text-slate-light tracking-widest uppercase block mb-1">COMPLIANCE STATUS</label>
                  <select value={formData.compliance_status} onChange={e => setFormData(f => ({ ...f, compliance_status: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid px-3 py-2 font-mono text-[11px] text-paper focus:outline-none focus:border-signal">
                    <option value="Compliant">COMPLIANT</option>
                    <option value="Pending">PENDING</option>
                    <option value="Non-Compliant">NON-COMPLIANT</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-mono text-[9px] text-slate-light tracking-widest uppercase block mb-1">NSSA NUMBER</label>
                  <input type="text" value={formData.nssa_number || ''} onChange={e => setFormData(f => ({ ...f, nssa_number: e.target.value }))}
                    placeholder="NSSA-XXXXX-X"
                    className="w-full bg-ink border border-ink-mid px-3 py-2 font-mono text-[11px] text-paper focus:outline-none focus:border-signal transition-colors" />
                </div>
                <div>
                  <label className="font-mono text-[9px] text-slate-light tracking-widest uppercase block mb-1">PRAZ NUMBER</label>
                  <input type="text" value={formData.praz_number || ''} onChange={e => setFormData(f => ({ ...f, praz_number: e.target.value }))}
                    placeholder="PRAZ-SUB-XXX-XX"
                    className="w-full bg-ink border border-ink-mid px-3 py-2 font-mono text-[11px] text-paper focus:outline-none focus:border-signal transition-colors" />
                </div>
              </div>

              <div>
                <label className="font-mono text-[9px] text-slate-light tracking-widest uppercase block mb-1">
                  RELIABILITY SCORE -- <span className="text-signal">{formData.reliability_score}%</span>
                </label>
                <input type="range" min={0} max={100} value={formData.reliability_score}
                  onChange={e => setFormData(f => ({ ...f, reliability_score: Number(e.target.value) }))}
                  className="w-full accent-yellow-500" />
              </div>

              <div>
                <label className="font-mono text-[9px] text-slate-light tracking-widest uppercase block mb-1">CAPABILITY TAGS</label>
                <div className="flex gap-2 mb-2">
                  <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                    placeholder="e.g. Earthworks"
                    className="flex-1 bg-ink border border-ink-mid px-3 py-1.5 font-mono text-[11px] text-paper focus:outline-none focus:border-signal transition-colors" />
                  <button onClick={addTag} type="button"
                    className="bg-ink-mid px-3 py-1.5 font-mono text-[10px] text-paper hover:bg-ink-mid/70 border border-ink-mid transition-colors">
                    ADD
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {formData.capability_tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-ink border border-ink-mid font-mono text-[9px] text-slate">
                      {tag.toUpperCase()}
                      <button onClick={() => removeTag(tag)} className="text-slate hover:text-red-400 transition-colors"><X className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-mono text-[9px] text-slate-light tracking-widest uppercase block mb-2">CAPABILITY DOMAIN TIERS</label>
                <div className="space-y-2">
                  {(formData.capability_matrix ?? []).map(cap => (
                    <div key={cap.domain} className="flex items-center gap-3">
                      <span className="font-mono text-[10px] text-slate w-24 flex-shrink-0">{cap.domain}</span>
                      <select value={cap.tier} onChange={e => updateCapTier(cap.domain, Number(e.target.value))}
                        className="flex-1 bg-ink border border-ink-mid px-2 py-1 font-mono text-[10px] text-paper focus:outline-none focus:border-signal">
                        <option value={0}>N/A -- Not Offered</option>
                        <option value={1}>Tier 1 -- Strategic</option>
                        <option value={2}>Tier 2 -- Qualified</option>
                        <option value={3}>Tier 3 -- Provisional</option>
                        <option value={4}>Tier 4 -- Restricted</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-ink-mid/50 pt-4">
                <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-3">CONTACT INFORMATION</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-mono text-[9px] text-slate tracking-widest uppercase block mb-1">CONTACT NAME</label>
                    <input type="text" value={formData.contact_name || ''} onChange={e => setFormData(f => ({ ...f, contact_name: e.target.value }))}
                      className="w-full bg-ink border border-ink-mid px-3 py-2 font-sans text-[12px] text-paper focus:outline-none focus:border-signal transition-colors" />
                  </div>
                  <div>
                    <label className="font-mono text-[9px] text-slate tracking-widest uppercase block mb-1">PHONE</label>
                    <input type="tel" value={formData.contact_phone || ''} onChange={e => setFormData(f => ({ ...f, contact_phone: e.target.value }))}
                      className="w-full bg-ink border border-ink-mid px-3 py-2 font-sans text-[12px] text-paper focus:outline-none focus:border-signal transition-colors" />
                  </div>
                  <div>
                    <label className="font-mono text-[9px] text-slate tracking-widest uppercase block mb-1">EMAIL</label>
                    <input type="email" value={formData.contact_email || ''} onChange={e => setFormData(f => ({ ...f, contact_email: e.target.value }))}
                      className="w-full bg-ink border border-ink-mid px-3 py-2 font-sans text-[12px] text-paper focus:outline-none focus:border-signal transition-colors" />
                  </div>
                  <div>
                    <label className="font-mono text-[9px] text-slate tracking-widest uppercase block mb-1">PHYSICAL ADDRESS</label>
                    <input type="text" value={formData.physical_address || ''} onChange={e => setFormData(f => ({ ...f, physical_address: e.target.value }))}
                      className="w-full bg-ink border border-ink-mid px-3 py-2 font-sans text-[12px] text-paper focus:outline-none focus:border-signal transition-colors" />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-ink-mid px-6 py-4 flex items-center justify-end gap-3">
              <button onClick={() => !isSaving && setShowModal(false)} disabled={isSaving}
                className="font-mono text-[10px] text-slate hover:text-paper px-4 py-2 border border-ink-mid hover:border-paper/30 transition-colors">
                CANCEL
              </button>
              <button onClick={handleSave} disabled={isSaving}
                className="inline-flex items-center gap-2 bg-signal text-ink font-mono text-[10px] font-bold px-5 py-2 hover:bg-yellow-500 transition-colors disabled:opacity-50">
                {isSaving
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />SAVING...</>
                  : <><Save className="w-3.5 h-3.5" />{isEditMode ? 'SAVE CHANGES' : 'REGISTER'}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
