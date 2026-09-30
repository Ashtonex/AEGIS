"use client";

// "My Tasks" as shown inside Microsoft Teams (deploy/teams-app/manifest.json
// static tab). A compact, single-purpose view of the signed-in person's own
// open work - no site chrome (NavigationWrapper hides it under /teams), its
// own sign-in so people stay inside the Teams tab, and a light refresh so
// newly assigned work shows up without reloading. The full Tasks page
// (/dashboard/crm/tasks) stays the place for managing everyone's work.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, ExternalLink, Loader2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { getCrmTasks, updateCrmTask } from "@/lib/api";

type Priority = "low" | "normal" | "high" | "urgent";

interface MyTask {
  id: string;
  title: string;
  description: string | null;
  entity_name: string | null;
  status: string;
  priority: Priority;
  due_date: string | null;
  depends_on_task_id: string | null;
  depends_on_status: string | null;
  depends_on_title: string | null;
  contribution_target_type: string | null;
  contribution_target_field: string | null;
}

const CLOSED = new Set(["completed", "cancelled", "superseded", "not_applicable"]);
const REFRESH_MS = 60_000;
const FULL_TASKS_URL = "/dashboard/crm/tasks";

const PRIORITY_TONE: Record<Priority, string> = {
  urgent: "border-red-500/40 bg-red-500/10 text-red-200",
  high: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  normal: "border-ink-mid text-slate-light",
  low: "border-ink-mid text-slate",
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function dueLabel(iso: string | null) {
  if (!iso) return "No deadline";
  const due = new Date(`${iso}T00:00:00`);
  const days = Math.round((due.getTime() - startOfToday().getTime()) / 86_400_000);
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due ${due.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
}

function bucket(task: MyTask): "review" | "overdue" | "week" | "later" {
  if (task.status === "under_review") return "review";
  if (!task.due_date) return "later";
  const days = (new Date(`${task.due_date}T00:00:00`).getTime() - startOfToday().getTime()) / 86_400_000;
  if (days < 0) return "overdue";
  if (days <= 7) return "week";
  return "later";
}

const BUCKETS: { key: ReturnType<typeof bucket>; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "week", label: "Due in the next 7 days" },
  { key: "later", label: "Later" },
  { key: "review", label: "Waiting for verification" },
];

function errorText(reason: unknown, fallback: string) {
  if (reason instanceof Error && reason.message) return reason.message;
  return fallback;
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) setError(signInError.message || "Sign-in failed.");
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="mx-auto mt-10 w-full max-w-sm space-y-3 border border-ink-mid bg-ink-light/30 p-5">
      <div>
        <p className="text-base font-semibold text-paper">Sign in to AEGIS</p>
        <p className="mt-1 text-xs text-slate-light">Once, and your tasks will show here in Teams.</p>
      </div>
      <input
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@sixnineconstruction.com"
        className="w-full border border-ink-mid bg-ink px-3 py-2 text-sm text-paper"
      />
      <input
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="w-full border border-ink-mid bg-ink px-3 py-2 text-sm text-paper"
      />
      {error && <p className="text-xs text-red-300">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 border border-signal bg-signal/10 px-4 py-2 text-xs uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-40"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Sign in
      </button>
    </form>
  );
}

