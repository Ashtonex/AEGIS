"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Calendar, CheckCircle2, ChevronDown, Circle, FileSpreadsheet, Layers, Link2, Loader2, Lock, Plus, ShieldCheck, Trash2, TrendingUp, UserCheck, Users, X } from "lucide-react";
import {
  getCrmTasks,
  createCrmTask,
  updateCrmTask,
  deleteCrmTask,
  getAssignableUsers,
  getTeams,
  assignTaskStack,
  backfillCrmTaskStacks,
  addCrmTaskContributor,
  removeCrmTaskContributor,
  getCrmTaskProgressSummary,
  TaskProgressRow,
} from "@/lib/api";
import { initials, avatarTone } from "@/lib/avatar";

type TaskStatus = "planned" | "not_started" | "ready" | "in_progress" | "waiting_on_third_party" | "blocked" | "under_review" | "completed" | "rejected" | "not_applicable" | "cancelled" | "superseded";

interface Task {
  id: string;
  title: string;
  description: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  assigned_to_team_id: string | null;
  assigned_to_team_name: string | null;
  source: "manual" | "template";
  due_date: string | null;
  status: TaskStatus;
  priority: "low" | "normal" | "high" | "urgent";
  created_at: string;
  depends_on_task_id: string | null;
  depends_on_title: string | null;
  depends_on_status: TaskStatus | null;
  evidence_required: boolean;
  evidence_ref: string | null;
  approver_user_id: string | null;
  approver_name: string | null;
  verified_by_user_id: string | null;
  verified_at: string | null;
  review_submitted_at: string | null;
  review_submitted_by_user_id: string | null;
  risk_flag: boolean;
  outcome: string | null;
  next_action: string | null;
  contributors: { id: string; full_name: string }[];
  quotation_id: string | null;
  boq_document_id: string | null;
  boq_imported_at: string | null;
  requirement_code: string | null;
  primary_entity_type: string | null;
  primary_entity_id: string | null;
  expected_outcome: string | null;
  criticality: "critical" | "high" | "medium" | "low";
  weight: number;
  gate_effect: "blocking" | "non_blocking";
  contribution_percent: number;
}

// entity_type values the quotation builder's source picker supports (see
// _SOURCE_LINK_COLUMNS in quotations.py).
const QUOTABLE_ENTITY_TYPES = new Set(["tender", "opportunity", "lead", "project"]);

interface AssignableUser {
  id: string;
  full_name: string;
  email: string;
}

interface Team {
  id: string;
  name: string;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "not_started", label: "Not Started" },
  { value: "ready", label: "Ready" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting_on_third_party", label: "Waiting on Third Party" },
  { value: "blocked", label: "Blocked" },
  { value: "under_review", label: "Under Review" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" },
  { value: "not_applicable", label: "Not Applicable" },
  { value: "cancelled", label: "Cancelled" },
  { value: "superseded", label: "Superseded" },
];

const CLOSED_STATUSES = new Set<TaskStatus>(["completed", "cancelled", "superseded", "not_applicable"]);

function isOverdue(task: Task) {
  // Overdue is deliberately derived, not a stored status - a task can be
  // simultaneously overdue AND blocked, which a single enum value can't
  // represent (see migration 125's rationale).
  return !!task.due_date && !CLOSED_STATUSES.has(task.status) && new Date(task.due_date) < new Date(new Date().toDateString());
}

const PRIORITY_TONE: Record<Task["priority"], string> = {
  low: "text-slate-light border-ink-mid",
  normal: "text-slate-light border-ink-mid",
  high: "text-amber-300 border-amber-500/30",
  urgent: "text-red-300 border-red-500/30",
};

function normalizeError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message || fallback;
}

function groupKey(task: Task) {
  return task.entity_type && task.entity_id ? `${task.entity_type}:${task.entity_id}` : "unlinked";
}

function stackLabel(tasks: Task[]) {
  const first = tasks[0];
  if (!first?.entity_type) return "General tasks";
  const name = first.entity_name || first.entity_id?.slice(0, 8) || "Unknown";
  return `${first.entity_type} · ${name}`;
}

function isAssignedTask(task: Task) {
  return !!task.assigned_to_user_id || !!task.assigned_to_team_id;
}

function isActiveAssignedTask(task: Task) {
  return isAssignedTask(task) && !CLOSED_STATUSES.has(task.status);
}

const PRIORITY_BORDER: Record<Task["priority"], string> = {
  low: "border-l-ink-mid",
  normal: "border-l-ink-mid",
  high: "border-l-amber-500/50",
  urgent: "border-l-red-500/60",
};

