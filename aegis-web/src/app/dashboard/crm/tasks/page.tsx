"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar, CheckCircle2, Circle, Layers, Loader2, Plus, Trash2, Users, X } from "lucide-react";
import {
  getCrmTasks,
  createCrmTask,
  updateCrmTask,
  deleteCrmTask,
  getAssignableUsers,
  getTeams,
  assignTaskStack,
  backfillCrmTaskStacks,
} from "@/lib/api";

interface Task {
  id: string;
  title: string;
  description: string | null;
  entity_type: string | null;
  entity_id: string | null;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  assigned_to_team_id: string | null;
  assigned_to_team_name: string | null;
  source: "manual" | "template";
  due_date: string | null;
  status: "open" | "in_progress" | "done" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  created_at: string;
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

const STATUS_OPTIONS: { value: Task["status"]; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

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

  const handleToggleDone = async (task: Task) => {
    setBusyId(task.id);
    const nextStatus = task.status === "done" ? "open" : "done";
    setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    try {
      const res = await updateCrmTask(task.id, { status: nextStatus });
      if (!res.success) throw new Error("Task could not be updated.");
    } catch (e) {
      setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)));
      setError(normalizeError(e, "Task could not be updated."));
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
              return (
                <div key={key} className="border border-ink-mid">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-mid bg-ink-light/40 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5 text-signal" />
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">
                        {entityType ? `${entityType} · ${entityId?.slice(0, 8)}` : "General tasks"}
                      </span>
                      <span className="text-[11px] text-slate-light">({groupTasks.length})</span>
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
                    {groupTasks.map((task) => (
                      <li key={task.id} className="flex items-start gap-3 p-4">
                        <button
                          type="button"
                          disabled={busyId === task.id}
                          onClick={() => void handleToggleDone(task)}
                          className="mt-0.5 shrink-0 disabled:opacity-40"
                        >
                          {task.status === "done" ? (
                            <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400" />
                          ) : (
                            <Circle className="h-4.5 w-4.5 text-slate-light" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`text-sm font-medium ${task.status === "done" ? "text-slate-light line-through" : "text-paper"}`}>{task.title}</p>
                            <span className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${PRIORITY_TONE[task.priority]}`}>{task.priority}</span>
                            {task.source === "template" && (
                              <span className="border border-signal/30 bg-signal/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-signal">Auto</span>
                            )}
                          </div>
                          {task.description && <p className="mt-1 text-xs text-slate-light">{task.description}</p>}
                          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-light">
                            {task.due_date && (
                              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(task.due_date).toLocaleDateString()}</span>
                            )}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2">
                            {task.assigned_to_team_name && !task.assigned_to_user_id && (
                              <span className="text-[11px] text-slate-light">Team: <span className="text-paper">{task.assigned_to_team_name}</span> ·</span>
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
                    ))}
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
