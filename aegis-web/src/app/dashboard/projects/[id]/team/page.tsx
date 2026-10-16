"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Users,
  HardHat,
  ShieldCheck,
  UserCheck,
  Plus,
  RefreshCw,
  Search,
  UserX,
  Trash2,
  Calendar,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Phone,
  Briefcase,
  Sparkles,
  Sliders,
  X,
  ChevronRight,
  Clock,
  BadgeCheck,
} from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import {
  getProjectRoles,
  assignProjectRole,
  updateProjectRole,
  deactivateProjectRole,
  getProjectTeamHires,
  createProjectTeamHire,
  deactivateProjectTeamHire,
  removeProjectAllocation,
} from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

const ROLE_OPTIONS = [
  "Project Manager",
  "Site Engineer",
  "General Foreman",
  "Site Clerk",
  "Safety / HSE Officer",
  "Quality Assurance Officer",
  "Quantity Surveyor (Site QS)",
  "Earthworks Supervisor",
  "Structural Lead",
  "MEP Supervisor",
  "Logistics & Stores Manager",
];

export default function ProjectTeamPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { project, detail, team: hrAllocations, loading: projectLoading, refetch: refetchProject } = useProject();

  // State
  const [roles, setRoles] = useState<any[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [projectHires, setProjectHires] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Active filter tab
  const [filterTab, setFilterTab] = useState<"all" | "roles" | "hires" | "permanent">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [isAssignRoleModalOpen, setIsAssignRoleModalOpen] = useState(false);
  const [isAddHireModalOpen, setIsAddHireModalOpen] = useState(false);

  // Assign Role Form State
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoleName, setSelectedRoleName] = useState("Project Manager");
  const [roleStartsOn, setRoleStartsOn] = useState("");
  const [roleEndsOn, setRoleEndsOn] = useState("");

  // Add Project Hire Form State
  const [hireFullName, setHireFullName] = useState("");
  const [hireTrade, setHireTrade] = useState("General Labourer");
  const [hireHourlyRate, setHireHourlyRate] = useState("5.00");
  const [hirePhone, setHirePhone] = useState("");
  const [hireNationalId, setHireNationalId] = useState("");

  // Load project roles & project hires (from project endpoint, no payroll permission block!)
  const loadWorkforceData = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    const targetId = project?.id || projectId;
    try {
      const [rolesRes, hiresRes] = await Promise.allSettled([
        getProjectRoles(targetId),
        getProjectTeamHires(targetId),
      ]);

      if (rolesRes.status === "fulfilled" && rolesRes.value.success && rolesRes.value.data) {
        setRoles(rolesRes.value.data.assignments || []);
        setAvailableUsers(rolesRes.value.data.available_users || []);
        if (rolesRes.value.data.available_users?.length > 0 && !selectedUserId) {
          setSelectedUserId(rolesRes.value.data.available_users[0].id);
        }
      }

      if (hiresRes.status === "fulfilled" && hiresRes.value.success && hiresRes.value.data) {
        setProjectHires(hiresRes.value.data.hires || []);
      }
    } catch (err: any) {
      console.warn("Error loading workforce data", err);
    } finally {
      setLoading(false);
    }
  }, [projectId, project?.id, selectedUserId]);

  useEffect(() => {
    void loadWorkforceData();
  }, [loadWorkforceData]);

  // Handle Role Assignment / Delegation
  const handleAssignRoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !selectedRoleName) return;

    setActionLoading(true);
    setFeedback(null);
    const targetId = project?.id || projectId;
    try {
      const res = await assignProjectRole(targetId, {
        user_id: selectedUserId,
        role_name: selectedRoleName,
        starts_on: roleStartsOn || undefined,
        ends_on: roleEndsOn || undefined,
      });

      if (res.success) {
        setFeedback({
          type: "success",
          message: res.message || `Assigned ${selectedRoleName} successfully.`,
        });
        setIsAssignRoleModalOpen(false);
        await loadWorkforceData();
        void refetchProject();
      } else {
        setFeedback({
          type: "error",
          message: res.error?.message || "Failed to assign project role.",
        });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error assigning role." });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Deactivating / Ending a Role Assignment
  const handleDeactivateRole = async (assignmentId: string, roleName: string) => {
    if (!confirm(`Are you sure you want to end and deactivate this assignment for ${roleName}? Historical records and past reports will be preserved.`)) {
      return;
    }

    setActionLoading(true);
    const targetId = project?.id || projectId;
    try {
      const res = await deactivateProjectRole(targetId, assignmentId);
      if (res.success) {
        setFeedback({ type: "success", message: `Deactivated role assignment for ${roleName}.` });
        await loadWorkforceData();
        void refetchProject();
      } else {
        setFeedback({ type: "error", message: res.error?.message || "Failed to deactivate role." });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error deactivating role." });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Adding a Casual Project Hire
  const handleAddHireSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hireFullName.trim()) return;

    setActionLoading(true);
    setFeedback(null);
    const targetId = project?.id || projectId;
    try {
      const res = await createProjectTeamHire(targetId, {
        full_name: hireFullName.trim(),
        trade: hireTrade,
        hourly_rate: parseFloat(hireHourlyRate) || 0,
        phone: hirePhone.trim() || undefined,
        national_id: hireNationalId.trim() || undefined,
      });

      if (res.success) {
        setFeedback({
          type: "success",
          message: `Registered project hire ${hireFullName.trim()} successfully.`,
        });
        setIsAddHireModalOpen(false);
        setHireFullName("");
        setHirePhone("");
        setHireNationalId("");
        await loadWorkforceData();
      } else {
        setFeedback({
          type: "error",
          message: res.error?.message || "Failed to register project hire.",
        });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error registering project hire." });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Deactivating / Removing a Project Hire from Project
  const handleDeactivateHire = async (workerId: string, workerName: string, currentStatus: string) => {
    const isDeactivating = currentStatus === "active";
    const msg = isDeactivating
      ? `Remove / deactivate ${workerName} from this project? Earlier attendance records and hours will remain safely preserved.`
      : `Reactivate ${workerName} for this project?`;

    if (!confirm(msg)) return;

    setActionLoading(true);
    const targetId = project?.id || projectId;
    try {
      const res = await deactivateProjectTeamHire(targetId, workerId);
      if (res.success) {
        setFeedback({
          type: "success",
          message: `Deactivated ${workerName} from project.`,
        });
        await loadWorkforceData();
      } else {
        setFeedback({ type: "error", message: res.error?.message || "Failed to update worker status." });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error updating worker." });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Removing / Soft-Ending a Permanent Company Staff Allocation
  const handleRemoveAllocation = async (allocationId: string, employeeName: string) => {
    if (!confirm(`Are you sure you want to remove ${employeeName} from this project? Their allocation will be ended without losing earlier site logs or company employment records.`)) {
      return;
    }

    setActionLoading(true);
    const targetId = project?.id || projectId;
    try {
      const res = await removeProjectAllocation(targetId, allocationId);
      if (res.success) {
        setFeedback({
          type: "success",
          message: `Removed ${employeeName} from this project.`,
        });
        void refetchProject();
        await loadWorkforceData();
      } else {
        setFeedback({ type: "error", message: res.error?.message || "Failed to remove employee allocation." });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error removing employee allocation." });
    } finally {
      setActionLoading(false);
    }
  };

  // Active counts & deduplicated headcount
  const activeRoles = useMemo(() => roles.filter((r) => r.is_active), [roles]);
  const activeHires = useMemo(() => projectHires.filter((h) => h.status === "active"), [projectHires]);
  const activePermanent = useMemo(() => hrAllocations.filter((m) => m.status !== "ended" && !m.is_deleted), [hrAllocations]);

  const totalHeadcount = useMemo(() => {
    const uniquePersons = new Set<string>();

    for (const perm of activePermanent) {
      const key = (perm.employee_id || perm.employee_number || perm.employee_name || "").toLowerCase().trim();
      if (key) uniquePersons.add(key);
      if ((perm as any).user_id) uniquePersons.add(`user:${(perm as any).user_id}`);
    }

    for (const role of activeRoles) {
      const userKey = role.user_id ? `user:${role.user_id}` : "";
      const nameKey = (role.full_name || role.user_name || "").toLowerCase().trim();
      const emailKey = (role.email || "").toLowerCase().trim();

      const alreadyCounted =
        (userKey && uniquePersons.has(userKey)) ||
        (nameKey && uniquePersons.has(nameKey)) ||
        (emailKey && uniquePersons.has(emailKey));

      if (!alreadyCounted) {
        uniquePersons.add(userKey || nameKey || `role:${role.id}`);
      }
    }

    for (const hire of activeHires) {
      const hireKey = (hire.national_id || hire.id || hire.full_name || "").toLowerCase().trim();
      if (hireKey) uniquePersons.add(`hire:${hireKey}`);
    }

    return uniquePersons.size;
  }, [activePermanent, activeRoles, activeHires]);

  return (
    <div className="w-full space-y-6">
      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`flex items-center justify-between border p-3.5 text-xs font-mono transition-all ${
            feedback.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300"
              : "border-red-500/40 bg-red-950/30 text-red-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="uppercase text-slate-light hover:text-paper">
            Dismiss
          </button>
        </div>
      )}

      {/* Header & Quick Action Buttons: 100% Full Width */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
            Project Team &amp; Flexible Workforce
          </h2>
          <p className="mt-1 text-xs text-slate-light">
            Manage delegated site leadership (PM, Engineer, Foreman), flexible casual project hires, and permanent company staff.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void loadWorkforceData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink px-3 py-1.5 font-mono text-xs text-slate-light hover:text-paper transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin text-signal" : ""}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setIsAssignRoleModalOpen(true)}
            className="inline-flex items-center gap-1.5 border border-signal/60 bg-signal/15 px-3.5 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-signal hover:bg-signal hover:text-ink transition-colors"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Delegate / Assign Role</span>
          </button>
          <button
            onClick={() => setIsAddHireModalOpen(true)}
            className="inline-flex items-center gap-1.5 border border-emerald-500/60 bg-emerald-500/15 px-3.5 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-emerald-300 hover:bg-emerald-500 hover:text-ink transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Project Hire</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Strip: 100% Full Width */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-ink-mid bg-ink/70 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Total Active Workforce</p>
          <p className="mt-1 font-mono text-2xl font-bold text-paper sm:text-3xl">{totalHeadcount}</p>
          <span className="text-[11px] text-slate-light">Combined site personnel</span>
        </div>

        <div className="border border-signal/40 bg-signal/5 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-signal">Delegated Leadership</p>
          <p className="mt-1 font-mono text-2xl font-bold text-signal sm:text-3xl">{activeRoles.length}</p>
          <span className="text-[11px] text-slate-light">PM, Engineers &amp; Supervisors</span>
        </div>

        <div className="border border-emerald-500/30 bg-ink/70 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">Casual Project Hires</p>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-300 sm:text-3xl">{activeHires.length}</p>
          <span className="text-[11px] text-slate-light">Temporary workers who come &amp; go</span>
        </div>

        <div className="border border-cyan-500/30 bg-ink/70 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-cyan-400">Permanent HR Staff</p>
          <p className="mt-1 font-mono text-2xl font-bold text-cyan-300 sm:text-3xl">{activePermanent.length}</p>
          <span className="text-[11px] text-slate-light">Allocated company employees</span>
        </div>
      </section>

      {/* Navigation Filter Tabs: Full Width */}
      <div className="flex border-b border-ink-mid gap-2 overflow-x-auto no-scrollbar font-mono text-xs">
        <button
          onClick={() => setFilterTab("all")}
          className={`pb-2.5 px-3 border-b-2 uppercase tracking-wider transition-colors ${
            filterTab === "all"
              ? "border-signal text-signal font-semibold"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          All Workforce ({totalHeadcount})
        </button>
        <button
          onClick={() => setFilterTab("roles")}
          className={`pb-2.5 px-3 border-b-2 uppercase tracking-wider transition-colors ${
            filterTab === "roles"
              ? "border-signal text-signal font-semibold"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          Delegated Roles ({roles.length})
        </button>
        <button
          onClick={() => setFilterTab("hires")}
          className={`pb-2.5 px-3 border-b-2 uppercase tracking-wider transition-colors ${
            filterTab === "hires"
              ? "border-signal text-signal font-semibold"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          Casual Project Hires ({projectHires.length})
        </button>
        <button
          onClick={() => setFilterTab("permanent")}
          className={`pb-2.5 px-3 border-b-2 uppercase tracking-wider transition-colors ${
            filterTab === "permanent"
              ? "border-signal text-signal font-semibold"
              : "border-transparent text-slate-light hover:text-paper"
          }`}
        >
          Permanent HR Staff ({activePermanent.length})
        </button>
      </div>

      {/* SECTION 1: DELEGATED PROJECT LEADERSHIP & ROLES */}
      {(filterTab === "all" || filterTab === "roles") && (
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-3.5 sm:px-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-signal" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                Delegated Project Leadership &amp; Operational Responsibilities
              </span>
            </div>
            <span className="font-mono text-xs text-slate-light">
              {activeRoles.length} Active Responsibilities
            </span>
          </div>

          {roles.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-light font-mono">
              No leadership roles assigned yet. Click &quot;Delegate / Assign Role&quot; to assign the Project Manager, Site Engineer, or Foreman.
            </div>
          ) : (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 text-[11px] text-slate uppercase tracking-wider">
                    <th className="py-2.5 px-4 sm:px-6">Assigned Role</th>
                    <th className="py-2.5 px-4">Delegate / Person</th>
                    <th className="py-2.5 px-4">Site Location</th>
                    <th className="py-2.5 px-4">Effective Dates</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/40">
                  {roles.map((r) => (
                    <tr key={r.id} className="hover:bg-ink-light/20 transition-colors">
                      <td className="py-3 px-4 sm:px-6">
                        <span className="font-semibold text-paper text-sm block font-sans">
                          {r.role_name}
                        </span>
                        <span className="text-[10px] text-slate-light font-mono">
                          Assigned by {r.assigned_by_name || "Executive"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-paper font-medium block">{r.user_name}</span>
                        <span className="text-[10px] text-slate-light">{r.user_email}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-light">
                        {r.site_name || "Main Project Site"}
                      </td>
                      <td className="py-3 px-4 text-slate-light text-[11px]">
                        {r.starts_on ? formatDate(String(r.starts_on)) : "Immediate"}
                        {r.ends_on && ` → ${formatDate(String(r.ends_on))}`}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`border px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider ${
                            r.is_active
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                              : "border-slate-500/40 bg-slate-500/10 text-slate-400"
                          }`}
                        >
                          {r.is_active ? "Active Role" : "Ended"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {r.is_active ? (
                          <button
                            onClick={() => handleDeactivateRole(r.id, r.role_name)}
                            disabled={actionLoading}
                            title="End assignment without losing historical records"
                            className="inline-flex items-center gap-1 border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-rose-500 hover:text-ink transition-colors disabled:opacity-50"
                          >
                            <UserX className="h-3 w-3" />
                            <span>End Role</span>
                          </button>
                        ) : (
                          <span className="text-slate text-[11px]">Inactive</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* SECTION 2: CASUAL PROJECT HIRES (finance.site_workers / site_day_attendance) */}
      {(filterTab === "all" || filterTab === "hires") && (
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-3.5 sm:px-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardHat className="h-4 w-4 text-emerald-400" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                Casual Project Hires &amp; Temporary Site Labourers
              </span>
            </div>
            <span className="font-mono text-xs text-slate-light">
              {projectHires.length} Hires ({activeHires.length} Active)
            </span>
          </div>

          {projectHires.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-light font-mono">
              No casual project hires registered yet. Click &quot;Add Project Hire&quot; to register day labourers and artisans who come and go.
            </div>
          ) : (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 text-[11px] text-slate uppercase tracking-wider">
                    <th className="py-2.5 px-4 sm:px-6">Worker Name</th>
                    <th className="py-2.5 px-4">Trade / Skill</th>
                    <th className="py-2.5 px-4">Hourly Rate</th>
                    <th className="py-2.5 px-4">HR Verification</th>
                    <th className="py-2.5 px-4">Hours Logged</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/40">
                  {projectHires.map((h) => {
                    const isActive = h.status === "active";
                    const isApproved = h.hr_status === "accepted" || h.hr_verified;

                    return (
                      <tr key={h.id || h.full_name} className="hover:bg-ink-light/20 transition-colors">
                        <td className="py-3 px-4 sm:px-6">
                          <span className="font-semibold text-paper text-sm block font-sans">
                            {h.full_name}
                          </span>
                          <span className="text-[10px] text-slate-light">
                            {h.national_id ? `ID: ${h.national_id}` : (h.phone ? `Phone: ${h.phone}` : "Casual Hire")}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-paper">{h.trade || "General Labour"}</td>
                        <td className="py-3 px-4 text-emerald-300 font-semibold">
                          ${parseFloat(h.hourly_rate || "0").toFixed(2)}/hr
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`border px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider inline-flex items-center gap-1 ${
                              isApproved
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                            }`}
                          >
                            <BadgeCheck className="h-3 w-3" />
                            <span>{isApproved ? "HR Approved" : "Pending Review"}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-light">
                          <span className="font-semibold text-paper">{h.hours_logged || 0} hrs</span>
                          {h.last_attended && (
                            <span className="block text-[10px] text-slate">Last: {formatDate(String(h.last_attended))}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`border px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider ${
                              isActive
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                : "border-slate-500/40 bg-slate-500/10 text-slate-400"
                            }`}
                          >
                            {h.status || "active"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => handleDeactivateHire(h.id, h.full_name, h.status)}
                            disabled={actionLoading}
                            title="Remove or deactivate worker from this project"
                            className={`inline-flex items-center gap-1 border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                              isActive
                                ? "border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500 hover:text-ink"
                                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500 hover:text-ink"
                            }`}
                          >
                            <UserX className="h-3 w-3" />
                            <span>{isActive ? "Remove from Project" : "Reactivate"}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* SECTION 3: ALLOCATED PERMANENT STAFF (HR Allocations with Remove Action) */}
      {(filterTab === "all" || filterTab === "permanent") && (
        <section className="border border-ink-mid bg-ink">
          <div className="border-b border-ink-mid p-3.5 sm:px-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-400" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                Permanent Company Staff &amp; Master HR Allocations
              </span>
            </div>
            <span className="font-mono text-xs text-slate-light">
              {activePermanent.length} Allocated Staff
            </span>
          </div>

          {activePermanent.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-light font-mono">
              No permanent company staff currently allocated to this project.
            </div>
          ) : (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 text-[11px] text-slate uppercase tracking-wider">
                    <th className="py-2.5 px-4 sm:px-6">Employee Name</th>
                    <th className="py-2.5 px-4">Job Title / Role</th>
                    <th className="py-2.5 px-4">Trade / Category</th>
                    <th className="py-2.5 px-4 text-center">Allocation %</th>
                    <th className="py-2.5 px-4">Starts On</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/40">
                  {activePermanent.map((m) => (
                    <tr key={m.allocation_id || m.id || m.employee_name} className="hover:bg-ink-light/20 transition-colors">
                      <td className="py-3 px-4 sm:px-6">
                        <span className="font-semibold text-paper text-sm block font-sans">
                          {m.employee_name || "Company Staff"}
                        </span>
                        <span className="text-[10px] text-slate-light">
                          {m.employee_number || "EMP"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-paper">
                        {m.job_title || m.role_on_project || "Site Engineer"}
                      </td>
                      <td className="py-3 px-4 text-slate-light">
                        {m.trade || m.category_name || "Technical"}
                      </td>
                      <td className="py-3 px-4 text-center text-signal font-bold">
                        {m.allocation_percent ? `${m.allocation_percent}%` : "100%"}
                      </td>
                      <td className="py-3 px-4 text-slate-light">
                        {formatDate(String(m.starts_on || m.created_at || ""))}
                      </td>
                      <td className="py-3 px-4">
                        <span className="border border-emerald-500/30 bg-emerald-950/20 px-2 py-0.5 text-[10px] uppercase text-emerald-400 font-bold">
                          {m.status || "active"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleRemoveAllocation(m.allocation_id || m.id || "", m.employee_name || "Company Staff")}
                          disabled={actionLoading}
                          title="Remove employee allocation from this project"
                          className="inline-flex items-center gap-1 border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-rose-500 hover:text-ink transition-colors disabled:opacity-50"
                        >
                          <UserX className="h-3 w-3" />
                          <span>Remove from Project</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* MODAL 1: ASSIGN / DELEGATE PROJECT ROLE */}
      {isAssignRoleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg border border-signal/50 bg-ink p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <div className="flex items-center gap-2 text-signal">
                <ShieldCheck className="h-5 w-5" />
                <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">
                  Delegate / Assign Project Role
                </h3>
              </div>
              <button
                onClick={() => setIsAssignRoleModalOpen(false)}
                className="text-slate hover:text-paper"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAssignRoleSubmit} className="space-y-4 font-mono text-xs">
              <div>
                <label className="text-slate block mb-1 uppercase tracking-wider">
                  Target Person / User
                </label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  required
                  className="w-full bg-ink-light border border-ink-mid px-3 py-2 text-paper focus:border-signal focus:outline-none"
                >
                  <option value="">Select a user in the organization</option>
                  {availableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.email}) - {u.role}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate block mb-1 uppercase tracking-wider">
                  Project Responsibility / Role
                </label>
                <select
                  value={selectedRoleName}
                  onChange={(e) => setSelectedRoleName(e.target.value)}
                  required
                  className="w-full bg-ink-light border border-ink-mid px-3 py-2 text-paper focus:border-signal focus:outline-none"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-light">
                  Assigning &quot;Project Manager&quot; will also update the project&apos;s primary lead manager record.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate block mb-1 uppercase tracking-wider">Start Date</label>
                  <input
                    type="date"
                    value={roleStartsOn}
                    onChange={(e) => setRoleStartsOn(e.target.value)}
                    className="w-full bg-ink-light border border-ink-mid px-3 py-2 text-paper focus:border-signal focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate block mb-1 uppercase tracking-wider">End Date (Optional)</label>
                  <input
                    type="date"
                    value={roleEndsOn}
                    onChange={(e) => setRoleEndsOn(e.target.value)}
                    className="w-full bg-ink-light border border-ink-mid px-3 py-2 text-paper focus:border-signal focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setIsAssignRoleModalOpen(false)}
                  className="px-4 py-2 border border-ink-mid text-slate-light hover:text-paper uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !selectedUserId}
                  className="px-4 py-2 border border-signal bg-signal text-ink font-bold uppercase tracking-wider hover:bg-signal-light disabled:opacity-50"
                >
                  {actionLoading ? "Assigning..." : "Confirm Role Assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: REGISTER CASUAL PROJECT HIRE */}
      {isAddHireModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg border border-emerald-500/50 bg-ink p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <HardHat className="h-5 w-5" />
                <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">
                  Register Casual Project Hire
                </h3>
              </div>
              <button
                onClick={() => setIsAddHireModalOpen(false)}
                className="text-slate hover:text-paper"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddHireSubmit} className="space-y-4 font-mono text-xs">
              <div>
                <label className="text-slate block mb-1 uppercase tracking-wider">
                  Worker Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={hireFullName}
                  onChange={(e) => setHireFullName(e.target.value)}
                  placeholder="e.g. Tendai Moyo"
                  className="w-full bg-ink-light border border-ink-mid px-3 py-2 text-paper focus:border-signal focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate block mb-1 uppercase tracking-wider">Trade / Skill</label>
                  <select
                    value={hireTrade}
                    onChange={(e) => setHireTrade(e.target.value)}
                    className="w-full bg-ink-light border border-ink-mid px-3 py-2 text-paper focus:border-signal focus:outline-none"
                  >
                    <option value="General Labourer">General Labourer</option>
                    <option value="Bricklayer / Mason">Bricklayer / Mason</option>
                    <option value="Carpenter / Shutter hand">Carpenter / Shutter hand</option>
                    <option value="Steel fixer">Steel fixer</option>
                    <option value="Plumber">Plumber</option>
                    <option value="Electrician">Electrician</option>
                    <option value="Plant Operator">Plant Operator</option>
                    <option value="Driver">Driver</option>
                    <option value="Painter">Painter</option>
                    <option value="Welder">Welder</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate block mb-1 uppercase tracking-wider">Hourly Rate ($)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={hireHourlyRate}
                    onChange={(e) => setHireHourlyRate(e.target.value)}
                    className="w-full bg-ink-light border border-ink-mid px-3 py-2 text-paper focus:border-signal focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate block mb-1 uppercase tracking-wider">Phone Number</label>
                  <input
                    type="tel"
                    value={hirePhone}
                    onChange={(e) => setHirePhone(e.target.value)}
                    placeholder="+263 77..."
                    className="w-full bg-ink-light border border-ink-mid px-3 py-2 text-paper focus:border-signal focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate block mb-1 uppercase tracking-wider">National ID (Optional)</label>
                  <input
                    type="text"
                    value={hireNationalId}
                    onChange={(e) => setHireNationalId(e.target.value)}
                    placeholder="e.g. 63-1234567-X-42"
                    className="w-full bg-ink-light border border-ink-mid px-3 py-2 text-paper focus:border-signal focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setIsAddHireModalOpen(false)}
                  className="px-4 py-2 border border-ink-mid text-slate-light hover:text-paper uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !hireFullName.trim()}
                  className="px-4 py-2 border border-emerald-500 bg-emerald-500 text-ink font-bold uppercase tracking-wider hover:bg-emerald-400 disabled:opacity-50"
                >
                  {actionLoading ? "Registering..." : "Add to Project Workforce"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
