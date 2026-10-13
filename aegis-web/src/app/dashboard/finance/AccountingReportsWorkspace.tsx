"use client";

import type React from "react";
import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  BookMarked,
  CheckCircle2,
  FileSearch,
  FileSpreadsheet,
  FolderLock,
  Info,
  Layers,
  Lock,
  PieChart,
  ShieldCheck,
  Table,
} from "lucide-react";
import { GeneralLedgerPanel } from "./GeneralLedgerPanel";
import { AuditWorkspacePanel } from "./AuditWorkspacePanel";
import { FinancialStatementsPanel } from "./FinancialStatementsPanel";
import { ManagementAccountsPanel } from "./ManagementAccountsPanel";
import { DepartmentTransfersPanel } from "./DepartmentTransfersPanel";
import { DataRoomPanel } from "./DataRoomPanel";

type RecordData = Record<string, any>;

export type AccountingSubTab = "gl" | "statements" | "close" | "transfers" | "data-room";
type GlSubMode = "ledger" | "audit";
type TransfersSubMode = "transfers" | "pnl";

interface AccountingReportsWorkspaceProps {
  initialSubTab?: AccountingSubTab;
  initialGlMode?: GlSubMode;
  initialTransfersMode?: TransfersSubMode;
  departments?: RecordData[];
  projects?: RecordData[];
  departmentPnl?: { departments: RecordData[]; consolidated: RecordData } | null;
}

const SUB_TABS: { id: AccountingSubTab; label: string; icon: any; description: string }[] = [
  {
    id: "gl",
    label: "GL & Audit Trail",
    icon: BookMarked,
    description: "Chart of accounts, journals, GL bridge proposals, periods, and audit drill-down",
  },
  {
    id: "statements",
    label: "Financial Statements",
    icon: FileSpreadsheet,
    description: "Income statement, balance sheet, cash movement, and trial balance",
  },
  {
    id: "close",
    label: "Month-End Close & Board Packs",
    icon: Lock,
    description: "Close readiness gates, management packs, period locking, and board exports",
  },
  {
    id: "transfers",
    label: "Transfers & Department P&L",
    icon: ArrowLeftRight,
    description: "Inter-department equipment/labor recharges and comparative departmental P&L",
  },
  {
    id: "data-room",
    label: "Data Room & Bankability",
    icon: ShieldCheck,
    description: "Audited financial statements, compliance dossier, and bankability reports",
  },
];

