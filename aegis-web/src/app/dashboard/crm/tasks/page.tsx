"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Calendar, CheckCircle2, Circle, Layers, Link2, Loader2, Lock, Plus, ShieldCheck, Trash2, Users, X } from "lucide-react";
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
} from "@/lib/api";
import { initials, avatarTone } from "@/lib/avatar";

type TaskStatus = "not_started" | "in_progress" | "waiting_on_third_party" | "blocked" | "under_review" | "completed" | "cancelled";

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
  risk_flag: boolean;
  outcome: string | null;
  next_action: string | null;
  contributors: { id: string; full_name: string }[];
}

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
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting_on_third_party", label: "Waiting on Third Party" },
  { value: "blocked", label: "Blocked" },
  { value: "under_review", label: "Under Review" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function isOverdue(task: Task) {
  // Overdue is deliberately derived, not a stored status - a task can be
  // simultaneously overdue AND blocked, which a single enum value can't
  // represent (see migration 125's rationale).
  return !!task.due_date && task.status !== "completed" && task.status !== "cancelled" && new Date(task.due_date) < new Date(new Date().toDateString());
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksRes, usersRes, teamsRes] = await Promise.all([
        getCrmTasks({
          department,
          status: statusFilter !== "all" ? statusFilter : undefined,
          assigned_to_user_id: assigneeFilter !== "all" ? assigneeFilter : undefined,
        }),
        getAssignableUsers(),
        getTeams(),
      ]);
      if (tasksRes.success && Array.isArray(tasksRes.data)) setTasks(tasksRes.data);
      if (usersRes.success && Array.isArray(usersRes.data)) setUsers(usersRes.data);
      if (teamsRes.success && Array.isArray(teamsRes.data)) setTeams(teamsRes.data);
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
    return Array.from(map.entries());
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
    // Reopening is always unrestricted (the gate below only guards the
    // not-completed -> completed transition), and a task blocked on an
    // unfinished predecessor doesn't even reach here - its toggle is
    // disabled in the JSX below.
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

    let evidenceRef: string | undefined;
    if (task.evidence_required) {
      // Evidence-gated completion: the backend rejects this unless the
      // caller is the task's approver (or holds crm_tasks.read_all) and
      // evidence_ref is set - prompt for it here rather than silently
      // failing the PATCH.
      const entered = window.prompt(
        `"${task.title}" requires evidence to complete. Paste a document link or reference:`,
        task.evidence_ref ?? "",
      );
      if (entered === null) return;
      if (!entered.trim()) {
        setError("Evidence is required to complete this task.");
        return;
      }
      evidenceRef = entered.trim();
    }

    setBusyId(task.id);
    setError(null);
    try {
      const res = await updateCrmTask(task.id, { status: "completed", ...(evidenceRef ? { evidence_ref: evidenceRef } : {}) });
      if (!res.success) throw new Error("Task could not be completed.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Task could not be completed."));
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
    <div className="min-h-screen bg-ink p-6 text-paper">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-start justify-between">
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

        <div className="flex flex-wrap gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper">
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper">
            <option value="all">All assignees</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>

        {error && <p className="text-sm text-red-300">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-light">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-light">No tasks match these filters.</p>
        ) : (
          <div className="space-y-6">
            {groups.map(([key, groupTasks]) => {
              const [entityType, entityId] = key === "unlinked" ? [null, null] : key.split(":");
              const doneCount = groupTasks.filter((t) => t.status === "completed").length;
              return (
                <div key={key} className="border border-ink-mid">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-mid bg-ink-light/40 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5 text-signal" />
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">
                        {entityType ? `${entityType} · ${groupTasks[0]?.entity_name || entityId?.slice(0, 8)}` : "General tasks"}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-light">
                        <span className="h-1 w-14 overflow-hidden rounded-full bg-ink-mid">
                          <span
                            className={`block h-full rounded-full ${doneCount === groupTasks.length ? "bg-emerald-400" : "bg-signal"}`}
                            style={{ width: `${(doneCount / groupTasks.length) * 100}%` }}
                          />
                        </span>
                        {doneCount}/{groupTasks.length}
                      </span>
                    </div>
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
                  <ul className="divide-y divide-ink-mid">
                    {groupTasks.map((task) => {
                      const blockedByPredecessor = !!task.depends_on_task_id && task.depends_on_status !== "completed";
                      const availableContributors = users.filter((u) => !task.contributors.some((c) => c.id === u.id));
                      return (
                        <li key={task.id} className={`flex items-start gap-3 border-l-2 p-4 ${PRIORITY_BORDER[task.priority]}`}>
                          <button
                            type="button"
                            disabled={busyId === task.id || blockedByPredecessor}
                            title={blockedByPredecessor ? `Blocked until "${task.depends_on_title}" is completed` : task.evidence_required ? "Requires evidence to complete" : undefined}
                            onClick={() => void handleToggleDone(task)}
                            className="mt-0.5 shrink-0 disabled:opacity-40"
                          >
                            {blockedByPredecessor ? (
                              <Lock className="h-4.5 w-4.5 text-slate-light" />
                            ) : task.status === "completed" ? (
                              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400" />
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
                              {task.evidence_required && (
                                <span className="flex items-center gap-1">
                                  <ShieldCheck className="h-3 w-3" /> Evidence required{task.approver_name ? ` · Approver: ${task.approver_name}` : ""}
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              {task.assigned_to_team_name && !task.assigned_to_user_id && (
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
              <input type="checkbox" checked={evidenceRequired} onChange={(e) => setEvidenceRequired(e.target.checked)} /> Requires evidence + approver sign-off to complete
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