// Proof is typed inline: Teams doesn't allow window.prompt/alert/confirm
// inside tabs.
function TaskRow({ task, busy, onStart, onSubmitProof }: {
  task: MyTask;
  busy: boolean;
  onStart: () => void;
  onSubmitProof: (proof: string) => void;
}) {
  const [proofOpen, setProofOpen] = useState(false);
  const [proof, setProof] = useState("");
  const blocked = !!task.depends_on_task_id && task.depends_on_status !== "completed";
  const overdue = bucket(task) === "overdue";
  return (
    <li className="border border-ink-mid bg-ink-light/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-paper">{task.title}</p>
        <span className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${PRIORITY_TONE[task.priority]}`}>{task.priority}</span>
        {task.contribution_target_field && (
          <span className="flex items-center gap-1 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300">
            <ClipboardCheck className="h-2.5 w-2.5" /> Clears a project gate
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-light">
        {task.entity_name && <span className="truncate">{task.entity_name}</span>}
        <span className={`flex items-center gap-1 ${overdue ? "text-red-300" : ""}`}>
          <CalendarClock className="h-3 w-3" /> {dueLabel(task.due_date)}
        </span>
        {task.status === "in_progress" && <span className="text-sky-300">In progress</span>}
        {blocked && (
          <span className="flex items-center gap-1 text-amber-300">
            <AlertTriangle className="h-3 w-3" /> After: {task.depends_on_title}
          </span>
        )}
      </div>
      {task.status === "under_review" ? (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-200">
          <ShieldCheck className="h-3 w-3" /> Proof submitted - waiting for your lead to verify.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {task.status !== "in_progress" && (
            <button
              type="button"
              disabled={busy || blocked}
              onClick={onStart}
              className="flex items-center gap-1 border border-ink-mid px-2.5 py-1 text-[11px] uppercase tracking-wider text-slate-light hover:text-paper disabled:opacity-40"
            >
              <Play className="h-3 w-3" /> Start
            </button>
          )}
          {!proofOpen && (
            <button
              type="button"
              disabled={busy || blocked}
              onClick={() => setProofOpen(true)}
              className="flex items-center gap-1 border border-signal/60 px-2.5 py-1 text-[11px] uppercase tracking-wider text-signal hover:bg-signal/10 disabled:opacity-40"
            >
              <CheckCircle2 className="h-3 w-3" /> Submit proof
            </button>
          )}
        </div>
      )}
      {proofOpen && task.status !== "under_review" && (
        <form
          className="mt-2 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (proof.trim()) onSubmitProof(proof.trim());
          }}
        >
          <input
            autoFocus
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            placeholder="Link to the document, or a reference"
            className="min-w-0 flex-1 border border-ink-mid bg-ink px-2 py-1.5 text-xs text-paper"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !proof.trim()}
              className="flex items-center gap-1 border border-signal bg-signal/10 px-3 py-1.5 text-[11px] uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Submit
            </button>
            <button
              type="button"
              onClick={() => { setProofOpen(false); setProof(""); }}
              className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-slate-light hover:text-paper"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export default function TeamsMyTasksPage() {
  const { user, session, sessionLoading } = useAuth();
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const userId = user?.id;
  const load = useCallback(async (quiet = false) => {
    if (!userId) return;
    if (!quiet) setLoading(true);
    try {
      const res = await getCrmTasks({ assigned_to_user_id: userId });
      if (res.success && Array.isArray(res.data)) {
        setTasks((res.data as MyTask[]).filter((t) => !CLOSED.has(t.status)));
        setError(null);
        setRefreshedAt(new Date());
      }
    } catch (e) {
      setError(errorText(e, "Your tasks did not load."));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!session) return;
    void load();
    const interval = window.setInterval(() => void load(true), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, load]);

  const grouped = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
    return BUCKETS.map((b) => ({ ...b, items: sorted.filter((t) => bucket(t) === b.key) })).filter((g) => g.items.length);
  }, [tasks]);

  const update = async (task: MyTask, payload: Record<string, unknown>, failure: string) => {
    setBusyId(task.id);
    setError(null);
    try {
      const res = await updateCrmTask(task.id, payload);
      if (!res.success) throw new Error(failure);
      await load(true);
    } catch (e) {
      setError(errorText(e, failure));
    } finally {
      setBusyId(null);
    }
  };

  // "completed" is what the Tasks page sends too: the server turns it into
  // under_review unless the caller is allowed to verify their own work.
  const submitProof = (task: MyTask, proof: string) =>
    void update(task, { status: "completed", evidence_ref: proof }, "The task could not be submitted.");

  if (sessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink text-slate-light">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink px-4 py-4 text-paper">
      {!session ? (
        <SignIn />
      ) : (
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold">My AEGIS tasks</h1>
              <p className="text-xs text-slate-light">
                {tasks.length} open{refreshedAt ? ` · updated ${refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="flex items-center gap-1.5 border border-ink-mid px-3 py-1.5 text-[11px] uppercase tracking-wider text-slate-light hover:text-paper disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
              <a
                href={FULL_TASKS_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 border border-ink-mid px-3 py-1.5 text-[11px] uppercase tracking-wider text-slate-light hover:text-paper"
              >
                <ExternalLink className="h-3 w-3" /> Full Tasks page
              </a>
            </div>
          </div>

          {error && <p className="text-sm text-red-300">{error}</p>}

          {loading && tasks.length === 0 ? (
            <div className="flex justify-center py-10 text-slate-light"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : grouped.length === 0 ? (
            <p className="flex items-center gap-2 py-10 text-sm text-slate-light">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Nothing assigned to you right now.
            </p>
          ) : (
            grouped.map((group) => (
              <section key={group.key} className="space-y-2">
                <h2 className={`font-mono text-[10px] uppercase tracking-wider ${group.key === "overdue" ? "text-red-300" : "text-slate-light"}`}>
                  {group.label} · {group.items.length}
                </h2>
                <ul className="space-y-2">
                  {group.items.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      busy={busyId === task.id}
                      onStart={() => void update(task, { status: "in_progress" }, "The task could not be started.")}
                      onSubmitProof={(proof) => submitProof(task, proof)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
