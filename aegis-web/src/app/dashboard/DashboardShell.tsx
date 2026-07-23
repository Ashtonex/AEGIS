"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { NotificationBell } from "@/components/layout/dashboard/NotificationBell";
import { PwaPushButton } from "@/components/pwa/PwaPushButton";
import { getMyProfile, updateMyProfile } from "@/lib/api";
import { DashboardTour } from "@/components/onboarding/DashboardTour";
import {
  Search, Bell, CircleHelp, User, LayoutDashboard, Briefcase,
  HardHat, Activity, Users, Truck, Wrench, ShoppingCart,
  Package, DollarSign, UserCheck, ShieldCheck, FileText,
  BarChart, PieChart, Settings, LogOut, ChevronDown, ChevronRight,
  Target, Handshake, Building2, BookOpen, Inbox, Zap, MapPin,
  LockKeyhole, ClipboardCheck, Calendar, Banknote, BookMarked, Receipt, BrainCircuit
} from "lucide-react";

type ModuleNavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

type ModuleGroup = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  subItems: ModuleNavItem[];
};

const MODULE_GROUPS: ModuleGroup[] = [
  {
    name: "Executive",
    href: "/dashboard/executive",
    icon: LayoutDashboard,
    subItems: [{ name: "Overview", href: "/dashboard/executive", icon: LayoutDashboard }],
  },
  {
    name: "Messages",
    href: "/dashboard/messages",
    icon: Inbox,
    subItems: [{ name: "Communication Ledger", href: "/dashboard/messages", icon: Inbox }],
  },
  {
    name: "Notifications",
    href: "/dashboard/notifications",
    icon: Bell,
    subItems: [{ name: "Notification Center", href: "/dashboard/notifications", icon: Bell }],
  },
  {
    name: "CRM",
    href: "/dashboard/crm",
    icon: Briefcase,
    subItems: [
      { name: "Commercial Command", href: "/dashboard/crm", icon: BarChart },
      { name: "Leads", href: "/dashboard/crm/leads", icon: Target },
      { name: "Opportunities", href: "/dashboard/crm/opportunities", icon: Briefcase },
      { name: "Tenders & Bids", href: "/dashboard/crm/tenders", icon: Building2 },
      { name: "Organizations", href: "/dashboard/crm/organizations", icon: Handshake },
      { name: "Contacts", href: "/dashboard/crm/contacts", icon: Users },
      { name: "Subcontractors", href: "/dashboard/crm/subcontractors", icon: HardHat },
      { name: "Activities", href: "/dashboard/crm/activities", icon: MapPin },
      { name: "Documents", href: "/dashboard/crm/documents", icon: BookOpen },
      { name: "Sales Inbox", href: "/dashboard/crm/inbox", icon: Inbox },
      { name: "Automations", href: "/dashboard/crm/automations", icon: Zap },
    ],
  },
  {
    name: "Estimating & Quotations",
    href: "/dashboard/quotations",
    icon: FileText,
    subItems: [
      { name: "Overview Dashboard", href: "/dashboard/quotations", icon: LayoutDashboard },
      { name: "Quotation Builder", href: "/dashboard/quotations/builder", icon: FileText },
      { name: "Commercial Control Brain", href: "/dashboard/quotations/ccb", icon: BrainCircuit },
      { name: "Export & History", href: "/dashboard/quotations/history", icon: BookOpen },
    ],
  },
  {
    name: "Projects",
    href: "/dashboard/projects",
    icon: HardHat,
    subItems: [
      { name: "Overview", href: "/dashboard/projects/overview", icon: LayoutDashboard },
      { name: "Schedule", href: "/dashboard/projects/schedule", icon: Activity },
      { name: "Financials", href: "/dashboard/projects/financials", icon: DollarSign },
      { name: "Materials", href: "/dashboard/projects/materials", icon: Package },
    ],
  },
  {
    name: "Site Operations",
    href: "/dashboard/site-operations",
    icon: Activity,
    subItems: [{ name: "Daily Reports", href: "/dashboard/site-operations", icon: Activity }],
  },
  {
    name: "Workforce",
    href: "/dashboard/workforce",
    icon: Users,
    subItems: [{ name: "Overview", href: "/dashboard/workforce", icon: Users }],
  },
  {
    name: "Fleet",
    href: "/dashboard/fleet",
    icon: Truck,
    subItems: [{ name: "Overview", href: "/dashboard/fleet", icon: Truck }],
  },
  {
    name: "Equipment",
    href: "/dashboard/equipment",
    icon: Wrench,
    subItems: [{ name: "Overview", href: "/dashboard/equipment", icon: Wrench }],
  },
  {
    name: "Procurement",
    href: "/dashboard/procurement",
    icon: ShoppingCart,
    subItems: [
      { name: "Requisitions", href: "/dashboard/procurement/requisitions", icon: ClipboardCheck },
      { name: "RFQs", href: "/dashboard/procurement/rfqs", icon: Search },
      { name: "Purchase Orders", href: "/dashboard/procurement/purchase-orders", icon: ShoppingCart },
      { name: "Suppliers", href: "/dashboard/procurement/suppliers", icon: Package },
      { name: "Invoices", href: "/dashboard/procurement/invoices", icon: DollarSign },
    ],
  },
  {
    name: "Inventory",
    href: "/dashboard/inventory",
    icon: Package,
    subItems: [
      { name: "Stock Levels", href: "/dashboard/inventory/stock", icon: Package },
      { name: "Item Catalogue", href: "/dashboard/inventory/catalogue", icon: FileText },
      { name: "Stores", href: "/dashboard/inventory/stores", icon: Building2 },
      { name: "Movements", href: "/dashboard/inventory/movements", icon: Activity },
    ],
  },
  {
    name: "Finance",
    href: "/dashboard/finance",
    icon: DollarSign,
    subItems: [
      { name: "Project Financials", href: "/dashboard/finance/project-financials", icon: DollarSign },
      { name: "Cost Codes", href: "/dashboard/finance/cost-codes", icon: FileText },
      { name: "Variations", href: "/dashboard/finance/variations", icon: BarChart },
      { name: "Progress Claims", href: "/dashboard/finance/progress-claims", icon: ClipboardCheck },
      { name: "Budgets", href: "/dashboard/finance/budgets", icon: PieChart },
      { name: "Banking & Cash", href: "/dashboard/finance/banking", icon: Banknote },
      { name: "Cashbook", href: "/dashboard/finance/cashbook", icon: BookMarked },
      { name: "Supplier Payments", href: "/dashboard/finance/supplier-payments", icon: Receipt },
      { name: "Payroll", href: "/dashboard/finance/payroll", icon: Users },
    ],
  },
  {
    name: "HR",
    href: "/dashboard/hr",
    icon: UserCheck,
    subItems: [
      { name: "Employee Register", href: "/dashboard/hr/employees", icon: Users },
      { name: "Attendance Log", href: "/dashboard/hr/attendance", icon: Calendar },
      { name: "Leave Management", href: "/dashboard/hr/leave", icon: UserCheck },
      { name: "Payroll", href: "/dashboard/hr/payroll", icon: Banknote },
    ],
  },
  {
    name: "Compliance",
    href: "/dashboard/compliance",
    icon: ShieldCheck,
    subItems: [
      { name: "Obligation Register", href: "/dashboard/compliance/obligations", icon: ShieldCheck },
      { name: "Employee Credentials", href: "/dashboard/compliance/employees", icon: Users },
      { name: "Equipment Licenses", href: "/dashboard/compliance/equipment", icon: Wrench },
      { name: "Deployment Gates", href: "/dashboard/compliance/deployment-gates", icon: LockKeyhole },
      { name: "Corrective Actions", href: "/dashboard/compliance/corrective-actions", icon: ClipboardCheck },
      { name: "HSE Incidents", href: "/dashboard/compliance/incidents", icon: Activity },
    ],
  },
  {
    name: "Client Portal",
    href: "/dashboard/client-portal",
    icon: LockKeyhole,
    subItems: [{ name: "Overview", href: "/dashboard/client-portal", icon: LockKeyhole }],
  },
  {
    name: "Documents",
    href: "/dashboard/documents",
    icon: FileText,
    subItems: [{ name: "Overview", href: "/dashboard/documents", icon: FileText }],
  },
  {
    name: "Reports",
    href: "/dashboard/reports",
    icon: BarChart,
    subItems: [{ name: "Overview", href: "/dashboard/reports", icon: BarChart }],
  },
  {
    name: "Analytics",
    href: "/dashboard/analytics",
    icon: PieChart,
    subItems: [
      { name: "Project Margin Trends", href: "/dashboard/analytics/projects", icon: BarChart },
      { name: "Fleet Productivity", href: "/dashboard/analytics/equipment", icon: Truck },
      { name: "Spend & Supplier SLA", href: "/dashboard/analytics/procurement", icon: ShoppingCart },
      { name: "Labour Allocation", href: "/dashboard/analytics/workforce", icon: Users },
    ],
  },
  {
    name: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
    subItems: [
      { name: "Configuration", href: "/dashboard/settings/configuration", icon: Settings },
      { name: "Access Control", href: "/dashboard/settings/access", icon: LockKeyhole },
      { name: "Account Setup", href: "/dashboard/settings/accounts", icon: Building2 },
      { name: "Website Content", href: "/dashboard/settings/website", icon: FileText },
      { name: "Audit Log", href: "/dashboard/settings/audit", icon: ShieldCheck },
      { name: "My Profile", href: "/dashboard/profile", icon: User },
    ],
  },
];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, signOut } = useAuth();
  const [time, setTime] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [tourOpen, setTourOpen] = useState(false);
  const [tourReady, setTourReady] = useState(false);
  
  // Extract user info from session
  const userEmail = session?.user?.email || "System User";
  // Create a display name from email (e.g., admin@example.com -> Admin)
  const displayName = userEmail.split('@')[0].charAt(0).toUpperCase() + userEmail.split('@')[0].slice(1);
  const userRole = String(session?.user?.app_metadata?.role || session?.user?.user_metadata?.role || "Employee");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' }) + ' CAT');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const activeGroup = useMemo(
    () => MODULE_GROUPS.find((group) => pathname === group.href || pathname?.startsWith(`${group.href}/`)) ?? null,
    [pathname]
  );

  const tourStorageKey = session?.user?.id ? `aegis:onboarding:tour:${session.user.id}` : null;

  const closeTour = useCallback(() => {
    setTourOpen(false);
    if (tourStorageKey && typeof window !== "undefined") {
      window.localStorage.setItem(tourStorageKey, new Date().toISOString());
    }
  }, [tourStorageKey]);

  const openTour = useCallback(() => {
    setTourOpen(true);
  }, []);

  const completeTour = useCallback(async () => {
    const completedAt = new Date().toISOString();
    setTourOpen(false);
    if (tourStorageKey && typeof window !== "undefined") {
      window.localStorage.setItem(tourStorageKey, completedAt);
    }
    try {
      await updateMyProfile({ onboarding_completed_at: completedAt });
    } catch {
      // Local completion still prevents repeat prompts if the profile write fails.
    }
  }, [tourStorageKey]);

  useEffect(() => {
    if (!activeGroup) return;
    setOpenGroups((current) => ({ ...current, [activeGroup.name]: true }));
  }, [activeGroup]);

  useEffect(() => {
    if (!session || !pathname?.startsWith("/dashboard")) {
      setTourOpen(false);
      setTourReady(false);
      return;
    }

    let mounted = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await getMyProfile();
        const profile = response.data || {};
        const completed = Boolean(profile.onboarding_completed_at);
        const localCompleted = tourStorageKey ? Boolean(window.localStorage.getItem(tourStorageKey)) : false;
        if (mounted && !completed && !localCompleted) {
          setTourOpen(true);
        }
      } catch {
        const localCompleted = tourStorageKey ? Boolean(window.localStorage.getItem(tourStorageKey)) : false;
        if (mounted && !localCompleted) {
          setTourOpen(true);
        }
      } finally {
        if (mounted) {
          setTourReady(true);
        }
      }
    }, 700);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [pathname, session, tourStorageKey]);

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
          
          <div className="relative group" data-tour="dashboard-search">
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
          
          <NotificationBell />
          <PwaPushButton />

          <button
            type="button"
            onClick={openTour}
            className="text-slate hover:text-paper transition-colors"
            title="Replay onboarding tour"
            aria-label="Replay onboarding tour"
          >
            <CircleHelp className="w-5 h-5" />
          </button>
          
          <div className="font-mono text-data-sm text-slate-light tracking-widest">
            {time}
          </div>
          
          <div className="flex items-center space-x-3 border-l border-ink-mid pl-6 cursor-pointer group" data-tour="dashboard-profile">
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
          <nav className="flex-1 py-4 overflow-y-auto no-scrollbar flex flex-col px-3" data-tour="dashboard-nav">
            {MODULE_GROUPS.map((group) => {
              const isCurrent = pathname === group.href || pathname?.startsWith(`${group.href}/`);
              const isOpen = Boolean(openGroups[group.name] ?? isCurrent);

              return (
                <div key={group.name} className="mb-1">
                  <button
                    onClick={() => setOpenGroups((current) => ({ ...current, [group.name]: !isOpen }))}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                      isCurrent ? "text-signal bg-signal/5" : "text-slate-light hover:text-paper hover:bg-ink-light"
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <group.icon className={`w-4 h-4 ${isCurrent ? "text-signal" : "text-slate"}`} />
                      <span>{group.name}</span>
                    </div>
                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate" /> : <ChevronRight className="w-4 h-4 text-slate" />}
                  </button>

                  {isOpen && (
                    <div className="mt-1 flex flex-col space-y-1 relative before:absolute before:left-5 before:top-0 before:bottom-0 before:w-px before:bg-ink-mid">
                      {group.subItems.map((sub) => {
                        const isSubCurrent = pathname === sub.href || pathname?.startsWith(`${sub.href}/`);
                        return (
                          <Link
                            key={sub.name}
                            href={sub.href}
                            className={`flex items-center space-x-3 py-1.5 pl-10 pr-3 rounded-sm text-xs transition-colors relative ${
                              isSubCurrent
                                ? "text-paper bg-ink-light before:absolute before:left-[19px] before:top-1/2 before:-translate-y-1/2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-signal"
                                : "text-slate hover:text-paper hover:bg-ink-light/50"
                            }`}
                          >
                            <sub.icon className={`w-3.5 h-3.5 ${isSubCurrent ? "text-signal" : "text-slate-light"}`} />
                            <span>{sub.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
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
      <DashboardTour
        open={tourOpen && tourReady}
        onClose={closeTour}
        onComplete={completeTour}
      />
    </div>
  );
}
