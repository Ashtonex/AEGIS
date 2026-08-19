"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Crown, Loader2, Plus, Trash2, Users, X } from "lucide-react";
import {
  getTeams,
  createTeam,
  deleteTeam,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
  setTeamMemberLead,
  getAssignableUsers,
} from "@/lib/api";

interface Team {
  id: string;
  name: string;
  member_count: number;
  created_at: string;
}

interface AssignableUser {
  id: string;
  full_name: string;
  email: string;
}

interface Member extends AssignableUser {
  is_lead?: boolean;
}

function normalizeError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message || fallback;
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [managingTeam, setManagingTeam] = useState<Team | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamsRes, usersRes] = await Promise.all([getTeams(), getAssignableUsers()]);
      if (teamsRes.success && Array.isArray(teamsRes.data)) setTeams(teamsRes.data);
      if (usersRes.success && Array.isArray(usersRes.data)) setUsers(usersRes.data);
    } catch (e) {
      setError(normalizeError(e, "Teams did not load."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newTeamName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await createTeam(name);
      if (!res.success) throw new Error("Team could not be created.");
      setNewTeamName("");
      await load();
    } catch (e2) {
      setError(normalizeError(e2, "Team could not be created."));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (team: Team) => {
    if (!window.confirm(`Delete team "${team.name}"?`)) return;
    try {
      const res = await deleteTeam(team.id);
      if (!res.success) throw new Error("Team could not be deleted.");
      setTeams((current) => current.filter((t) => t.id !== team.id));
      if (managingTeam?.id === team.id) setManagingTeam(null);
    } catch (e) {
      setError(normalizeError(e, "Team could not be deleted."));
    }
  };

  return (
    <div className="min-h-screen bg-ink p-6 text-paper">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/dashboard/crm" className="inline-flex items-center gap-1.5 text-xs text-slate-light hover:text-paper">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to CRM
            </Link>
            <h1 className="mt-2 font-display text-2xl font-semibold text-paper">Teams</h1>
            <p className="mt-1 text-sm text-slate-light">Group people so a lead, opportunity, tender, project, or asset can be assigned to the whole team at once.</p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="flex gap-2 border border-ink-mid bg-ink-light p-4">
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="New team name, e.g. Tender Response Squad"
            className="flex-1 border border-ink-mid bg-ink px-3 py-2 text-sm text-paper"
          />
          <button
            type="submit"
            disabled={creating || !newTeamName.trim()}
            className="flex items-center gap-1.5 border border-signal bg-signal/10 px-4 py-2 text-xs uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create Team
          </button>
        </form>

        {error && <p className="text-sm text-red-300">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-light">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : teams.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-light">No teams yet. Create one above.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {teams.map((team) => (
              <div key={team.id} className="flex items-center justify-between border border-ink-mid bg-ink-light p-4">
                <button type="button" onClick={() => setManagingTeam(team)} className="flex min-w-0 items-center gap-2.5 text-left">
                  <Users className="h-4 w-4 shrink-0 text-signal" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-paper">{team.name}</p>
                    <p className="text-[11px] text-slate-light">{team.member_count} member{team.member_count === 1 ? "" : "s"}</p>
                  </div>
                </button>
                <button type="button" onClick={() => void handleDelete(team)} className="shrink-0 rounded-sm p-1.5 text-slate-light hover:bg-red-950/40 hover:text-red-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {managingTeam && (
        <TeamMembersModal
          team={managingTeam}
          allUsers={users}
          onClose={() => { setManagingTeam(null); void load(); }}
        />
      )}
    </div>
  );
}

function TeamMembersModal({ team, allUsers, onClose }: { team: Team; allUsers: AssignableUser[]; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [addUserId, setAddUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTeamMembers(team.id);
      if (res.success && Array.isArray(res.data)) setMembers(res.data);
    } catch (e) {
      setError(normalizeError(e, "Members did not load."));
    } finally {
      setLoading(false);
    }
  }, [team.id]);

  useEffect(() => { void load(); }, [load]);

  const availableToAdd = allUsers.filter((u) => !members.some((m) => m.id === u.id));

  const handleAdd = async () => {
    if (!addUserId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addTeamMember(team.id, addUserId);
      if (!res.success) throw new Error("Member could not be added.");
      setAddUserId("");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Member could not be added."));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await removeTeamMember(team.id, userId);
      if (!res.success) throw new Error("Member could not be removed.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Member could not be removed."));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleLead = async (member: Member) => {
    setBusy(true);
    setError(null);
    try {
      const res = await setTeamMemberLead(team.id, member.id, !member.is_lead);
      if (!res.success) throw new Error("Team lead could not be updated.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Team lead could not be updated."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md border border-ink-mid bg-ink" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <p className="text-sm font-semibold text-paper">{team.name} — Members</p>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-3 p-4">
          <div className="flex gap-2">
            <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className="flex-1 border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper">
              <option value="">-- Add a person --</option>
              {availableToAdd.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
            <button onClick={() => void handleAdd()} disabled={busy || !addUserId} className="border border-ink-mid px-3 py-2 text-xs uppercase text-slate-light hover:text-paper disabled:opacity-40">Add</button>
          </div>

          {error && <p className="text-xs text-red-300">{error}</p>}

          {loading ? (
            <div className="flex justify-center py-4 text-slate-light"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : members.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-light">No members yet.</p>
          ) : (
            <ul className="divide-y divide-ink-mid border border-ink-mid">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between p-2.5">
                  <div className="flex items-center gap-2">
                    {m.is_lead && <Crown className="h-3.5 w-3.5 text-signal" aria-label="Team lead" />}
                    <div>
                      <p className="text-sm text-paper">{m.full_name}</p>
                      <p className="text-[11px] text-slate-light">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleToggleLead(m)}
                      disabled={busy}
                      title={m.is_lead ? "Remove as team lead" : "Make team lead"}
                      className={`text-[10px] uppercase tracking-wider disabled:opacity-40 ${m.is_lead ? "text-signal hover:text-slate-light" : "text-slate-light hover:text-signal"}`}
                    >
                      {m.is_lead ? "Lead" : "Make lead"}
                    </button>
                    <button onClick={() => void handleRemove(m.id)} disabled={busy} className="text-slate-light hover:text-red-300 disabled:opacity-40">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
