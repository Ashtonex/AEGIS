"use client";

// Bulk task distribution for the Tasks page: the "Distribute all" preview,
// the routing rules / Teams settings editor, and the bulk-assign bar that
// appears when tasks are ticked. Routing logic lives server-side
// (imperium-api app/shared/task_routing.py) - these only preview and apply.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, Send, Settings2, Shuffle, UserCheck, X } from "lucide-react";
import {
  applyTaskDistribution,
  bulkAssignCrmTasks,
  getTaskRouting,
  previewTaskDistribution,
  testTaskRoutingTeams,
  updateTaskRoutingRule,
  updateTaskRoutingSettings,
  type TaskDistributionPreview,
  type TaskPlanItem,
  type TaskPriority,
  type TaskRoutingConfig,
  type TaskRoutingRule,
} from "@/lib/api/crm";
import { initials, avatarTone } from "@/lib/avatar";

interface Person {
  id: string;
  full_name: string;
}

const PRIORITY_TONE: Record<TaskPriority, string> = {
  urgent: "border-red-500/40 bg-red-500/10 text-red-200",
  high: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  normal: "border-ink-mid text-slate-light",
  low: "border-ink-mid text-slate",
};

function errorText(reason: unknown, fallback: string) {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string") return reason;
  return fallback;
}

function shortDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function ModalShell({ title, subtitle, onClose, children, footer, wide }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6" onClick={onClose}>
      <div
        className={`flex max-h-[92vh] w-full flex-col border border-ink-mid bg-ink text-paper shadow-2xl ${wide ? "max-w-5xl" : "max-w-2xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-mid px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-slate-light">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-light hover:text-paper" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-mid px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

function PlanTable({ items }: { items: TaskPlanItem[] }) {
  return (
    <div className="overflow-x-auto border border-ink-mid">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="bg-ink-light/40 font-mono text-[10px] uppercase tracking-wider text-slate-light">
          <tr>
            <th className="px-3 py-2">Task</th>
            <th className="px-3 py-2">Goes to</th>
            <th className="px-3 py-2">Priority</th>
            <th className="px-3 py-2">Due</th>
            <th className="px-3 py-2">Why</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {items.map((item) => (
            <tr key={item.task_id}>
              <td className="px-3 py-2">
                <p className="text-paper">{item.title}</p>
                {item.entity_name && <p className="text-[11px] text-slate-light">{item.entity_name}</p>}
              </td>
              <td className="px-3 py-2 text-paper">
                {item.assignee_name ?? "-"}
                {item.category_label && <p className="text-[11px] text-slate-light">{item.category_label}</p>}
              </td>
              <td className="px-3 py-2">
                <span className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${PRIORITY_TONE[item.new_priority]}`}>{item.new_priority}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-paper">
                {shortDate(item.due_date)}
                {item.hard_deadline && <p className="text-[11px] text-slate-light">deadline {shortDate(item.hard_deadline)}</p>}
              </td>
              <td className="px-3 py-2 text-[11px] text-slate-light">{item.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distribute all
// ---------------------------------------------------------------------------

export function DistributeModal({ onClose, onApplied, onOpenSettings }: {
  onClose: () => void;
  onApplied: (message: string) => void;
  onOpenSettings: () => void;
}) {
  const [preview, setPreview] = useState<TaskDistributionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await previewTaskDistribution();
        if (!cancelled && res.success && res.data) setPreview(res.data);
      } catch (e) {
        if (!cancelled) setError(errorText(e, "The distribution preview could not be built."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const visibleItems = useMemo(() => {
    if (!preview) return [];
    return personFilter === "all" ? preview.items : preview.items.filter((i) => i.assignee_id === personFilter);
  }, [personFilter, preview]);

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const res = await applyTaskDistribution();
      if (!res.success || !res.data) throw new Error("Distribution could not be applied.");
      const teams = res.data.teams_messages;
      onApplied(`${res.message}${teams ? ` ${teams} Teams message${teams === 1 ? "" : "s"} on the way.` : ""}`);
    } catch (e) {
      setError(errorText(e, "Distribution could not be applied."));
      setApplying(false);
    }
  };

  const summary = preview?.summary;
  return (
    <ModalShell
      wide
      title="Distribute tasks"
      subtitle="Every open task without a person, routed by kind of work and ranked by importance and urgency. Nothing changes until you apply."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onOpenSettings} className="mr-auto flex items-center gap-1.5 px-3 py-2 text-xs uppercase tracking-wider text-slate-light hover:text-paper">
            <Settings2 className="h-3.5 w-3.5" /> Routing rules
          </button>
          <button type="button" onClick={onClose} className="border border-ink-mid px-4 py-2 text-xs uppercase tracking-wider text-slate-light hover:text-paper">Cancel</button>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={loading || applying || !summary || summary.total === 0}
            className="flex items-center gap-1.5 border border-signal bg-signal/10 px-4 py-2 text-xs uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-40"
          >
            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shuffle className="h-3.5 w-3.5" />}
            Apply to {summary?.total ?? 0} task{summary?.total === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-light"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : error && !preview ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : summary ? (
        <div className="space-y-4">
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="border border-ink-mid bg-ink-light/25 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-light">To assign</p>
              <p className="mt-1 text-2xl font-semibold">{summary.newly_assigned}</p>
            </div>
            <div className="border border-ink-mid bg-ink-light/25 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Deadline added only</p>
              <p className="mt-1 text-2xl font-semibold">{summary.deadline_only}</p>
            </div>
            <div className={`border p-3 ${summary.unroutable ? "border-amber-500/40 bg-amber-500/5" : "border-ink-mid bg-ink-light/25"}`}>
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Nobody to route to</p>
              <p className="mt-1 text-2xl font-semibold">{summary.unroutable}</p>
            </div>
          </div>

          {summary.by_person.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPersonFilter("all")}
                className={`border px-2.5 py-1.5 text-xs ${personFilter === "all" ? "border-signal bg-signal/10 text-signal" : "border-ink-mid text-slate-light hover:text-paper"}`}
              >
                Everyone
              </button>
              {summary.by_person.map((p) => (
                <button
                  key={p.user_id ?? "none"}
                  type="button"
                  onClick={() => setPersonFilter(p.user_id ?? "all")}
                  className={`flex items-center gap-2 border px-2.5 py-1.5 text-left text-xs ${personFilter === p.user_id ? "border-signal bg-signal/10" : "border-ink-mid hover:border-slate"}`}
                >
                  {p.user_id && (
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px] font-bold ${avatarTone(p.user_id)}`}>
                      {initials(p.full_name ?? "?")}
                    </span>
                  )}
                  <span>
                    <span className="block text-paper">{p.full_name ?? "Unknown"} · {p.count}</span>
                    <span className="block text-[10px] text-slate-light">
                      {p.urgent ? `${p.urgent} urgent · ` : ""}{p.high ? `${p.high} high · ` : ""}{shortDate(p.earliest_due)} → {shortDate(p.latest_due)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {preview!.unroutable.length > 0 && (
            <div className="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                {preview!.unroutable.length} task(s) fall in a category with nobody in it and will stay unassigned
                ({Array.from(new Set(preview!.unroutable.map((u) => u.category_label ?? "no category"))).join(", ")}).{" "}
                <button type="button" onClick={onOpenSettings} className="underline hover:text-paper">Add people in routing rules</button>.
              </div>
            </div>
          )}

          {summary.total === 0 ? (
            <p className="flex items-center gap-2 py-6 text-sm text-slate-light"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Every open task already has a person and a deadline.</p>
          ) : (
            <PlanTable items={visibleItems} />
          )}
        </div>
      ) : null}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Routing rules + Teams settings
// ---------------------------------------------------------------------------

function splitTerms(value: string) {
  return value.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
}

function RuleEditor({ rule, people, onSaved }: { rule: TaskRoutingRule; people: Person[]; onSaved: (config: TaskRoutingConfig) => void }) {
  const [pool, setPool] = useState<string[]>(rule.assignee_user_ids);
  const [keywords, setKeywords] = useState(rule.keywords.join(", "));
  const [entityTypes, setEntityTypes] = useState(rule.entity_types.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    pool.join() !== rule.assignee_user_ids.join() ||
    splitTerms(keywords).join() !== rule.keywords.join() ||
    splitTerms(entityTypes).join() !== rule.entity_types.join();
  const available = people.filter((p) => !pool.includes(p.id));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.full_name ?? rule.assignees.find((a) => a.id === id)?.full_name ?? "Unknown";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await updateTaskRoutingRule(rule.category_key, {
        assignee_user_ids: pool,
        keywords: splitTerms(keywords),
        entity_types: splitTerms(entityTypes),
      });
      if (!res.success || !res.data) throw new Error("Category could not be saved.");
      onSaved(res.data);
      setSaved(true);
    } catch (e) {
      setError(errorText(e, "Category could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 border border-ink-mid bg-ink-light/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{rule.label}</p>
        {pool.length === 0 && <span className="border border-amber-500/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-200">Nobody assigned</span>}
      </div>
      <div>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-light">People (least busy gets the next stack)</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {pool.map((id) => (
            <span key={id} className="flex items-center gap-1.5 border border-ink-mid bg-ink px-2 py-1 text-xs">
              {nameOf(id)}
              <button type="button" onClick={() => { setPool((c) => c.filter((x) => x !== id)); setSaved(false); }} className="text-slate-light hover:text-red-300" aria-label={`Remove ${nameOf(id)}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {available.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) { setPool((c) => [...c, e.target.value]); setSaved(false); } }}
              className="border border-dashed border-ink-mid bg-ink px-2 py-1 text-xs text-slate-light"
            >
              <option value="">+ Add person</option>
              {available.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          )}
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-light">Title keywords (comma separated)</span>
        <textarea
          value={keywords}
          onChange={(e) => { setKeywords(e.target.value); setSaved(false); }}
          rows={2}
          className="w-full border border-ink-mid bg-ink px-2 py-1.5 text-xs text-paper"
        />
      </label>
      <label className="block">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-light">Record types that default here</span>
        <input
          value={entityTypes}
          onChange={(e) => { setEntityTypes(e.target.value); setSaved(false); }}
          className="w-full border border-ink-mid bg-ink px-2 py-1.5 text-xs text-paper"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        {error && <span className="mr-auto text-xs text-red-300">{error}</span>}
        {saved && !dirty && <span className="mr-auto flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-3 w-3" /> Saved</span>}
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="flex items-center gap-1.5 border border-signal bg-signal/10 px-3 py-1.5 text-xs uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />} Save
        </button>
      </div>
    </div>
  );
}

export function RoutingSettingsModal({ people, onClose }: { people: Person[]; onClose: () => void }) {
  const [config, setConfig] = useState<TaskRoutingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [webhook, setWebhook] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [days, setDays] = useState({ due_days_urgent: 2, due_days_high: 5, due_days_normal: 10, due_days_low: 20, daily_capacity: 4 });

  useEffect(() => {
    (async () => {
      try {
        const res = await getTaskRouting();
        if (res.success && res.data) {
          setConfig(res.data);
          const s = res.data.settings;
          setDays({
            due_days_urgent: s.due_days_urgent,
            due_days_high: s.due_days_high,
            due_days_normal: s.due_days_normal,
            due_days_low: s.due_days_low,
            daily_capacity: s.daily_capacity,
          });
        }
      } catch (e) {
        setError(errorText(e, "Routing rules could not be loaded."));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveSettings = async (payload: Parameters<typeof updateTaskRoutingSettings>[0], message: string) => {
    setSavingSettings(true);
    setError(null);
    setNotice(null);
    try {
      const res = await updateTaskRoutingSettings(payload);
      if (!res.success || !res.data) throw new Error("Settings could not be saved.");
      setConfig(res.data);
      setNotice(message);
      return true;
    } catch (e) {
      setError(errorText(e, "Settings could not be saved."));
      return false;
    } finally {
      setSavingSettings(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await testTaskRoutingTeams();
      if (!res.success) throw new Error("Teams did not accept the test.");
      setNotice(`${res.message} Check Teams (Workflows chat).`);
    } catch (e) {
      setError(errorText(e, "Teams did not accept the test."));
    } finally {
      setTesting(false);
    }
  };

  const s = config?.settings;
  return (
    <ModalShell
      wide
      title="Task routing"
      subtitle="Who gets which kind of work, how deadlines are set, and Teams notifications."
      onClose={onClose}
    >
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-light"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !config || !s ? (
        <p className="text-sm text-red-300">{error ?? "Routing rules could not be loaded."}</p>
      ) : (
        <div className="space-y-6">
          {(error || notice) && (
            <p className={`text-sm ${error ? "text-red-300" : "text-emerald-300"}`}>{error ?? notice}</p>
          )}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border border-ink-mid bg-ink-light/25 p-4">
              <div>
                <p className="text-sm font-semibold">Auto-distribute new tasks</p>
                <p className="mt-0.5 text-xs text-slate-light">
                  Every 10 minutes, newly generated tasks are routed, dated and announced automatically.
                  {s.last_auto_run_at ? ` Last run ${new Date(s.last_auto_run_at).toLocaleString()}.` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={savingSettings}
                onClick={() => void saveSettings({ auto_distribute: !s.auto_distribute }, s.auto_distribute ? "Auto-distribution turned off." : "Auto-distribution turned on.")}
                className={`border px-4 py-2 text-xs uppercase tracking-wider disabled:opacity-40 ${s.auto_distribute ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" : "border-ink-mid text-slate-light hover:text-paper"}`}
              >
                {s.auto_distribute ? "On" : "Off"}
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Categories · checked top to bottom</h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {config.rules.map((rule) => (
                <RuleEditor key={`${rule.category_key}:${rule.assignee_user_ids.join()}`} rule={rule} people={people} onSaved={setConfig} />
              ))}
            </div>
            <p className="text-[11px] text-slate-light">
              A task goes to the first category whose keyword is in its title; failing that, the category for its record type;
              failing that, <span className="text-paper">{config.rules.find((r) => r.category_key === s.fallback_category)?.label ?? "the fallback"}</span>.
              All of one record&apos;s tasks in a category go to the same person.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-light"><CalendarClock className="h-3.5 w-3.5" /> Deadlines (business days)</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {([
                ["due_days_urgent", "Urgent"],
                ["due_days_high", "High"],
                ["due_days_normal", "Normal"],
                ["due_days_low", "Low"],
                ["daily_capacity", "Tasks / person / day"],
              ] as const).map(([key, label]) => (
                <label key={key} className="block border border-ink-mid bg-ink-light/20 p-2">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-light">{label}</span>
                  <input
                    type="number"
                    min={1}
                    value={days[key]}
                    onChange={(e) => setDays((d) => ({ ...d, [key]: Math.max(1, Number(e.target.value) || 1) }))}
                    className="mt-1 w-full border border-ink-mid bg-ink px-2 py-1 text-sm text-paper"
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-slate-light">
                Normal and low work is spread at the daily capacity so it doesn&apos;t all fall due at once. Tender work always lands before the submission deadline.
              </p>
              <button
                type="button"
                disabled={savingSettings}
                onClick={() => void saveSettings(days, "Deadline rules saved.")}
                className="shrink-0 border border-ink-mid px-3 py-1.5 text-xs uppercase tracking-wider text-slate-light hover:text-paper disabled:opacity-40"
              >
                Save deadlines
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-light"><Send className="h-3.5 w-3.5" /> Microsoft Teams</h3>
            <div className="space-y-3 border border-ink-mid bg-ink-light/20 p-4">
              <p className="text-xs text-slate-light">
                {s.teams_webhook_configured
                  ? <>Connected ({s.teams_webhook_hint}). Each person gets one Teams message per batch of assignments.</>
                  : <>Not connected. Assignments still notify inside AEGIS; add a Workflows URL to also message people in Teams.</>}
              </p>
              <details className="text-xs text-slate-light">
                <summary className="cursor-pointer text-paper">How to get the URL (one-time, ~5 minutes)</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>In Teams, open <span className="text-paper">Workflows</span> → <span className="text-paper">Create</span> → start from blank, trigger <span className="text-paper">When a Teams webhook request is received</span> (who can trigger: <span className="text-paper">Anyone</span>).</li>
                  <li>Add action <span className="text-paper">Post card in a chat or channel</span>: Post as <span className="text-paper">Flow bot</span>, Post in <span className="text-paper">Chat with Flow bot</span>.</li>
                  <li>Recipient: expression <code className="text-paper">triggerBody()?[&apos;recipient&apos;]</code>. Adaptive Card: expression <code className="text-paper">triggerBody()?[&apos;card&apos;]</code>.</li>
                  <li>Save, then copy the webhook URL from the trigger and paste it below.</li>
                </ol>
              </details>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={webhook}
                  onChange={(e) => setWebhook(e.target.value)}
                  placeholder={s.teams_webhook_configured ? "Paste a new URL to replace the current one" : "https://…logic.azure.com/workflows/… or …powerplatform.com/…"}
                  className="min-w-0 flex-1 border border-ink-mid bg-ink px-2 py-1.5 text-xs text-paper"
                />
                <button
                  type="button"
                  disabled={!webhook.trim() || savingSettings}
                  onClick={async () => { if (await saveSettings({ teams_webhook_url: webhook.trim() }, "Teams webhook saved - send a test to confirm.")) setWebhook(""); }}
                  className="border border-signal bg-signal/10 px-3 py-1.5 text-xs uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-40"
                >
                  Save URL
                </button>
              </div>
              {s.teams_webhook_configured && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={testing}
                    onClick={() => void sendTest()}
                    className="flex items-center gap-1.5 border border-ink-mid px-3 py-1.5 text-xs uppercase tracking-wider text-slate-light hover:text-paper disabled:opacity-40"
                  >
                    {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send me a test
                  </button>
                  <button
                    type="button"
                    disabled={savingSettings}
                    onClick={() => { if (window.confirm("Disconnect Teams notifications?")) void saveSettings({ teams_webhook_url: "" }, "Teams disconnected."); }}
                    className="border border-ink-mid px-3 py-1.5 text-xs uppercase tracking-wider text-slate-light hover:text-red-300 disabled:opacity-40"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Bulk assign (appears when tasks are ticked)
// ---------------------------------------------------------------------------

export function BulkAssignBar({ selectedIds, people, onClear, onDone }: {
  selectedIds: string[];
  people: Person[];
  onClear: () => void;
  onDone: (message: string) => void;
}) {
  const [assignee, setAssignee] = useState("");
  const [dueMode, setDueMode] = useState<"auto" | "fixed">("auto");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<"" | TaskPriority>("");
  const [recalc, setRecalc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TaskPlanItem[] | null>(null);

  const request = (previewOnly: boolean) => ({
    task_ids: selectedIds,
    assigned_to_user_id: assignee,
    due_date: dueMode === "fixed" && dueDate ? dueDate : null,
    priority: priority || null,
    recalculate_due_dates: recalc,
    preview: previewOnly,
  });

  const run = async (previewOnly: boolean) => {
    if (!assignee) return;
    setBusy(true);
    setError(null);
    try {
      const res = await bulkAssignCrmTasks(request(previewOnly));
      if (!res.success || !res.data) throw new Error("Tasks could not be assigned.");
      if (previewOnly) {
        setPreview(res.data.items);
      } else {
        setPreview(null);
        const teams = res.data.teams_messages;
        onDone(`${res.message}${teams ? " Teams message sent." : ""}`);
      }
    } catch (e) {
      setError(errorText(e, "Tasks could not be assigned."));
    } finally {
      setBusy(false);
    }
  };

  const assigneeName = people.find((p) => p.id === assignee)?.full_name;
  return (
    <>
      <div className="sticky bottom-3 z-40 flex flex-wrap items-center gap-2 border border-signal/50 bg-ink/95 p-3 shadow-2xl backdrop-blur">
        <span className="flex items-center gap-1.5 text-xs text-paper">
          <UserCheck className="h-3.5 w-3.5 text-signal" /> {selectedIds.length} selected
        </span>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="border border-ink-mid bg-ink-light px-2 py-1.5 text-xs text-paper">
          <option value="">Assign to…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <select value={dueMode} onChange={(e) => setDueMode(e.target.value as "auto" | "fixed")} className="border border-ink-mid bg-ink-light px-2 py-1.5 text-xs text-paper">
          <option value="auto">Deadlines: automatic</option>
          <option value="fixed">Deadlines: one date for all</option>
        </select>
        {dueMode === "fixed" && (
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="border border-ink-mid bg-ink-light px-2 py-1 text-xs text-paper" />
        )}
        {dueMode === "auto" && (
          <label className="flex items-center gap-1.5 text-[11px] text-slate-light">
            <input type="checkbox" checked={recalc} onChange={(e) => setRecalc(e.target.checked)} /> re-date tasks that have one
          </label>
        )}
        <select value={priority} onChange={(e) => setPriority(e.target.value as "" | TaskPriority)} className="border border-ink-mid bg-ink-light px-2 py-1.5 text-xs text-paper">
          <option value="">Priority: automatic</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          {error && <span className="text-xs text-red-300">{error}</span>}
          <button type="button" onClick={onClear} className="px-3 py-1.5 text-xs uppercase tracking-wider text-slate-light hover:text-paper">Clear</button>
          <button
            type="button"
            disabled={!assignee || busy || (dueMode === "fixed" && !dueDate)}
            onClick={() => void run(true)}
            className="flex items-center gap-1.5 border border-signal bg-signal/10 px-3 py-1.5 text-xs uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />} Review & assign
          </button>
        </div>
      </div>
      {preview && (
        <ModalShell
          wide
          title={`Assign ${preview.length} task${preview.length === 1 ? "" : "s"} to ${assigneeName ?? "this person"}`}
          subtitle="Most important first. They'll get one notification in AEGIS and one Teams message for the whole batch."
          onClose={() => setPreview(null)}
          footer={
            <>
              {error && <span className="mr-auto text-xs text-red-300">{error}</span>}
              <button type="button" onClick={() => setPreview(null)} className="border border-ink-mid px-4 py-2 text-xs uppercase tracking-wider text-slate-light hover:text-paper">Back</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(false)}
                className="flex items-center gap-1.5 border border-signal bg-signal/10 px-4 py-2 text-xs uppercase tracking-wider text-signal hover:bg-signal/20 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Assign
              </button>
            </>
          }
        >
          <PlanTable items={preview} />
        </ModalShell>
      )}
    </>
  );
}
