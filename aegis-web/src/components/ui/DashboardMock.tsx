"use client";

import { Activity, LayoutDashboard, Database, Shield, Settings, Users, FileText, Bell, Search } from "lucide-react";

export function DashboardMock() {
  return (
    <div className="relative w-full aspect-video bg-void border border-ink-mid rounded-[4px] overflow-hidden shadow-[0_0_0_1px_var(--dxl-ink-mid),0_40px_120px_rgba(0,0,0,0.6),0_0_80px_rgba(200,150,12,0.04)] flex">
      
      {/* SIDEBAR */}
      <div className="w-[200px] h-full bg-void border-r border-ink-mid flex flex-col">
        <div className="p-4 border-b border-ink-mid">
          <span className="font-display text-xl text-signal tracking-wide">AEGIS</span>
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
                  ? "bg-ink-light border-l-2 border-signal text-paper" 
                  : "text-slate-light border-l-2 border-transparent hover:text-paper hover:bg-ink"
              }`}
            >
              <item.icon className="w-4 h-4" />
              <span className="font-sans text-[12px]">{item.label}</span>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-ink-mid">
          <div className="flex items-center gap-3 text-slate">
            <Settings className="w-4 h-4" />
            <span className="font-sans text-[12px]">Settings</span>
          </div>
        </div>
      </div>

      {/* MAIN AREA */}
      <div className="flex-1 h-full bg-ink flex flex-col">
        
        {/* TOP BAR */}
        <div className="h-12 border-b border-ink-mid flex items-center justify-between px-4">
          <div className="text-[11px] text-slate font-sans">
            Home / Projects / <span className="text-paper">Kariba South Expansion</span>
          </div>
          <div className="flex items-center gap-4 text-slate">
            <Search className="w-4 h-4 cursor-pointer hover:text-paper" />
            <Bell className="w-4 h-4 cursor-pointer hover:text-paper" />
            <div className="w-6 h-6 rounded-full bg-ink-light border border-ink-mid overflow-hidden">
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
              <div key={i} className="bg-ink-light border border-ink-mid p-4 rounded-sm flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] uppercase tracking-wider text-signal">{kpi.label}</span>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm ${kpi.trend === "UNDER" || kpi.trend.includes("DAYS") ? "bg-success/10 text-success" : "bg-info/10 text-info"}`}>
                    {kpi.trend}
                  </span>
                </div>
                <div className="flex items-end justify-between mt-1">
                  <span className={`font-sans text-[20px] font-bold text-paper ${kpi.pulse ? "animate-[pulse_3s_ease-in-out_infinite]" : ""}`}>{kpi.value}</span>
                  <svg width="60" height="24" className="overflow-visible">
                    <path d={kpi.spark} fill="none" stroke="var(--dxl-info)" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
            ))}
          </div>

          {/* ROW 2: CHART + FEED */}
          <div className="flex gap-4 h-[160px]">
            {/* CHART */}
            <div className="w-[70%] bg-ink-light border border-ink-mid rounded-sm p-4 relative overflow-hidden flex flex-col">
              <span className="text-[10px] text-slate uppercase tracking-wider mb-2">Resource Utilization</span>
              <div className="flex-1 relative">
                {/* SVG Area Chart */}
                <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                  <path d="M0,100 L0,60 C20,40 30,70 50,50 C70,30 80,40 100,20 L100,100 Z" fill="rgba(14,165,233,0.1)" />
                  <path d="M0,60 C20,40 30,70 50,50 C70,30 80,40 100,20" fill="none" stroke="var(--dxl-info)" strokeWidth="2" />
                  
                  {/* Grid lines */}
                  <line x1="0" y1="25" x2="100" y2="25" stroke="var(--dxl-ink-mid)" strokeWidth="0.5" strokeDasharray="2,2" />
                  <line x1="0" y1="50" x2="100" y2="50" stroke="var(--dxl-ink-mid)" strokeWidth="0.5" strokeDasharray="2,2" />
                  <line x1="0" y1="75" x2="100" y2="75" stroke="var(--dxl-ink-mid)" strokeWidth="0.5" strokeDasharray="2,2" />
                </svg>
              </div>
            </div>
            {/* FEED */}
            <div className="w-[30%] bg-ink-light border border-ink-mid rounded-sm p-4 flex flex-col">
               <span className="text-[10px] text-slate uppercase tracking-wider mb-3">Activity Stream</span>
               <div className="flex-1 flex flex-col gap-3 overflow-hidden">
                 {[
                   { name: "JW", text: "Approved structural steel delivery", time: "12m" },
                   { name: "AT", text: "Updated risk register #421", time: "1h" },
                   { name: "MS", text: "Site inspection completed", time: "3h" },
                 ].map((act, i) => (
                   <div key={i} className="flex items-start gap-2 border-b border-ink-mid pb-2 last:border-0 last:pb-0">
                     <div className="w-5 h-5 rounded-full bg-ink border border-ink-mid flex items-center justify-center text-[8px] text-signal">{act.name}</div>
                     <div className="flex-1">
                       <div className="text-[10px] text-paper leading-tight">{act.text}</div>
                       <div className="text-[8px] text-slate mt-0.5">{act.time} ago</div>
                     </div>
                   </div>
                 ))}
               </div>
            </div>
          </div>

          {/* ROW 3: TABLE */}
          <div className="flex-1 bg-ink-light border border-ink-mid rounded-sm flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-ink-mid bg-ink/50">
               <div className="w-[10%] text-[10px] text-slate uppercase">ID</div>
               <div className="w-[40%] text-[10px] text-slate uppercase">Deliverable</div>
               <div className="w-[20%] text-[10px] text-slate uppercase">Contractor</div>
               <div className="w-[15%] text-[10px] text-slate uppercase">Status</div>
               <div className="w-[15%] text-[10px] text-slate uppercase text-right">Date</div>
            </div>
            <div className="flex flex-col">
              {[1, 2, 3].map((row) => (
                <div key={row} className="flex items-center justify-between px-4 py-2 border-b border-ink-mid last:border-0 hover:bg-ink/30 transition-colors">
                  <div className="w-[10%]"><div className="w-6 h-3 bg-ink border border-ink-mid rounded-sm" /></div>
                  <div className="w-[40%]"><div className="w-3/4 h-3 bg-ink-mid rounded-sm" /></div>
                  <div className="w-[20%]"><div className="w-1/2 h-3 bg-ink border border-ink-mid rounded-sm" /></div>
                  <div className="w-[15%]"><div className="w-12 h-4 bg-success/10 border border-success/20 rounded-sm" /></div>
                  <div className="w-[15%] flex justify-end"><div className="w-10 h-3 bg-ink border border-ink-mid rounded-sm" /></div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
