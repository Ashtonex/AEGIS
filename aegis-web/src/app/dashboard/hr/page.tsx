"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Loader2 } from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { getHROperationsSummary } from "@/lib/api";

// Only the active tab's panel ships to the browser instead of all at once.
function PanelLoading() {
  return <Skeleton className="h-64 w-full" />;
}
const VendorVerificationPanel = dynamic(() => import("./VendorVerificationPanel").then((m) => m.VendorVerificationPanel), { loading: PanelLoading });
const OrgChartTabs = dynamic(() => import("./OrgChartTabs").then((m) => m.OrgChartTabs), { loading: PanelLoading });
const HRFilesPage = dynamic(() => import("./HRFilesPage").then((m) => m.HRFilesPage), { loading: PanelLoading });
const HRAttendancePage = dynamic(() => import("./HRAttendancePage").then((m) => m.HRAttendancePage), { loading: PanelLoading });
const PerformancePanel = dynamic(() => import("./PerformancePanel").then((m) => m.PerformancePanel), { loading: PanelLoading });
const HRHome = dynamic(() => import("./HRHome").then((m) => m.HRHome), { loading: PanelLoading });
const HREmployeeRegister = dynamic(() => import("./HREmployeeRegister").then((m) => m.HREmployeeRegister), { loading: PanelLoading });
const HRLeavePage = dynamic(() => import("./HRLeavePage").then((m) => m.HRLeavePage), { loading: PanelLoading });
const OperationList = dynamic(() => import("./HRTabPanels").then((m) => m.OperationList), { loading: PanelLoading });
const RecruitmentAssessmentsPanel = dynamic(() => import("./RecruitmentAssessmentsPanel").then((m) => m.RecruitmentAssessmentsPanel), { loading: PanelLoading });

type RecordData = Record<string, any>;
type HRTab = "home" | "employees" | "recruitment" | "documents" | "credentials" | "performance" | "assets" | "training" | "org-chart" | "planning" | "attendance" | "leave" | "payroll" | "vendor-verification";

const TAB_ROUTES: Record<HRTab, string> = {
  home: "/dashboard/hr",
  employees: "/dashboard/hr/employees",
  recruitment: "/dashboard/hr/recruitment",
  documents: "/dashboard/hr/documents",
  credentials: "/dashboard/hr/credentials",
  performance: "/dashboard/hr/performance",
  assets: "/dashboard/hr/assets",
  training: "/dashboard/hr/training",
  "org-chart": "/dashboard/hr/org-chart",
  planning: "/dashboard/hr/planning",
  attendance: "/dashboard/hr/attendance",
  leave: "/dashboard/hr/leave",
  payroll: "/dashboard/hr/payroll",
  "vendor-verification": "/dashboard/hr/vendor-verification",
};

const HR_TAB_LABELS: Record<HRTab, string> = {
  home: "HR Dashboard",
  employees: "Employee Register",
  recruitment: "Recruitment",
  documents: "Contracts & Docs",
  credentials: "Credentials",
  performance: "Performance",
  assets: "Assets",
  training: "Training Matrix",
  "org-chart": "Org Chart",
  planning: "Workforce Planning",
  attendance: "Attendance",
  leave: "Leave Management",
  payroll: "Payroll",
  "vendor-verification": "Vendor Verification",
};

