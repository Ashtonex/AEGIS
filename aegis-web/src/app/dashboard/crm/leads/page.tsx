"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Target, Zap, AlertTriangle, ShieldCheck, Clock, TrendingUp, 
  Building2, MapPin, Loader2, MessageSquare, Bot, FormInput, 
  Search, Eye, Linkedin, Inbox 
} from 'lucide-react';

// Define types based on our backend schema
interface Lead {
  id: string;
  company_name: string;
  contact_name: string;
  sector: string;
  estimated_budget: number;
  ai_score: number;
  ai_rationale: string;
  lead_source: string;
  status: string;
  created_at: string;
}

export default function CRMLeadsApp() {
  const [activeTab, setActiveTab] = useState<'inbox' | 'live_chat' | 'chatbot' | 'web_forms' | 'prospector' | 'visitors' | 'linkedin'>('web_forms');
  
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [qualifyingId, setQualifyingId] = useState<string | null>(null);

  useEffect(() => {
    fetchLeads();
  }, []);

  const fetchLeads = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/crm/leads');
      if (res.ok) {
        const data = await res.json();
        setLeads(data.data);
      } else {
        // Fallback for UI visualization if DB/API isn't running
        setLeads([
          {
            id: '1',
            company_name: 'Ministry of Transport',
            contact_name: 'Dir. of Roads',
            sector: 'Government',
            estimated_budget: 15000000,
            ai_score: 92,
            ai_rationale: 'High historical win-rate in Government sector. Budget matches heavy-equipment capability.',
            lead_source: 'Government Gazette',
            status: 'New',
            created_at: new Date().toISOString()
          },
          {
            id: '2',
            company_name: 'Zimplats',
            contact_name: 'Procurement Manager',
            sector: 'Mining',
            estimated_budget: 450000,
            ai_score: 85,
            ai_rationale: 'Mining sector has fast payment terms. High propensity to convert.',
            lead_source: 'Website Enquiry',
            status: 'New',
            created_at: new Date().toISOString()
          },
          {
            id: '3',
            company_name: 'Local Supermarket Chain',
            contact_name: 'Facilities Manager',
            sector: 'Commercial',
            estimated_budget: 25000,
            ai_score: 31,
            ai_rationale: 'Low margin, low budget. Deprioritized based on opportunity cost.',
            lead_source: 'Manual Entry',
            status: 'New',
            created_at: new Date().toISOString()
          }
        ]);
      }
    } catch (error) {
      console.error("Error fetching leads", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQualify = async (leadId: string) => {
    setQualifyingId(leadId);
    try {
      const res = await fetch(`http://localhost:8000/api/crm/leads/${leadId}/qualify`, {
        method: 'POST'
      });
      if (res.ok) {
        setLeads(leads.filter(l => l.id !== leadId));
      }
    } catch (error) {
      console.error("Failed to qualify", error);
    } finally {
      setQualifyingId(null);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-signal bg-signal/10 border-signal/30';
    if (score >= 50) return 'text-paper bg-ink-light border-ink-mid';
    return 'text-red-500 bg-red-500/10 border-red-500/30';
  };

  // ==========================================================================
  // RENDER: LEADS INBOX (Intelligence Grid)
  // ==========================================================================
  const renderInbox = () => {
    if (isLoading && leads.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 text-signal animate-spin" />
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col h-full animate-in fade-in duration-500">
        <header className="flex justify-between items-end border-b border-ink-mid pb-6 mb-8 shrink-0">
          <div>
            <h1 className="font-display text-headline-xl tracking-tight text-paper mb-1 flex items-center">
              <Inbox className="w-6 h-6 mr-3 text-signal" />
              Leads Inbox
            </h1>
            <p className="text-body-sm text-slate-light font-mono tracking-widest uppercase">AI-Scored Commercial Signals</p>
          </div>
          <div className="flex space-x-3 items-center">
             <div className="px-4 py-2 bg-ink-light border border-ink-mid flex items-center">
               <div className="w-2 h-2 rounded-full bg-signal animate-pulse-signal mr-2"></div>
               <span className="font-mono text-xs text-slate-light">ML Engine Active</span>
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto pb-12 pr-4">
          <div className="mb-6 flex justify-between items-center">
            <h2 className="font-mono text-xs text-slate-light tracking-widest uppercase">Incoming Signals Matrix</h2>
            <span className="font-mono text-[10px] px-2 py-1 bg-ink-mid text-paper">{leads.length} UNPROCESSED SIGNALS</span>
          </div>

          <div className="space-y-4">
            {leads.map((lead) => (
              <div key={lead.id} className="bg-ink-light border border-ink-mid p-5 hover:border-signal/50 transition-all duration-300 group">
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="font-sans text-lg font-semibold text-paper group-hover:text-signal transition-colors">{lead.company_name}</h3>
                      <span className="font-mono text-[10px] px-2 py-0.5 bg-ink border border-ink-mid text-slate-light rounded-sm">
                        {lead.sector}
                      </span>
                      {lead.ai_score >= 80 && (
                         <span className="font-mono text-[10px] px-2 py-0.5 bg-signal/10 border border-signal/30 text-signal rounded-sm flex items-center">
                           <Zap className="w-3 h-3 mr-1" /> HOT PROSPECT
                         </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-6 text-sm font-mono text-slate-light">
                      <div className="flex items-center"><Clock className="w-3.5 h-3.5 mr-1.5" /> Source: {lead.lead_source}</div>
                      <div className="flex items-center"><Building2 className="w-3.5 h-3.5 mr-1.5" /> Est. Budget: <span className="text-paper ml-1">${lead.estimated_budget.toLocaleString()}</span></div>
                    </div>
                  </div>

                  <div className="flex-1 bg-ink border border-ink-mid p-3 border-l-2 border-l-signal/50">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-mono text-[10px] text-slate-light uppercase tracking-widest flex items-center">
                        <TrendingUp className="w-3 h-3 mr-1" /> Propensity Score
                      </h4>
                      <span className={`font-display text-2xl px-2 py-1 border ${getScoreColor(lead.ai_score)}`}>
                        {lead.ai_score}
                      </span>
                    </div>
                    <p className="text-xs text-slate font-sans leading-relaxed">
                      <span className="text-signal mr-1">AI Rationale:</span> 
                      {lead.ai_rationale}
                    </p>
                  </div>

                  <div className="flex flex-col space-y-2 w-full xl:w-auto xl:ml-4">
                    <button 
                      onClick={() => handleQualify(lead.id)}
                      disabled={qualifyingId === lead.id}
                      className="px-6 py-3 bg-signal text-ink font-mono text-xs font-bold hover:bg-signal/90 transition-colors flex items-center justify-center disabled:opacity-50"
                    >
                      {qualifyingId === lead.id ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> QUALIFYING...</>
                      ) : (
                        <><ShieldCheck className="w-4 h-4 mr-2" /> QUALIFY & CONVERT</>
                      )}
                    </button>
                    <button className="px-6 py-2 border border-ink-mid text-slate hover:text-paper hover:border-slate-light font-mono text-xs transition-colors">
                      DISMISS
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {leads.length === 0 && !isLoading && (
              <div className="bg-ink-light border border-dashed border-ink-mid p-12 text-center">
                <Target className="w-8 h-8 text-slate mx-auto mb-4 opacity-50" />
                <h3 className="font-mono text-sm text-paper mb-2 uppercase tracking-widest">No Active Leads</h3>
                <p className="font-sans text-sm text-slate-light">The intelligence grid is waiting for new commercial signals.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ==========================================================================
  // RENDER: LEAD ENGINE OVERVIEW (Pipedrive "LeadBooster" Clone)
  // ==========================================================================
  const renderLeadEngine = () => {
    return (
      <div className="flex-1 flex flex-col h-full animate-in fade-in duration-500 overflow-y-auto">
        
        {/* Subtle background radar circles to mimic the Pipedrive aesthetic but in Dark Mode */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-center justify-center z-0 opacity-[0.05]">
          <div className="w-[800px] h-[800px] rounded-full border border-paper absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2"></div>
          <div className="w-[1200px] h-[1200px] rounded-full border border-paper absolute bottom-0 right-0 translate-x-1/3 translate-y-1/3"></div>
          <Target className="w-64 h-64 text-paper absolute top-[20%] left-[10%] opacity-20" />
          <Target className="w-48 h-48 text-paper absolute bottom-[20%] right-[10%] opacity-20" />
        </div>

        <div className="relative z-10 w-full max-w-4xl mx-auto py-12 flex flex-col items-center">
          
          <div className="mb-4">
            <span className="bg-signal text-ink text-[10px] font-mono font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider">
              NEW
            </span>
          </div>
          
          <h1 className="font-display text-4xl text-paper mb-3 text-center tracking-tight">Lead Engine</h1>
          <p className="text-slate-light font-sans text-lg mb-8 text-center max-w-2xl">
            The Commercial Engine provides powerful, automated ways to capture and score leads directly into your pipeline.
          </p>

          <button className="px-6 py-3 bg-signal text-ink font-mono text-sm font-bold rounded-sm hover:bg-signal/90 transition-colors mb-16 shadow-[0_0_20px_rgba(212,175,55,0.2)]">
            Configure Web Forms
          </button>

          {/* Grid of 4 cards mimicking the screenshot */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full px-4">
            
            {/* Live Chat Card */}
            <div className="bg-ink-light border border-ink-mid p-8 rounded-sm flex flex-col items-center text-center hover:border-signal/50 transition-colors cursor-pointer group">
              <div className="w-16 h-16 rounded-full bg-ink flex items-center justify-center mb-6 relative border border-ink-mid group-hover:border-signal/50">
                <MessageSquare className="w-7 h-7 text-paper" />
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-signal rounded-full flex items-center justify-center border-2 border-ink-light">
                  <span className="text-[10px] font-bold text-ink">1</span>
                </div>
              </div>
              <h3 className="font-sans font-semibold text-lg text-paper mb-2">Live Chat</h3>
              <p className="text-sm text-slate-light font-sans max-w-[250px]">
                Add a human touch to your client portal and website conversations.
              </p>
            </div>

            {/* AI Prospector Card */}
            <div className="bg-ink-light border border-ink-mid p-8 rounded-sm flex flex-col items-center text-center hover:border-signal/50 transition-colors cursor-pointer group">
              <div className="w-16 h-16 rounded-full bg-ink flex items-center justify-center mb-6 border border-ink-mid group-hover:border-signal/50">
                <Search className="w-7 h-7 text-green-500" />
              </div>
              <h3 className="font-sans font-semibold text-lg text-paper mb-2">AI Prospector</h3>
              <p className="text-sm text-slate-light font-sans max-w-[250px]">
                Find leads from public gazettes and government procurement portals instantly.
              </p>
            </div>

            {/* Chatbot Card */}
            <div className="bg-ink-light border border-ink-mid p-8 rounded-sm flex flex-col items-center text-center hover:border-signal/50 transition-colors cursor-pointer group">
              <div className="w-16 h-16 rounded-full bg-ink flex items-center justify-center mb-6 relative border border-ink-mid group-hover:border-signal/50">
                <Bot className="w-7 h-7 text-blue-400" />
              </div>
              <h3 className="font-sans font-semibold text-lg text-paper mb-2">Signal Bot</h3>
              <p className="text-sm text-slate-light font-sans max-w-[250px]">
                Engage with inbound enquiries 24/7. Automatically qualify leads before they reach the inbox.
              </p>
            </div>

            {/* Web Forms Card (Active/Highlighted state based on screenshot) */}
            <div className="bg-ink-light border border-signal p-8 rounded-sm flex flex-col items-center text-center shadow-[0_0_15px_rgba(212,175,55,0.1)] cursor-pointer group relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-1 bg-signal"></div>
              <div className="w-16 h-16 rounded-full bg-ink flex items-center justify-center mb-6 border border-signal">
                <FormInput className="w-7 h-7 text-signal" />
              </div>
              <h3 className="font-sans font-semibold text-lg text-paper mb-2">Web Forms</h3>
              <p className="text-sm text-slate-light font-sans max-w-[250px]">
                Ensure your leads' vital data is captured with intuitive, embeddable forms.
              </p>
            </div>

          </div>
        </div>
      </div>
    );
  };

  // ==========================================================================
  // RENDER: MAIN SHELL (2-Column Layout)
  // ==========================================================================
  return (
    <div className="min-h-screen bg-ink flex font-sans selection:bg-signal selection:text-ink w-full relative">
      
      {/* Texture Layer */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-[0.02] mix-blend-screen z-0"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '40px 40px' }}
      />
      
      {/* Secondary Left Sidebar */}
      <aside className="w-64 bg-ink border-r border-ink-mid flex-shrink-0 flex flex-col z-10 py-6">
        
        {/* Module Title */}
        <div className="px-6 mb-8 flex items-center text-paper font-sans text-lg font-semibold tracking-tight">
          <Link href="/dashboard/crm" className="text-slate-light hover:text-paper mr-2">CRM</Link>
          <span className="text-slate-dark mr-2">/</span>
          <span>Leads</span>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-8">
          
          {/* Section 1: Inbox */}
          <div className="px-4 space-y-1">
            <button 
              onClick={() => setActiveTab('inbox')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'inbox' ? 'bg-signal/10 text-signal border border-signal/20' : 'text-slate-light hover:bg-ink-light hover:text-paper'}`}
            >
              <Inbox className="w-4 h-4" />
              <span>Leads Inbox</span>
            </button>
          </div>

          {/* Section 2: LEAD ENGINE */}
          <div className="px-4">
            <h3 className="text-[10px] font-mono tracking-widest text-slate-dark uppercase mb-2 px-3">Lead Engine</h3>
            <div className="space-y-1">
              <button 
                onClick={() => setActiveTab('live_chat')}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'live_chat' ? 'bg-ink-light text-paper' : 'text-slate-light hover:bg-ink-light hover:text-paper'}`}
              >
                <MessageSquare className="w-4 h-4" />
                <span>Live Chat</span>
              </button>
              
              <button 
                onClick={() => setActiveTab('chatbot')}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'chatbot' ? 'bg-ink-light text-paper' : 'text-slate-light hover:bg-ink-light hover:text-paper'}`}
              >
                <Bot className="w-4 h-4" />
                <span>Signal Bot</span>
              </button>
              
              <button 
                onClick={() => setActiveTab('web_forms')}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'web_forms' ? 'bg-signal/5 text-signal border border-signal/10' : 'text-slate-light hover:bg-ink-light hover:text-paper'}`}
              >
                <FormInput className="w-4 h-4" />
                <span>Web Forms</span>
              </button>
              
              <button 
                onClick={() => setActiveTab('prospector')}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'prospector' ? 'bg-ink-light text-paper' : 'text-slate-light hover:bg-ink-light hover:text-paper'}`}
              >
                <Search className="w-4 h-4" />
                <span>AI Prospector</span>
              </button>
            </div>
          </div>

          {/* Section 3: ADD-ONS */}
          <div className="px-4">
            <h3 className="text-[10px] font-mono tracking-widest text-slate-dark uppercase mb-2 px-3">Add-Ons</h3>
            <div className="space-y-1">
              <button 
                onClick={() => setActiveTab('visitors')}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'visitors' ? 'bg-ink-light text-paper' : 'text-slate-light hover:bg-ink-light hover:text-paper'}`}
              >
                <Eye className="w-4 h-4" />
                <span>Tender Scraping</span>
              </button>
            </div>
          </div>

          {/* Section 4: INTEGRATIONS */}
          <div className="px-4">
            <h3 className="text-[10px] font-mono tracking-widest text-slate-dark uppercase mb-2 px-3">Integrations</h3>
            <div className="space-y-1">
              <button 
                onClick={() => setActiveTab('linkedin')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'linkedin' ? 'bg-ink-light text-paper' : 'text-slate-light hover:bg-ink-light hover:text-paper'}`}
              >
                <div className="flex items-center space-x-3">
                  <Linkedin className="w-4 h-4 text-blue-500" />
                  <span>LinkedIn</span>
                </div>
                <span className="bg-signal text-ink text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider">NEW</span>
              </button>
            </div>
          </div>

        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 relative z-10 bg-ink overflow-hidden flex flex-col p-8 pt-6">
         {activeTab === 'inbox' && renderInbox()}
         {['live_chat', 'chatbot', 'web_forms', 'prospector'].includes(activeTab) && renderLeadEngine()}
         {['visitors', 'linkedin'].includes(activeTab) && (
           <div className="flex-1 flex flex-col items-center justify-center text-center">
             <Target className="w-12 h-12 text-slate mx-auto mb-4 opacity-20" />
             <h2 className="font-mono text-lg text-slate-light uppercase tracking-widest mb-2">Integration Locked</h2>
             <p className="font-sans text-slate text-sm max-w-md">This module requires external API keys to be configured in the System Administrator panel.</p>
           </div>
         )}
      </main>

    </div>
  );
}
