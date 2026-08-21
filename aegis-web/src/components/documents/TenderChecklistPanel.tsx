"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckSquare, Loader2, Square, Trash2, Plus, UserPlus, Calendar } from "lucide-react";
import {
  getTenderRequirements,
  createTenderRequirement,
  toggleTenderRequirement,
  deleteTenderRequirement,
  convertTenderRequirementToTask,
  getAssignableUsers,
} from "@/lib/api";
import { initials, avatarTone } from "@/lib/avatar";

interface RequirementRecord {
  id: string;
  label: string;
  is_satisfied: boolean;
  satisfied_document_id: string | null;
  linked_task_id: string | null;
  task_assigned_to_user_id: string | null;
  task_assigned_to_name: string | null;
  task_status: string | null;
  task_due_date: string | null;
}

interface AssignableUser {
  id: string;
  full_name: string;
  email: string;
}

function normalizeError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message || fallback;
}

/**
 * Freeform per-tender submission checklist (crm.tender_requirements). Items
 * are ticked automatically when an uploaded document's file name matches the
 * item's label (see documents.py's _auto_match_tender_requirements) - or by
 * converting the item into a real crm.tasks row via "Make Task" below, in
 * which case completing that task is what ticks it (see migration 137 and
 * crm_tasks.py's update_task). Anything that doesn't match/convert gets
 * ticked by hand.
 */
