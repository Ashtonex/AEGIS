"use client";

import { useCallback, useEffect, useState } from "react";
import { checkInToday } from "@/lib/api";
import { WeeklyHoursModal } from "./WeeklyHoursModal";

function harareDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare" }).format(new Date());
}

function safeGet(store: Storage | undefined, key: string) {
  try { return store?.getItem(key) ?? null; } catch { return null; }
}
function safeSet(store: Storage | undefined, key: string, value: string) {
  try { store?.setItem(key, value); } catch { /* private mode: the server dedupes anyway */ }
}

/**
 * Signing in to AEGIS is the check-in. Runs once per Harare day per browser
 * (the server is idempotent too). From Friday, the first load also opens the
 * weekly hours confirmation until it is submitted; "Remind me later" hides it
 * for this browser session only.
 */
export function AttendanceCheckIn() {
  const [dueWeek, setDueWeek] = useState<string | null>(null);

  const run = useCallback(async () => {
    const day = harareDate();
    const key = `aegis:checkin:${day}`;
    const cached = safeGet(typeof window !== "undefined" ? window.localStorage : undefined, key);
    let due: string | null = null;
    if (cached !== null) {
      due = cached || null;
    } else {
      try {
        const result = await checkInToday();
        if (!result.data.linked) { safeSet(window.localStorage, key, ""); return; }
        due = result.data.weekly_confirmation_due ?? null;
        safeSet(window.localStorage, key, due ?? "");
      } catch {
        return; // never block the dashboard over attendance
      }
    }
    if (due && !safeGet(window.sessionStorage, `aegis:weekly-later:${due}`)) setDueWeek(due);
  }, []);

  useEffect(() => {
    void run();
    // A tab left open overnight checks in again on the new day.
    const onVisible = () => { if (document.visibilityState === "visible") void run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [run]);

  if (!dueWeek) return null;
  return (
    <WeeklyHoursModal
      weekEnd={dueWeek}
      onClose={() => { safeSet(window.sessionStorage, `aegis:weekly-later:${dueWeek}`, "1"); setDueWeek(null); }}
      onDone={() => safeSet(window.localStorage, `aegis:checkin:${harareDate()}`, "")}
    />
  );
}
