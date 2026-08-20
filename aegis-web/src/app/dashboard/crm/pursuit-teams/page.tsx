"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Crown, Loader2, Plus, Target, Trash2, Users, X } from "lucide-react";
import {
  getPursuits,
  getPursuitTeams,
  createPursuitTeam,
  updatePursuitTeam,
  getPursuitTeamMembers,
  addPursuitTeamMember,
  removePursuitTeamMember,
  getAssignableUsers,
  getFinanceDepartments,
} from "@/lib/api";

interface Pursuit {
  id: string;
  status: string;
  lead_company_name: string | null;
  opportunity_name: string | null;
  tender_reference: string | null;
  pursuit_team_id: string | null;
  pursuit_team_name: string | null;
}

interface PursuitTeam {
  id: string;
  pursuit_id: string;
  name: string;
  objective: string | null;
  team_lead_user_id: string | null;
  team_lead_name: string | null;
  status: "active" | "closed";
  member_count: number;
  result: string | null;
}

interface AssignableUser {
  id: string;
  full_name: string;
  email: string;
}

interface Department {
  id: string;
  code: string;
  name: string;
}

interface Member extends AssignableUser {
  department_id: string | null;
  department_name: string | null;
  role_label: string | null;
}

function normalizeError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message || fallback;
}

function pursuitLabel(p: Pursuit) {
  return p.tender_reference || p.opportunity_name || p.lead_company_name || `Pursuit ${p.id.slice(0, 8)}`;
}