const DEPARTMENT_TABS: { value: string; label: string }[] = [
  { value: "commercial", label: "Commercial" },
  { value: "construction", label: "Construction" },
  { value: "plant_equipment", label: "Plant & Equipment" },
];

const ENTITY_STAGE_GUIDANCE: Record<string, string> = {
  lead: "Lead work is qualification, paperwork capture, site/client follow-up, and conversion readiness.",
  opportunity: "Opportunity work is scope clarity, pricing readiness, bid strategy, and client decision support.",
  tender: "Tender work is BOQ, quotation, subcontractor sourcing, compliance documents, bonds, and deadline control.",
  project: "Project work is handover, pre-mobilisation, site controls, budget discipline, requisitions, and delivery proof.",
};

export default function CrmTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [department, setDepartment] = useState<string>(DEPARTMENT_TABS[0].value);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stackTeamPick, setStackTeamPick] = useState<Record<string, string>>({});
  const [assigningStack, setAssigningStack] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [progress, setProgress] = useState<{
    users: TaskProgressRow[];
    teams: TaskProgressRow[];
    overall: { open: number; completed: number; overdue: number; total: number; pct_complete: number };
  } | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [assignmentView, setAssignmentView] = useState<"needs_assignment" | "assigned" | "all">("needs_assignment");
  const [selectedStackKey, setSelectedStackKey] = useState<string>("all");
  const [openStacks, setOpenStacks] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksRes, usersRes, teamsRes, progressRes] = await Promise.all([
        getCrmTasks({
          department,
          status: statusFilter !== "all" ? statusFilter : undefined,
          assigned_to_user_id: assigneeFilter !== "all" ? assigneeFilter : undefined,
        }),
        getAssignableUsers(),
        getTeams(),
        // Caught independently: a 403 here (no crm_tasks.read_all) is the
        // permission gate doing its job, not an error - it must not fail
        // the Promise.all and blank out tasks/users/teams for everyone else.
        getCrmTaskProgressSummary().catch(() => null),
      ]);
      if (tasksRes.success && Array.isArray(tasksRes.data)) setTasks(tasksRes.data);
      if (usersRes.success && Array.isArray(usersRes.data)) setUsers(usersRes.data);
      if (teamsRes.success && Array.isArray(teamsRes.data)) setTeams(teamsRes.data);
      if (progressRes?.success && progressRes.data) setProgress(progressRes.data);
    } catch (e) {
      setError(normalizeError(e, "Tasks did not load."));
    } finally {
      setLoading(false);
    }
  }, [department, statusFilter, assigneeFilter]);

  useEffect(() => { void load(); }, [load]);

  const handleBackfill = async () => {
    setBackfilling(true);
    setError(null);
    try {
      const res = await backfillCrmTaskStacks();
      if (!res.success) throw new Error("Backfill could not run.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Backfill could not run."));
    } finally {
      setBackfilling(false);
    }
  };

  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = groupKey(task);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(task);
    }
    return Array.from(map.entries()).sort((a, b) => stackLabel(a[1]).localeCompare(stackLabel(b[1])));
  }, [tasks]);

  const stackOptions = useMemo(() => {
    return groups.map(([key, groupTasks]) => ({ key, label: stackLabel(groupTasks), count: groupTasks.length }));
  }, [groups]);

  const filteredGroups = useMemo(() => {
    const byStack = selectedStackKey === "all" ? groups : groups.filter(([key]) => key === selectedStackKey);
    return byStack
      .map(([key, groupTasks]) => {
        const byCompletion = showCompleted ? groupTasks : groupTasks.filter((t) => !CLOSED_STATUSES.has(t.status));
        const byAssignment = byCompletion.filter((task) => {
          if (assignmentView === "needs_assignment") return !isAssignedTask(task);
          if (assignmentView === "assigned") return isActiveAssignedTask(task);
          return true;
        });
        return [key, byAssignment] as [string, Task[]];
      })
      .filter(([, groupTasks]) => groupTasks.length > 0);
  }, [assignmentView, groups, selectedStackKey, showCompleted]);

  const boardTasks = useMemo(() => {
    const byStack = selectedStackKey === "all" ? groups : groups.filter(([key]) => key === selectedStackKey);
    return byStack.flatMap(([, groupTasks]) => {
      return groupTasks.filter((task) => {
        if (!showCompleted && CLOSED_STATUSES.has(task.status)) return false;
        if (statusFilter !== "all" && task.status !== statusFilter) return false;
        if (assigneeFilter !== "all" && task.assigned_to_user_id !== assigneeFilter) return false;
        return true;
      });
    });
  }, [assigneeFilter, groups, selectedStackKey, showCompleted, statusFilter]);

  const assignmentSummary = useMemo(() => {
    const openTasks = tasks.filter((task) => !CLOSED_STATUSES.has(task.status));
    return {
      unassigned: openTasks.filter((task) => !isAssignedTask(task)).length,
      assigned: openTasks.filter(isAssignedTask).length,
      underReview: openTasks.filter((task) => task.status === "under_review").length,
      overdue: openTasks.filter(isOverdue).length,
    };
  }, [tasks]);

  const workload = useMemo(() => {
    const byUser = new Map<string, { name: string; open: number; overdue: number }>();
    for (const task of tasks) {
      if (!task.assigned_to_user_id || !task.assigned_to_name) continue;
      if (task.status === "completed" || task.status === "cancelled") continue;
      const entry = byUser.get(task.assigned_to_user_id) ?? { name: task.assigned_to_name, open: 0, overdue: 0 };
      entry.open += 1;
      if (isOverdue(task)) entry.overdue += 1;
      byUser.set(task.assigned_to_user_id, entry);
    }
    return Array.from(byUser.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  }, [tasks]);

  const handleToggleDone = async (task: Task) => {
    // Reopening is always unrestricted. Completing is two-step: the assignee
    // submits proof, then a team lead / approver verifies the work.
    if (task.status === "completed") {
      setBusyId(task.id);
      setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, status: "not_started" } : t)));
      try {
        const res = await updateCrmTask(task.id, { status: "not_started" });
        if (!res.success) throw new Error("Task could not be reopened.");
      } catch (e) {
        setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)));
        setError(normalizeError(e, "Task could not be reopened."));
      } finally {
        setBusyId(null);
      }
      return;
    }

    const entered = window.prompt(
      task.status === "under_review"
        ? `"${task.title}" is under review. Verify it with the proof/reference below:`
        : `"${task.title}" needs proof before it can be submitted as complete. Paste a document link or reference:`,
      task.evidence_ref ?? "",
    );
    if (entered === null) return;
    if (!entered.trim()) {
      setError("Proof is required before this task can be submitted for completion.");
      return;
    }
    const evidenceRef = entered.trim();

    setBusyId(task.id);
    setError(null);
    try {
      const res = await updateCrmTask(task.id, { status: "completed", evidence_ref: evidenceRef });
      if (!res.success) throw new Error("Task could not be submitted or verified.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Task could not be submitted or verified."));
    } finally {
      setBusyId(null);
    }
  };

  const handleAddContributor = async (task: Task, userId: string) => {
    if (!userId) return;
    setBusyId(task.id);
    try {
      const res = await addCrmTaskContributor(task.id, userId);
      if (!res.success) throw new Error("Contributor could not be added.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Contributor could not be added."));
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveContributor = async (task: Task, userId: string) => {
    setBusyId(task.id);
    try {
      const res = await removeCrmTaskContributor(task.id, userId);
      if (!res.success) throw new Error("Contributor could not be removed.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Contributor could not be removed."));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (task: Task) => {
    if (!window.confirm(`Delete task "${task.title}"?`)) return;
    setBusyId(task.id);
    try {
      const res = await deleteCrmTask(task.id);
      if (!res.success) throw new Error("Task could not be deleted.");
      setTasks((current) => current.filter((t) => t.id !== task.id));
    } catch (e) {
      setError(normalizeError(e, "Task could not be deleted."));
    } finally {
      setBusyId(null);
    }
  };

  const handleDistribute = async (task: Task, userId: string) => {
    setBusyId(task.id);
    try {
      const res = await updateCrmTask(task.id, { assigned_to_user_id: userId || null });
      if (!res.success) throw new Error("Task could not be reassigned.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Task could not be reassigned."));
    } finally {
      setBusyId(null);
    }
  };

  const handleBoardStatusChange = async (task: Task, newStatus: TaskStatus) => {
    if (task.status === newStatus) return;
    let evidenceRef: string | undefined;
    if (newStatus === "completed" || newStatus === "under_review") {
      const entered = window.prompt(
        newStatus === "completed"
          ? `"${task.title}" needs proof before completion/verification. Paste a document link or reference:`
          : `"${task.title}" needs proof before review. Paste a document link or reference:`,
        task.evidence_ref ?? "",
      );
      if (entered === null) return;
      if (!entered.trim()) {
        setError("Proof is required before this task can be submitted for completion.");
        return;
      }
      evidenceRef = entered.trim();
    }
    setBusyId(task.id);
    setError(null);
    try {
      const res = await updateCrmTask(task.id, { status: newStatus, ...(evidenceRef ? { evidence_ref: evidenceRef } : {}) });
      if (!res.success) throw new Error("Task status could not be updated.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Task status could not be updated."));
    } finally {
      setBusyId(null);
    }
  };

  const handleAssignStack = async (key: string, entityType: string, entityId: string) => {
    const teamId = stackTeamPick[key];
    if (!teamId) return;
    setAssigningStack(key);
    setError(null);
    try {
      const res = await assignTaskStack(entityType, entityId, teamId);
      if (!res.success) throw new Error("Stack could not be assigned to that team.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Stack could not be assigned to that team."));
    } finally {
      setAssigningStack(null);
    }
  };

  return (
    <div className="min-h-screen bg-ink px-4 py-6 text-paper sm:px-6 xl:px-8">
      <div className="mx-auto w-full max-w-[1500px] space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/dashboard/crm" className="inline-flex items-center gap-1.5 text-xs text-slate-light hover:text-paper">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to CRM
            </Link>
            <h1 className="mt-2 font-display text-2xl font-semibold text-paper">Tasks</h1>
            <p className="mt-1 text-sm text-slate-light">Grouped by the lead/opportunity/tender/project they belong to. Assign a whole stack to a team, then distribute individual items to people.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleBackfill()}
              disabled={backfilling}
              title="Generate task stacks for existing records that predate auto-generation"
              className="flex items-center gap-1.5 border border-ink-mid px-3 py-2 text-xs uppercase tracking-wider text-slate-light hover:text-paper disabled:opacity-40"
            >
              {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />} Backfill Stacks
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 border border-signal bg-signal/10 px-4 py-2 text-xs uppercase tracking-wider text-signal hover:bg-signal/20"
            >
              <Plus className="h-3.5 w-3.5" /> New Task
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <button
            type="button"
            onClick={() => setAssignmentView("needs_assignment")}
            className={`border p-3 text-left transition-colors ${assignmentView === "needs_assignment" ? "border-signal bg-signal/10" : "border-ink-mid bg-ink-light/25 hover:border-slate"}`}
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Needs assignment</p>
            <p className="mt-1 text-2xl font-semibold text-paper">{assignmentSummary.unassigned}</p>
          </button>
          <button
            type="button"
            onClick={() => setAssignmentView("assigned")}
            className={`border p-3 text-left transition-colors ${assignmentView === "assigned" ? "border-signal bg-signal/10" : "border-ink-mid bg-ink-light/25 hover:border-slate"}`}
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Assigned / in motion</p>
            <p className="mt-1 text-2xl font-semibold text-paper">{assignmentSummary.assigned}</p>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("under_review")}
            className="border border-ink-mid bg-ink-light/25 p-3 text-left transition-colors hover:border-slate"
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Needs verification</p>
            <p className="mt-1 text-2xl font-semibold text-paper">{assignmentSummary.underReview}</p>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className="border border-ink-mid bg-ink-light/25 p-3 text-left transition-colors hover:border-slate"
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Overdue open work</p>
            <p className={`mt-1 text-2xl font-semibold ${assignmentSummary.overdue > 0 ? "text-red-300" : "text-paper"}`}>{assignmentSummary.overdue}</p>
          </button>
        </div>

        {progress && (
          <div className="border border-ink-mid bg-ink-light/30">
            <button
              type="button"
              onClick={() => setProgressOpen((current) => !current)}
              className="flex w-full items-center justify-between gap-3 p-3 text-left"
            >
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-slate">
                <TrendingUp className="h-3.5 w-3.5 text-signal" /> Team Progress
                <span className="text-slate-light">
                  {progress.overall.completed}/{progress.overall.total} complete ({progress.overall.pct_complete}%)
                  {progress.overall.overdue > 0 ? ` · ${progress.overall.overdue} overdue` : ""}
                </span>
              </span>
              <ChevronDown className={`h-3.5 w-3.5 text-slate-light transition-transform ${progressOpen ? "rotate-180" : ""}`} />
            </button>
            {progressOpen && (
              <div className="grid gap-4 border-t border-ink-mid p-3 sm:grid-cols-2">
                <ProgressColumn title="By person" rows={progress.users} labelKey="full_name" />
                <ProgressColumn title="By team" rows={progress.teams} labelKey="name" />
              </div>
            )}
          </div>
        )}

        {workload.length > 0 && (
          <div className="flex flex-wrap gap-2 border border-ink-mid bg-ink-light/30 p-3">
            <span className="mr-1 flex items-center font-mono text-[10px] uppercase tracking-wider text-slate">Who&apos;s carrying what</span>
            {workload.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setAssigneeFilter((current) => (current === w.id ? "all" : w.id))}
                title={`${w.name}: ${w.open} open${w.overdue ? `, ${w.overdue} overdue` : ""}`}
                className={`flex items-center gap-2 border px-2 py-1 transition-colors ${
                  assigneeFilter === w.id ? "border-signal bg-signal/10" : "border-ink-mid hover:border-slate"
                }`}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px] font-bold ${avatarTone(w.id)}`}>
                  {initials(w.name)}
                </span>
                <span className="text-xs text-paper">{w.name}</span>
                <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold ${w.overdue > 0 ? "bg-red-500/20 text-red-300" : "bg-ink-mid text-slate-light"}`}>
                  {w.overdue > 0 ? `${w.overdue} late` : w.open}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex overflow-x-auto border-b border-ink-mid">
          {DEPARTMENT_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setDepartment(tab.value)}
              className={`shrink-0 border-b-2 px-4 py-2.5 text-xs uppercase tracking-wider ${
                department === tab.value ? "border-signal text-signal" : "border-transparent text-slate-light hover:text-paper"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid gap-2 lg:grid-cols-[minmax(240px,1.4fr)_minmax(160px,0.8fr)_minmax(180px,0.8fr)_auto_auto]">
          <select
            value={selectedStackKey}
            onChange={(e) => {
              setSelectedStackKey(e.target.value);
              if (e.target.value !== "all") setOpenStacks((current) => ({ ...current, [e.target.value]: true }));
            }}
            className="border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
          >
            <option value="all">All task stacks</option>
            {stackOptions.map((stack) => (
              <option key={stack.key} value={stack.key}>{stack.label} ({stack.count})</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper">
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper">
            <option value="all">All assignees</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <select value={assignmentView} onChange={(e) => setAssignmentView(e.target.value as typeof assignmentView)} className="border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper">
            <option value="needs_assignment">Needs assignment</option>
            <option value="assigned">Assigned / in motion</option>
            <option value="all">All work</option>
          </select>
          <label className="flex items-center gap-1.5 border border-ink-mid px-3 py-1.5 text-xs text-slate-light">
            <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} /> Show completed
          </label>
          <div className="flex border border-ink-mid">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 text-xs uppercase tracking-wider ${viewMode === "list" ? "bg-signal/10 text-signal" : "text-slate-light hover:text-paper"}`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode("board")}
              className={`border-l border-ink-mid px-3 py-1.5 text-xs uppercase tracking-wider ${viewMode === "board" ? "bg-signal/10 text-signal" : "text-slate-light hover:text-paper"}`}
            >
              Board
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-red-300">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-light">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-light">No tasks match these filters.</p>
        ) : viewMode === "board" ? (
          <TaskBoard tasks={boardTasks} busyId={busyId} onStatusChange={handleBoardStatusChange} />
        ) : (
          <div className="space-y-6">
            {filteredGroups.map(([key, groupTasks]) => {
              const [entityType, entityId] = key === "unlinked" ? [null, null] : key.split(":");
              const doneCount = groupTasks.filter((t) => t.status === "completed").length;
              const isOpen = selectedStackKey !== "all" || (openStacks[key] ?? filteredGroups.length <= 3);
              return (
                <div key={key} className="border border-ink-mid">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-mid bg-ink-light/40 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => setOpenStacks((current) => ({ ...current, [key]: !isOpen }))}
                      className="flex min-w-0 items-center gap-2 text-left"
                    >
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-light transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      <Layers className="h-3.5 w-3.5 shrink-0 text-signal" />
                      <span className="truncate font-mono text-[10px] uppercase tracking-wider text-slate-light">{stackLabel(groupTasks)}</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-light">
                        <span className="h-1 w-14 overflow-hidden rounded-full bg-ink-mid">
                          <span
                            className={`block h-full rounded-full ${doneCount === groupTasks.length ? "bg-emerald-400" : "bg-signal"}`}
                            style={{ width: `${(doneCount / groupTasks.length) * 100}%` }}
                          />
                        </span>
                        {doneCount}/{groupTasks.length}
                      </span>
                    </button>
                    {entityType && entityId && (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={stackTeamPick[key] ?? ""}
                          onChange={(e) => setStackTeamPick((current) => ({ ...current, [key]: e.target.value }))}
                          className="border border-ink-mid bg-ink px-2 py-1 text-[11px] text-paper"
                        >
                          <option value="">-- Assign stack to team --</option>
                          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <button
                          type="button"
                          disabled={!stackTeamPick[key] || assigningStack === key}
                          onClick={() => void handleAssignStack(key, entityType, entityId)}
                          className="flex items-center gap-1 border border-ink-mid px-2 py-1 text-[11px] text-slate-light hover:text-paper disabled:opacity-40"
                        >
                          {assigningStack === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />} Assign
                        </button>
                      </div>
                    )}
                  </div>
                  {entityType && ENTITY_STAGE_GUIDANCE[entityType] && (
                    <p className="border-b border-ink-mid bg-ink/40 px-4 py-2 text-xs text-slate-light">{ENTITY_STAGE_GUIDANCE[entityType]}</p>
                  )}
                  {!showCompleted && doneCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowCompleted(true)}
                      className="flex w-full items-center gap-1.5 border-b border-ink-mid bg-ink-light/20 px-4 py-1.5 text-[10px] uppercase tracking-wider text-slate-light hover:text-paper"
                    >
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" /> {doneCount} completed hidden
                    </button>
                  )}
                  {isOpen && (
                  <ul className="divide-y divide-ink-mid">
                    {groupTasks.map((task) => {
                      const blockedByPredecessor = !!task.depends_on_task_id && task.depends_on_status !== "completed";
                      const availableContributors = users.filter((u) => !task.contributors.some((c) => c.id === u.id));
                      return (
                        <li key={task.id} className={`flex items-start gap-3 border-l-2 p-4 ${PRIORITY_BORDER[task.priority]}`}>
                          <button
                            type="button"
                            disabled={busyId === task.id || blockedByPredecessor}
                            title={
                              blockedByPredecessor
                                ? `Blocked until "${task.depends_on_title}" is completed`
                                : task.status === "under_review"
                                  ? "Verify submitted work"
                                  : "Submit proof for completion"
                            }
                            onClick={() => void handleToggleDone(task)}
                            className="mt-0.5 shrink-0 disabled:opacity-40"
                          >
                            {blockedByPredecessor ? (
                              <Lock className="h-4.5 w-4.5 text-slate-light" />
                            ) : task.status === "completed" ? (
                              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400" />
                            ) : task.status === "under_review" ? (
                              <ShieldCheck className="h-4.5 w-4.5 text-amber-300" />
                            ) : (
                              <Circle className="h-4.5 w-4.5 text-slate-light" />
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className={`text-sm font-medium ${task.status === "completed" ? "text-slate-light line-through" : "text-paper"}`}>{task.title}</p>
                              <span className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${PRIORITY_TONE[task.priority]}`}>{task.priority}</span>
                              {task.source === "template" && (
                                <span className="border border-signal/30 bg-signal/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-signal">Auto</span>
                              )}
                              {task.status !== "not_started" && task.status !== "completed" && (
                                <span className="border border-ink-mid px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-light">
                                  {STATUS_OPTIONS.find((s) => s.value === task.status)?.label}
                                </span>
                              )}
                              {isAssignedTask(task) && (
                                <span className="flex items-center gap-1 border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-sky-200">
                                  <UserCheck className="h-2.5 w-2.5" /> Assigned
                                </span>
                              )}
                              {task.gate_effect === "blocking" && (
                                <span className="border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-red-200">Blocking</span>
                              )}
                              {task.requirement_code && (
                                <span className="border border-ink-mid px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-light">{task.requirement_code}</span>
                              )}
                              {task.risk_flag && (
                                <span title="Risk flagged" className="flex items-center gap-1 border border-amber-500/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">
                                  <AlertTriangle className="h-2.5 w-2.5" /> Risk
                                </span>
                              )}
                              {isOverdue(task) && (
                                <span className="border border-red-500/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-red-300">Overdue</span>
                              )}
                              {task.verified_at && (
                                <span title={`Verified by ${task.approver_name ?? "approver"}`} className="flex items-center gap-1 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-400">
                                  <ShieldCheck className="h-2.5 w-2.5" /> Verified
                                </span>
                              )}
                            </div>
                            {task.description && <p className="mt-1 text-xs text-slate-light">{task.description}</p>}
                            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-light">
                              {task.due_date && (
                                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(task.due_date).toLocaleDateString()}</span>
                              )}
                              {task.depends_on_title && (
                                <span className="flex items-center gap-1"><Link2 className="h-3 w-3" /> After: {task.depends_on_title}</span>
                              )}
                              <span className="flex items-center gap-1">
                                <ShieldCheck className="h-3 w-3" /> Proof required{task.approver_name ? ` · Approver: ${task.approver_name}` : ""}
                              </span>
                              {task.evidence_ref && (
                                <span className="flex items-center gap-1 text-emerald-300">
                                  <Link2 className="h-3 w-3" /> Proof attached
                                </span>
                              )}
                              {task.quotation_id ? (
                                <Link
                                  href={`/dashboard/quotations/builder?edit=${task.quotation_id}`}
                                  className="flex items-center gap-1 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-400 hover:bg-emerald-950/20"
                                >
                                  <FileSpreadsheet className="h-3 w-3" /> Quotation
                                </Link>
                              ) : task.entity_type && QUOTABLE_ENTITY_TYPES.has(task.entity_type) && task.entity_id ? (
                                <Link
                                  href={`/dashboard/quotations/builder?source_type=${task.entity_type}&source_id=${task.entity_id}&task_id=${task.id}`}
                                  className="flex items-center gap-1 border border-dashed border-ink-mid px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-light hover:border-signal hover:text-signal"
                                >
                                  <FileSpreadsheet className="h-3 w-3" /> Build Quotation
                                </Link>
                              ) : null}
                              {task.boq_imported_at && (
                                <span className="flex items-center gap-1 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">
                                  <FileSpreadsheet className="h-3 w-3" /> BOQ imported
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              {task.assigned_to_team_name && (
                                <span className="text-[11px] text-slate-light">Team: <span className="text-paper">{task.assigned_to_team_name}</span> ·</span>
                              )}
                              {task.assigned_to_user_id && task.assigned_to_name && (
                                <span className={`flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[9px] font-bold ${avatarTone(task.assigned_to_user_id)}`} title={task.assigned_to_name}>
                                  {initials(task.assigned_to_name)}
                                </span>
                              )}
                              <select
                                value={task.assigned_to_user_id ?? ""}
                                onChange={(e) => void handleDistribute(task, e.target.value)}
                                disabled={busyId === task.id}
                                className="border border-ink-mid bg-ink-light px-2 py-1 text-[11px] text-paper disabled:opacity-40"
                              >
                                <option value="">{task.assigned_to_team_name ? "-- Distribute to a person --" : "-- Unassigned --"}</option>
                                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                              </select>
                              {task.contributors.map((c) => (
                                <span key={c.id} className="flex items-center gap-1 border border-ink-mid px-1.5 py-0.5 text-[11px] text-slate-light">
                                  {c.full_name}
                                  <button type="button" onClick={() => void handleRemoveContributor(task, c.id)} disabled={busyId === task.id} className="hover:text-red-300 disabled:opacity-40">
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                </span>
                              ))}
                              {availableContributors.length > 0 && (
                                <select
                                  value=""
                                  onChange={(e) => void handleAddContributor(task, e.target.value)}
                                  disabled={busyId === task.id}
                                  title="Add a contributor"
                                  className="border border-dashed border-ink-mid bg-ink px-1.5 py-0.5 text-[11px] text-slate-light disabled:opacity-40"
                                >
                                  <option value="">+ Contributor</option>
                                  {availableContributors.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                                </select>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={busyId === task.id}
                            onClick={() => void handleDelete(task)}
                            className="shrink-0 rounded-sm p-1.5 text-slate-light hover:bg-red-950/40 hover:text-red-300 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateTaskModal
          users={users}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void load(); }}
        />
      )}
    </div>
  );
}

// Native HTML5 drag-and-drop (draggable/onDragStart/onDragOver/onDrop) -
// same mechanism already used by the opportunities Kanban board
// (crm/opportunities/page.tsx's OpportunitiesKanban), so no drag-and-drop
// library gets added to the project just for this view.
const BOARD_COLUMNS: { key: string; label: string; dropStatus: TaskStatus; match: (task: Task) => boolean }[] = [
  {
    key: "unassigned",
    label: "Needs Assignment",
    dropStatus: "ready",
    match: (task) => !isAssignedTask(task) && !CLOSED_STATUSES.has(task.status),
  },
  {
    key: "assigned",
    label: "Assigned",
    dropStatus: "ready",
    match: (task) => isAssignedTask(task) && ["planned", "not_started", "ready"].includes(task.status),
  },
  {
    key: "in_progress",
    label: "In Progress",
    dropStatus: "in_progress",
    match: (task) => isAssignedTask(task) && ["in_progress", "waiting_on_third_party"].includes(task.status),
  },
  { key: "under_review", label: "Under Review", dropStatus: "under_review", match: (task) => task.status === "under_review" },
  { key: "completed", label: "Completed", dropStatus: "completed", match: (task) => task.status === "completed" },
  { key: "blocked", label: "Blocked / Rejected", dropStatus: "blocked", match: (task) => ["blocked", "rejected"].includes(task.status) },
];

function TaskBoard({ tasks, busyId, onStatusChange }: { tasks: Task[]; busyId: string | null; onStatusChange: (task: Task, status: TaskStatus) => void }) {
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {BOARD_COLUMNS.map((column) => {
        const columnTasks = tasks.filter(column.match);
        return (
          <div
            key={column.key}
            onDragOver={(e) => { e.preventDefault(); }}
            onDragEnter={(e) => { e.preventDefault(); setDragOverColumn(column.key); }}
            onDragLeave={() => setDragOverColumn((current) => (current === column.key ? null : current))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverColumn(null);
              const taskId = e.dataTransfer.getData("text/plain");
              const task = tasks.find((t) => t.id === taskId);
              if (task) onStatusChange(task, column.dropStatus);
            }}
            className={`min-h-[300px] w-64 shrink-0 border p-2 transition-colors ${
              dragOverColumn === column.key ? "border-signal bg-signal/5" : "border-ink-mid bg-ink-light/20"
            }`}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">{column.label}</span>
              <span className="rounded-full bg-ink-mid px-1.5 py-0.5 font-mono text-[10px] text-slate-light">{columnTasks.length}</span>
            </div>
            <div className="space-y-2">
              {columnTasks.map((task) => (
                <div
                  key={task.id}
                  draggable={busyId !== task.id}
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", task.id); e.dataTransfer.effectAllowed = "move"; }}
                  className={`border-l-2 border border-ink-mid bg-ink p-2.5 ${PRIORITY_BORDER[task.priority]} ${busyId === task.id ? "opacity-40" : "cursor-grab active:cursor-grabbing"}`}
                >
                  <p className={`text-xs font-medium ${task.status === "completed" ? "text-slate-light line-through" : "text-paper"}`}>{task.title}</p>
                  {task.entity_name && (
                    <p className="mt-0.5 truncate text-[10px] text-slate-light">{task.entity_type} · {task.entity_name}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {task.assigned_to_name && (
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[9px] font-bold ${avatarTone(task.assigned_to_user_id ?? task.id)}`} title={task.assigned_to_name}>
                        {initials(task.assigned_to_name)}
                      </span>
                    )}
                    {isOverdue(task) && (
                      <span className="border border-red-500/30 px-1 py-0.5 text-[9px] uppercase tracking-wider text-red-300">Overdue</span>
                    )}
                    {task.due_date && (
                      <span className="font-mono text-[10px] text-slate-light">{new Date(task.due_date).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProgressColumn({ title, rows, labelKey }: { title: string; rows: TaskProgressRow[]; labelKey: "full_name" | "name" }) {
  return (
    <div className="space-y-2">
      <p className="font-mono text-[9px] uppercase tracking-wider text-slate">{title}</p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-light">Nothing assigned yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="space-y-1">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="truncate text-paper">{row[labelKey] ?? "—"}</span>
                <span className="shrink-0 text-slate-light">
                  {row.completed}/{row.total}{row.overdue > 0 ? ` · ${row.overdue} late` : ""}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full border border-ink-mid bg-ink-light">
                <div
                  className={`h-full transition-all duration-500 ${row.overdue > 0 ? "bg-red-400" : "bg-signal"}`}
                  style={{ width: `${row.pct_complete}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateTaskModal({ users, onClose, onCreated }: { users: AssignableUser[]; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("normal");
  const [evidenceRequired, setEvidenceRequired] = useState(false);
  const [approverId, setApproverId] = useState("");
  const [riskFlag, setRiskFlag] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createCrmTask({
        title: title.trim(),
        description: description.trim() || undefined,
        assigned_to_user_id: assignedTo || undefined,
        due_date: dueDate || undefined,
        priority,
        task_type: "personal_action",
        evidence_required: evidenceRequired,
        approver_user_id: evidenceRequired && approverId ? approverId : undefined,
        risk_flag: riskFlag,
      });
      if (!res.success) throw new Error("Task could not be created.");
      onCreated();
    } catch (e2) {
      setError(normalizeError(e2, "Task could not be created."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md border border-ink-mid bg-ink" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <p className="text-sm font-semibold text-paper">New Task</p>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <form onSubmit={handleSubmit} className="space-y-3 p-4">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-light">Title</label>
            <input required value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper" placeholder="e.g. Follow up with client on BOQ" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-light">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full resize-none border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-light">Assign to</label>
              <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper">
                <option value="">-- Unassigned --</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-light">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Task["priority"])} className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-light">Due date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper" />
          </div>

          <div className="space-y-2 border-t border-ink-mid pt-3">
            <label className="flex items-center gap-2 text-xs text-slate-light">
              <input type="checkbox" checked={riskFlag} onChange={(e) => setRiskFlag(e.target.checked)} /> Flag as risk exposure
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-light">
              <input type="checkbox" checked={evidenceRequired} onChange={(e) => setEvidenceRequired(e.target.checked)} /> Needs named approver as well as team-lead verification
            </label>
            {evidenceRequired && (
              <select value={approverId} onChange={(e) => setApproverId(e.target.value)} className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper">
                <option value="">-- Approver --</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            )}
          </div>

          {error && <p className="text-xs text-red-300">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="border border-ink-mid px-4 py-2 text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
            <button type="submit" disabled={submitting || !title.trim()} className="flex items-center gap-1.5 border border-signal bg-signal/10 px-4 py-2 text-xs uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-40">
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
