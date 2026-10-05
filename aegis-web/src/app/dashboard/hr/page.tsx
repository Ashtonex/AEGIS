"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Loader2, Plus, X } from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  getHREmployees,
  getHRLeaveRequests,
  createHRLeaveRequest,
  approveHRLeaveRequest,
  getHROperationsSummary
} from "@/lib/api";

// Only the active tab's panel ships to the browser instead of all at once.
function PanelLoading() {
  return <Skeleton className="h-64 w-full" />;
}
const VendorVerificationPanel = dynamic(() => import("./VendorVerificationPanel").then((m) => m.VendorVerificationPanel), { loading: PanelLoading });
const OrgChartTabs = dynamic(() => import("./OrgChartTabs").then((m) => m.OrgChartTabs), { loading: PanelLoading });
const HRFilesPage = dynamic(() => import("./HRFilesPage").then((m) => m.HRFilesPage), { loading: PanelLoading });
const HRAttendancePage = dynamic(() => import("./HRAttendancePage").then((m) => m.HRAttendancePage), { loading: PanelLoading });
const AbsencePanel = dynamic(() => import("./HRAttendancePage").then((m) => m.AbsencePanel), { loading: PanelLoading });
const HRHome = dynamic(() => import("./HRHome").then((m) => m.HRHome), { loading: PanelLoading });
const HREmployeeRegister = dynamic(() => import("./HREmployeeRegister").then((m) => m.HREmployeeRegister), { loading: PanelLoading });
const LeaveTab = dynamic(() => import("./HRTabPanels").then((m) => m.LeaveTab), { loading: PanelLoading });
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

function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed/i.test(rawMessage)) {
    return fallback;
  }
  const clean = rawMessage.trim();
  return clean || fallback;
}
export default function HRDashboard() {
  return <HRPage initialTab="home" />;
}

/** One-line description per page instead of the same subtitle everywhere. */
const HR_TAB_SUBTITLES: Partial<Record<HRTab, string>> = {
  recruitment: "Candidates, their assessment scores and onboarding tasks.",
  documents: "Employment contracts and employee documents with expiry dates.",
  credentials: "Certifications, licences, medicals and inductions per employee.",
  performance: "Performance reviews and disciplinary records.",
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
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "HR Officer", "HR Manager"]}>
      {initialTab === "home" ? <HRHome />
        : initialTab === "employees" ? <HREmployeeRegister />
        : initialTab === "documents" || initialTab === "credentials" || initialTab === "assets" ? <HRFilesPage kind={initialTab === "documents" ? "contracts" : initialTab} />
        : initialTab === "attendance" ? <HRAttendancePage />
        : <HRWorkspace initialTab={initialTab} />}
    </RBACGuard>
  );
}

