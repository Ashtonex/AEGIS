"use client";

import { Activity, LayoutDashboard, Database, Shield, Settings, Users, FileText, Bell, Search } from "lucide-react";

export function DashboardMock() {
  return (
    <div className="relative w-full aspect-video bg-snc-void border border-snc-border rounded-[4px] overflow-hidden shadow-[0_0_0_1px_var(--snc-border),0_40px_120px_rgba(0,0,0,0.6),0_0_80px_rgba(200,150,12,0.04)] flex">
      
      {/* SIDEBAR */}
      <div className="w-[200px] h-full bg-snc-void border-r border-snc-border flex flex-col">
        <div className="p-4 border-b border-snc-border">
          <span className="font-display text-xl text-snc-gold-primary tracking-wide">AEGIS</span>
        </div>
        <div className="flex-1 py-4 flex flex-col gap-1">
          {[
            { icon: LayoutDashboard, label: "Overview", active: true },
            { icon: Activity, label: "Operations" },
            { icon: Database, label: "Assets" },
            { icon: Users, label: "Workforce" },
            { icon: FileText, label: "Tenders" },
            { icon: Shield, label: "Safety" },
          ].map((item, i) => (
            <div 
              key={i} 
              className={`flex items-center gap-3 px-4 py-2 cursor-pointer ${
                item.active 
                  ? "bg-snc-navy-raised border-l-2 border-snc-gold-primary text-snc-text-primary" 
                  : "text-snc-text-secondary border-l-2 border-transparent hover:text-snc-text-primary hover:bg-snc-navy"
              }`}
            >
              <item.icon className="w-4 h-4" />
              <span className="font-sans text-[12px]">{item.label}</span>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-snc-border">
          <div className="flex items-center gap-3 text-snc-text-tertiary">
            <Settings className="w-4 h-4" />
            <span className="font-sans text-[12px]">Settings</span>
          </div>
        </div>
      </div>

      {/* MAIN AREA */}
      <div className="flex-1 h-full bg-snc-navy flex flex-col">
        
        {/* TOP BAR */}
        <div className="h-12 border-b border-snc-border flex items-center justify-between px-4">
          <div className="text-[11px] text-snc-text-tertiary font-sans">
            Home / Projects / <span className="text-snc-text-primary">Kariba South Expansion</span>
          </div>
          <div className="flex items-center gap-4 text-snc-text-tertiary">
            <Search className="w-4 h-4 cursor-pointer hover:text-snc-text-primary" />
            <Bell className="w-4 h-4 cursor-pointer hover:text-snc-text-primary" />
            <div className="w-6 h-6 rounded-full bg-snc-navy-raised border border-snc-border overflow-hidden">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#152848"/><circle cx="12" cy="8" r="4" fill="#64748B"/><path d="M4 22C4 17.5817 7.58172 14 12 14C16.4183 14 20 17.5817 20 22" fill="#64748B"/></svg>
            </div>
          </div>
        </div>

        {/* CONTENT AREA */}
        <div className="flex-1 p-6 flex flex-col gap-6 overflow-hidden">
          
          {/* ROW 1: KPIs */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "PROGRESS", value: "68.4%", trend: "+2.1%", spark: "M0,20 Q15,5 30,15 T60,5" },
              { label: "BUDGET VARIANCE", value: "$142K", trend: "UNDER", spark: "M0,10 Q15,20 30,10 T60,20", pulse: true },
              { label: "WORKFORCE", value: "412", trend: "ACTIVE", spark: "M0,15 Q15,10 30,20 T60,10" },
              { label: "SAFETY LTI", value: "0", trend: "342 DAYS", spark: "M0,20 L60,20", pulse: true },
            ].map((kpi, i) => (
              <div key={i} className="bg-snc-navy-raised border border-snc-border p-4 rounded-sm flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] uppercase tracking-wider text-snc-gold-primary">{kpi.label}</span>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm ${kpi.trend === "UNDER" || kpi.trend.includes("DAYS") ? "bg-snc-success/10 text-snc-success" : "bg-snc-electric/10 text-snc-electric"}`}>
                    {kpi.trend}
                  </span>
                </div>
                <div className="flex items-end justify-between mt-1">
                  <span className={`font-sans text-[20px] font-bold text-snc-text-primary ${kpi.pulse ? "animate-[pulse_3s_ease-in-out_infinite]" : ""}`}>{kpi.value}</span>
                  <svg width="60" height="24" className="overflow-visible">
                    <path d={kpi.spark} fill="none" stroke="var(--snc-electric)" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
            ))}
          </div>

          {/* ROW 2: CHART + FEED */}
          <div className="flex gap-4 h-[160px]">
            {/* CHART */}
            <div className="w-[70%] bg-snc-navy-raised border border-snc-border rounded-sm p-4 relative overflow-hidden flex flex-col">
              <span className="text-[10px] text-snc-text-tertiary uppercase tracking-wider mb-2">Resource Utilization</span>
              <div className="flex-1 relative">
                {/* SVG Area Chart */}
                <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                  <path d="M0,100 L0,60 C20,40 30,70 50,50 C70,30 80,40 100,20 L100,100 Z" fill="rgba(14,165,233,0.1)" />
                  <path d="M0,60 C20,40 30,70 50,50 C70,30 80,40 100,20" fill="none" stroke="var(--snc-electric)" strokeWidth="2" />
                  
                  {/* Grid lines */}
                  <line x1="0" y1="25" x2="100" y2="25" stroke="var(--snc-border)" strokeWidth="0.5" strokeDasharray="2,2" />
                  <line x1="0" y1="50" x2="100" y2="50" stroke="var(--snc-border)" strokeWidth="0.5" strokeDasharray="2,2" />
                  <line x1="0" y1="75" x2="100" y2="75" stroke="var(--snc-border)" strokeWidth="0.5" strokeDasharray="2,2" />
                </svg>
              </div>
            </div>
            {/* FEED */}
            <div className="w-[30%] bg-snc-navy-raised border border-snc-border rounded-sm p-4 flex flex-col">
               <span className="text-[10px] text-snc-text-tertiary uppercase tracking-wider mb-3">Activity Stream</span>
               <div className="flex-1 flex flex-col gap-3 overflow-hidden">
                 {[
                   { name: "JW", text: "Approved structural steel delivery", time: "12m" },
                   { name: "AT", text: "Updated risk register #421", time: "1h" },
                   { name: "MS", text: "Site inspection completed", time: "3h" },
                 ].map((act, i) => (
                   <div key={i} className="flex items-start gap-2 border-b border-snc-border pb-2 last:border-0 last:pb-0">
                     <div className="w-5 h-5 rounded-full bg-snc-navy border border-snc-border flex items-center justify-center text-[8px] text-snc-gold-primary">{act.name}</div>
                     <div className="flex-1">
                       <div className="text-[10px] text-snc-text-primary leading-tight">{act.text}</div>
                       <div className="text-[8px] text-snc-text-tertiary mt-0.5">{act.time} ago</div>
                     </div>
                   </div>
                 ))}
               </div>
            </div>
          </div>

          {/* ROW 3: TABLE */}
          <div className="flex-1 bg-snc-navy-raised border border-snc-border rounded-sm flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-snc-border bg-snc-navy/50">
               <div className="w-[10%] text-[10px] text-snc-text-tertiary uppercase">ID</div>
               <div className="w-[40%] text-[10px] text-snc-text-tertiary uppercase">Deliverable</div>
               <div className="w-[20%] text-[10px] text-snc-text-tertiary uppercase">Contractor</div>
               <div className="w-[15%] text-[10px] text-snc-text-tertiary uppercase">Status</div>
               <div className="w-[15%] text-[10px] text-snc-text-tertiary uppercase text-right">Date</div>
            </div>
            <div className="flex flex-col">
              {[1, 2, 3].map((row) => (
                <div key={row} className="flex items-center justify-between px-4 py-2 border-b border-snc-border last:border-0 hover:bg-snc-navy/30 transition-colors">
                  <div className="w-[10%]"><div className="w-6 h-3 bg-snc-navy border border-snc-border rounded-sm" /></div>
                  <div className="w-[40%]"><div className="w-3/4 h-3 bg-snc-border rounded-sm" /></div>
                  <div className="w-[20%]"><div className="w-1/2 h-3 bg-snc-navy border border-snc-border rounded-sm" /></div>
                  <div className="w-[15%]"><div className="w-12 h-4 bg-snc-success/10 border border-snc-success/20 rounded-sm" /></div>
                  <div className="w-[15%] flex justify-end"><div className="w-10 h-3 bg-snc-navy border border-snc-border rounded-sm" /></div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
