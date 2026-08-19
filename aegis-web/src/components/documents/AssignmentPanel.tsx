"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, User, Users, Check } from "lucide-react";
import { getAssignableUsers, getTeams, getAssignment, setAssignment } from "@/lib/api";
import type { DocumentEntityType } from "./EntityDocumentsPanel";

function normalizeError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message || fallback;
}

/**
 * Assign a lead/opportunity/tender/project/fleet/machinery record to either
 * a person or a team. Whoever is assigned gets an in-app notification
 * immediately (see routers/assignments.py's set_assignment).
 */
export function AssignmentPanel({ entityType, entityId }: { entityType: DocumentEntityType; entityId: string }) {
  const [mode, setMode] = useState<"person" | "team">("person");
  const [users, setUsers] = useState<{ id: string; full_name: string; email: string }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [current, setCurrent] = useState<{ assigned_to_user_id: string | null; assigned_to_team_id: string | null; assigned_user_name: string | null; assigned_team_name: string | null } | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, teamsRes, assignmentRes] = await Promise.all([
        getAssignableUsers(),
        getTeams(),
        getAssignment(entityType, entityId),
      ]);
      if (usersRes.success && Array.isArray(usersRes.data)) setUsers(usersRes.data);
      if (teamsRes.success && Array.isArray(teamsRes.data)) setTeams(teamsRes.data);
      if (assignmentRes.success && assignmentRes.data) {
        setCurrent(assignmentRes.data);
        if (assignmentRes.data.assigned_to_team_id) {
          setMode("team");
          setSelectedId(assignmentRes.data.assigned_to_team_id);
        } else if (assignmentRes.data.assigned_to_user_id) {
          setMode("person");
          setSelectedId(assignmentRes.data.assigned_to_user_id);
        }
      }
    } catch (e) {
      setError(normalizeError(e, "Assignment info did not load."));
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const target = mode === "person"
        ? { assigned_to_user_id: selectedId || null, assigned_to_team_id: null }
        : { assigned_to_user_id: null, assigned_to_team_id: selectedId || null };
      const res = await setAssignment(entityType, entityId, target);
      if (!res.success) throw new Error("Assignment could not be saved.");
      setSaved(true);
      await load();
    } catch (e) {
      setError(normalizeError(e, "Assignment could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4 text-slate-light">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  const currentLabel = current?.assigned_team_name || current?.assigned_user_name;

  return (
    <div className="space-y-3">
      {currentLabel && (
        <p className="text-xs text-slate-light">
          Currently assigned to <span className="text-paper font-semibold">{currentLabel}</span>
          {current?.assigned_to_team_id ? " (team)" : ""}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { setMode("person"); setSelectedId(""); }}
          className={`flex flex-1 items-center justify-center gap-1.5 border px-2 py-1.5 text-xs ${mode === "person" ? "border-signal text-signal" : "border-ink-mid text-slate-light hover:text-paper"}`}
        >
          <User className="h-3.5 w-3.5" /> Person
        </button>
        <button
          type="button"
          onClick={() => { setMode("team"); setSelectedId(""); }}
          className={`flex flex-1 items-center justify-center gap-1.5 border px-2 py-1.5 text-xs ${mode === "team" ? "border-signal text-signal" : "border-ink-mid text-slate-light hover:text-paper"}`}
        >
          <Users className="h-3.5 w-3.5" /> Team
        </button>
      </div>

      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper"
      >
        <option value="">-- Unassigned --</option>
        {(mode === "person" ? users : teams).map((item) => (
          <option key={item.id} value={item.id}>{"full_name" in item ? item.full_name : item.name}</option>
        ))}
      </select>

      {error && <p className="text-xs text-red-300">{error}</p>}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving}
        className="flex w-full items-center justify-center gap-1.5 border border-ink-mid bg-ink-light px-3 py-2 text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : null}
        {saving ? "Saving…" : saved ? "Saved" : "Save assignment"}
      </button>
    </div>
  );
}