export function AccountingReportsWorkspace({
  initialSubTab = "gl",
  initialGlMode = "ledger",
  initialTransfersMode = "transfers",
  departments = [],
  projects = [],
  departmentPnl = null,
}: AccountingReportsWorkspaceProps) {
  const [activeSubTab, setActiveSubTab] = useState<AccountingSubTab>(initialSubTab);
  const [glMode, setGlMode] = useState<GlSubMode>(initialGlMode);
  const [transfersMode, setTransfersMode] = useState<TransfersSubMode>(initialTransfersMode);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const subtabParam = params.get("subtab");
      if (
        subtabParam &&
        (subtabParam === "gl" ||
          subtabParam === "statements" ||
          subtabParam === "close" ||
          subtabParam === "transfers" ||
          subtabParam === "data-room")
      ) {
        setActiveSubTab(subtabParam as AccountingSubTab);
      }
      const glModeParam = params.get("gl_mode");
      if (glModeParam === "ledger" || glModeParam === "audit") {
        setGlMode(glModeParam as GlSubMode);
      }
      const transfersModeParam = params.get("transfers_mode");
      if (transfersModeParam === "transfers" || transfersModeParam === "pnl") {
        setTransfersMode(transfersModeParam as TransfersSubMode);
      }
    }
  }, []);

  const handleTabChange = (tabId: AccountingSubTab) => {
    setActiveSubTab(tabId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("subtab", tabId);
      window.history.replaceState({}, "", url.toString());
    }
  };

  const handleGlModeChange = (mode: GlSubMode) => {
    setGlMode(mode);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("gl_mode", mode);
      window.history.replaceState({}, "", url.toString());
    }
  };

  const handleTransfersModeChange = (mode: TransfersSubMode) => {
    setTransfersMode(mode);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("transfers_mode", mode);
      window.history.replaceState({}, "", url.toString());
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-ink-light border border-ink-mid rounded-lg p-5 shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest bg-lime-400/10 text-lime-400 border border-lime-400/20">
                Hub 5 · GL &amp; Reports
              </span>
              <span className="text-xs text-slate font-mono">SNC Accounting &amp; Governance</span>
            </div>
            <h2 className="text-lg font-semibold text-paper mt-1 tracking-tight">
              General Ledger, Statements &amp; Month-End Close
            </h2>
            <p className="text-xs text-slate-light mt-0.5 max-w-2xl">
              Authoritative double-entry ledger, GL bridge proposal approvals, statutory financial statements,
              close readiness gates, and board management packs.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-center">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-ink border border-ink-mid text-xs font-mono text-slate">
              <Info className="h-3.5 w-3.5 text-signal" />
              <span>Strict period gates: locked periods prevent post-dated journal mutation</span>
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

      {/* GL Sub-mode switcher */}
      {activeSubTab === "gl" && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-ink-light/70 border border-ink-mid px-4 py-2.5 rounded-md">
          <div className="flex items-center gap-2 text-xs font-mono text-slate">
            <Layers className="h-4 w-4 text-signal" />
            <span className="uppercase tracking-wider">General Ledger View:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleGlModeChange("ledger")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors border ${
                glMode === "ledger"
                  ? "bg-signal/20 text-signal border-signal/50 font-medium"
                  : "bg-ink border-ink-mid text-slate hover:text-paper"
              }`}
            >
              <BookMarked className="h-3.5 w-3.5" />
              <span>GL &amp; Bridge Proposals</span>
            </button>
            <button
              onClick={() => handleGlModeChange("audit")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors border ${
                glMode === "audit"
                  ? "bg-signal/20 text-signal border-signal/50 font-medium"
                  : "bg-ink border-ink-mid text-slate hover:text-paper"
              }`}
            >
              <FileSearch className="h-3.5 w-3.5" />
              <span>Audit Trail Drill-Down</span>
            </button>
          </div>
        </div>
      )}

      {/* Transfers Sub-mode switcher */}
      {activeSubTab === "transfers" && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-ink-light/70 border border-ink-mid px-4 py-2.5 rounded-md">
          <div className="flex items-center gap-2 text-xs font-mono text-slate">
            <Layers className="h-4 w-4 text-signal" />
            <span className="uppercase tracking-wider">Department Mode:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleTransfersModeChange("transfers")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors border ${
                transfersMode === "transfers"
                  ? "bg-signal/20 text-signal border-signal/50 font-medium"
                  : "bg-ink border-ink-mid text-slate hover:text-paper"
              }`}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              <span>Internal Transfers Workflow</span>
            </button>
            <button
              onClick={() => handleTransfersModeChange("pnl")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors border ${
                transfersMode === "pnl"
                  ? "bg-signal/20 text-signal border-signal/50 font-medium"
                  : "bg-ink border-ink-mid text-slate hover:text-paper"
              }`}
            >
              <PieChart className="h-3.5 w-3.5" />
              <span>Department P&amp;L Performance</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Body */}
      <div>
        {activeSubTab === "gl" && glMode === "ledger" && <GeneralLedgerPanel />}

        {activeSubTab === "gl" && glMode === "audit" && <AuditWorkspacePanel />}

        {activeSubTab === "statements" && <FinancialStatementsPanel />}

        {activeSubTab === "close" && <ManagementAccountsPanel />}

        {activeSubTab === "transfers" && transfersMode === "transfers" && (
          <DepartmentTransfersPanel
            mode="transfers"
            departments={departments}
            projects={projects}
          />
        )}

        {activeSubTab === "transfers" && transfersMode === "pnl" && (
          <DepartmentTransfersPanel
            mode="pnl"
            departments={departments}
            projects={projects}
            departmentPnl={departmentPnl}
          />
        )}

        {activeSubTab === "data-room" && <DataRoomPanel />}
      </div>
    </div>
  );
}
