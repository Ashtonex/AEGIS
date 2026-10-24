"use client";

import type React from "react";
import { useEffect, useState } from "react";
import {
  Building2,
  CalendarCheck,
  CreditCard,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Info,
  Layers,
  Scale,
  Users,
  Wallet,
} from "lucide-react";
import { SupplierPaymentsPanel } from "./SupplierPaymentsPanel";
import { VendorPaymentsPanel } from "./VendorPaymentsPanel";
import { PayrollPanel } from "./PayrollPanel";
import { StatutoryPanel } from "./StatutoryPanel";

type RecordData = Record<string, any>;

export type PayablesSubTab = "payables" | "payroll" | "statutory";
export type PayablesMode = "procurement" | "subcontractor";

interface PayablesPayrollWorkspaceProps {
  initialSubTab?: PayablesSubTab;
  initialPayablesMode?: PayablesMode;
  projects?: RecordData[];
  departmentId?: string;
}

const SUB_TABS: { id: PayablesSubTab; label: string; icon: any; description: string }[] = [
  {
    id: "payables",
    label: "Unified Payables",
    icon: CreditCard,
    description: "PO-matched AP aging, batch settlement, and subcontractor portal requests",
  },
  {
    id: "payroll",
    label: "Payroll & Site Wages",
    icon: Users,
    description: "Staff monthly/hourly profiles, approved payroll runs, and casual site wage sheets",
  },
  {
    id: "statutory",
    label: "Statutory & Tax (ZIMRA / NSSA)",
    icon: Scale,
    description: "VAT net position, PAYE, AIDS Levy, NSSA employer/employee, and fiscalization",
  },
];

export function PayablesPayrollWorkspace({
  initialSubTab = "payables",
  initialPayablesMode = "procurement",
  projects = [],
  departmentId = "",
}: PayablesPayrollWorkspaceProps) {
  const [activeSubTab, setActiveSubTab] = useState<PayablesSubTab>(initialSubTab);
  const [payablesMode, setPayablesMode] = useState<PayablesMode>(initialPayablesMode);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const subtabParam = params.get("subtab");
      if (
        subtabParam &&
        (subtabParam === "payables" || subtabParam === "payroll" || subtabParam === "statutory")
      ) {
        setActiveSubTab(subtabParam as PayablesSubTab);
      }
      const modeParam = params.get("mode");
      if (modeParam === "procurement" || modeParam === "subcontractor") {
        setPayablesMode(modeParam as PayablesMode);
      }
    }
  }, []);

  const handleTabChange = (tabId: PayablesSubTab) => {
    setActiveSubTab(tabId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("subtab", tabId);
      window.history.replaceState({}, "", url.toString());
    }
  };

  const handleModeChange = (mode: PayablesMode) => {
    setPayablesMode(mode);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", mode);
      window.history.replaceState({}, "", url.toString());
    }
  };

  return (
    <div className="space-y-6">
      {/* Payables & Payroll Header Card */}
      <div className="bg-ink-light border border-ink-mid rounded-lg p-5 shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest bg-lime-400/10 text-lime-400 border border-lime-400/20">
                Hub 4 · Payables &amp; Payroll
              </span>
              <span className="text-xs text-slate font-mono">SNC Disbursements &amp; Obligations</span>
            </div>
            <h2 className="text-lg font-semibold text-paper mt-1 tracking-tight">
              Payables, Payroll &amp; Statutory Command Center
            </h2>
            <p className="text-xs text-slate-light mt-0.5 max-w-2xl">
              Consolidated procurement supplier payments, subcontractor portal payment claims, staff &amp;
              site payroll runs, and ZIMRA/NSSA statutory obligations.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-center">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-ink border border-ink-mid text-xs font-mono text-slate">
              <Info className="h-3.5 w-3.5 text-signal" />
              <span>3-Way PO matching clears open commitments upon payment batch</span>
            </div>
          </div>
        </div>

        {/* Sub-navigation Tabs */}
        <div className="mt-5 pt-4 border-t border-ink-mid flex flex-wrap gap-2">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-sm text-xs font-mono uppercase tracking-wider transition-colors border ${
                  isActive
                    ? "bg-signal text-ink border-signal font-semibold shadow-sm"
                    : "border-ink-mid bg-ink/40 text-slate hover:text-paper hover:border-signal/40"
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? "text-ink" : "text-slate"}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Payables Sub-mode Switcher (visible only on payables tab) */}
      {activeSubTab === "payables" && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-ink-light/70 border border-ink-mid px-4 py-2.5 rounded-md">
          <div className="flex items-center gap-2 text-xs font-mono text-slate">
            <Layers className="h-4 w-4 text-signal" />
            <span className="uppercase tracking-wider">Payables Source Type:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleModeChange("procurement")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors border ${
                payablesMode === "procurement"
                  ? "bg-signal/20 text-signal border-signal/50 font-medium"
                  : "bg-ink border-ink-mid text-slate hover:text-paper"
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Procurement Invoices (3-Way Matched)</span>
            </button>
            <button
              onClick={() => handleModeChange("subcontractor")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors border ${
                payablesMode === "subcontractor"
                  ? "bg-signal/20 text-signal border-signal/50 font-medium"
                  : "bg-ink border-ink-mid text-slate hover:text-paper"
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>Subcontractor Portal Requests</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Panel Body */}
      <div>
        {activeSubTab === "payables" && payablesMode === "procurement" && (
          <SupplierPaymentsPanel />
        )}

        {activeSubTab === "payables" && payablesMode === "subcontractor" && (
          <VendorPaymentsPanel />
        )}

        {activeSubTab === "payroll" && (
          <PayrollPanel projects={projects} departmentId={departmentId} />
        )}

        {activeSubTab === "statutory" && <StatutoryPanel />}
      </div>
    </div>
  );
}
