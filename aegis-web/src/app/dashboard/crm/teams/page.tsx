"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Crown,
  Loader2,
  Plus,
  ShieldCheck,
  Target,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  getAssignableUsers,
  getCrmTasks,
  getTeamMembers,
  getTeams,
  removeTeamMember,
  setTeamMemberLead,
} from "@/lib/api";
import { avatarTone, initials } from "@/lib/avatar";

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

interface CrmTask {
  id: string;
  title?: string | null;
  task_title?: string | null;
  status?: string | null;
  due_date?: string | null;
  priority?: string | null;
  entity_type?: string | null;
  entity_name?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to_team_id?: string | null;
  assigned_to_team_name?: string | null;
}

interface WorkloadEntry {
  open: number;
  completed: number;
  overdue: number;
  total: number;
}

interface TeamInsight extends WorkloadEntry {
  team: Team;
  members: Member[];
  leadCount: number;
  undistributed: number;
  directOpen: number;
  progress: number;
  valueScore: number;
  riskScore: number;
  contribution: string;
  validation: string;
}

function normalizeError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message || fallback;
}

function isOpenTask(task: CrmTask) {
  const status = String(task.status ?? "").toLowerCase();
  return status !== "completed" && status !== "cancelled";
}

function isCompletedTask(task: CrmTask) {
  return String(task.status ?? "").toLowerCase() === "completed";
}

function isOverdue(task: CrmTask, today: Date) {
  return isOpenTask(task) && !!task.due_date && new Date(task.due_date) < today;
}

function pct(value: number) {
  return `${Math.round(value)}%`;
}

