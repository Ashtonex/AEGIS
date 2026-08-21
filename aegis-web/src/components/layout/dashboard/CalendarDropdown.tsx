"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { CrmActivity } from "@/lib/api";
import { useCalendarActivities } from "@/hooks/useCalendarActivities";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function dateKey(value: Date | string) {
  const d = typeof value === "string" ? new Date(value) : value;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfGrid(monthDate: Date) {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfGrid(monthDate: Date) {
  const start = startOfGrid(monthDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 41);
  end.setHours(23, 59, 59, 999);
  return end;
}

function priorityClass(activity: CrmActivity) {
  if (activity.priority === "urgent") return "border-red-500/40 text-red-200";
  if (activity.priority === "high") return "border-amber-500/40 text-amber-100";
  return "border-ink-mid text-paper";
}

function formatTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function CalendarDropdown() {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const rangeStart = useMemo(() => startOfGrid(visibleMonth), [visibleMonth]);
  const rangeEnd = useMemo(() => endOfGrid(visibleMonth), [visibleMonth]);
  const { activities, isLoading, error, refresh } = useCalendarActivities(rangeStart, rangeEnd);

  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const activitiesByDay = useMemo(() => {
    const map = new Map<string, CrmActivity[]>();
    for (const activity of activities) {
      if (!activity.activity_date) continue;
      const key = dateKey(activity.activity_date);
      const bucket = map.get(key);
      if (bucket) bucket.push(activity);
      else map.set(key, [activity]);
    }
    return map;
  }, [activities]);

  const today = new Date();
  const gridDays = useMemo(() => {
    const days: Date[] = [];
    const cursor = new Date(rangeStart);
    for (let i = 0; i < 42; i++) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [rangeStart]);

  const agenda = useMemo(() => {
    if (selectedDate) {
      return (activitiesByDay.get(dateKey(selectedDate)) || [])
        .slice()
        .sort((a, b) => new Date(a.activity_date).getTime() - new Date(b.activity_date).getTime());
    }
    const now = Date.now();
    return activities
      .filter((activity) => new Date(activity.activity_date).getTime() >= now - 60 * 60 * 1000)
      .slice()
      .sort((a, b) => new Date(a.activity_date).getTime() - new Date(b.activity_date).getTime())
      .slice(0, 8);
  }, [selectedDate, activitiesByDay, activities]);

  function changeMonth(delta: number) {
    setSelectedDate(null);
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-slate hover:text-paper transition-colors relative"
        aria-label="Open calendar"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <CalendarDays className="w-5 h-5" />
      </button>

      {open && (
        // Below md, this renders as a full-height bottom sheet over a
        // backdrop instead of the absolute-anchored dropdown - anchoring a
        // 520px panel to a small header icon doesn't work once the icon
        // sits near the edge of a phone-width screen.
        <div className="fixed inset-0 z-50 bg-black/60 md:absolute md:inset-auto md:right-0 md:top-9 md:bg-transparent" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto border-t border-ink-mid bg-ink-light shadow-2xl md:static md:inset-auto md:w-[min(520px,calc(100vw-2rem))] md:max-h-none md:overflow-visible md:border md:border-ink-mid"
          >
          <div className="flex items-center justify-between border-b border-ink-mid p-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-signal">CRM schedule</p>
              <h2 className="text-base font-semibold text-paper">Calendar</h2>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => changeMonth(-1)}
                className="inline-flex h-7 w-7 items-center justify-center border border-ink-mid text-slate-light hover:text-paper"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="font-mono text-[10px] uppercase tracking-widest text-slate-light w-24 text-center">
                {MONTH_LABELS[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}
              </span>
              <button
                type="button"
                onClick={() => changeMonth(1)}
                className="inline-flex h-7 w-7 items-center justify-center border border-ink-mid text-slate-light hover:text-paper"
                aria-label="Next month"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="p-3 border-b border-ink-mid">
            <div className="grid grid-cols-7 gap-1 mb-1">
              {DAY_LABELS.map((label, idx) => (
                <div key={`${label}-${idx}`} className="text-center font-mono text-[9px] uppercase text-slate">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {gridDays.map((day) => {
                const inMonth = day.getMonth() === visibleMonth.getMonth();
                const isToday = dateKey(day) === dateKey(today);
                const isSelected = selectedDate && dateKey(day) === dateKey(selectedDate);
                const hasActivity = activitiesByDay.has(dateKey(day));
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => setSelectedDate(isSelected ? null : day)}
                    className={[
                      "relative h-8 text-xs flex items-center justify-center",
                      inMonth ? "text-paper" : "text-slate/40",
                      isSelected ? "bg-signal text-ink font-semibold" : "hover:bg-ink",
                      isToday && !isSelected ? "border border-signal/60" : "",
                    ].join(" ")}
                  >
                    {day.getDate()}
                    {hasActivity && !isSelected && (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full bg-signal" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate">
                {selectedDate
                  ? selectedDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
                  : "Upcoming"}
              </p>
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="text-[10px] font-mono uppercase text-signal hover:underline"
                >
                  Clear
                </button>
              )}
            </div>

            {isLoading ? (
              <div className="h-24 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-signal animate-spin" />
              </div>
            ) : error ? (
              <p className="p-4 text-sm text-red-200">{error}</p>
            ) : agenda.length === 0 ? (
              <p className="p-4 pb-5 text-sm text-slate-light">
                {selectedDate ? "Nothing scheduled this day." : "Nothing coming up."}
              </p>
            ) : (
              <div className="max-h-[280px] overflow-y-auto divide-y divide-ink-mid">
                {agenda.map((activity) => (
                  <div key={activity.id} className={`px-4 py-3 border-l-2 ${priorityClass(activity)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-paper">{activity.subject}</p>
                      <span className="font-mono text-[10px] uppercase text-slate-light whitespace-nowrap">
                        {formatTime(activity.activity_date)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] uppercase text-slate">{activity.type}</span>
                      {activity.owner_name && (
                        <span className="font-mono text-[10px] uppercase text-slate-light">· {activity.owner_name}</span>
                      )}
                      {(activity.opportunity_name || activity.lead_company) && (
                        <span className="text-[10px] text-slate-light truncate">
                          · {activity.opportunity_name || activity.lead_company}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Link
            href="/dashboard/crm/activities"
            onClick={() => setOpen(false)}
            className="block border-t border-ink-mid p-3 text-center font-mono text-[10px] uppercase tracking-widest text-signal hover:bg-ink"
          >
            Open full CRM calendar
          </Link>
          </div>
        </div>
      )}
    </div>
  );
}
