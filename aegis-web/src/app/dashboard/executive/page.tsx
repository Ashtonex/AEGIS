"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';
import { 
  getExecutiveKPIs, 
  getModulesStatus 
} from '@/lib/api';
import { 
  FileText, Activity, AlertCircle, FileCheck, Loader2
} from 'lucide-react';
import Link from 'next/link';

export default function ExecutiveCommandCentre() {
  const { session } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  
  // Extract user info from session
  const userEmail = session?.user?.email || "System User";
  const displayName = userEmail.split('@')[0].charAt(0).toUpperCase() + userEmail.split('@')[0].slice(1);
  const userRole = "Super Admin";
  
  // Real Data (if available) + Mock Data for aesthetic completion
  const [kpis, setKpis] = useState({
    cash_survival_days: 14,
    revenue: "$4.72M",
    margin: "18.7%",
    active_projects_count: 8,
    pipeline: "$11.83M",
    revenue_concentration_percent: 76,
    safety_score: 92,
    documented_percent: 38
  });

  useEffect(() => {
    if (!session) return;
    
    async function loadData() {
      try {
        const kpiRes = await getExecutiveKPIs();
        if (kpiRes.success && kpiRes.data) {
          // Merge real backend data where possible
          setKpis((prev) => ({
            ...prev,
            cash_survival_days: kpiRes.data.cash_survival_days ?? prev.cash_survival_days,
            revenue_concentration_percent: kpiRes.data.revenue_concentration_percent ?? prev.revenue_concentration_percent,
            active_projects_count: kpiRes.data.active_projects_count ?? prev.active_projects_count
          }));
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    
    loadData();
  }, [session]);

  if (isLoading) {
    return (
      <div className="h-full bg-ink flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-signal animate-spin" />
      </div>
    );
  }

  // MOCK MODULE GATEWAY (24 modules)
  const allModules = [
    { id: '01', name: 'Project Management', status: 'In Development' },
    { id: '02', name: 'Site Operations', status: 'In Development' },
    { id: '03', name: 'Workforce Management', status: 'Not Built' },
    { id: '04', name: 'Fleet Management', status: 'In Development' },
    { id: '05', name: 'Equipment & Assets', status: 'Not Built' },
    { id: '06', name: 'Procurement Management', status: 'Not Built' },
    { id: '07', name: 'Inventory & Materials', status: 'Not Built' },
    { id: '08', name: 'Budgeting & Cost Control', status: 'Not Built' },
    { id: '09', name: 'Financial Performance', status: 'Not Built' },
    { id: '10', name: 'Quotation & Estimation', status: 'Not Built' },
    { id: '11', name: 'Human Resources', status: 'Not Built' },
    { id: '12', name: 'Compliance & Legal', status: 'Not Built' },
    { id: '13', name: 'Health & Safety', status: 'Not Built' },
    { id: '14', name: 'Document Management', status: 'Not Built' },
    { id: '15', name: 'CRM', status: 'Active', href: '/dashboard/crm' },
    { id: '16', name: 'Client Portal', status: 'Not Built' },
    { id: '17', name: 'Supplier Portal', status: 'Not Built' },
    { id: '18', name: 'Communication', status: 'Not Built' },
    { id: '19', name: 'Executive Command', status: 'Active', href: '/dashboard/executive' },
    { id: '20', name: 'Business Intelligence', status: 'Not Built' },
    { id: '21', name: 'Risk Management', status: 'Not Built' },
    { id: '22', name: 'Tender Management', status: 'Not Built' },
    { id: '23', name: 'Maintenance Scheduling', status: 'Not Built' },
    { id: '24', name: 'Automated Reporting', status: 'Not Built' },
  ];

  return (
    <div className="p-6 h-full flex flex-col">
      {/* HERO SECTION */}
      <div className="flex justify-between items-end mb-6 shrink-0">
        <div>
          <h1 className="font-display text-4xl text-paper tracking-tight mb-1">Good morning, {displayName}.</h1>
          <p className="font-sans text-sm text-slate-light">{userRole}</p>
        </div>
        <div className="text-right">
          <p className="font-sans text-sm text-slate-light">{new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>

      {/* 8 HERO KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6 shrink-0">
        
        {/* Cash Runway */}
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm border-t-2 border-t-red-500">
          <p className="font-mono text-[10px] tracking-widest text-slate uppercase mb-2">Cash Runway</p>
          <div className="flex items-baseline space-x-1">
            <span className="font-display text-3xl text-paper leading-none">{kpis.cash_survival_days}</span>
            <span className="font-mono text-[10px] text-slate-light">DAYS</span>
          </div>
          <p className="font-mono text-[10px] text-red-500 mt-3 flex items-center"><AlertCircle className="w-3 h-3 mr-1"/> Critical</p>
        </div>

        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="font-mono text-[10px] tracking-widest text-slate uppercase mb-2">Revenue (YTD)</p>
          <span className="font-display text-3xl text-paper leading-none">{kpis.revenue}</span>
          <p className="font-mono text-[10px] text-green-500 mt-3">▲ 12.4% vs last month</p>
        </div>

        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="font-mono text-[10px] tracking-widest text-slate uppercase mb-2">Gross Profit Margin</p>
          <span className="font-display text-3xl text-paper leading-none">{kpis.margin}</span>
          <p className="font-mono text-[10px] text-green-500 mt-3">▲ 2.1% vs last month</p>
        </div>

        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="font-mono text-[10px] tracking-widest text-slate uppercase mb-2">Active Projects</p>
          <span className="font-display text-3xl text-paper leading-none">{kpis.active_projects_count}</span>
          <p className="font-mono text-[10px] text-signal mt-3">3 delayed</p>
        </div>

        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="font-mono text-[10px] tracking-widest text-slate uppercase mb-2">Pipeline Value</p>
          <span className="font-display text-3xl text-paper leading-none">{kpis.pipeline}</span>
          <p className="font-mono text-[10px] text-slate-light mt-3">Weighted</p>
        </div>

        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm border-t-2 border-t-red-500">
          <p className="font-mono text-[10px] tracking-widest text-slate uppercase mb-2">Top Client Concentration</p>
          <span className="font-display text-3xl text-paper leading-none">{kpis.revenue_concentration_percent}%</span>
          <p className="font-mono text-[10px] text-red-500 mt-3 flex items-center"><AlertCircle className="w-3 h-3 mr-1"/> High Risk</p>
        </div>

        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm border-t-2 border-t-green-500">
          <p className="font-mono text-[10px] tracking-widest text-slate uppercase mb-2">Safety Score</p>
          <span className="font-display text-3xl text-paper leading-none">{kpis.safety_score}</span>
          <p className="font-mono text-[10px] text-green-500 mt-3">▲ Good</p>
        </div>

        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm border-t-2 border-t-signal">
          <p className="font-mono text-[10px] tracking-widest text-slate uppercase mb-2">Documented Processes</p>
          <span className="font-display text-3xl text-paper leading-none">{kpis.documented_percent}%</span>
          <p className="font-mono text-[10px] text-signal mt-3">Needs Work</p>
        </div>

      </div>

      {/* 4-COLUMN MAIN LAYOUT */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0">
        
        {/* COL 1: MODULE GATEWAY */}
        <div className="bg-ink border border-ink-mid rounded-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-mid shrink-0">
            <h3 className="font-mono text-[10px] tracking-widest text-paper uppercase">Module Gateway</h3>
          </div>
          <div className="p-4 overflow-y-auto flex-1 no-scrollbar">
            <div className="grid grid-cols-4 gap-2">
              {allModules.map((mod) => (
                <div 
                  key={mod.id} 
                  className={`aspect-square flex flex-col justify-between p-2 border rounded-sm transition-colors group ${
                    mod.status === 'Active' 
                      ? 'bg-ink-light border-ink-mid hover:border-signal cursor-pointer' 
                      : mod.status === 'In Development'
                        ? 'bg-ink border-ink-mid/50 opacity-70 cursor-not-allowed'
                        : 'bg-ink border-transparent opacity-30 cursor-not-allowed'
                  }`}
                  title={mod.status !== 'Active' ? `Coming Soon - ${mod.status}` : ''}
                >
                  {mod.href ? (
                    <Link href={mod.href} className="absolute inset-0 z-10" />
                  ) : null}
                  <span className="font-mono text-[9px] text-slate">{mod.id}</span>
                  <span className={`font-sans text-[9px] leading-tight break-words ${mod.status === 'Active' ? 'text-paper' : 'text-slate'}`}>
                    {mod.name}
                  </span>
                </div>
              ))}
            </div>
            
            <div className="mt-6 flex space-x-4">
              <div className="flex items-center space-x-1">
                <span className="w-2 h-2 bg-green-500 rounded-sm"></span>
                <span className="font-mono text-[9px] text-slate uppercase tracking-wider">Active</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="w-2 h-2 bg-signal rounded-sm"></span>
                <span className="font-mono text-[9px] text-slate uppercase tracking-wider">In Development</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="w-2 h-2 bg-slate-dark rounded-sm"></span>
                <span className="font-mono text-[9px] text-slate uppercase tracking-wider">Not Built</span>
              </div>
            </div>
          </div>
        </div>

        {/* COL 2: OPERATIONAL INTEL & MAP */}
        <div className="flex flex-col gap-4 min-h-0">
          
          <div className="bg-ink border border-ink-mid rounded-sm flex flex-col shrink-0">
            <div className="px-4 py-3 border-b border-ink-mid">
              <h3 className="font-mono text-[10px] tracking-widest text-paper uppercase">Operational Intelligence</h3>
            </div>
            <div className="p-4 space-y-3">
              {[
                { label: 'Live Projects', val: '8' },
                { label: 'Deployed Machinery', val: '24' },
                { label: 'Active Workforce', val: '142' },
                { label: 'Open Purchase Orders', val: '17' },
                { label: 'Materials in Stock', val: '$1.92M' },
                { label: 'Safety Incidents (YTD)', val: '2' },
              ].map(stat => (
                <div key={stat.label} className="flex justify-between items-center text-sm border-b border-ink-mid/30 pb-2">
                  <span className="font-sans text-slate-light flex items-center"><Activity className="w-3 h-3 mr-2 opacity-50"/> {stat.label}</span>
                  <span className="font-mono text-paper">{stat.val}</span>
                </div>
              ))}
              <div className="pt-2">
                <p className="font-sans text-xs text-slate-light">Regions of Operation</p>
                <p className="font-mono text-sm text-paper mt-1">Mutare, Beira, Harare</p>
              </div>
            </div>
          </div>

          <div className="bg-ink border border-ink-mid rounded-sm flex flex-col flex-1 overflow-hidden relative">
            <div className="px-4 py-3 border-b border-ink-mid absolute top-0 left-0 right-0 z-10 bg-ink/80 backdrop-blur-sm">
              <h3 className="font-mono text-[10px] tracking-widest text-paper uppercase">Regional Footprint</h3>
            </div>
            {/* Minimal SVG representation of Zimbabwe map footprint */}
            <div className="flex-1 flex items-center justify-center p-4 pt-12 relative opacity-60">
              <svg viewBox="0 0 100 100" className="w-full h-full stroke-ink-mid fill-ink stroke-1">
                <path d="M 30,10 L 70,10 L 90,40 L 70,90 L 20,80 L 10,40 Z" />
              </svg>
              {/* Nodes */}
              <div className="absolute top-[35%] left-[65%] flex flex-col items-center">
                <div className="w-2 h-2 bg-signal rounded-full shadow-[0_0_10px_rgba(200,150,12,0.8)]"></div>
                <span className="font-mono text-[9px] mt-1 text-slate-light">Harare</span>
              </div>
              <div className="absolute top-[60%] left-[80%] flex flex-col items-center">
                <div className="w-2 h-2 bg-signal rounded-full shadow-[0_0_10px_rgba(200,150,12,0.8)] animate-pulse-signal"></div>
                <span className="font-mono text-[9px] mt-1 text-slate-light">Mutare</span>
              </div>
              <div className="absolute top-[80%] left-[90%] flex flex-col items-center">
                <div className="w-2 h-2 bg-slate-light rounded-full"></div>
                <span className="font-mono text-[9px] mt-1 text-slate-dark">Beira Corridor</span>
              </div>
            </div>
          </div>

        </div>

        {/* COL 3: ACTIVITY FEED */}
        <div className="bg-ink border border-ink-mid rounded-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-mid shrink-0 flex justify-between items-center">
            <h3 className="font-mono text-[10px] tracking-widest text-paper uppercase">Activity Feed</h3>
          </div>
          <div className="p-4 overflow-y-auto flex-1 no-scrollbar space-y-4">
            
            <div className="flex gap-3">
              <FileCheck className="w-4 h-4 text-slate shrink-0 mt-0.5" />
              <div>
                <p className="font-sans text-xs text-paper">Mutare Batching Plant</p>
                <p className="font-sans text-xs text-slate-light">Progress update submitted</p>
                <p className="font-mono text-[9px] text-slate mt-1">23 May 2025, 08:15</p>
              </div>
            </div>
            <div className="h-px bg-ink-mid/30 w-full ml-7"></div>

            <div className="flex gap-3">
              <AlertCircle className="w-4 h-4 text-slate shrink-0 mt-0.5" />
              <div>
                <p className="font-sans text-xs text-paper">New Inquiry Received</p>
                <p className="font-sans text-xs text-slate-light">From Delta Mining</p>
                <p className="font-mono text-[9px] text-slate mt-1">23 May 2025, 07:42</p>
              </div>
            </div>
            <div className="h-px bg-ink-mid/30 w-full ml-7"></div>

            <div className="flex gap-3">
              <FileText className="w-4 h-4 text-slate shrink-0 mt-0.5" />
              <div>
                <p className="font-sans text-xs text-paper">Purchase Order #PO-1042</p>
                <p className="font-sans text-xs text-slate-light">Approved</p>
                <p className="font-mono text-[9px] text-slate mt-1">23 May 2025, 07:31</p>
              </div>
            </div>
            <div className="h-px bg-ink-mid/30 w-full ml-7"></div>

            <div className="flex gap-3">
              <Activity className="w-4 h-4 text-slate shrink-0 mt-0.5" />
              <div>
                <p className="font-sans text-xs text-paper">Safety Inspection</p>
                <p className="font-sans text-xs text-slate-light">All sites completed</p>
                <p className="font-mono text-[9px] text-slate mt-1">22 May 2025, 17:00</p>
              </div>
            </div>
            <div className="h-px bg-ink-mid/30 w-full ml-7"></div>

            <div className="flex gap-3">
              <FileCheck className="w-4 h-4 text-slate shrink-0 mt-0.5" />
              <div>
                <p className="font-sans text-xs text-paper">Invoice #INV-2025-087</p>
                <p className="font-sans text-xs text-slate-light">Payment received</p>
                <p className="font-mono text-[9px] text-slate mt-1">22 May 2025, 16:45</p>
              </div>
            </div>

          </div>
          <div className="p-3 border-t border-ink-mid shrink-0">
            <button className="font-mono text-[10px] text-signal hover:text-signal-muted tracking-widest uppercase flex justify-between w-full">
              <span>View all activity</span>
              <span>→</span>
            </button>
          </div>
        </div>

        {/* COL 4: RECENT NOTIFICATIONS / STRATEGIC ALERTS */}
        <div className="bg-ink border border-ink-mid rounded-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-mid shrink-0">
            <h3 className="font-mono text-[10px] tracking-widest text-paper uppercase">Recent Notifications</h3>
          </div>
          <div className="p-4 overflow-y-auto flex-1 no-scrollbar space-y-4">
            
            <div className="flex justify-between items-start group cursor-pointer">
              <div className="flex space-x-2">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 shrink-0"></span>
                <div>
                  <p className="font-sans text-xs text-paper group-hover:text-signal transition-colors">Low Cash Runway</p>
                  <p className="font-sans text-[11px] text-slate-light mt-0.5">14 days remaining</p>
                </div>
              </div>
              <span className="font-mono text-[9px] text-slate shrink-0">2m ago</span>
            </div>

            <div className="flex justify-between items-start group cursor-pointer">
              <div className="flex space-x-2">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 shrink-0"></span>
                <div>
                  <p className="font-sans text-xs text-paper group-hover:text-signal transition-colors">Invoice Overdue</p>
                  <p className="font-sans text-[11px] text-slate-light mt-0.5">INV-2025-082 is overdue</p>
                </div>
              </div>
              <span className="font-mono text-[9px] text-slate shrink-0">18m ago</span>
            </div>

            <div className="flex justify-between items-start group cursor-pointer">
              <div className="flex space-x-2">
                <span className="w-1.5 h-1.5 bg-signal rounded-full mt-1.5 shrink-0"></span>
                <div>
                  <p className="font-sans text-xs text-paper group-hover:text-signal transition-colors">Project Delay Risk</p>
                  <p className="font-sans text-[11px] text-slate-light mt-0.5">Mutare Batching Plant</p>
                </div>
              </div>
              <span className="font-mono text-[9px] text-slate shrink-0">25m ago</span>
            </div>

            <div className="flex justify-between items-start group cursor-pointer">
              <div className="flex space-x-2">
                <span className="w-1.5 h-1.5 bg-slate-light rounded-full mt-1.5 shrink-0"></span>
                <div>
                  <p className="font-sans text-xs text-paper group-hover:text-signal transition-colors">PO Awaiting Approval</p>
                  <p className="font-sans text-[11px] text-slate-light mt-0.5">PO-1045 requires approval</p>
                </div>
              </div>
              <span className="font-mono text-[9px] text-slate shrink-0">1h ago</span>
            </div>

            <div className="flex justify-between items-start group cursor-pointer">
              <div className="flex space-x-2">
                <span className="w-1.5 h-1.5 bg-slate-light rounded-full mt-1.5 shrink-0"></span>
                <div>
                  <p className="font-sans text-xs text-paper group-hover:text-signal transition-colors">Compliance Document</p>
                  <p className="font-sans text-[11px] text-slate-light mt-0.5">ZIMRA clearance expiring</p>
                </div>
              </div>
              <span className="font-mono text-[9px] text-slate shrink-0">2h ago</span>
            </div>

          </div>
          <div className="p-3 border-t border-ink-mid shrink-0">
            <button className="font-mono text-[10px] text-signal hover:text-signal-muted tracking-widest uppercase flex justify-between w-full">
              <span>View all notifications</span>
              <span>→</span>
            </button>
          </div>
        </div>

      </div>

    </div>
  );
}
