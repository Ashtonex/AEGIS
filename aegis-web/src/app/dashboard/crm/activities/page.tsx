"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  Phone,
  Users,
  Mail,
  MessageSquare,
  MapPin,
  Plus,
  Check,
  Clock,
  User,
  Briefcase,
  Loader2,
  AlertTriangle,
  Calendar,
  List,
  ChevronLeft,
  ChevronRight,
  X,
  Activity,
  AlertCircle,
} from "lucide-react";
import {
  getCrmActivities,
  getCrmCommunications,
  createCrmCommunication,
  getCrmContacts,
  getCrmOpportunities,
  updateCrmActivity,
  updateCrmCommunication,
  sendCrmWhatsAppMessage,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityRecord {
  id: string;
  type: string;
  channel?: string;
  direction?: "inbound" | "outbound" | "internal";
  subject: string;
  description?: string;
  body?: string;
  activity_date: string;
  started_at?: string;
  duration_seconds?: number;
  status: string;
  outcome?: string;
  response_summary?: string;
  next_action?: string;
  contact_id?: string;
  lead_id?: string;
  opportunity_id?: string;
  contact_name?: string;
  lead_company?: string;
  opportunity_name?: string;
  created_at?: string;
  actor_name?: string;
}

type ViewMode = "list" | "calendar";

type DateGroup = "today" | "yesterday" | "this-week" | "earlier";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVITY_TYPES = ["Call", "WhatsApp", "WhatsApp Call", "Email", "Meeting", "Site Visit", "Manual Note"] as const;

/** Monochrome-plus-signal palette per type. Calendar dots + icon bg tints. */
const TYPE_CONFIG: Record<
  string,
  { color: string; bg: string; border: string; dot: string }
> = {
  Call:       { color: "text-blue-300",   bg: "bg-blue-500/10",   border: "border-blue-500/25",   dot: "#60a5fa" },
  Meeting:    { color: "text-amber-300",  bg: "bg-amber-500/10",  border: "border-amber-500/25",  dot: "#fbbf24" },
  Email:      { color: "text-slate-300",  bg: "bg-slate-500/10",  border: "border-slate-400/25",  dot: "#94a3b8" },
  "Site Visit": { color: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/25", dot: "#34d399" },
  WhatsApp:   { color: "text-violet-300", bg: "bg-violet-500/10", border: "border-violet-500/25", dot: "#a78bfa" },
  "WhatsApp Call": { color: "text-cyan-300", bg: "bg-cyan-500/10", border: "border-cyan-500/25", dot: "#67e8f9" },
  "Manual Note": { color: "text-zinc-300", bg: "bg-zinc-500/10", border: "border-zinc-400/25", dot: "#d4d4d8" },
};
const DEFAULT_TYPE_CONFIG = { color: "text-paper/60", bg: "bg-white/5", border: "border-white/10", dot: "#94a3b8" };

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTypeConfig(type: string) {
  return TYPE_CONFIG[type] ?? DEFAULT_TYPE_CONFIG;
}

function getActivityIcon(type: string, sizeClass = "w-3.5 h-3.5") {
  const cls = `${sizeClass}`;
  switch (type) {
    case "Call":       return <Phone className={cls} />;
    case "Meeting":    return <Users className={cls} />;
    case "Email":      return <Mail className={cls} />;
    case "WhatsApp":   return <MessageSquare className={cls} />;
    case "Site Visit": return <MapPin className={cls} />;
    default:           return <Clock className={cls} />;
  }
}

function typeToChannel(type: string): string {
  const map: Record<string, string> = {
    Call: "phone_call",
    WhatsApp: "whatsapp_message",
    "WhatsApp Call": "whatsapp_call",
    Email: "email",
    Meeting: "meeting",
    "Site Visit": "site_visit",
    "Manual Note": "manual_note",
  };
  return map[type] ?? "manual_note";
}

function channelToType(channel?: string, fallback = "Manual Note"): string {
  const map: Record<string, string> = {
    phone_call: "Call",
    whatsapp_message: "WhatsApp",
    whatsapp_call: "WhatsApp Call",
    email: "Email",
    meeting: "Meeting",
    site_visit: "Site Visit",
    manual_note: "Manual Note",
  };
  return channel ? map[channel] ?? fallback : fallback;
}

function normalizeCommunicationRecord(item: any): ActivityRecord {
  const type = channelToType(item.channel, item.type ?? "Manual Note");
  const details = [
    item.body,
    item.outcome ? `Outcome: ${item.outcome}` : null,
    item.response_summary ? `Response: ${item.response_summary}` : null,
    item.next_action ? `Next action: ${item.next_action}` : null,
    item.duration_seconds ? `Duration: ${item.duration_seconds} seconds` : null,
  ].filter(Boolean).join("\n");
  return {
    ...item,
    type,
    subject: item.subject || item.outcome || "CRM communication",
    description: item.description || details,
    activity_date: item.activity_date || item.started_at || item.created_at,
    status: item.status === "planned" || item.status === "pending" ? "Pending" : item.status === "failed" ? "Failed" : item.status === "received" ? "Received" : "Completed",
  };
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatTime(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleTimeString(undefined, {
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch {
    return "";
  }
}

function isOverdue(act: ActivityRecord): boolean {
  if (act.status !== "Planned" && act.status !== "Pending") return false;
  return new Date(act.activity_date) < new Date();
}

function getDateGroup(dateStr: string): DateGroup {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - startOfToday.getDay());

  if (d >= startOfToday) return "today";
  if (d >= startOfYesterday) return "yesterday";
  if (d >= startOfWeek) return "this-week";
  return "earlier";
}

const GROUP_LABELS: Record<DateGroup, string> = {
  "today":     "TODAY",
  "yesterday": "YESTERDAY",
  "this-week": "THIS WEEK",
  "earlier":   "EARLIER",
};

function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  return fallback;
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ activities }: { activities: ActivityRecord[] }) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const thisMonth = activities.filter(
    (a) => new Date(a.activity_date) >= startOfMonth
  );

  const stats = [
    {
      label: "Total This Month",
      value: thisMonth.length,
      icon: <Activity className="w-4 h-4" />,
      color: "text-paper",
      highlight: false,
    },
    {
      label: "Calls Made",
      value: thisMonth.filter((a) => a.type === "Call").length,
      icon: <Phone className="w-4 h-4" />,
      color: "text-blue-300",
      highlight: false,
    },
    {
      label: "Meetings Held",
      value: thisMonth.filter((a) => a.type === "Meeting").length,
      icon: <Users className="w-4 h-4" />,
      color: "text-amber-300",
      highlight: false,
    },
    {
      label: "Emails Sent",
      value: thisMonth.filter((a) => a.type === "Email").length,
      icon: <Mail className="w-4 h-4" />,
      color: "text-slate-300",
      highlight: false,
    },
    {
      label: "Overdue",
      value: activities.filter(isOverdue).length,
      icon: <AlertCircle className="w-4 h-4" />,
      color: "text-red-400",
      highlight: true,
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-3 mb-5 shrink-0">
      {stats.map((s) => (
        <div
          key={s.label}
          className={`relative bg-ink/40 border rounded-sm p-3 flex flex-col gap-1.5 overflow-hidden group transition-all ${
            s.highlight
              ? "border-red-500/20 hover:border-red-500/40"
              : "border-white/5 hover:border-signal/20"
          }`}
        >
          {/* Left accent stripe */}
          <div
            className={`absolute left-0 top-0 bottom-0 w-0.5 ${
              s.highlight ? "bg-red-500/60" : "bg-signal/30"
            }`}
          />
          <div className={`flex items-center justify-between ${s.color}`}>
            {s.icon}
            <span
              className={`font-mono text-2xl font-black tracking-tight ${s.color}`}
            >
              {s.value}
            </span>
          </div>
          <p className="font-mono text-[9px] text-slate-light uppercase tracking-widest">
            {s.label}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Activity Card ────────────────────────────────────────────────────────────

interface ActivityCardProps {
  act: ActivityRecord;
  onToggleStatus: (act: ActivityRecord) => void;
}

function ActivityCard({ act, onToggleStatus }: ActivityCardProps) {
  const cfg = getTypeConfig(act.type);
  const overdue = isOverdue(act);

  return (
    <div
      className={`relative pl-5 group transition-all`}
    >
      {/* Timeline stem dot */}
      <div
        className={`absolute left-0 top-2 w-2.5 h-2.5 rounded-full border-2 border-[#050505] transition-all`}
        style={{ backgroundColor: cfg.dot }}
        title={act.type}
      />

      <div
        className={`${cfg.bg} border ${cfg.border} rounded-sm p-3 hover:border-opacity-50 transition-all`}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-start gap-2 min-w-0">
            <span className={`mt-0.5 p-1 rounded-sm ${cfg.bg} ${cfg.border} border ${cfg.color} shrink-0`}>
              {getActivityIcon(act.type)}
            </span>
            <div className="min-w-0">
              <h3 className={`font-sans font-bold text-xs text-paper group-hover:text-signal transition-colors truncate`}>
                {act.subject}
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className={`font-mono text-[8px] uppercase tracking-wider ${cfg.color}`}>
                  {act.type}
                </span>
                {/* Status badge */}
                {act.status === "Completed" ? (
                  <span className="inline-flex items-center gap-0.5 font-mono text-[8px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1 py-0.5 rounded-sm uppercase tracking-wider">
                    <Check className="w-2 h-2" /> Done
                  </span>
                ) : overdue ? (
                  <span className="inline-flex items-center gap-0.5 font-mono text-[8px] text-red-400 bg-red-500/15 border border-red-500/30 px-1 py-0.5 rounded-sm uppercase tracking-wider animate-pulse">
                    <AlertTriangle className="w-2 h-2" /> OVERDUE
                  </span>
                ) : (
                  <span className="font-mono text-[8px] text-signal bg-signal/10 border border-signal/20 px-1 py-0.5 rounded-sm uppercase tracking-wider">
                    {act.status}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Timestamp + toggle */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="font-mono text-[9px] text-paper/70">
              {formatDate(act.activity_date)}
            </div>
            <div className="font-mono text-[8px] text-slate-light">
              {formatTime(act.activity_date)}
            </div>
            <button
              onClick={() => onToggleStatus(act)}
              className={`mt-1 px-2 py-0.5 rounded-sm font-mono text-[7px] uppercase tracking-wider border transition-all ${
                act.status === "Completed"
                  ? "border-white/10 text-slate-light hover:border-signal/40 hover:text-signal"
                  : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              }`}
            >
              {act.status === "Completed" ? "Reopen" : "Done"}
            </button>
          </div>
        </div>

        {/* Description */}
        {act.description && (
          <p className="text-[10px] text-paper/70 leading-relaxed bg-ink/40 p-2 rounded-sm border border-white/5 font-sans mb-2">
            {act.description}
          </p>
        )}

        {/* Metadata chips */}
        <div className="flex flex-wrap gap-1.5 text-[8px] font-mono">
          {act.contact_name && (
            <span className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded-sm text-slate-light border border-white/5">
              <User className="w-2 h-2 text-signal" />
              {act.contact_name}
            </span>
          )}
          {act.actor_name && (
            <span className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded-sm text-slate-light border border-white/5">
              <Users className="w-2 h-2 text-amber-300" />
              {act.actor_name}
            </span>
          )}
          {act.direction && (
            <span className="bg-white/5 px-1.5 py-0.5 rounded-sm text-slate-light border border-white/5 uppercase">
              {act.direction}
            </span>
          )}
          {act.opportunity_name && (
            <span className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded-sm text-slate-light border border-white/5 max-w-[160px] truncate">
              <Briefcase className="w-2 h-2 text-blue-400 shrink-0" />
              <span className="truncate">{act.opportunity_name}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({
  activities,
  onToggleStatus,
}: {
  activities: ActivityRecord[];
  onToggleStatus: (act: ActivityRecord) => void;
}) {
  const sorted = useMemo(
    () => [...activities].sort(
      (a, b) => new Date(b.activity_date).getTime() - new Date(a.activity_date).getTime()
    ),
    [activities]
  );

  const grouped = useMemo(() => {
    const map: Partial<Record<DateGroup, ActivityRecord[]>> = {};
    const order: DateGroup[] = ["today", "yesterday", "this-week", "earlier"];
    for (const act of sorted) {
      const g = getDateGroup(act.activity_date);
      if (!map[g]) map[g] = [];
      map[g]!.push(act);
    }
    return order.filter((g) => map[g]?.length).map((g) => ({ group: g, items: map[g]! }));
  }, [sorted]);

  if (activities.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-dark font-mono text-xs gap-2">
        <Clock className="w-10 h-10 text-white/10 stroke-[1.5]" />
        <span>No activities logged yet.</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-1">
      {grouped.map(({ group, items }) => (
        <div key={group}>
          {/* Group header */}
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono text-[9px] text-signal tracking-widest uppercase">
              {GROUP_LABELS[group]}
            </span>
            <div className="flex-1 h-px bg-white/5" />
            <span className="font-mono text-[8px] text-slate-dark">{items.length}</span>
          </div>

          {/* Activities stem */}
          <div className="relative border-l border-white/8 pl-1 space-y-3">
            {items.map((act) => (
              <ActivityCard key={act.id} act={act} onToggleStatus={onToggleStatus} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Calendar View ────────────────────────────────────────────────────────────

function CalendarView({ activities }: { activities: ActivityRecord[] }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const navigate = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m > 11) { m = 0; y++; }
    if (m < 0) { m = 11; y--; }
    setViewMonth(m);
    setViewYear(y);
  };

  // Build day grid (cells with padding for weekday offset)
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  // Map activities to day numbers for this month
  const actsByDay = useMemo(() => {
    const map: Record<number, ActivityRecord[]> = {};
    for (const act of activities) {
      const d = new Date(act.activity_date);
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(act);
      }
    }
    return map;
  }, [activities, viewYear, viewMonth]);

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const isToday = (day: number) =>
    day === today.getDate() &&
    viewMonth === today.getMonth() &&
    viewYear === today.getFullYear();

  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-sm border border-white/10 hover:border-signal/40 text-slate-light hover:text-signal transition-all"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <h2 className="font-mono text-xs text-paper tracking-widest uppercase">
          {MONTHS[viewMonth]} {viewYear}
        </h2>
        <button
          onClick={() => navigate(1)}
          className="p-1.5 rounded-sm border border-white/10 hover:border-signal/40 text-slate-light hover:text-signal transition-all"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-1 shrink-0">
        {DAYS_OF_WEEK.map((d) => (
          <div
            key={d}
            className="font-mono text-[8px] text-slate-dark uppercase tracking-widest text-center py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1 flex-1 auto-rows-fr">
        {cells.map((day, i) => {
          if (!day) {
            return <div key={`pad-${i}`} className="min-h-[72px]" />;
          }
          const dayActs = actsByDay[day] ?? [];
          const selected = selectedDay === day;
          const todayCell = isToday(day);
          const hasOverdue = dayActs.some(isOverdue);

          return (
            <button
              key={day}
              onClick={() => setSelectedDay(selected ? null : day)}
              className={`relative min-h-[72px] p-1.5 rounded-sm border text-left flex flex-col transition-all ${
                todayCell
                  ? "border-signal/50 bg-signal/5"
                  : selected
                  ? "border-signal/30 bg-white/5"
                  : "border-white/5 bg-ink/30 hover:border-white/10"
              }`}
            >
              {/* Day number */}
              <span
                className={`font-mono text-[10px] font-bold mb-1 ${
                  todayCell ? "text-signal" : "text-paper/60"
                }`}
              >
                {day}
              </span>

              {/* Overdue alert stripe */}
              {hasOverdue && (
                <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              )}

              {/* Activity dots (max 4 visible) */}
              <div className="flex flex-wrap gap-0.5 mt-auto">
                {dayActs.slice(0, 6).map((act, idx) => {
                  const cfg = getTypeConfig(act.type);
                  return (
                    <div
                      key={idx}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: cfg.dot }}
                      title={`${act.type}: ${act.subject}`}
                    />
                  );
                })}
                {dayActs.length > 6 && (
                  <span className="font-mono text-[7px] text-slate-light">
                    +{dayActs.length - 6}
                  </span>
                )}
              </div>

              {/* Activity micro-labels (only if small count) */}
              {dayActs.length > 0 && dayActs.length <= 2 && (
                <div className="mt-0.5 space-y-0.5">
                  {dayActs.map((act, idx) => (
                    <div
                      key={idx}
                      className="font-mono text-[7px] truncate"
                      style={{ color: getTypeConfig(act.type).dot }}
                    >
                      {act.subject}
                    </div>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected day detail */}
      {selectedDay && actsByDay[selectedDay] && (
        <div className="shrink-0 border-t border-white/8 pt-3">
          <p className="font-mono text-[9px] text-signal uppercase tracking-widest mb-2">
            {selectedDay} {MONTHS[viewMonth]} — {actsByDay[selectedDay].length} activit
            {actsByDay[selectedDay].length !== 1 ? "ies" : "y"}
          </p>
          <div className="space-y-1.5 max-h-[180px] overflow-y-auto custom-scrollbar">
            {actsByDay[selectedDay].map((act) => {
              const cfg = getTypeConfig(act.type);
              const overdue = isOverdue(act);
              return (
                <div
                  key={act.id}
                  className={`flex items-center gap-2 ${cfg.bg} ${cfg.border} border rounded-sm px-2 py-1.5`}
                >
                  <span className={cfg.color}>{getActivityIcon(act.type, "w-3 h-3")}</span>
                  <span className="font-sans text-[11px] text-paper flex-1 truncate">{act.subject}</span>
                  <span className="font-mono text-[8px] text-slate-light">{formatTime(act.activity_date)}</span>
                  {overdue && (
                    <span className="font-mono text-[7px] text-red-400 bg-red-500/10 border border-red-500/20 px-1 rounded-sm uppercase">
                      OVR
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 shrink-0 border-t border-white/5 pt-3">
        {Object.entries(TYPE_CONFIG).map(([type, cfg]) => (
          <div key={type} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.dot }} />
            <span className="font-mono text-[8px] text-slate-light uppercase tracking-wide">
              {type}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span className="font-mono text-[8px] text-red-400 uppercase tracking-wide">Overdue</span>
        </div>
      </div>
    </div>
  );
}

// ─── Quick Log Panel ──────────────────────────────────────────────────────────

interface QuickLogPanelProps {
  contacts: { id: string; contact_name: string; email?: string; phone?: string }[];
  opportunities: { id: string; name: string; budget?: number; stage?: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

function QuickLogPanel({ contacts, opportunities, onClose, onSuccess }: QuickLogPanelProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formType, setFormType] = useState<string>("Call");
  const [formSubject, setFormSubject] = useState("");
  const [formDate, setFormDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [formTime, setFormTime] = useState("09:00");
  const [formNotes, setFormNotes] = useState("");
  const [formContactId, setFormContactId] = useState("");
  const [formOpportunityId, setFormOpportunityId] = useState("");
  const [formStatus, setFormStatus] = useState("Completed");
  const [formDirection, setFormDirection] = useState<"outbound" | "inbound" | "internal">("outbound");
  const [formOutcome, setFormOutcome] = useState("");
  const [formResponse, setFormResponse] = useState("");
  const [formNextAction, setFormNextAction] = useState("");
  const [formDurationMinutes, setFormDurationMinutes] = useState("");
  const [sendViaWhatsApp, setSendViaWhatsApp] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formSubject.trim()) e.subject = "Subject is required.";
    if (!formDate) e.date = "Date is required.";
    if (!formTime) e.time = "Time is required.";
    if (formDurationMinutes.trim() && Number.isNaN(Number(formDurationMinutes))) e.duration = "Duration must be a number.";
    if (sendViaWhatsApp && formType === "WhatsApp" && !formContactId) e.contact = "Choose a contact before sending through WhatsApp.";
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const errors = validate();
    setFormErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    try {
      const activityDateTime = new Date(`${formDate}T${formTime}:00`).toISOString();
      const channel = typeToChannel(formType);
      const duration_seconds = formDurationMinutes.trim() ? Math.round(Number(formDurationMinutes) * 60) : undefined;
      const payload = {
        channel,
        direction: formDirection,
        subject: formSubject.trim(),
        body: formNotes.trim() || undefined,
        started_at: activityDateTime,
        status: formStatus.toLowerCase(),
        outcome: formOutcome.trim() || undefined,
        response_summary: formResponse.trim() || undefined,
        next_action: formNextAction.trim() || undefined,
        duration_seconds,
        contact_id: formContactId || undefined,
        opportunity_id: formOpportunityId || undefined,
      };
      const response = sendViaWhatsApp && channel === "whatsapp_message"
        ? await sendCrmWhatsAppMessage({
            body: formNotes.trim() || formSubject.trim(),
            subject: formSubject.trim(),
            contact_id: formContactId || undefined,
            opportunity_id: formOpportunityId || undefined,
          }) as { success: boolean; error?: { message?: string } }
        : await createCrmCommunication(payload) as { success: boolean; error?: { message?: string } };
      if (!response.success) {
        throw new Error("Could not log activity.");
      }
      onSuccess();
    } catch (err: unknown) {
      setSubmitError(normalizeActionError(err, "Failed to create activity log."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const typeEmoji: Record<string, string> = {
    Call: "📞", Meeting: "🤝", Email: "✉️", "Site Visit": "📍", WhatsApp: "💬", "WhatsApp Call": "☎️", "Manual Note": "•",
  };

  return (
    /* Overlay backdrop */
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-sm bg-[#06101e] border-l border-white/8 flex flex-col h-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "slideInRight 0.25s ease-out" }}
      >
        {/* Panel header */}
        <div className="flex justify-between items-center border-b border-white/8 px-5 py-4 shrink-0">
          <div>
            <h2 className="font-sans font-black text-sm tracking-wide uppercase text-paper">
              Log Activity
            </h2>
            <p className="font-mono text-[9px] text-slate-light tracking-widest mt-0.5">
              CRM Interaction Record
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-sm border border-white/10 hover:border-signal/40 text-slate-light hover:text-signal transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Type selector pills */}
        <div className="px-5 pt-4 pb-3 border-b border-white/5 shrink-0">
          <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-2">
            Interaction Type
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ACTIVITY_TYPES.map((t) => {
              const cfg = getTypeConfig(t);
              const active = formType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFormType(t)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm border font-mono text-[9px] uppercase tracking-wider transition-all ${
                    active
                      ? `${cfg.bg} ${cfg.border} ${cfg.color} border`
                      : "bg-white/3 border-white/8 text-slate-light hover:border-white/20"
                  }`}
                >
                  <span>{typeEmoji[t] || "●"}</span>
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4">
          {/* Direction */}
          <div>
            <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
              Direction
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["outbound", "inbound", "internal"] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  onClick={() => setFormDirection(direction)}
                  className={`px-2 py-1.5 rounded-sm border font-mono text-[8px] uppercase tracking-wider transition-all ${
                    formDirection === direction
                      ? "bg-signal/10 border-signal/40 text-signal"
                      : "bg-white/3 border-white/8 text-slate-light hover:border-white/20"
                  }`}
                >
                  {direction}
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
              Subject / Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formSubject}
              onChange={(e) => setFormSubject(e.target.value)}
              placeholder="e.g. Initial tender brief discussion"
              className={`w-full bg-ink/80 border rounded-sm px-3 py-2 text-xs text-paper focus:border-signal outline-none font-sans transition-colors ${
                formErrors.subject ? "border-red-500/60" : "border-white/10"
              }`}
            />
            {formErrors.subject && (
              <p className="font-mono text-[9px] text-red-400 mt-1">{formErrors.subject}</p>
            )}
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
                Date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className="w-full bg-ink/80 border border-white/10 rounded-sm px-2.5 py-2 text-xs text-paper focus:border-signal outline-none font-mono"
              />
            </div>
            <div>
              <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
                Time <span className="text-red-400">*</span>
              </label>
              <input
                type="time"
                value={formTime}
                onChange={(e) => setFormTime(e.target.value)}
                className="w-full bg-ink/80 border border-white/10 rounded-sm px-2.5 py-2 text-xs text-paper focus:border-signal outline-none font-mono"
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
              Status
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {["Completed", "Planned", "Pending"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFormStatus(s)}
                  className={`px-2 py-1.5 rounded-sm border font-mono text-[8px] uppercase tracking-wider transition-all ${
                    formStatus === s
                      ? s === "Completed"
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                        : s === "Planned"
                        ? "bg-signal/10 border-signal/40 text-signal"
                        : "bg-blue-500/10 border-blue-500/30 text-blue-300"
                      : "bg-white/3 border-white/8 text-slate-light hover:border-white/20"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Outcome and duration */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
                Outcome
              </label>
              <select
                value={formOutcome}
                onChange={(e) => setFormOutcome(e.target.value)}
                className="w-full bg-ink/80 border border-white/10 rounded-sm px-2.5 py-2 text-xs text-paper focus:border-signal outline-none font-sans"
              >
                <option value="">Not set</option>
                <option value="connected">Connected</option>
                <option value="no_answer">No answer</option>
                <option value="interested">Interested</option>
                <option value="not_interested">Not interested</option>
                <option value="quote_requested">Quote requested</option>
                <option value="follow_up_required">Follow-up required</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div>
              <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
                Duration minutes
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={formDurationMinutes}
                onChange={(e) => setFormDurationMinutes(e.target.value)}
                className={`w-full bg-ink/80 border rounded-sm px-2.5 py-2 text-xs text-paper focus:border-signal outline-none font-mono ${
                  formErrors.duration ? "border-red-500/60" : "border-white/10"
                }`}
              />
              {formErrors.duration && (
                <p className="font-mono text-[9px] text-red-400 mt-1">{formErrors.duration}</p>
              )}
            </div>
          </div>

          {/* Contact */}
          <div>
            <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
              <User className="w-2.5 h-2.5 inline mr-1" />
              Linked Contact
            </label>
            <select
              value={formContactId}
              onChange={(e) => setFormContactId(e.target.value)}
              className="w-full bg-ink/80 border border-white/10 rounded-sm px-2.5 py-2 text-xs text-paper focus:border-signal outline-none font-sans"
            >
              <option value="">— None —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contact_name} {c.phone ? `(${c.phone})` : c.email ? `(${c.email})` : ""}
                </option>
              ))}
            </select>
            {formErrors.contact && (
              <p className="font-mono text-[9px] text-red-400 mt-1">{formErrors.contact}</p>
            )}
          </div>

          {/* Opportunity */}
          <div>
            <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
              <Briefcase className="w-2.5 h-2.5 inline mr-1" />
              Linked Deal / Opportunity
            </label>
            <select
              value={formOpportunityId}
              onChange={(e) => setFormOpportunityId(e.target.value)}
              className="w-full bg-ink/80 border border-white/10 rounded-sm px-2.5 py-2 text-xs text-paper focus:border-signal outline-none font-sans"
            >
              <option value="">— None —</option>
              {opportunities.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — ${Number(o.budget ?? 0).toLocaleString()} [{o.stage}]
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
              Notes / Message Body
            </label>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Key discussion points, outcomes, next steps..."
              rows={4}
              className="w-full bg-ink/80 border border-white/10 rounded-sm px-2.5 py-2 text-xs text-paper focus:border-signal outline-none font-sans resize-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-3">
            <label className="block">
              <span className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
                Response summary
              </span>
              <textarea
                value={formResponse}
                onChange={(e) => setFormResponse(e.target.value)}
                placeholder="What did they say or confirm?"
                rows={2}
                className="w-full bg-ink/80 border border-white/10 rounded-sm px-2.5 py-2 text-xs text-paper focus:border-signal outline-none font-sans resize-none"
              />
            </label>
            <label className="block">
              <span className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1.5">
                Next action
              </span>
              <input
                value={formNextAction}
                onChange={(e) => setFormNextAction(e.target.value)}
                placeholder="e.g. Send BOQ tomorrow"
                className="w-full bg-ink/80 border border-white/10 rounded-sm px-2.5 py-2 text-xs text-paper focus:border-signal outline-none font-sans"
              />
            </label>
          </div>

          {formType === "WhatsApp" && (
            <label className="flex items-start gap-2 bg-violet-500/10 border border-violet-500/25 rounded-sm p-3 text-xs text-violet-100">
              <input
                type="checkbox"
                checked={sendViaWhatsApp}
                onChange={(e) => setSendViaWhatsApp(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-mono text-[9px] uppercase tracking-widest text-violet-200">Send through WhatsApp Cloud API</span>
                <span className="mt-1 block text-[10px] leading-relaxed text-violet-100/80">Leave unchecked to manually log a WhatsApp message that was sent outside AEGIS.</span>
              </span>
            </label>
          )}

          {submitError && (
            <div className="flex items-center gap-2 bg-red-950/30 border border-red-500/30 p-2.5 rounded-sm">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <p className="font-mono text-[9px] text-red-300">{submitError}</p>
            </div>
          )}
        </form>

        {/* Submit footer */}
        <div className="border-t border-white/8 px-5 py-4 shrink-0">
          <button
            type="submit"
            form=""
            disabled={isSubmitting}
            onClick={handleSubmit}
            className="w-full bg-signal hover:bg-signal/85 disabled:opacity-50 text-black py-2.5 rounded-sm text-xs font-mono font-black tracking-widest uppercase transition-all flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{isSubmitting ? "LOGGING..." : "LOG INTERACTION"}</span>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CRMActivitiesPage() {
  const { session } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [contacts, setContacts] = useState<{ id: string; contact_name: string; email?: string; phone?: string }[]>([]);
  const [opportunities, setOpportunities] = useState<{ id: string; name: string; budget?: number; stage?: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [showLogForm, setShowLogForm] = useState(false);

  const loadPageData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [actRes, contactsRes, oppsRes] = await Promise.allSettled([
        getCrmCommunications({ limit: 250 }),
        getCrmContacts(),
        getCrmOpportunities(),
      ]);

      if (actRes.status === "fulfilled" && actRes.value.success) {
        setActivities((actRes.value.data || []).map(normalizeCommunicationRecord));
      } else {
        const fallback = await getCrmActivities();
        setActivities((fallback.data || []).map((item: any) => ({
          ...item,
          activity_date: item.activity_date || item.created_at,
        })));
      }
      if (contactsRes.status === "fulfilled" && contactsRes.value.success) {
        setContacts(contactsRes.value.data || []);
      }
      if (oppsRes.status === "fulfilled" && oppsRes.value.success) {
        setOpportunities(oppsRes.value.data || []);
      }
    } catch (err: unknown) {
      setLoadError(normalizeActionError(err, "Failed to load activities feed."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadPageData();
  }, [session, loadPageData]);

  const toggleStatus = useCallback(
    async (activity: ActivityRecord) => {
      const nextStatus = activity.status === "Completed" ? "Pending" : "Completed";
      // Optimistic update
      setActivities((prev) =>
        prev.map((a) => (a.id === activity.id ? { ...a, status: nextStatus } : a))
      );
      try {
        if (activity.channel) {
          await updateCrmCommunication(activity.id, { status: nextStatus.toLowerCase() });
        } else {
          await updateCrmActivity(activity.id, { status: nextStatus });
        }
      } catch {
        // Revert on failure
        setActivities((prev) =>
          prev.map((a) => (a.id === activity.id ? { ...a, status: activity.status } : a))
        );
      }
    },
    []
  );

  const overdueCount = useMemo(() => activities.filter(isOverdue).length, [activities]);

  return (
    <div className="flex flex-col h-full bg-[#050a13] text-paper overflow-hidden">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-start border-b border-white/8 px-6 py-4 shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-sans font-black text-xl tracking-tight uppercase text-paper">
              Activity Log
            </h1>
            {overdueCount > 0 && (
              <span className="flex items-center gap-1 font-mono text-[9px] text-red-400 bg-red-500/10 border border-red-500/25 px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
                <AlertTriangle className="w-2.5 h-2.5" />
                {overdueCount} Overdue
              </span>
            )}
          </div>
          <p className="font-mono text-[9px] text-slate-light tracking-widest uppercase">
            CRM Communications &amp; Interaction Feed
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center bg-ink/60 border border-white/8 rounded-sm p-0.5">
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wider transition-all ${
                viewMode === "list"
                  ? "bg-signal text-black font-black"
                  : "text-slate-light hover:text-paper"
              }`}
            >
              <List className="w-3 h-3" />
              List
            </button>
            <button
              onClick={() => setViewMode("calendar")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wider transition-all ${
                viewMode === "calendar"
                  ? "bg-signal text-black font-black"
                  : "text-slate-light hover:text-paper"
              }`}
            >
              <Calendar className="w-3 h-3" />
              Calendar
            </button>
          </div>

          {/* Log button */}
          <button
            onClick={() => setShowLogForm(true)}
            className="flex items-center gap-1.5 bg-signal hover:bg-signal/85 text-black px-4 py-2 text-xs font-mono font-black tracking-wider rounded-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>LOG ACTIVITY</span>
          </button>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 px-6 py-5 overflow-hidden">
        {/* Error */}
        {loadError && (
          <div className="bg-red-950/20 border border-red-500/30 p-3 mb-4 rounded-sm flex items-center gap-2.5 text-red-200 shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="font-mono text-xs">{loadError}</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-signal animate-spin" />
              <span className="font-mono text-[10px] text-slate-light tracking-widest uppercase">
                Loading feed...
              </span>
            </div>
          </div>
        ) : (
          <>
            {/* Stats Bar */}
            <StatsBar activities={activities} />

            {/* Main content: List or Calendar */}
            {viewMode === "list" ? (
              <ListView activities={activities} onToggleStatus={toggleStatus} />
            ) : (
              <CalendarView activities={activities} />
            )}
          </>
        )}
      </div>

      {/* ── Slide-in Quick Log Panel ───────────────────────────────────────── */}
      {showLogForm && (
        <QuickLogPanel
          contacts={contacts}
          opportunities={opportunities}
          onClose={() => setShowLogForm(false)}
          onSuccess={async () => {
            setShowLogForm(false);
            await loadPageData();
          }}
        />
      )}
    </div>
  );
}