export function TenderChecklistPanel({ tenderId }: { tenderId: string }) {
  const [items, setItems] = useState<RequirementRecord[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, usersRes] = await Promise.all([getTenderRequirements(tenderId), getAssignableUsers()]);
      if (!reqRes.success || !Array.isArray(reqRes.data)) throw new Error("Checklist did not load.");
      setItems(reqRes.data);
      if (usersRes.success && Array.isArray(usersRes.data)) setUsers(usersRes.data);
    } catch (e) {
      setError(normalizeError(e, "Checklist did not load."));
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await createTenderRequirement(tenderId, label);
      if (!res.success) throw new Error("Checklist item could not be added.");
      setNewLabel("");
      await load();
    } catch (e2) {
      setError(normalizeError(e2, "Checklist item could not be added."));
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (item: RequirementRecord) => {
    setBusyId(item.id);
    setError(null);
    const next = !item.is_satisfied;
    setItems((current) => current.map((i) => (i.id === item.id ? { ...i, is_satisfied: next } : i)));
    try {
      const res = await toggleTenderRequirement(tenderId, item.id, next);
      if (!res.success) throw new Error("Checklist item could not be updated.");
    } catch (e) {
      setItems((current) => current.map((i) => (i.id === item.id ? { ...i, is_satisfied: item.is_satisfied } : i)));
      setError(normalizeError(e, "Checklist item could not be updated."));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item: RequirementRecord) => {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await deleteTenderRequirement(tenderId, item.id);
      if (!res.success) throw new Error("Checklist item could not be removed.");
      setItems((current) => current.filter((i) => i.id !== item.id));
    } catch (e) {
      setError(normalizeError(e, "Checklist item could not be removed."));
    } finally {
      setBusyId(null);
    }
  };

  const handleConvert = async (item: RequirementRecord, assignedToUserId: string, dueDate: string) => {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await convertTenderRequirementToTask(tenderId, item.id, {
        assigned_to_user_id: assignedToUserId || undefined,
        due_date: dueDate || undefined,
      });
      if (!res.success) throw new Error("Could not turn this into a task.");
      setConvertingId(null);
      await load();
    } catch (e) {
      setError(normalizeError(e, "Could not turn this into a task."));
    } finally {
      setBusyId(null);
    }
  };

  const satisfiedCount = items.filter((i) => i.is_satisfied).length;

  return (
    <div className="space-y-3">
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="e.g. Bid Bond, BOQ, Company Registration…"
          className="flex-1 border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper"
        />
        <button
          type="submit"
          disabled={adding || !newLabel.trim()}
          className="flex items-center gap-1 border border-ink-mid px-3 py-2 text-xs uppercase text-slate-light hover:text-paper disabled:opacity-40"
        >
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
        </button>
      </form>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-slate-light">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-light">No checklist items yet. Add what needs to be submitted with this tender.</p>
      ) : (
        <>
          <p className="text-[11px] text-slate-light">{satisfiedCount} of {items.length} complete</p>
          <ul className="divide-y divide-ink-mid border border-ink-mid">
            {items.map((item) => (
              <li key={item.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={busyId === item.id || !!item.linked_task_id}
                    title={item.linked_task_id ? "Driven by its linked task - complete the task to satisfy this item" : undefined}
                    onClick={() => void handleToggle(item)}
                    className="flex min-w-0 items-center gap-2.5 text-left disabled:opacity-70"
                  >
                    {item.is_satisfied ? (
                      <CheckSquare className="h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <Square className="h-4 w-4 shrink-0 text-slate-light" />
                    )}
                    <span className={`truncate text-sm ${item.is_satisfied ? "text-slate-light line-through" : "text-paper"}`}>{item.label}</span>
                    {item.satisfied_document_id && (
                      <span className="shrink-0 rounded-sm border border-emerald-500/30 bg-emerald-950/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-400">Auto-matched</span>
                    )}
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    {!item.linked_task_id && convertingId !== item.id && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => setConvertingId(item.id)}
                        title="Turn into an assignable task"
                        className="flex items-center gap-1 border border-dashed border-ink-mid px-2 py-1 text-[10px] uppercase tracking-wider text-slate-light hover:border-signal hover:text-signal disabled:opacity-40"
                      >
                        <UserPlus className="h-3 w-3" /> Make Task
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void handleDelete(item)}
                      title="Remove"
                      className="shrink-0 rounded-sm p-1.5 text-slate-light hover:bg-red-950/40 hover:text-red-300 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {item.linked_task_id && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-7 text-[11px] text-slate-light">
                    {item.task_assigned_to_name ? (
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[9px] font-bold ${avatarTone(item.task_assigned_to_user_id ?? item.id)}`} title={item.task_assigned_to_name}>
                        {initials(item.task_assigned_to_name)}
                      </span>
                    ) : (
                      <span className="text-slate-light">Unassigned</span>
                    )}
                    {item.task_due_date && (
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(item.task_due_date).toLocaleDateString()}</span>
                    )}
                    {item.task_status && item.task_status !== "completed" && (
                      <span className="border border-ink-mid px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-light">{item.task_status.replace(/_/g, " ")}</span>
                    )}
                  </div>
                )}

                {convertingId === item.id && (
                  <ConvertToTaskForm
                    users={users}
                    busy={busyId === item.id}
                    onCancel={() => setConvertingId(null)}
                    onSubmit={(assignedToUserId, dueDate) => void handleConvert(item, assignedToUserId, dueDate)}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ConvertToTaskForm({
  users,
  busy,
  onCancel,
  onSubmit,
}: {
  users: AssignableUser[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (assignedToUserId: string, dueDate: string) => void;
}) {
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [dueDate, setDueDate] = useState("");

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border border-dashed border-ink-mid bg-ink-light/40 p-2">
      <select
        value={assignedToUserId}
        onChange={(e) => setAssignedToUserId(e.target.value)}
        className="border border-ink-mid bg-ink px-2 py-1 text-[11px] text-paper"
      >
        <option value="">-- Assign to --</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="border border-ink-mid bg-ink px-2 py-1 text-[11px] text-paper"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => onSubmit(assignedToUserId, dueDate)}
        className="flex items-center gap-1 border border-signal bg-signal/10 px-2 py-1 text-[10px] uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Create Task
      </button>
      <button type="button" disabled={busy} onClick={onCancel} className="text-[10px] uppercase tracking-wider text-slate-light hover:text-paper disabled:opacity-40">
        Cancel
      </button>
    </div>
  );
}