export default function PursuitTeamsPage() {
  const [pursuits, setPursuits] = useState<Pursuit[]>([]);
  const [pursuitTeams, setPursuitTeams] = useState<PursuitTeam[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formPursuitId, setFormPursuitId] = useState("");
  const [formName, setFormName] = useState("");
  const [formObjective, setFormObjective] = useState("");
  const [formLeadId, setFormLeadId] = useState("");
  const [creating, setCreating] = useState(false);

  const [managingTeam, setManagingTeam] = useState<PursuitTeam | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pursuitsRes, teamsRes, usersRes] = await Promise.all([
        getPursuits(),
        getPursuitTeams(),
        getAssignableUsers(),
      ]);
      if (pursuitsRes.success && Array.isArray(pursuitsRes.data)) setPursuits(pursuitsRes.data);
      if (teamsRes.success && Array.isArray(teamsRes.data)) setPursuitTeams(teamsRes.data);
      if (usersRes.success && Array.isArray(usersRes.data)) setUsers(usersRes.data);
    } catch (e) {
      setError(normalizeError(e, "Pursuit teams did not load."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A pursuit already carrying an active team is dropped from the picker -
  // crm.pursuit_teams enforces one active team per pursuit at a time, so
  // offering it again would just surface a 409 on submit.
  const pursuitsWithoutActiveTeam = useMemo(
    () => pursuits.filter((p) => !p.pursuit_team_id),
    [pursuits],
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formName.trim();
    if (!name || !formPursuitId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await createPursuitTeam({
        pursuit_id: formPursuitId,
        name,
        objective: formObjective.trim() || undefined,
        team_lead_user_id: formLeadId || undefined,
      });
      if (!res.success) throw new Error("Pursuit team could not be formed.");
      setFormPursuitId("");
      setFormName("");
      setFormObjective("");
      setFormLeadId("");
      await load();
    } catch (e2) {
      setError(normalizeError(e2, "Pursuit team could not be formed."));
    } finally {
      setCreating(false);
    }
  };

  const handleClose = async (team: PursuitTeam) => {
    const result = window.prompt(`Close "${team.name}"? Optionally record the result:`, team.result ?? "");
    if (result === null) return;
    try {
      const res = await updatePursuitTeam(team.id, { status: "closed", result: result || undefined });
      if (!res.success) throw new Error("Pursuit team could not be closed.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Pursuit team could not be closed."));
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
            <h1 className="mt-2 font-display text-2xl font-semibold text-paper">Pursuit Teams</h1>
            <p className="mt-1 text-sm text-slate-light">
              Temporary, cross-functional teams formed around one Lead, Opportunity or Tender — borrowing people from
              Commercial, Construction, Plant &amp; Equipment, Corporate Control Services and Risk for the duration of the pursuit.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="space-y-3 border border-ink-mid bg-ink-light p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={formPursuitId}
              onChange={(e) => setFormPursuitId(e.target.value)}
              className="border border-ink-mid bg-ink px-3 py-2 text-sm text-paper"
            >
              <option value="">-- Pursuit to form a team around --</option>
              {pursuitsWithoutActiveTeam.map((p) => (
                <option key={p.id} value={p.id}>{pursuitLabel(p)} ({p.status})</option>
              ))}
            </select>
            <select
              value={formLeadId}
              onChange={(e) => setFormLeadId(e.target.value)}
              className="border border-ink-mid bg-ink px-3 py-2 text-sm text-paper"
            >
              <option value="">-- Team lead (optional now) --</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <input
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="Team name, e.g. Tender Team — SNC-2026-014"
            className="w-full border border-ink-mid bg-ink px-3 py-2 text-sm text-paper"
          />
          <input
            value={formObjective}
            onChange={(e) => setFormObjective(e.target.value)}
            placeholder="Objective, e.g. Prepare and submit a compliant, competitive tender by the closing date"
            className="w-full border border-ink-mid bg-ink px-3 py-2 text-sm text-paper"
          />
          <button
            type="submit"
            disabled={creating || !formName.trim() || !formPursuitId}
            className="flex items-center gap-1.5 border border-signal bg-signal/10 px-4 py-2 text-xs uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Form Team
          </button>
        </form>

        {error && <p className="text-sm text-red-300">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-light">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : pursuitTeams.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-light">No pursuit teams yet. Form one above.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {pursuitTeams.map((team) => {
              const pursuit = pursuits.find((p) => p.id === team.pursuit_id);
              return (
                <div key={team.id} className="flex flex-col gap-2 border border-ink-mid bg-ink-light p-4">
                  <div className="flex items-start justify-between">
                    <button type="button" onClick={() => setManagingTeam(team)} className="flex min-w-0 items-start gap-2.5 text-left">
                      <Users className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-paper">{team.name}</p>
                        {pursuit && (
                          <p className="flex items-center gap-1 truncate text-[11px] text-slate-light">
                            <Target className="h-3 w-3 shrink-0" /> {pursuitLabel(pursuit)}
                          </p>
                        )}
                        {team.team_lead_name && (
                          <p className="flex items-center gap-1 truncate text-[11px] text-slate-light">
                            <Crown className="h-3 w-3 shrink-0 text-signal" /> {team.team_lead_name}
                          </p>
                        )}
                        <p className="text-[11px] text-slate-light">
                          {team.member_count} member{team.member_count === 1 ? "" : "s"} ·{" "}
                          <span className={team.status === "active" ? "text-signal" : "text-slate-light"}>{team.status}</span>
                        </p>
                      </div>
                    </button>
                    {team.status === "active" && (
                      <button type="button" onClick={() => void handleClose(team)} title="Close team" className="shrink-0 rounded-sm p-1.5 text-slate-light hover:bg-red-950/40 hover:text-red-300">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {managingTeam && (
        <PursuitTeamMembersModal
          team={managingTeam}
          allUsers={users}
          onClose={() => { setManagingTeam(null); void load(); }}
        />
      )}
    </div>
  );
}

function PursuitTeamMembersModal({ team, allUsers, onClose }: { team: PursuitTeam; allUsers: AssignableUser[]; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [addUserId, setAddUserId] = useState("");
  const [addDeptId, setAddDeptId] = useState("");
  const [addRoleLabel, setAddRoleLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, deptsRes] = await Promise.all([getPursuitTeamMembers(team.id), getFinanceDepartments()]);
      if (membersRes.success && Array.isArray(membersRes.data)) setMembers(membersRes.data);
      if (deptsRes.success && Array.isArray(deptsRes.data)) setDepartments(deptsRes.data);
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
      const res = await addPursuitTeamMember(team.id, {
        user_id: addUserId,
        department_id: addDeptId || undefined,
        role_label: addRoleLabel.trim() || undefined,
      });
      if (!res.success) throw new Error("Member could not be added.");
      setAddUserId("");
      setAddDeptId("");
      setAddRoleLabel("");
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
      const res = await removePursuitTeamMember(team.id, userId);
      if (!res.success) throw new Error("Member could not be removed.");
      await load();
    } catch (e) {
      setError(normalizeError(e, "Member could not be removed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg border border-ink-mid bg-ink" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div>
            <p className="text-sm font-semibold text-paper">{team.name} — Members</p>
            {team.objective && <p className="mt-0.5 text-[11px] text-slate-light">{team.objective}</p>}
          </div>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-3 p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className="border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper">
              <option value="">-- Person --</option>
              {availableToAdd.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
            <select value={addDeptId} onChange={(e) => setAddDeptId(e.target.value)} className="border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper">
              <option value="">-- Representing department --</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input
              value={addRoleLabel}
              onChange={(e) => setAddRoleLabel(e.target.value)}
              placeholder="Role, e.g. QS Lead"
              className="border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper"
            />
          </div>
          <button onClick={() => void handleAdd()} disabled={busy || !addUserId} className="w-full border border-ink-mid px-3 py-2 text-xs uppercase text-slate-light hover:text-paper disabled:opacity-40">
            Add to team
          </button>

          {error && <p className="text-xs text-red-300">{error}</p>}

          {loading ? (
            <div className="flex justify-center py-4 text-slate-light"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : members.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-light">No members yet.</p>
          ) : (
            <ul className="divide-y divide-ink-mid border border-ink-mid">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between p-2.5">
                  <div>
                    <p className="text-sm text-paper">
                      {m.full_name}
                      {m.id === team.team_lead_user_id && <Crown className="ml-1.5 inline h-3.5 w-3.5 text-signal" aria-label="Team lead" />}
                    </p>
                    <p className="text-[11px] text-slate-light">
                      {[m.department_name, m.role_label].filter(Boolean).join(" · ") || m.email}
                    </p>
                  </div>
                  <button onClick={() => void handleRemove(m.id)} disabled={busy} className="text-slate-light hover:text-red-300 disabled:opacity-40">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