function HRWorkspace({ initialTab }: { initialTab: HRTab }) {
  const activeTab = initialTab;
  const [employees, setEmployees] = useState<RecordData[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<RecordData[]>([]);
  const [operations, setOperations] = useState<RecordData>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  // Each modal is only reachable from its own page.
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  // Form Fields
  const [leaveForm, setLeaveForm] = useState({ employee_id: "", leave_type: "annual", start_date: "", end_date: "", days_requested: "1", reason: "" });

  // Only fetch what this page shows.
  const needsPeople = activeTab === "leave";
  const needsOperations = activeTab !== "vendor-verification";

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const none = { data: [] as RecordData[] };
      const [empRes, leaveRes, opsRes] = await Promise.allSettled([
        needsPeople ? getHREmployees() : Promise.resolve(none),
        activeTab === "leave" ? getHRLeaveRequests() : Promise.resolve(none),
        needsOperations ? getHROperationsSummary() : Promise.resolve({ data: {} as RecordData }),
      ]);
      const warnings: string[] = [];
      // Leavers never appear in the leave picker.
      if (empRes.status === "fulfilled") setEmployees((empRes.value.data || []).filter((e: RecordData) => e.employment_status !== "terminated"));
      else warnings.push("Employee register could not be loaded.");
      if (leaveRes.status === "fulfilled") setLeaveRequests(leaveRes.value.data || []);
      else warnings.push("Leave register could not be loaded.");
      if (opsRes.status === "fulfilled") setOperations(opsRes.value.data || {});
      else warnings.push("HR operating layer could not be loaded.");
      setSourceWarnings(warnings);
    } catch (err) {
      setError(loadFailureMessage(err));
    } finally {
      setLoading(false);
    }
  }, [activeTab, needsPeople, needsOperations]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateLeaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveForm.employee_id) {
      setNotice("Please select an employee.");
      return;
    }
    if (!leaveForm.start_date || !leaveForm.end_date) {
      setNotice("Please specify start and end dates.");
      return;
    }
    if (leaveForm.end_date < leaveForm.start_date) {
      setNotice("End date must be on or after start date.");
      return;
    }
    const days = Number(leaveForm.days_requested);
    if (!days || days <= 0 || Number.isNaN(days)) {
      setNotice("Days requested must be greater than zero.");
      return;
    }
    try {
      await createHRLeaveRequest({
        ...leaveForm,
        days_requested: days
      });
      setNotice("Leave request submitted successfully.");
      setShowLeaveModal(false);
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to submit leave request."));
    }
  };

  const handleDecideLeave = async (id: string, decision: 'approved' | 'rejected') => {
    try {
      await approveHRLeaveRequest(id, decision, "Processed from HR Intelligence Panel.");
      setNotice(`Leave request ${decision} successfully.`);
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to process leave request."));
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center bg-ink">
        <Loader2 className="h-8 w-8 animate-spin text-signal" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Notice Banner */}
      {notice && (
        <div className="bg-ink-light border border-signal/20 px-4 py-3 rounded flex items-center justify-between text-paper text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
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
        actions={
          activeTab === "leave" ? (
            <button
              onClick={() => setShowLeaveModal(true)}
              className="flex items-center space-x-2 bg-signal text-ink font-semibold px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Apply Leave</span>
            </button>
          ) : undefined
        }
      />

      {activeTab === "vendor-verification" && (
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
          <VendorVerificationPanel />
        </div>
      )}

      <div className="space-y-6">
          {activeTab === "leave" && <AbsencePanel />}
          {activeTab === "leave" && (
            <LeaveTab calendarRows={operations.leave_calendar || leaveRequests} leaveRequests={leaveRequests} onDecide={handleDecideLeave} />
          )}

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
          {activeTab === "performance" && (
            <OperationList title="Performance reviews and disciplinary records" rows={[...(operations.performance || []), ...(operations.discipline || [])]} columns={["employee_name", "outcome", "rating", "next_review_date", "category", "severity", "status"]} empty="No performance reviews or disciplinary records have been recorded." />
          )}
          {activeTab === "training" && (
            <OperationList title="Training matrix by role and project" rows={operations.training || []} columns={["role_name", "training_name", "project_name", "mandatory", "employees_in_role", "current_records"]} empty="No training requirements have been recorded." />
          )}
          {activeTab === "org-chart" && (
            <OrgChartTabs />
          )}
          {activeTab === "planning" && (
            <OperationList title="Workforce planning by project and site" rows={operations.workforce_plans || []} columns={["project_name", "role_name", "required_headcount", "assigned_count", "shortfall", "status", "planned_start"]} empty="No workforce plans have been recorded." />
          )}
      </div>

      {/* Leave Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Submit Leave Request</span>
              <button onClick={() => setShowLeaveModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateLeaveRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Employee</label>
                <select
                  required
                  value={leaveForm.employee_id}
                  onChange={(e) => setLeaveForm({ ...leaveForm, employee_id: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                >
                  <option value="">Select Employee</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.employee_name || e.name || e.full_name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Leave Type</label>
                  <select
                    value={leaveForm.leave_type}
                    onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="annual">Annual Leave</option>
                    <option value="sick">Sick Leave</option>
                    <option value="maternity">Maternity Leave</option>
                    <option value="paternity">Paternity Leave</option>
                    <option value="compassionate">Compassionate</option>
                    <option value="study">Study Leave</option>
                    <option value="unpaid">Unpaid Leave</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Days Requested</label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    required
                    value={leaveForm.days_requested}
                    onChange={(e) => setLeaveForm({ ...leaveForm, days_requested: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.start_date}
                    onChange={(e) => {
                      const nextStart = e.target.value;
                      let days = leaveForm.days_requested;
                      if (nextStart && leaveForm.end_date && leaveForm.end_date >= nextStart) {
                        const diff = Math.round((new Date(leaveForm.end_date).getTime() - new Date(nextStart).getTime()) / 86400000) + 1;
                        days = String(Math.max(1, diff));
                      }
                      setLeaveForm({ ...leaveForm, start_date: nextStart, days_requested: days });
                    }}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">End Date</label>
                  <input
                    type="date"
                    required
                    min={leaveForm.start_date || undefined}
                    value={leaveForm.end_date}
                    onChange={(e) => {
                      const nextEnd = e.target.value;
                      let days = leaveForm.days_requested;
                      if (leaveForm.start_date && nextEnd && nextEnd >= leaveForm.start_date) {
                        const diff = Math.round((new Date(nextEnd).getTime() - new Date(leaveForm.start_date).getTime()) / 86400000) + 1;
                        days = String(Math.max(1, diff));
                      }
                      setLeaveForm({ ...leaveForm, end_date: nextEnd, days_requested: days });
                    }}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Reason / Notes</label>
                <textarea
                  placeholder="Please state leave reason..."
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50 h-20"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowLeaveModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