function textValue(value: unknown, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function dateValue(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function statusClass(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (["active", "present", "verified"].includes(normalized)) {
    return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  }
  if (["on_leave", "leave", "submitted", "pending"].includes(normalized)) {
    return "border-blue-500/30 bg-blue-950/20 text-blue-300";
  }
  if (["suspended", "late", "expired"].includes(normalized)) {
    return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  }
  if (["terminated", "absent", "rejected"].includes(normalized)) {
    return "border-red-500/30 bg-red-950/20 text-red-300";
  }
  return "border-slate-500/30 bg-slate-950/20 text-slate-300";
}

function loadFailureMessage(reason: unknown) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  const normalizedMessage = rawMessage.toLowerCase();
  if (
    normalizedMessage.includes("signal is aborted") ||
    normalizedMessage.includes("operation was aborted") ||
    normalizedMessage.includes("aborterror") ||
    normalizedMessage.includes("timeouterror")
  ) {
    return "The HR feed is still synchronizing. Please retry once the connection is ready.";
  }
  return "Failed to load HR Workspace data.";
}

export default function HRDashboard() {
  return <HRPage initialTab="home" />;
}

/** One-line description per page instead of the same subtitle everywhere. */
const HR_TAB_SUBTITLES: Partial<Record<HRTab, string>> = {
  recruitment: "Candidates, their assessment scores and onboarding tasks.",
  documents: "Employment contracts and employee documents with expiry dates.",
  credentials: "Certifications, licences, medicals and inductions per employee.",
  performance: "Weekly graded scorecards from AEGIS activity, assisted working periods, reviews and disciplinary records.",
  assets: "PPE, tools, vehicles and equipment issued to employees.",
  training: "Training required per role and project, and who has it.",
  "org-chart": "The group and management structure, and who reports to whom.",
  planning: "Headcount needed per project and site against people assigned.",
  attendance: "Daily check-in and check-out per employee.",
  leave: "How many days each person was away, plus leave requests, approvals and the calendar.",
  payroll: "PAYE, NSSA, loans, advances and other payroll adjustments.",
  "vendor-verification": "Suppliers and subcontractors awaiting verification.",
};

/** Shared HR workspace, rendered by a real route per tab (see the sibling
 * folders here) instead of the old hr/[tab] -> redirect() -> ?tab= shim. */
export function HRPage({ initialTab }: { initialTab: HRTab }) {
  return (
    <RBACGuard>
      {initialTab === "home" ? <HRHome />
        : initialTab === "employees" ? <HREmployeeRegister />
        : initialTab === "documents" || initialTab === "credentials" || initialTab === "assets" ? <HRFilesPage kind={initialTab === "documents" ? "contracts" : initialTab} />
        : initialTab === "attendance" ? <HRAttendancePage />
        : initialTab === "leave" ? <HRLeavePage />
        : <HRWorkspace initialTab={initialTab} />}
    </RBACGuard>
  );
}

function HRWorkspace({ initialTab }: { initialTab: HRTab }) {
  const activeTab = initialTab;
  const [operations, setOperations] = useState<RecordData>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  const needsOperations = activeTab !== "vendor-verification";

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [opsRes] = await Promise.allSettled([
        needsOperations ? getHROperationsSummary() : Promise.resolve({ data: {} as RecordData }),
      ]);
      const warnings: string[] = [];
      if (opsRes.status === "fulfilled") setOperations(opsRes.value.data || {});
      else warnings.push("HR operating layer could not be loaded.");
      setSourceWarnings(warnings);
    } catch (err) {
      setError(loadFailureMessage(err));
    } finally {
      setLoading(false);
    }
  }, [needsOperations]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center bg-ink">
        <Loader2 className="h-8 w-8 animate-spin text-signal" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <div>
            <p className="font-semibold">HR data could not be loaded.</p>
            <p className="mt-1 text-red-100/80">{error}</p>
          </div>
        </div>
      )}
      {sourceWarnings.length > 0 && (
        <div className="space-y-2 rounded border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          {sourceWarnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p>{warning}</p>
            </div>
          ))}
        </div>
      )}

      <DashboardPageHeader
        title={HR_TAB_LABELS[activeTab]}
        subtitle={HR_TAB_SUBTITLES[activeTab]}
      />

      {activeTab === "vendor-verification" && (
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
          <VendorVerificationPanel />
        </div>
      )}

      <div className="space-y-6">
          {activeTab === "payroll" && (
            <OperationList
              title="Payroll statutory compliance"
              rows={operations.payroll_adjustments || []}
              columns={["employee_name", "adjustment_type", "description", "amount", "balance", "status"]}
              empty="No PAYE, NSSA, deduction, loan or advance adjustments have been recorded."
            />
          )}

          {activeTab === "recruitment" && (
            <div className="space-y-6">
              <RecruitmentAssessmentsPanel onImported={() => void loadData()} />
              <OperationList title="Recruitment and onboarding pipeline" rows={[...(operations.recruitment || []), ...(operations.onboarding || [])]} columns={["candidate_name", "employee_name", "role_applied_for", "task_name", "stage", "status", "due_date"]} empty="No recruitment candidates or onboarding tasks have been recorded." />
            </div>
          )}
          {activeTab === "performance" && <PerformancePanel />}
          {activeTab === "performance" && (
            <OperationList title="Performance reviews and disciplinary records" rows={[...(operations.performance || []), ...(operations.discipline || [])]} columns={["employee_name", "outcome", "rating", "next_review_date", "category", "severity", "status"]} empty="No performance reviews or disciplinary records have been recorded." />
          )}
          {activeTab === "training" && (
            <OperationList title="Training matrix by role and project" rows={operations.training || []} columns={["role_name", "training_name", "project_name", "mandatory", "employees_in_role", "current_records"]} empty="No training requirements have been recorded." />
          )}
          {activeTab === "org-chart" && (
            // "Org chart and reporting lines": drawn organograms plus the line-manager tree.
            <OrgChartTabs />
          )}
          {activeTab === "planning" && (
            <OperationList title="Workforce planning by project and site" rows={operations.workforce_plans || []} columns={["project_name", "role_name", "required_headcount", "assigned_count", "shortfall", "status", "planned_start"]} empty="No workforce plans have been recorded." />
          )}
      </div>

    </div>
  );
}
