"use client";

import { useEffect, useState } from "react";

/**
 * Self-contained CAT wall clock for the dashboard top bar.
 *
 * This used to live as `time` state inside DashboardShell, ticking once a
 * second. DashboardShell is ~950 lines and renders the entire sidebar nav
 * tree (149 links), so every tick re-rendered the whole shell. Owning the
 * interval and the state here confines each tick to this one text node.
 *
 * Markup/formatting is byte-for-byte what DashboardShell rendered before:
 * `<div className="hidden lg:block font-mono text-data-sm text-slate-light
 * tracking-widest">{time}</div>`, with time = HH:MM (24h, Africa/Harare) + " CAT".
 */
export function ShellClock() {
  // Starts empty (as before) so server and client markup match; the first
  // effect tick fills it in immediately on mount.
  const [time, setTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' }) + ' CAT');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="hidden lg:block font-mono text-data-sm text-slate-light tracking-widest">
      {time}
    </div>
  );
}

export default ShellClock;
