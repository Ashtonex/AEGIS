"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, User, Users, Check } from "lucide-react";
import { getAssignableUsers, getTeams, getAssignment, setAssignment } from "@/lib/api";
import type { DocumentEntityType } from "./EntityDocumentsPanel";

function normalizeError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (!message) return fallback;
  if (message.toLowerCase().includes("authentication service temporarily unavailable")) {
    return "Assignment service is reconnecting. Retry in a few seconds.";
  }
  if (message.toLowerCase().includes("backend service is waking up") || message.toLowerCase().includes("temporarily unavailable")) {
    return "Assignment service is reconnecting. Retry in a few seconds.";
  }
  return message;
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
  const [pickerWarning, setPickerWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPickerWarning(null);
    const [usersResult, teamsResult, assignmentResult] = await Promise.allSettled([
      getAssignableUsers(),
      getTeams(),
      getAssignment(entityType, entityId),
    ]);

    const warnings: string[] = [];
    if (usersResult.status === "fulfilled" && usersResult.value.success && Array.isArray(usersResult.value.data)) {
      setUsers(usersResult.value.data);
    } else if (usersResult.status === "rejected") {
      warnings.push(normalizeError(usersResult.reason, "People list did not load."));
    }

    if (teamsResult.status === "fulfilled" && teamsResult.value.success && Array.isArray(teamsResult.value.data)) {
      setTeams(teamsResult.value.data);
    } else if (teamsResult.status === "rejected") {
      warnings.push(normalizeError(teamsResult.reason, "Team list did not load."));
    }

    if (assignmentResult.status === "fulfilled" && assignmentResult.value.success && assignmentResult.value.data) {
      setCurrent(assignmentResult.value.data);
      if (assignmentResult.value.data.assigned_to_team_id) {
        setMode("team");
        setSelectedId(assignmentResult.value.data.assigned_to_team_id);
      } else if (assignmentResult.value.data.assigned_to_user_id) {
        setMode("person");
        setSelectedId(assignmentResult.value.data.assigned_to_user_id);
      }
    } else if (assignmentResult.status === "rejected") {
      setError(normalizeError(assignmentResult.reason, "Current assignment did not load."));
    }

    if (warnings.length > 0) {
      setPickerWarning(Array.from(new Set(warnings)).join(" "));
    }
    setLoading(false);
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

      {pickerWarning && (
        <div className="flex items-start justify-between gap-3 border border-amber-500/30 bg-amber-950/15 p-3 text-xs text-amber-200">
          <div className="flex gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{pickerWarning}</span>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase text-amber-100 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

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
