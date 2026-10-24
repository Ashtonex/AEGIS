"use client";

import type React from "react";
import { useEffect, useState } from "react";
import {
  Banknote,
  BookOpen,
  CheckCircle2,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Info,
  Layers,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { FinanceOperationsPanel } from "./FinanceOperationsPanel";
import { BankStatementReviewPanel } from "./BankStatementReviewPanel";
import { CashForecastPanel } from "./CashForecastPanel";

type RecordData = Record<string, any>;

export type TreasurySubTab = "accounts" | "reconciliation" | "cashbook" | "forecast";
type ReconciliationSubMode = "matching" | "tagging";

interface TreasuryBankingWorkspaceProps {
  initialSubTab?: TreasurySubTab;
  projects: RecordData[];
  departmentId?: string;
}

const SUB_TABS: { id: TreasurySubTab; label: string; icon: any; description: string }[] = [
  {
    id: "accounts",
    label: "Bank & Cash Accounts",
    icon: CreditCard,
    description: "Account balances, new accounts, and cashbook voucher posting",
  },
  {
    id: "reconciliation",
    label: "Statement Reconciliation",
    icon: FileSpreadsheet,
    description: "3-way statement matching, CSV/PDF imports, and project cost tagging",
  },
  {
    id: "cashbook",
    label: "Cashbook Ledger",
    icon: BookOpen,
    description: "Complete chronological transaction ledger and client receipt allocations",
  },
  {
    id: "forecast",
    label: "13-Week Cash Forecast",
    icon: TrendingUp,
    description: "Projected liquidity horizons, committed purchase orders, and delay assumptions",
  },
];

export function TreasuryBankingWorkspace({
  initialSubTab = "accounts",
  projects,
  departmentId = "",
}: TreasuryBankingWorkspaceProps) {
  const [activeSubTab, setActiveSubTab] = useState<TreasurySubTab>(initialSubTab);
  const [reconcileMode, setReconcileMode] = useState<ReconciliationSubMode>("matching");

  // Read URL search params on mount if available (e.g. ?subtab=cashbook)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const subtabParam = params.get("subtab");
      if (
        subtabParam &&
        (subtabParam === "accounts" ||
          subtabParam === "reconciliation" ||
          subtabParam === "cashbook" ||
          subtabParam === "forecast")
      ) {
        setActiveSubTab(subtabParam as TreasurySubTab);
      }
      const modeParam = params.get("mode");
      if (modeParam === "matching" || modeParam === "tagging") {
        setReconcileMode(modeParam as ReconciliationSubMode);
      }
    }
  }, []);

  // Update URL search query without full reload
  const handleTabChange = (tabId: TreasurySubTab) => {
    setActiveSubTab(tabId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("subtab", tabId);
      window.history.replaceState({}, "", url.toString());
    }
  };

  const handleModeChange = (mode: ReconciliationSubMode) => {
    setReconcileMode(mode);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", mode);
      window.history.replaceState({}, "", url.toString());
    }
  };

  return (
    <div className="space-y-6">
      {/* Treasury Header Card */}
      <div className="bg-ink-light border border-ink-mid rounded-lg p-5 shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest bg-lime-400/10 text-lime-400 border border-lime-400/20">
                Hub 3 · Treasury &amp; Banking
              </span>
              <span className="text-xs text-slate font-mono">SNC Multi-Currency Treasury</span>
            </div>
            <h2 className="text-lg font-semibold text-paper mt-1 tracking-tight">
              Treasury &amp; Banking Engine
            </h2>
            <p className="text-xs text-slate-light mt-0.5 max-w-2xl">
              Unified cash management, automated 3-way bank statement matching, AI-assisted project tagging,
              and 13-week cash liquidity forecasting.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-center">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-ink border border-ink-mid text-xs font-mono text-slate">
              <Info className="h-3.5 w-3.5 text-signal" />
              <span>Double-entry protected: bank tags do not create ghost cashbook postings</span>
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

      {/* Reconciliation Sub-mode switcher (visible only on reconciliation tab) */}
      {activeSubTab === "reconciliation" && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-ink-light/70 border border-ink-mid px-4 py-2.5 rounded-md">
          <div className="flex items-center gap-2 text-xs font-mono text-slate">
            <Layers className="h-4 w-4 text-signal" />
            <span className="uppercase tracking-wider">Reconciliation Mode:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleModeChange("matching")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors border ${
                reconcileMode === "matching"
                  ? "bg-signal/20 text-signal border-signal/50 font-medium"
                  : "bg-ink border-ink-mid text-slate hover:text-paper"
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>3-Way Bank Matching (CSV)</span>
            </button>
            <button
              onClick={() => handleModeChange("tagging")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors border ${
                reconcileMode === "tagging"
                  ? "bg-signal/20 text-signal border-signal/50 font-medium"
                  : "bg-ink border-ink-mid text-slate hover:text-paper"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Smart Tagging &amp; Rule Engine</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Body */}
      <div>
        {activeSubTab === "accounts" && (
          <FinanceOperationsPanel
            tab="cash-accounts"
            projects={projects}
            departmentId={departmentId}
          />
        )}

        {activeSubTab === "reconciliation" && reconcileMode === "matching" && (
          <FinanceOperationsPanel
            tab="banking"
            projects={projects}
            departmentId={departmentId}
          />
        )}

        {activeSubTab === "reconciliation" && reconcileMode === "tagging" && (
          <BankStatementReviewPanel projects={projects} />
        )}

        {activeSubTab === "cashbook" && (
          <FinanceOperationsPanel
            tab="cashbook"
            projects={projects}
            departmentId={departmentId}
          />
        )}

        {activeSubTab === "forecast" && <CashForecastPanel />}
      </div>
    </div>
  );
}
