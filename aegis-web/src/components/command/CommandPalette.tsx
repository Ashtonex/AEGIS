"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Briefcase,
  Layers,
  Users,
  DollarSign,
  FileText,
  ShieldCheck,
  Truck,
  PlusCircle,
  ExternalLink,
  Clock,
  HardHat,
  X,
  CornerDownLeft,
} from "lucide-react";

interface CommandItem {
  id: string;
  category: "Actions" | "Projects" | "Commercial & Supply" | "People & HR" | "Finance & Controls";
  label: string;
  sublabel?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  shortcut?: string;
}

const DEFAULT_COMMANDS: CommandItem[] = [
  // Fast Actions
  {
    id: "action-new-requisition",
    category: "Actions",
    label: "Create Purchase Requisition",
    sublabel: "Start a new material or equipment order request",
    href: "/dashboard/procurement?action=new-requisition",
    icon: PlusCircle,
    badge: "Procurement",
  },
  {
    id: "action-clock-in",
    category: "Actions",
    label: "Register Site Attendance / Clock In",
    sublabel: "Clock in daily site crew or project hires",
    href: "/dashboard/site-operations?action=clock-in",
    icon: HardHat,
    badge: "Site Ops",
  },
  {
    id: "action-log-incident",
    category: "Actions",
    label: "Log Safety Incident / Near Miss",
    sublabel: "Submit HSE site inspection or safety record",
    href: "/dashboard/hse?action=new-incident",
    icon: ShieldCheck,
    badge: "HSE",
  },
  {
    id: "action-new-quote",
    category: "Actions",
    label: "Generate New Client Quotation",
    sublabel: "Build an estimate or rate analysis",
    href: "/dashboard/quotations",
    icon: FileText,
    badge: "Commercial",
  },

  // Projects
  {
    id: "nav-projects",
    category: "Projects",
    label: "Project Portfolio & Execution",
    sublabel: "Master project list, delivery milestones, budgets",
    href: "/dashboard/projects",
    icon: Briefcase,
  },
  {
    id: "nav-site-day",
    category: "Projects",
    label: "Site Day Register & Daily Briefings",
    sublabel: "Live morning briefings, shift hours, daily targets",
    href: "/dashboard/site-operations",
    icon: Clock,
  },
  {
    id: "nav-drawings",
    category: "Projects",
    label: "Technical Drawings & Take-Offs",
    sublabel: "Architectural blueprints and BOQ extraction",
    href: "/dashboard/drawings",
    icon: Layers,
  },

  // Commercial & Supply
  {
    id: "nav-procurement",
    category: "Commercial & Supply",
    label: "Procurement & Purchase Orders",
    sublabel: "Requisitions, supplier POs, approval queues",
    href: "/dashboard/procurement",
    icon: Layers,
  },
  {
    id: "nav-inventory",
    category: "Commercial & Supply",
    label: "Inventory & Warehouse Stores",
    sublabel: "Stock levels, issue logs, asset allocations",
    href: "/dashboard/inventory",
    icon: Layers,
  },
  {
    id: "nav-fleet",
    category: "Commercial & Supply",
    label: "Plant & Heavy Equipment Fleet",
    sublabel: "Asset telematics, maintenance runs, fuel logs",
    href: "/dashboard/fleet",
    icon: Truck,
  },
  {
    id: "nav-tenders",
    category: "Commercial & Supply",
    label: "Tenders & Bidding Matrix",
    sublabel: "Public and private tender submissions",
    href: "/dashboard/tenders",
    icon: FileText,
  },

  // People & HR
  {
    id: "nav-workforce",
    category: "People & HR",
    label: "Staff & Workforce Directory",
    sublabel: "Permanent personnel, site contractors, roles",
    href: "/dashboard/workforce",
    icon: Users,
  },
  {
    id: "nav-leave",
    category: "People & HR",
    label: "Leave Applications & Approvals",
    sublabel: "Staff leave calendar, medical, entitlement",
    href: "/dashboard/hr/leave",
    icon: Users,
  },
  {
    id: "nav-payroll",
    category: "People & HR",
    label: "Site Payroll Runs & Compensation",
    sublabel: "Verified time entries and wage runs",
    href: "/dashboard/payroll",
    icon: DollarSign,
  },

  // Finance & Controls
  {
    id: "nav-executive",
    category: "Finance & Controls",
    label: "Executive Command Center",
    sublabel: "Company KPI health, exceptions, variance radar",
    href: "/dashboard/executive",
    icon: Briefcase,
  },
  {
    id: "nav-cash-flow",
    category: "Finance & Controls",
    label: "Cash Flow Forecasting & Bank Curves",
    sublabel: "13-week cash position and revenue reconciliation",
    href: "/dashboard/cash-flow",
    icon: DollarSign,
  },
  {
    id: "nav-general-ledger",
    category: "Finance & Controls",
    label: "General Ledger & Chart of Accounts",
    sublabel: "Statutory journals, double-entry trial balance",
    href: "/dashboard/general-ledger",
    icon: DollarSign,
  },
  {
    id: "nav-data-room",
    category: "Finance & Controls",
    label: "Financial Data Room & Compliance Vault",
    sublabel: "Verified audit packages and corporate credentials",
    href: "/dashboard/data-room",
    icon: ShieldCheck,
  },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut (Cmd+K / Ctrl+K)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === "Escape" && open) {
        e.preventDefault();
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Filter commands
  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DEFAULT_COMMANDS;

    return DEFAULT_COMMANDS.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        (cmd.sublabel && cmd.sublabel.toLowerCase().includes(q)) ||
        cmd.category.toLowerCase().includes(q) ||
        (cmd.badge && cmd.badge.toLowerCase().includes(q))
    );
  }, [query]);

  // Group by category
  const categories = useMemo(() => {
    const groups: { [key: string]: CommandItem[] } = {};
    for (const item of filteredCommands) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return groups;
  }, [filteredCommands]);

  const handleSelect = useCallback(
    (item: CommandItem) => {
      onOpenChange(false);
      router.push(item.href);
    },
    [onOpenChange, router]
  );

  // Keyboard navigation within results
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
    } else if (e.key === "Enter" && filteredCommands[selectedIndex]) {
      e.preventDefault();
      handleSelect(filteredCommands[selectedIndex]);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity animate-in fade-in"
        onClick={() => onOpenChange(false)}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-2xl border border-ink-mid bg-ink-light shadow-2xl overflow-hidden rounded-md animate-in zoom-in-95 duration-150">
        {/* Search Input Bar */}
        <div className="flex items-center border-b border-ink-mid px-4 py-3 bg-ink">
          <Search className="h-5 w-5 text-signal shrink-0 mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search modules, projects, requisitions, or quick actions..."
            className="w-full bg-transparent text-sm text-paper placeholder-slate focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-slate hover:text-paper p-1 mr-2"
              aria-label="Clear query"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <span className="hidden sm:inline-flex items-center rounded border border-ink-mid px-1.5 py-0.5 text-[10px] font-mono text-slate-light">
            ESC
          </span>
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-2 divide-y divide-ink-mid/30">
          {filteredCommands.length === 0 ? (
            <div className="py-12 text-center">
              <Search className="mx-auto h-8 w-8 text-slate/50 mb-3" />
              <p className="text-sm font-medium text-paper">No results found for &ldquo;{query}&rdquo;</p>
              <p className="text-xs text-slate-light mt-1">Try searching for a project name, requisition, staff member, or module.</p>
            </div>
          ) : (
            Object.entries(categories).map(([category, items]) => (
              <div key={category} className="py-2 first:pt-0 last:pb-0">
                <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-slate-light font-semibold">
                  {category}
                </div>
                <div className="space-y-0.5 mt-1">
                  {items.map((item) => {
                    const globalIdx = filteredCommands.indexOf(item);
                    const isSelected = globalIdx === selectedIndex;
                    const IconComponent = item.icon;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelect(item)}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                        className={`w-full flex items-center justify-between rounded px-3 py-2 text-left text-xs transition-colors ${
                          isSelected ? "bg-signal/15 text-paper border border-signal/40" : "text-paper hover:bg-white/5 border border-transparent"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`p-1.5 rounded border shrink-0 ${
                              isSelected
                                ? "bg-signal/20 border-signal/40 text-signal"
                                : "bg-ink border-ink-mid text-slate-light"
                            }`}
                          >
                            <IconComponent className="h-4 w-4" />
                          </div>
                          <div className="truncate">
                            <p className="font-medium text-paper tracking-tight">{item.label}</p>
                            {item.sublabel && <p className="text-[11px] text-slate-light truncate">{item.sublabel}</p>}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          {item.badge && (
                            <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-ink-mid text-slate-light bg-ink">
                              {item.badge}
                            </span>
                          )}
                          {isSelected && <CornerDownLeft className="h-3.5 w-3.5 text-signal" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="flex items-center justify-between border-t border-ink-mid bg-ink/80 px-4 py-2 text-[11px] text-slate font-mono">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded border border-ink-mid px-1 py-0.5 text-[9px] bg-ink text-slate-light">↑</kbd>{" "}
              <kbd className="rounded border border-ink-mid px-1 py-0.5 text-[9px] bg-ink text-slate-light">↓</kbd> to navigate
            </span>
            <span>
              <kbd className="rounded border border-ink-mid px-1 py-0.5 text-[9px] bg-ink text-slate-light">↵</kbd> to select
            </span>
          </div>
          <span className="hidden sm:inline">Six Nine Construction &bull; AEGIS ERP</span>
        </div>
      </div>
    </div>
  );
}