function plural(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

function teamContribution(insight: TeamInsight) {
  if (insight.completed >= 10) return "Converts work into business progress consistently.";
  if (insight.open >= 8) return "Carries meaningful delivery load across active work.";
  if (insight.members.length >= 3) return "Adds scalable capacity that can absorb cross-functional work.";
  if (insight.leadCount > 0) return "Has accountable leadership and can own assigned outcomes.";
  return "Needs people, ownership and assigned outcomes before it creates measurable value.";
}

function teamValidation(insight: TeamInsight) {
  if (insight.members.length === 0) return "Not usable yet: add members before assigning business work.";
  if (insight.leadCount === 0) return "Needs a lead: no one is accountable for quality or dispatch.";
  if (insight.overdue > 0) return "At risk: overdue work needs escalation or redistribution.";
  if (insight.undistributed > 0) return "Action needed: work is sitting at team level and must be given to people.";
  if (insight.completed > 0) return "Validated: this team has delivered completed work.";
  return "Ready: staffed and led, but needs assigned outcomes to prove value.";
}

function statusTone(insight: TeamInsight) {
  if (insight.members.length === 0 || insight.leadCount === 0) return "border-amber-500/40 bg-amber-950/15 text-amber-200";
  if (insight.overdue > 0) return "border-red-500/40 bg-red-950/20 text-red-200";
  if (insight.undistributed > 0) return "border-blue-500/40 bg-blue-950/20 text-blue-200";
  return "border-emerald-500/35 bg-emerald-950/15 text-emerald-200";
}

function barTone(insight: TeamInsight) {
  if (insight.overdue > 0) return "bg-red-400";
  if (insight.undistributed > 0) return "bg-blue-400";
  return "bg-emerald-400";
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [membersByTeam, setMembersByTeam] = useState<Record<string, Member[]>>({});
  const [workload, setWorkload] = useState<Record<string, WorkloadEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [managingTeam, setManagingTeam] = useState<Team | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamsRes, usersRes, tasksRes] = await Promise.all([getTeams(), getAssignableUsers(), getCrmTasks({})]);
      const nextTeams = teamsRes.success && Array.isArray(teamsRes.data) ? teamsRes.data as Team[] : [];
      const nextUsers = usersRes.success && Array.isArray(usersRes.data) ? usersRes.data as AssignableUser[] : [];
      const nextTasks = tasksRes.success && Array.isArray(tasksRes.data) ? tasksRes.data as CrmTask[] : [];
      const today = new Date(new Date().toDateString());
      const byUser: Record<string, WorkloadEntry> = {};

      for (const task of nextTasks) {
        const userId = task.assigned_to_user_id;
        if (!userId) continue;
        const entry = byUser[userId] ?? { open: 0, completed: 0, overdue: 0, total: 0 };
        entry.total += 1;
        if (isOpenTask(task)) entry.open += 1;
        if (isCompletedTask(task)) entry.completed += 1;
        if (isOverdue(task, today)) entry.overdue += 1;
        byUser[userId] = entry;
      }

      const memberEntries = await Promise.all(
        nextTeams.map(async (team) => {
          try {
            const res = await getTeamMembers(team.id);
            return [team.id, res.success && Array.isArray(res.data) ? res.data as Member[] : []] as const;
          } catch {
            return [team.id, []] as const;
          }
        }),
      );

      setTeams(nextTeams);
      setUsers(nextUsers);
      setTasks(nextTasks);
      setWorkload(byUser);
      setMembersByTeam(Object.fromEntries(memberEntries));
    } catch (e) {
      setError(normalizeError(e, "Teams did not load."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const insights = useMemo<TeamInsight[]>(() => {
    const today = new Date(new Date().toDateString());
    return teams.map((team) => {
      const members = membersByTeam[team.id] ?? [];
      const teamTasks = tasks.filter((task) => task.assigned_to_team_id === team.id);
      const directOpen = teamTasks.filter((task) => isOpenTask(task)).length;
      const completed = teamTasks.filter((task) => isCompletedTask(task)).length;
      const overdue = teamTasks.filter((task) => isOverdue(task, today)).length;
      const undistributed = teamTasks.filter((task) => isOpenTask(task) && !task.assigned_to_user_id).length;
      const total = teamTasks.length;
      const progress = total > 0 ? (completed / total) * 100 : 0;
      const leadCount = members.filter((member) => member.is_lead).length;
      const memberOpen = members.reduce((sum, member) => sum + (workload[member.id]?.open ?? 0), 0);
      const open = Math.max(directOpen, memberOpen + undistributed);
      const valueScore = completed * 3 + members.length * 2 + leadCount * 4 + Math.max(0, directOpen - overdue);
      const riskScore = overdue * 4 + undistributed * 2 + (leadCount === 0 ? 5 : 0) + (members.length === 0 ? 6 : 0);
      const base = {
        team,
        members,
        leadCount,
        undistributed,
        directOpen,
        open,
        completed,
        overdue,
        total,
        progress,
        valueScore,
        riskScore,
      };
      return {
        ...base,
        contribution: teamContribution(base as TeamInsight),
        validation: teamValidation(base as TeamInsight),
      };
    }).sort((a, b) => (b.riskScore - a.riskScore) || (b.valueScore - a.valueScore));
  }, [membersByTeam, tasks, teams, workload]);

  const summary = useMemo(() => {
    const totalMembers = insights.reduce((sum, item) => sum + item.members.length, 0);
    const open = insights.reduce((sum, item) => sum + item.open, 0);
    const completed = insights.reduce((sum, item) => sum + item.completed, 0);
    const overdue = insights.reduce((sum, item) => sum + item.overdue, 0);
    const undistributed = insights.reduce((sum, item) => sum + item.undistributed, 0);
    const ledTeams = insights.filter((item) => item.leadCount > 0).length;
    const activeTeams = insights.filter((item) => item.open > 0 || item.completed > 0).length;
    const valueScore = insights.reduce((sum, item) => sum + item.valueScore, 0);
    return { totalMembers, open, completed, overdue, undistributed, ledTeams, activeTeams, valueScore };
  }, [insights]);

  const handleCreate = async (e: FormEvent) => {
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
    <div className="min-h-screen bg-ink text-paper">
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="border-b border-ink-mid pb-5">
          <Link href="/dashboard/crm" className="inline-flex items-center gap-1.5 text-xs text-slate-light hover:text-paper">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to CRM
          </Link>
          <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-signal">Team Command Centre</p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-paper">Teams</h1>
              <p className="mt-2 max-w-4xl text-sm text-slate-light">
                Build accountable squads, validate whether they are staffed correctly, and see how work assigned to teams is converting into business progress.
              </p>
            </div>
            <form onSubmit={handleCreate} className="flex w-full gap-2 xl:max-w-xl">
              <input
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="Create team, e.g. Tender Response Squad"
                className="h-11 min-w-0 flex-1 border border-ink-mid bg-ink-light px-3 text-sm text-paper outline-none placeholder:text-slate focus:border-signal"
              />
              <button
                type="submit"
                disabled={creating || !newTeamName.trim()}
                className="inline-flex h-11 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-40"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Build Team
              </button>
            </form>
          </div>
        </header>

        {error && (
          <div className="border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">{error}</div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="Teams" value={teams.length} icon={<Users className="h-4 w-4" />} />
          <Metric label="People placed" value={summary.totalMembers} icon={<UserPlus className="h-4 w-4" />} />
          <Metric label="Led teams" value={`${summary.ledTeams}/${teams.length || 0}`} icon={<Crown className="h-4 w-4" />} />
          <Metric label="Active teams" value={summary.activeTeams} icon={<Activity className="h-4 w-4" />} />
          <Metric label="Open work" value={summary.open} icon={<Target className="h-4 w-4" />} />
          <Metric label="Value score" value={summary.valueScore} icon={<TrendingUp className="h-4 w-4" />} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-mid pb-3">
              <div>
                <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">Team Portfolio</h2>
                <p className="mt-1 text-xs text-slate-light">Sorted by risk first, then business value.</p>
              </div>
              <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-wider">
                <span className="border border-red-500/30 px-2 py-1 text-red-200">{summary.overdue} overdue</span>
                <span className="border border-blue-500/30 px-2 py-1 text-blue-200">{summary.undistributed} to dispatch</span>
                <span className="border border-emerald-500/30 px-2 py-1 text-emerald-200">{summary.completed} completed</span>
              </div>
            </div>

            {loading ? (
              <div className="flex h-72 items-center justify-center text-slate-light">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : insights.length === 0 ? (
              <div className="border border-ink-mid bg-ink-light p-8 text-center">
                <p className="font-mono text-xs uppercase tracking-wider text-signal">No teams yet</p>
                <p className="mt-2 text-sm text-slate-light">Create a team, add people, appoint a lead, then start assigning work from CRM Tasks.</p>
              </div>
            ) : (
              <div className="grid gap-4 2xl:grid-cols-2">
                {insights.map((insight) => (
                  <TeamPanel
                    key={insight.team.id}
                    insight={insight}
                    onManage={() => setManagingTeam(insight.team)}
                    onDelete={() => void handleDelete(insight.team)}
                  />
                ))}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <section className="border border-ink-mid bg-ink-light p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-signal" />
                <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">Validation Rules</h2>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <Rule good={summary.ledTeams === teams.length && teams.length > 0} label="Every team needs a lead" value={`${summary.ledTeams}/${teams.length || 0}`} />
                <Rule good={summary.undistributed === 0} label="Team work must be dispatched to people" value={String(summary.undistributed)} />
                <Rule good={summary.overdue === 0} label="Overdue work must be escalated" value={String(summary.overdue)} />
                <Rule good={summary.totalMembers >= teams.length && teams.length > 0} label="Teams need real capacity" value={String(summary.totalMembers)} />
              </div>
            </section>

            <section className="border border-ink-mid bg-ink-light p-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-signal" />
                <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">Enhancement Ideas</h2>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-light">
                <Idea title="Team charters" body="Add purpose, target department, commercial owner and decision limits to each team." />
                <Idea title="Capacity planning" body="Give each member weekly capacity so overload warnings are based on hours, not only task count." />
                <Idea title="Business contribution" body="Tie completed tasks to opportunity value, tender value, project value or avoided risk." />
                <Idea title="Lead review cadence" body="Require team leads to verify completed work and run weekly risk reviews." />
              </div>
            </section>
          </aside>
        </section>
      </div>

      {managingTeam && (
        <TeamMembersDrawer
          team={managingTeam}
          allUsers={users}
          workload={workload}
          members={membersByTeam[managingTeam.id] ?? []}
          onClose={() => { setManagingTeam(null); void load(); }}
        />
      )}
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) {
  return (
    <div className="border border-ink-mid bg-ink-light p-4">
      <div className="flex items-center justify-between gap-2 text-slate-light">
        <span className="font-mono text-[10px] uppercase tracking-wider">{label}</span>
        <span className="text-signal">{icon}</span>
      </div>
      <p className="mt-3 font-display text-2xl font-semibold text-paper">{value}</p>
    </div>
  );
}

function Rule({ good, label, value }: { good: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-mid/60 pb-2">
      <span className="text-slate-light">{label}</span>
      <span className={`inline-flex items-center gap-1 font-mono text-xs font-bold ${good ? "text-emerald-300" : "text-amber-300"}`}>
        {good ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} {value}
      </span>
    </div>
  );
}

function Idea({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-l border-signal/40 pl-3">
      <p className="font-semibold text-paper">{title}</p>
      <p className="mt-1 text-xs leading-5">{body}</p>
    </div>
  );
}

function TeamPanel({ insight, onManage, onDelete }: { insight: TeamInsight; onManage: () => void; onDelete: () => void }) {
  return (
    <section className="border border-ink-mid bg-ink-light p-4">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onManage} className="min-w-0 text-left">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-signal" />
            <h3 className="truncate text-base font-semibold text-paper">{insight.team.name}</h3>
          </div>
          <p className="mt-1 text-xs text-slate-light">{insight.contribution}</p>
        </button>
        <button type="button" onClick={onDelete} className="shrink-0 p-1.5 text-slate-light hover:bg-red-950/40 hover:text-red-300" title="Delete team">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className={`mt-4 border px-3 py-2 text-xs ${statusTone(insight)}`}>
        {insight.validation}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        <MiniStat label="People" value={insight.members.length} />
        <MiniStat label="Leads" value={insight.leadCount} />
        <MiniStat label="Open" value={insight.open} />
        <MiniStat label="Done" value={insight.completed} />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-slate-light">
          <span>Progress</span>
          <span>{pct(insight.progress)}</span>
        </div>
        <div className="mt-2 h-2 bg-ink">
          <div className={`h-full ${barTone(insight)}`} style={{ width: `${Math.min(100, insight.progress)}%` }} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-wider">
        <span className="border border-ink-mid px-2 py-1 text-slate-light">Value {insight.valueScore}</span>
        <span className="border border-ink-mid px-2 py-1 text-slate-light">Risk {insight.riskScore}</span>
        {insight.undistributed > 0 && <span className="border border-blue-500/30 px-2 py-1 text-blue-200">{plural(insight.undistributed, "dispatch")}</span>}
        {insight.overdue > 0 && <span className="border border-red-500/30 px-2 py-1 text-red-200">{plural(insight.overdue, "overdue")}</span>}
      </div>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-ink-mid bg-ink p-2">
      <p className="font-display text-lg font-semibold text-paper">{value}</p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-light">{label}</p>
    </div>
  );
}

function TeamMembersDrawer({
  team,
  allUsers,
  workload,
  members,
  onClose,
}: {
  team: Team;
  allUsers: AssignableUser[];
  workload: Record<string, WorkloadEntry>;
  members: Member[];
  onClose: () => void;
}) {
  const [currentMembers, setCurrentMembers] = useState<Member[]>(members);
  const [addUserId, setAddUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getTeamMembers(team.id);
      if (res.success && Array.isArray(res.data)) setCurrentMembers(res.data as Member[]);
    } catch (e) {
      setError(normalizeError(e, "Members did not load."));
    }
  }, [team.id]);

  useEffect(() => { setCurrentMembers(members); }, [members]);
  useEffect(() => { void load(); }, [load]);

  const availableToAdd = allUsers.filter((u) => !currentMembers.some((m) => m.id === u.id));
  const openLoad = currentMembers.reduce((sum, member) => sum + (workload[member.id]?.open ?? 0), 0);
  const completed = currentMembers.reduce((sum, member) => sum + (workload[member.id]?.completed ?? 0), 0);
  const overdue = currentMembers.reduce((sum, member) => sum + (workload[member.id]?.overdue ?? 0), 0);

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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70" onClick={onClose}>
      <aside className="h-full w-full max-w-3xl overflow-y-auto border-l border-ink-mid bg-ink" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 z-10 border-b border-ink-mid bg-ink p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Team Builder</p>
              <h2 className="mt-1 text-xl font-semibold text-paper">{team.name}</h2>
              <p className="mt-1 text-xs text-slate-light">Add people, appoint leads, and validate whether the team has enough capacity to carry work.</p>
            </div>
            <button onClick={onClose} className="p-1.5 text-slate-light hover:text-paper"><X className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="space-y-5 p-5">
          <section className="grid gap-3 sm:grid-cols-4">
            <MiniStat label="Members" value={currentMembers.length} />
            <MiniStat label="Open load" value={openLoad} />
            <MiniStat label="Completed" value={completed} />
            <MiniStat label="Overdue" value={overdue} />
          </section>

          <section className="border border-ink-mid bg-ink-light p-4">
            <div className="flex gap-2">
              <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className="h-10 min-w-0 flex-1 border border-ink-mid bg-ink px-3 text-sm text-paper">
                <option value="">Add a person to this team</option>
                {availableToAdd.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
              <button onClick={() => void handleAdd()} disabled={busy || !addUserId} className="h-10 border border-signal px-4 font-mono text-xs uppercase text-signal hover:bg-signal/10 disabled:opacity-40">
                Add
              </button>
            </div>
            {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
          </section>

          {currentMembers.length === 0 ? (
            <div className="border border-amber-500/30 bg-amber-950/10 p-5 text-sm text-amber-200">
              This team has no members yet. It cannot receive accountable work until people are added and a lead is appointed.
            </div>
          ) : (
            <section className="divide-y divide-ink-mid border border-ink-mid">
              {currentMembers.map((member) => {
                const entry = workload[member.id] ?? { open: 0, completed: 0, overdue: 0, total: 0 };
                const progress = entry.total > 0 ? (entry.completed / entry.total) * 100 : 0;
                return (
                  <div key={member.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-bold ${avatarTone(member.id)}`}>
                        {initials(member.full_name)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-paper">{member.full_name}</p>
                          {member.is_lead && <Crown className="h-4 w-4 shrink-0 text-signal" aria-label="Team lead" />}
                        </div>
                        <p className="truncate text-xs text-slate-light">{member.email}</p>
                        <p className="mt-1 text-xs text-slate-light">
                          Contributes {plural(entry.completed, "completed task")} and carries {plural(entry.open, "open item")}.
                        </p>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider text-slate-light">
                        <span>Personal progress</span>
                        <span>{pct(progress)}</span>
                      </div>
                      <div className="mt-2 h-2 bg-ink">
                        <div className={entry.overdue > 0 ? "h-full bg-red-400" : "h-full bg-emerald-400"} style={{ width: `${Math.min(100, progress)}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => void handleToggleLead(member)}
                        disabled={busy}
                        className={`h-8 border px-2 font-mono text-[10px] uppercase tracking-wider disabled:opacity-40 ${member.is_lead ? "border-signal/50 text-signal" : "border-ink-mid text-slate-light hover:text-signal"}`}
                      >
                        {member.is_lead ? "Lead" : "Make lead"}
                      </button>
                      <button onClick={() => void handleRemove(member.id)} disabled={busy} className="h-8 border border-ink-mid px-2 text-slate-light hover:border-red-500/40 hover:text-red-300 disabled:opacity-40">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
