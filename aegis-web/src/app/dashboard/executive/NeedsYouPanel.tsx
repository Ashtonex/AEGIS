"use client";

// "Needs you": approvals, exceptions and site problems as one ranked to-do
// list (GET /executive/needs-you). Items close by themselves when their
// condition is fixed; this panel only assigns, snoozes or dismisses them.
// Decisions are still made in their own module (its approval rules live
// there) - except leave and plant requests, which keep the quick
// approve/reject the old Decisions panel had.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BellOff, Check, ChevronDown, ChevronRight, Clock, Loader2, MoreHorizontal, RotateCcw, UserPlus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useLiveRefresh } from "@/lib/live/LiveDataProvider";
import { NEEDS_YOU_TABLES } from "@/lib/live/liveTables";
import {
  actOnExecutiveNeedsYou,
  approveHRLeaveRequest,
  getExecutiveNeedsYou,
  updatePlantRequestStatus,
  type NeedsYouAction,
  type NeedsYouData,
  type NeedsYouItem,
  type NeedsYouKind,
} from "@/lib/api";

const VISIBLE = 8;
const SEVERITY = {
  critical: { dot: "bg-red-400", label: "Critical", tone: "border-red-500/40 text-red-300 bg-red-950/20" },
  warning: { dot: "bg-amber-400", label: "Warning", tone: "border-amber-500/40 text-amber-300 bg-amber-950/20" },
  info: { dot: "bg-sky-400", label: "Info", tone: "border-ink-mid text-slate-light" },
} as const;
const KIND_LABEL: Record<NeedsYouKind, string> = { site: "Site", decision: "Decision", exception: "Exception" };
const SNOOZE_OPTIONS = [
  { label: "Until tomorrow", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
];

type Filter = "all" | "mine" | NeedsYouKind;

const money = (value: number | null) =>
  value === null ? null : `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;

function addDays(iso: string, days: number): string {
  const day = new Date(`${iso}T12:00:00`);
  day.setDate(day.getDate() + days);
  return day.toISOString().slice(0, 10);
}

function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || fallback;
}

function ageLabel(item: NeedsYouItem): string | null {
  if (item.due) return `Due ${shortDate(item.due)}`;
  if (item.age_days === null) return item.kind === "site" && item.since ? `Last worked ${shortDate(item.since)}` : null;
  if (item.age_days === 0) return "Today";
  return `${item.age_days}d old`;
}

type Props = {
  currentUserId: string | null;
  onOpenSite: (projectId: string) => void;
};

export function NeedsYouPanel({ currentUserId, onOpenSite }: Props) {
  const [data, setData] = useState<NeedsYouData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<NeedsYouItem | null>(null);
  const [dismissing, setDismissing] = useState<NeedsYouItem | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getExecutiveNeedsYou();
      setData(res.data ?? null);
      setFailed(null);
    } catch (err) {
      setFailed(errorText(err, "The action list could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Quiet refresh: an approval decided, a clock-out recorded or another
  // executive snoozing an item all change the list.
  useLiveRefresh(NEEDS_YOU_TABLES, undefined, () => void load());

  const act = useCallback(async (body: NeedsYouAction) => {
    setBusyKey(body.item_key);
    try {
      const res = await actOnExecutiveNeedsYou(body);
      if (res.data) setData(res.data);
      toast.success(res.message || "Saved.");
      return true;
    } catch (err) {
      toast.error(errorText(err, "That change could not be saved."));
      return false;
    } finally {
      setBusyKey(null);
    }
  }, []);

  const decide = useCallback(async (item: NeedsYouItem, decision: "approved" | "rejected") => {
    if (!item.decide) return;
    setBusyKey(item.key);
    try {
      if (item.decide.type === "leave_request") {
        await approveHRLeaveRequest(item.decide.id, decision, "Processed from Executive Dashboard.");
      } else {
        await updatePlantRequestStatus(item.decide.id, { status: decision });
      }
      toast.success(`${decision === "approved" ? "Approved" : "Rejected"}: ${item.title.replace(/^Decide /, "")}`);
      await load();
    } catch (err) {
      toast.error(errorText(err, "The decision could not be recorded."));
    } finally {
      setBusyKey(null);
    }
  }, [load]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const open = items.filter((item) => !item.hidden);
  const hidden = items.filter((item) => item.hidden);
  const filtered = open.filter((item) => {
    if (filter === "all") return true;
    if (filter === "mine") return item.state.assigned_to?.user_id === currentUserId;
    return item.kind === filter;
  });
  const visible = showAll ? filtered : filtered.slice(0, VISIBLE);
  const summary = data?.summary;

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: open.length },
    { key: "site", label: "Sites", count: summary?.by_kind.site ?? 0 },
    { key: "decision", label: "Decisions", count: summary?.by_kind.decision ?? 0 },
    { key: "exception", label: "Exceptions", count: summary?.by_kind.exception ?? 0 },
    { key: "mine", label: "Assigned to me", count: summary?.mine ?? 0 },
  ];

  return (
    <section className="bg-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-4">
      <div className="flex flex-wrap justify-between items-start gap-3 border-b border-ink-mid pb-3">
        <div>
          <h2 className="font-mono text-xs tracking-widest text-paper uppercase">Needs you</h2>
          <p className="text-xs text-slate-light mt-1">
            Site problems, decisions waiting in their module and exceptions, worst first. Items close by themselves once fixed.
          </p>
        </div>
        {summary && (
          <div className="flex flex-wrap gap-1.5 font-mono text-[10px] uppercase">
            <span className="px-2 py-0.5 border border-ink-mid rounded text-paper">{summary.open} open</span>
            {summary.critical > 0 && <span className={`px-2 py-0.5 border rounded ${SEVERITY.critical.tone}`}>{summary.critical} critical</span>}
            {summary.unassigned > 0 && <span className="px-2 py-0.5 border border-ink-mid rounded text-slate-light">{summary.unassigned} unassigned</span>}
          </div>
        )}
      </div>

      {open.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.filter((chip) => chip.key === "all" || chip.count > 0).map((chip) => (
            <button
              key={chip.key}
              onClick={() => { setFilter(chip.key); setShowAll(false); }}
              className={`font-mono text-[10px] uppercase px-2 py-0.5 border rounded ${filter === chip.key ? "border-signal text-signal" : "border-ink-mid text-slate-light hover:text-paper"}`}
            >
              {chip.label} {chip.count}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {loading && !data ? (
          <p className="flex items-center gap-2 text-xs text-slate py-4"><Loader2 className="h-4 w-4 animate-spin" /> Building your action list…</p>
        ) : failed && !data ? (
          <p className="text-xs text-red-300 py-4">{failed}</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-slate py-4">{open.length ? "Nothing in this view." : "Nothing needs you right now."}</p>
        ) : (
          <>
            {visible.map((item) => (
              <ItemRow
                key={item.key}
                item={item}
                busy={busyKey === item.key}
                today={data?.today ?? new Date().toISOString().slice(0, 10)}
                onOpenSite={onOpenSite}
                onAssign={() => setAssigning(item)}
                onDismiss={() => setDismissing(item)}
                onAct={act}
                onDecide={decide}
              />
            ))}
            {filtered.length > VISIBLE && (
              <button onClick={() => setShowAll((value) => !value)} className="w-full font-mono text-[10px] uppercase text-signal hover:underline py-1">
                {showAll ? "Show fewer" : `Show all ${filtered.length}`}
              </button>
            )}
          </>
        )}
      </div>

      {hidden.length > 0 && (
        <div className="mt-3 border-t border-ink-mid pt-3">
          <button onClick={() => setShowHidden((value) => !value)} className="flex items-center gap-1 font-mono text-[10px] uppercase text-slate-light hover:text-paper">
            {showHidden ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Snoozed {summary?.snoozed ?? 0} · Dismissed {summary?.dismissed ?? 0}
          </button>
          {showHidden && (
            <div className="mt-2 space-y-1.5">
              {hidden.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 border border-ink-mid rounded-md px-3 py-2 opacity-75">
                  <div className="min-w-0">
                    <p className="text-xs text-paper truncate">{item.title}</p>
                    <p className="font-mono text-[10px] text-slate">
                      {item.state.status === "snoozed" ? `Snoozed until ${shortDate(item.state.snoozed_until)}` : "Dismissed"}
                      {item.state.note ? ` · ${item.state.note}` : ""}
                    </p>
                  </div>
                  <button
                    disabled={busyKey === item.key}
                    onClick={() => void act({ item_key: item.key, action: "reopen" })}
                    className="shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] font-mono rounded border border-ink-mid text-slate-light hover:text-paper hover:border-signal disabled:opacity-50"
                  >
                    {busyKey === item.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Reopen
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AssignDialog
        item={assigning}
        assignees={data?.assignees ?? []}
        onClose={() => setAssigning(null)}
        onSave={async (assignee, note) => {
          if (!assigning) return;
          if (await act({ item_key: assigning.key, action: "assign", assignee_user_id: assignee, note })) setAssigning(null);
        }}
      />
      <DismissDialog
        item={dismissing}
        onClose={() => setDismissing(null)}
        onSave={async (note) => {
          if (!dismissing) return;
          if (await act({ item_key: dismissing.key, action: "dismiss", note })) setDismissing(null);
        }}
      />
    </section>
  );
}

function ItemRow({ item, busy, today, onOpenSite, onAssign, onDismiss, onAct, onDecide }: {
  item: NeedsYouItem;
  busy: boolean;
  today: string;
  onOpenSite: (projectId: string) => void;
  onAssign: () => void;
  onDismiss: () => void;
  onAct: (body: NeedsYouAction) => Promise<boolean>;
  onDecide: (item: NeedsYouItem, decision: "approved" | "rejected") => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const severity = SEVERITY[item.severity];
  const owner = item.state.assigned_to;
  const age = ageLabel(item);
  const amount = money(item.amount);
  const openTarget = item.kind === "site" && item.project_id
    ? <button onClick={() => onOpenSite(item.project_id!)} className="px-2.5 py-1 text-xs font-mono rounded border border-ink-mid bg-ink text-slate-light hover:text-paper hover:border-signal">{item.action_label}</button>
    : <Link href={item.action_url || "/dashboard"} className="px-2.5 py-1 text-xs font-mono rounded border border-ink-mid bg-ink text-slate-light hover:text-paper hover:border-signal">{item.action_label} →</Link>;

  return (
    <div className="border border-ink-mid bg-ink-light rounded-md p-3 hover:border-signal/60 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${severity.dot}`} aria-label={severity.label} />
            <span className="font-mono text-[10px] uppercase text-signal">{KIND_LABEL[item.kind]}{item.category && item.kind !== "site" ? ` · ${item.category}` : ""}</span>
            {age && <span className="font-mono text-[9px] uppercase px-1.5 border border-ink-mid rounded text-slate-light">{age}</span>}
            {item.state.returned && <span className="font-mono text-[9px] uppercase px-1.5 border border-amber-500/40 rounded text-amber-300">{item.state.returned}</span>}
          </div>
          <p className="font-semibold text-paper text-sm mt-1.5">{item.title}</p>
          {(item.detail || item.points.length > 0) && (
            <button onClick={() => setExpanded((value) => !value)} className="mt-0.5 flex items-center gap-1 text-xs text-slate-light hover:text-paper">
              {item.points.length > 0 && (expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
              {item.detail || `${item.points.length} detail(s)`}
            </button>
          )}
          {expanded && item.points.length > 0 && (
            <ul className="mt-1 ml-4 list-disc space-y-0.5 text-xs text-slate-light">
              {item.points.map((point) => <li key={point}>{point}</li>)}
            </ul>
          )}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate">
            {owner ? (
              <span className="text-paper">Owner: {owner.name || "—"}</span>
            ) : item.suggested_owner ? (
              <span>Suggested owner: {item.suggested_owner.name}{item.suggested_owner.role ? ` (${item.suggested_owner.role})` : ""}</span>
            ) : (
              <span>No owner</span>
            )}
            {item.state.note && <span className="italic">“{item.state.note}”</span>}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
          {amount && <span className="font-mono text-sm text-paper">{amount}</span>}
          {item.decide ? (
            <>
              <button disabled={busy} onClick={() => void onDecide(item, "approved")} className="px-2.5 py-1 text-xs font-mono rounded border border-emerald-600/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 disabled:opacity-50 flex items-center gap-1">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Approve
              </button>
              <button disabled={busy} onClick={() => void onDecide(item, "rejected")} className="px-2.5 py-1 text-xs font-mono rounded border border-rose-600/50 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 disabled:opacity-50 flex items-center gap-1">
                <X className="h-3 w-3" /> Reject
              </button>
            </>
          ) : openTarget}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button disabled={busy} aria-label="More actions" className="p-1.5 rounded border border-ink-mid text-slate-light hover:text-paper hover:border-signal disabled:opacity-50">
                {busy && !item.decide ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {item.suggested_owner && !owner && (
                <DropdownMenuItem onSelect={() => void onAct({ item_key: item.key, action: "assign", assignee_user_id: item.suggested_owner!.user_id })}>
                  <UserPlus className="h-3.5 w-3.5" /> Assign to {item.suggested_owner.name}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onAssign}>
                <UserPlus className="h-3.5 w-3.5" /> {owner ? "Reassign…" : "Assign to…"}
              </DropdownMenuItem>
              {owner && (
                <DropdownMenuItem onSelect={() => void onAct({ item_key: item.key, action: "unassign" })}>
                  <X className="h-3.5 w-3.5" /> Remove owner
                </DropdownMenuItem>
              )}
              {item.decide && item.action_url && (
                <DropdownMenuItem asChild>
                  <Link href={item.action_url}>Open in its module →</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> Snooze</DropdownMenuLabel>
              {SNOOZE_OPTIONS.map((option) => (
                <DropdownMenuItem key={option.days} onSelect={() => void onAct({ item_key: item.key, action: "snooze", until: addDays(today, option.days) })}>
                  {option.label}
                </DropdownMenuItem>
              ))}
              {item.kind !== "decision" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onDismiss}>
                    <BellOff className="h-3.5 w-3.5" /> Dismiss…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function AssignDialog({ item, assignees, onClose, onSave }: {
  item: NeedsYouItem | null;
  assignees: NeedsYouData["assignees"];
  onClose: () => void;
  onSave: (assignee: string, note?: string) => Promise<void>;
}) {
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setAssignee(item.state.assigned_to?.user_id || item.suggested_owner?.user_id || "");
      setNote("");
    }
  }, [item]);

  return (
    <Dialog open={Boolean(item)} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign</DialogTitle>
          <DialogDescription>{item?.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger><SelectValue placeholder="Choose a person" /></SelectTrigger>
            <SelectContent>
              {assignees.map((person) => (
                <SelectItem key={person.user_id} value={person.user_id}>
                  {person.name || person.email}{item?.suggested_owner?.user_id === person.user_id ? " (suggested)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note for them (optional)" maxLength={500} />
          <p className="text-[11px] text-slate">They get a notification with a link to where it is fixed.</p>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono rounded border border-ink-mid text-slate-light hover:text-paper">Cancel</button>
          <button
            disabled={!assignee || saving}
            onClick={async () => { setSaving(true); await onSave(assignee, note.trim() || undefined); setSaving(false); }}
            className="px-3 py-1.5 text-xs font-mono rounded border border-signal text-signal hover:bg-signal/10 disabled:opacity-50 flex items-center gap-1"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />} Assign
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DismissDialog({ item, onClose, onSave }: {
  item: NeedsYouItem | null;
  onClose: () => void;
  onSave: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (item) setNote(""); }, [item]);

  return (
    <Dialog open={Boolean(item)} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dismiss</DialogTitle>
          <DialogDescription>
            {item?.title} — it stays hidden until something new appears under it.
          </DialogDescription>
        </DialogHeader>
        <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why? (required, kept on record)" maxLength={500} />
        <DialogFooter>
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono rounded border border-ink-mid text-slate-light hover:text-paper">Cancel</button>
          <button
            disabled={!note.trim() || saving}
            onClick={async () => { setSaving(true); await onSave(note.trim()); setSaving(false); }}
            className="px-3 py-1.5 text-xs font-mono rounded border border-amber-500/50 text-amber-300 hover:bg-amber-950/30 disabled:opacity-50 flex items-center gap-1"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />} Dismiss
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
