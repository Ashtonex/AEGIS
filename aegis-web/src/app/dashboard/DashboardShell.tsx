"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { 
  Search, Bell, User, LayoutDashboard, Briefcase, 
  HardHat, Activity, Users, Truck, Wrench, ShoppingCart, 
  Package, DollarSign, UserCheck, ShieldCheck, FileText, 
  BarChart, PieChart, Settings, LogOut, ChevronDown, ChevronRight,
  Target, Handshake, Building2, BookOpen, Inbox, Zap, MapPin
} from "lucide-react";

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, signOut } = useAuth();
  const [time, setTime] = useState("");
  
  // Extract user info from session
  const userEmail = session?.user?.email || "System User";
  // Create a display name from email (e.g., admin@example.com -> Admin)
  const displayName = userEmail.split('@')[0].charAt(0).toUpperCase() + userEmail.split('@')[0].slice(1);
  const userRole = "Super Admin"; // Or extract from session metadata if available

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' }) + ' CAT');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // State for CRM dropdown accordion
  const [isCrmOpen, setIsCrmOpen] = useState(pathname?.startsWith('/dashboard/crm'));

  const crmSubItems = [
    { name: "Commercial Command", href: "/dashboard/crm", icon: BarChart, active: true },
    { name: "Leads", href: "/dashboard/crm/leads", icon: Target, active: true },
    { name: "Opportunities", href: "/dashboard/crm/opportunities", icon: Briefcase, active: true },
    { name: "Quotations", href: "/dashboard/crm/quotations", icon: FileText, active: true },
    { name: "Tenders & Bids", href: "/dashboard/crm/tenders", icon: Building2, active: true },
    { name: "Organizations", href: "/dashboard/crm/organizations", icon: Handshake, active: true },
    { name: "Contacts", href: "/dashboard/crm/contacts", icon: Users, active: true },
    { name: "Subcontractors", href: "/dashboard/crm/subcontractors", icon: HardHat, active: true },
    { name: "Activities", href: "/dashboard/crm/activities", icon: MapPin, active: true },
    { name: "Documents", href: "/dashboard/crm/documents", icon: BookOpen, active: true },
    { name: "Sales Inbox", href: "/dashboard/crm/inbox", icon: Inbox, active: true },
    { name: "Automations", href: "/dashboard/crm/automations", icon: Zap, active: true },
  ];

  const navItems = [
    { name: "Executive", href: "/dashboard/executive", icon: LayoutDashboard, active: true },
    { 
      name: "CRM", 
      href: "/dashboard/crm", 
      icon: Briefcase, 
      active: true,
      hasSubMenu: true,
      subItems: crmSubItems
    },
    { name: "Projects", href: "/dashboard/projects", icon: HardHat, active: true },
    { name: "Site Operations", href: "/dashboard/site-operations", icon: Activity, active: true },
    { name: "Workforce", href: "/dashboard/workforce", icon: Users, active: true },
    { name: "Fleet", href: "/dashboard/fleet", icon: Truck, active: true },
    { name: "Equipment", href: "/dashboard/equipment", icon: Wrench, active: true },
    { name: "Procurement", href: "/dashboard/procurement", icon: ShoppingCart, active: true },
    { name: "Inventory", href: "/dashboard/inventory", icon: Package, active: true },
    { name: "Finance", href: "/dashboard/finance", icon: DollarSign, active: true },
    { name: "HR", href: "/dashboard/hr", icon: UserCheck, active: true },
    { name: "Compliance", href: "/dashboard/compliance", icon: ShieldCheck, active: true },
    { name: "Documents", href: "/dashboard/documents", icon: FileText, active: true },
    { name: "Reports", href: "/dashboard/reports", icon: BarChart, active: true },
    { name: "Analytics", href: "/dashboard/analytics", icon: PieChart, active: true },
    { name: "Settings", href: "/dashboard/settings", icon: Settings, active: true },
  ];

  return (
    <div className="min-h-screen bg-ink flex flex-col font-sans selection:bg-signal selection:text-ink">
      
      {/* GLOBAL TOP NAVIGATION BAR */}
      <header className="h-14 border-b border-ink-mid bg-ink flex items-center justify-between px-6 z-30 shrink-0">
        <div className="flex items-center space-x-8">
          <Link href="/dashboard/executive" className="flex items-center space-x-3">
            <div className="w-6 h-6 bg-signal rounded-sm flex items-center justify-center">
              <span className="font-display text-ink font-bold text-sm">SNC</span>
            </div>
            <span className="font-display text-lg tracking-tight text-paper">IMPERIUM</span>
          </Link>
          
          <div className="relative group">
            <Search className="w-4 h-4 text-slate absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-signal transition-colors" />
            <input 
              type="text" 
              placeholder="Search Imperium..." 
              className="bg-ink-light border border-ink-mid rounded-sm pl-10 pr-4 py-1.5 text-sm text-paper placeholder-slate focus:outline-none focus:border-signal/50 focus:ring-1 focus:ring-signal/50 transition-all w-64"
            />
          </div>
        </div>

        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2 border-r border-ink-mid pr-6">
            <span className="w-2 h-2 rounded-full bg-signal animate-pulse-signal"></span>
            <span className="text-data-sm font-mono text-slate-light tracking-widest uppercase">Six Nine Construction</span>
          </div>
          
          <button className="text-slate hover:text-paper transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-signal rounded-full border border-ink"></span>
          </button>
          
          <div className="font-mono text-data-sm text-slate-light tracking-widest">
            {time}
          </div>
          
          <div className="flex items-center space-x-3 border-l border-ink-mid pl-6 cursor-pointer group">
            <div className="text-right">
              <p className="text-sm font-medium text-paper group-hover:text-signal transition-colors">{displayName}</p>
              <p className="text-[10px] font-mono tracking-widest text-slate uppercase">{userRole}</p>
            </div>
            <div className="w-8 h-8 rounded-sm bg-ink-light border border-ink-mid flex items-center justify-center text-slate group-hover:border-signal/50 transition-colors">
              <User className="w-4 h-4" />
            </div>
          </div>
        </div>
      </header>

      {/* BODY CONFIGURATION */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* FIXED LEFT SIDEBAR */}
        <aside className="w-56 flex-shrink-0 border-r border-ink-mid bg-ink flex flex-col z-20">
          <nav className="flex-1 py-4 overflow-y-auto no-scrollbar flex flex-col px-3">
            {navItems.map((item) => {
              const isCurrent = pathname === item.href || (pathname?.startsWith(item.href) && item.href !== '/dashboard' && item.href !== '#' && !item.hasSubMenu);
              
              if (item.hasSubMenu) {
                return (
                  <div key={item.name} className="mb-1">
                    <button 
                      onClick={() => setIsCrmOpen(!isCrmOpen)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                        pathname?.startsWith(item.href) ? "text-signal bg-signal/5" : "text-slate-light hover:text-paper hover:bg-ink-light"
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <item.icon className={`w-4 h-4 ${pathname?.startsWith(item.href) ? 'text-signal' : 'text-slate'}`} />
                        <span>{item.name}</span>
                      </div>
                      {isCrmOpen ? <ChevronDown className="w-4 h-4 text-slate" /> : <ChevronRight className="w-4 h-4 text-slate" />}
                    </button>
                    
                    {isCrmOpen && (
                      <div className="mt-1 flex flex-col space-y-1 relative before:absolute before:left-5 before:top-0 before:bottom-0 before:w-px before:bg-ink-mid">
                        {item.subItems?.map((sub) => {
                          const isSubCurrent = pathname === sub.href || (pathname?.startsWith(sub.href) && sub.href !== '/dashboard/crm');
                          return (
                            <Link
                              key={sub.name}
                              href={sub.active ? sub.href : "#"}
                              onClick={(e) => !sub.active && e.preventDefault()}
                              className={`flex items-center space-x-3 py-1.5 pl-10 pr-3 rounded-sm text-xs transition-colors relative ${
                                isSubCurrent 
                                  ? "text-paper bg-ink-light before:absolute before:left-[19px] before:top-1/2 before:-translate-y-1/2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-signal" 
                                  : sub.active 
                                    ? "text-slate hover:text-paper hover:bg-ink-light/50" 
                                    : "text-slate-dark cursor-not-allowed"
                              }`}
                            >
                              <sub.icon className={`w-3.5 h-3.5 ${isSubCurrent ? 'text-signal' : sub.active ? 'text-slate-light' : 'text-slate-dark'}`} />
                              <span>{sub.name}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <Link 
                  key={item.name} 
                  href={item.active ? item.href : "#"} 
                  onClick={(e) => !item.active && e.preventDefault()}
                  className={`flex items-center space-x-3 px-3 py-2 rounded-sm mb-1 text-sm font-medium transition-colors ${
                    isCurrent 
                      ? "text-signal bg-signal/5 border border-signal/20" 
                      : item.active 
                        ? "text-slate-light hover:text-paper hover:bg-ink-light" 
                        : "text-slate-dark cursor-not-allowed"
                  }`}
                >
                  <item.icon className={`w-4 h-4 ${isCurrent ? 'text-signal' : item.active ? 'text-slate' : 'text-slate-dark'}`} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* MAIN CONTENT AREA */}
        <main className="flex-1 overflow-auto bg-ink relative">
          <div 
            className="absolute inset-0 pointer-events-none opacity-[0.03] mix-blend-screen"
            style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '40px 40px' }}
          />
          {children}
        </main>
      </div>
    </div>
  );
}
