"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle, BadgeCheck, Loader2, Plus, RefreshCw, Search,
  ShieldCheck, Users, X, CalendarCheck, CalendarDays, Award, Briefcase, CheckCircle2
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  getHREmployees,
  getHREmployee,
  getHREmployeeSkills,
  getHREmployeeCertifications,
  getHRAttendance,
  recordHRAttendance,
  getHRLeaveRequests,
  createHRLeaveRequest,
  approveHRLeaveRequest,
  getInternalProjects
} from "@/lib/api";

type RecordData = Record<string, any>;
type HRTab = "employees" | "attendance" | "leave" | "payroll";

const TAB_ROUTES: Record<HRTab, string> = {
  employees: "/dashboard/hr/employees",
  attendance: "/dashboard/hr/attendance",
  leave: "/dashboard/hr/leave",
  payroll: "/dashboard/hr/payroll",
};

function normalizeTab(value: string | null | undefined): HRTab {
  return value && value in TAB_ROUTES ? (value as HRTab) : "employees";
}

function textValue(value: unknown, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function dateValue(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function statusClass(status: string) {
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
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  return fallback;
}

export default function HRDashboard() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "HR Officer", "HR Manager"]}>
      <HRWorkspace />
    </RBACGuard>
  );
}

function HRWorkspace() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<HRTab>(() => normalizeTab(searchParams?.get("tab")));
  const [employees, setEmployees] = useState<RecordData[]>([]);
  const [attendance, setAttendance] = useState<RecordData[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<RecordData[]>([]);
  const [projects, setProjects] = useState<RecordData[]>([]);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [employeeDetail, setEmployeeDetail] = useState<RecordData | null>(null);
  const [employeeSkills, setEmployeeSkills] = useState<RecordData[]>([]);
  const [employeeCerts, setEmployeeCerts] = useState<RecordData[]>([]);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().slice(0, 10));

  // Modals
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  // Form Fields
  const [attendanceForm, setAttendanceForm] = useState({ employee_id: "", project_id: "", site_id: "", attendance_date: new Date().toISOString().slice(0, 10), status: "present", regular_hours: "8", overtime_hours: "0", notes: "" });
  const [leaveForm, setLeaveForm] = useState({ employee_id: "", leave_type: "annual", start_date: "", end_date: "", days_requested: "1", reason: "" });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [empRes, attendRes, leaveRes, projRes] = await Promise.allSettled([
        getHREmployees(),
        getHRAttendance({ date: attendanceDate }),
        getHRLeaveRequests(),
        getInternalProjects()
      ]);
      const warnings: string[] = [];
      if (empRes.status === "fulfilled") setEmployees(empRes.value.data || []);
      else warnings.push("Employee register could not be loaded.");
      if (attendRes.status === "fulfilled") setAttendance(attendRes.value.data || []);
      else warnings.push("Attendance register could not be loaded.");
      if (leaveRes.status === "fulfilled") setLeaveRequests(leaveRes.value.data || []);
      else warnings.push("Leave register could not be loaded.");
      if (projRes.status === "fulfilled") setProjects(projRes.value.data || []);
      else warnings.push("Project register could not be loaded.");
      setSourceWarnings(warnings);
      if (empRes.status === "rejected") {
        throw new Error(loadFailureMessage(empRes.reason));
      }
    } catch (err) {
      setError(loadFailureMessage(err));
    } finally {
      setLoading(false);
    }
  }, [attendanceDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setActiveTab(normalizeTab(searchParams?.get("tab")));
  }, [searchParams]);

  const loadEmployeeDetail = async (id: string) => {
    setSelectedEmployeeId(id);
    if (!id) {
      setEmployeeDetail(null);
      setEmployeeSkills([]);
      setEmployeeCerts([]);
      return;
    }
    setDetailLoading(true);
    try {
      const [empRes, skillsRes, certsRes] = await Promise.allSettled([
        getHREmployee(id),
        getHREmployeeSkills(id),
        getHREmployeeCertifications(id)
      ]);
      if (empRes.status === "fulfilled") setEmployeeDetail(empRes.value.data || null);
      if (skillsRes.status === "fulfilled") setEmployeeSkills(skillsRes.value.data || []);
      if (certsRes.status === "fulfilled") setEmployeeCerts(certsRes.value.data || []);
      if (empRes.status === "rejected") {
        throw new Error(loadFailureMessage(empRes.reason));
      }
    } catch (err) {
      setNotice(loadFailureMessage(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRecordAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attendanceForm.employee_id) return;
    try {
      await recordHRAttendance({
        ...attendanceForm,
        regular_hours: Number(attendanceForm.regular_hours),
        overtime_hours: Number(attendanceForm.overtime_hours)
      });
      setNotice("Attendance logged successfully.");
      setShowAttendanceModal(false);
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to log attendance."));
    }
  };

  const handleCreateLeaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveForm.employee_id || !leaveForm.start_date || !leaveForm.end_date) return;
    try {
      await createHRLeaveRequest({
        ...leaveForm,
        days_requested: Number(leaveForm.days_requested)
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

  // KPIs
  const kpis = useMemo(() => {
    const total = employees.length;
    const active = employees.filter(e => e.employment_status === "active").length;
    const leave = employees.filter(e => e.employment_status === "on_leave").length;
    const suspended = employees.filter(e => e.employment_status === "suspended").length;
    
    // Simple skills summary
    const uniqueSkills = new Set();
    employees.forEach(e => {
      if (Array.isArray(e.skills)) {
        e.skills.forEach((s: any) => uniqueSkills.add(s.skill_name));
      }
    });

    return { total, active, leave, suspended, skillsCount: uniqueSkills.size };
  }, [employees]);

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return employees.filter(e => {
      const matchSearch = searchQuery ? (e.employee_name || e.name || "").toLowerCase().includes(searchQuery.toLowerCase()) || 
                            (e.employee_number || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (e.job_title || "").toLowerCase().includes(searchQuery.toLowerCase()) : true;
      const matchDept = deptFilter !== "all" ? e.department === deptFilter : true;
      const matchStatus = statusFilter !== "all" ? e.employment_status === statusFilter : true;
      return matchSearch && matchDept && matchStatus;
    });
  }, [employees, searchQuery, deptFilter, statusFilter]);

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

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-paper tracking-tight font-display">HR & Workforce</h1>
          <p className="text-sm text-slate-light font-sans mt-0.5">Six Nine Construction workforce, competence registers, and attendance controls.</p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setShowAttendanceModal(true)}
            className="flex items-center space-x-2 bg-ink-light border border-ink-mid hover:bg-ink-mid/30 text-paper font-medium px-4 py-2 rounded-sm text-sm transition-colors"
          >
            <CalendarCheck className="h-4 w-4 text-signal" />
            <span>Log Attendance</span>
          </button>
          <button
            onClick={() => setShowLeaveModal(true)}
            className="flex items-center space-x-2 bg-signal text-ink font-semibold px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Apply Leave</span>
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Total Headcount</p>
          <p className="text-xl font-semibold text-paper tracking-tight mt-1">{kpis.total}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Active Deployed</p>
          <p className="text-xl font-semibold text-emerald-400 tracking-tight mt-1">{kpis.active}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">On Approved Leave</p>
          <p className="text-xl font-semibold text-blue-400 tracking-tight mt-1">{kpis.leave}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Suspended / Inactive</p>
          <p className="text-xl font-semibold text-amber-500 tracking-tight mt-1">{kpis.suspended}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Competence Registered SKUs</p>
          <p className="text-xl font-semibold text-paper tracking-tight mt-1">{kpis.skillsCount}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-ink-mid">
        <Link
          href={TAB_ROUTES.employees}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "employees" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Employee Register
        </Link>
        <Link
          href={TAB_ROUTES.attendance}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "attendance" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Attendance Log
        </Link>
        <Link
          href={TAB_ROUTES.leave}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "leave" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Leave Management
        </Link>
        <Link
          href={TAB_ROUTES.payroll}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "payroll" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Payroll Runs
        </Link>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {activeTab === "employees" && (
            <div className="space-y-4">
              {/* Search & Filters */}
              <div className="bg-ink-light border border-ink-mid p-4 rounded-sm flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate" />
                  <input
                    type="text"
                    placeholder="Search employees, numbers, trades..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-ink border border-ink-mid rounded pl-9 pr-4 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div className="flex gap-4 w-full md:w-auto">
                  <select
                    value={deptFilter}
                    onChange={(e) => setDeptFilter(e.target.value)}
                    className="bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="all">All Departments</option>
                    <option value="Operations">Operations</option>
                    <option value="Engineering">Engineering</option>
                    <option value="Administration">Administration</option>
                    <option value="Plant Hire">Plant Hire</option>
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="on_leave">On Leave</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              {/* Table */}
              <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                      <th className="p-4">Employee #</th>
                      <th className="p-4">Name</th>
                      <th className="p-4">Role</th>
                      <th className="p-4">Department</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {filteredEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-slate">No employees found matching the filters.</td>
                      </tr>
                    ) : (
                      filteredEmployees.map((e) => (
                        <tr
                          key={e.id}
                          onClick={() => void loadEmployeeDetail(e.id)}
                          className={`cursor-pointer hover:bg-ink-mid/30 transition-colors ${selectedEmployeeId === e.id ? 'bg-ink-mid/20 border-l-2 border-l-signal' : ''}`}
                        >
                          <td className="p-4 font-mono text-signal">{e.employee_number || "—"}</td>
                          <td className="p-4 font-medium text-paper">{e.employee_name || e.name || e.full_name}</td>
                          <td className="p-4 text-paper">{e.job_title}</td>
                          <td className="p-4 text-slate-light">{e.department || "—"}</td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(e.employment_status)}`}>
                              {e.employment_status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "attendance" && (
            <div className="space-y-4">
              <div className="bg-ink-light border border-ink-mid p-4 rounded-sm flex justify-between items-center">
                <span className="font-mono text-xs uppercase text-slate tracking-wider">Attendance date filter</span>
                <input
                  type="date"
                  value={attendanceDate}
                  onChange={(e) => setAttendanceDate(e.target.value)}
                  className="bg-ink border border-ink-mid rounded px-3 py-1.5 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                      <th className="p-4">Employee</th>
                      <th className="p-4">Check In</th>
                      <th className="p-4">Check Out</th>
                      <th className="p-4 text-right">Regular Hrs</th>
                      <th className="p-4 text-right">Overtime</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {attendance.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate">No attendance logged for the selected date.</td>
                      </tr>
                    ) : (
                      attendance.map((a) => (
                        <tr key={a.id} className="hover:bg-ink-mid/10">
                          <td className="p-4 font-medium text-paper">{a.employee_name}</td>
                          <td className="p-4 font-mono text-slate-light">{a.check_in ? new Date(a.check_in).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : "—"}</td>
                          <td className="p-4 font-mono text-slate-light">{a.check_out ? new Date(a.check_out).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : "—"}</td>
                          <td className="p-4 text-right text-paper font-mono">{a.regular_hours}</td>
                          <td className="p-4 text-right text-slate-light font-mono">{a.overtime_hours}</td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(a.status)}`}>
                              {a.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "leave" && (
            <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                    <th className="p-4">Employee</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Start</th>
                    <th className="p-4">End</th>
                    <th className="p-4 text-right">Days</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {leaveRequests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-slate">No leave requests logged.</td>
                    </tr>
                  ) : (
                    leaveRequests.map((l) => (
                      <tr key={l.id} className="hover:bg-ink-mid/10">
                        <td className="p-4 font-medium text-paper">{l.employee_name}</td>
                        <td className="p-4 capitalize text-paper">{l.leave_type}</td>
                        <td className="p-4 text-slate-light">{dateValue(l.start_date)}</td>
                        <td className="p-4 text-slate-light">{dateValue(l.end_date)}</td>
                        <td className="p-4 text-right text-paper font-mono">{l.days_requested}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(l.status)}`}>
                            {l.status}
                          </span>
                        </td>
                        <td className="p-4 text-right space-x-2">
                          {l.status === "pending" && (
                            <>
                              <button
                                onClick={() => void handleDecideLeave(l.id, "approved")}
                                className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 px-2 py-1 rounded text-xs font-mono"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => void handleDecideLeave(l.id, "rejected")}
                                className="bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-2 py-1 rounded text-xs font-mono"
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "payroll" && (
            <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
                <span className="font-mono text-xs tracking-wider uppercase text-slate">Payroll Processing</span>
              </div>
              <div className="p-6 text-center text-slate">
                <AlertTriangle className="h-8 w-8 text-signal/50 mx-auto mb-2" />
                <p className="text-sm font-medium text-paper">Manual Payroll is Active</p>
                <p className="text-xs mt-1">Payroll runs and payslips are currently handled manually via external registers.</p>
                <button className="mt-4 px-4 py-2 bg-signal text-ink text-sm font-semibold rounded hover:bg-signal/90">
                  Manage Payroll
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detailed Side Panel */}
        <div className="space-y-6">
          <div className="bg-ink-light border border-ink-mid p-5 rounded-sm">
            <h2 className="text-sm font-semibold text-paper tracking-wider uppercase font-mono border-b border-ink-mid pb-3">Workforce Intelligence</h2>
            {detailLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-signal" />
              </div>
            ) : employeeDetail ? (
              <div className="space-y-6 mt-4">
                <div>
                  <h3 className="text-base font-semibold text-paper">{employeeDetail.employee_name || employeeDetail.name}</h3>
                  <p className="text-xs text-slate-light font-mono mt-0.5">{employeeDetail.job_title || "Role not assigned"}</p>
                </div>

                <div className="space-y-2 text-xs border-t border-b border-ink-mid py-4">
                  <div className="flex justify-between">
                    <span className="text-slate">Employee Code:</span>
                    <span className="font-mono text-paper font-semibold">{employeeDetail.employee_number || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">Department:</span>
                    <span className="text-paper">{employeeDetail.department || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">Employment Type:</span>
                    <span className="text-paper">{employeeDetail.employment_type || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">Start Date:</span>
                    <span className="text-paper">{dateValue(employeeDetail.start_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">Deployment Hub:</span>
                    <span className="text-paper">{employeeDetail.work_location || "Headquarters"}</span>
                  </div>
                </div>

                {/* Skills register */}
                <div className="space-y-2">
                  <h4 className="text-[10px] uppercase font-mono tracking-widest text-slate">Skill Qualifications</h4>
                  {employeeSkills.length === 0 ? (
                    <p className="text-[11px] text-slate italic">No validated skills recorded in competency registry.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {employeeSkills.map((s) => (
                        <span key={s.id} className="bg-ink border border-ink-mid px-2.5 py-1 rounded text-xs text-paper flex items-center space-x-1.5">
                          <span>{s.skill_name}</span>
                          <span className="text-[10px] font-mono text-signal uppercase">[{s.proficiency}]</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Certifications Register */}
                <div className="space-y-2">
                  <h4 className="text-[10px] uppercase font-mono tracking-widest text-slate">Certificates & Clearances</h4>
                  {employeeCerts.length === 0 ? (
                    <p className="text-[11px] text-slate italic">No professional certifications on file.</p>
                  ) : (
                    <div className="space-y-2">
                      {employeeCerts.map((c) => (
                        <div key={c.id} className="bg-ink border border-ink-mid p-2.5 rounded flex items-center justify-between">
                          <div>
                            <p className="text-xs font-semibold text-paper">{c.certification_name}</p>
                            <p className="text-[10px] text-slate-light font-mono mt-0.5">Expires: {dateValue(c.expires_on)}</p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-sm text-[9px] uppercase font-mono border ${statusClass(c.verification_status)}`}>
                            {c.verification_status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate mt-4 text-center">Select an employee record to view comprehensive details, skills, and certifications.</p>
            )}
          </div>
        </div>
      </div>

      {/* Attendance Modal */}
      {showAttendanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-sm space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Log Attendance</span>
              <button onClick={() => setShowAttendanceModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleRecordAttendance} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Employee</label>
                <select
                  required
                  value={attendanceForm.employee_id}
                  onChange={(e) => setAttendanceForm({ ...attendanceForm, employee_id: e.target.value })}
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
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Project</label>
                  <select
                    value={attendanceForm.project_id}
                    onChange={(e) => setAttendanceForm({ ...attendanceForm, project_id: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="">Select Project (Optional)</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={attendanceForm.attendance_date}
                    onChange={(e) => setAttendanceForm({ ...attendanceForm, attendance_date: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Status</label>
                  <select
                    value={attendanceForm.status}
                    onChange={(e) => setAttendanceForm({ ...attendanceForm, status: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="present">Present</option>
                    <option value="late">Late</option>
                    <option value="half_day">Half Day</option>
                    <option value="absent">Absent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Reg Hours</label>
                  <input
                    type="number"
                    value={attendanceForm.regular_hours}
                    onChange={(e) => setAttendanceForm({ ...attendanceForm, regular_hours: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">OT Hours</label>
                  <input
                    type="number"
                    value={attendanceForm.overtime_hours}
                    onChange={(e) => setAttendanceForm({ ...attendanceForm, overtime_hours: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="Additional attendance comments..."
                  value={attendanceForm.notes}
                  onChange={(e) => setAttendanceForm({ ...attendanceForm, notes: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowAttendanceModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Log Attendance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Leave Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-sm space-y-4">
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
                    onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">End Date</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.end_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
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
