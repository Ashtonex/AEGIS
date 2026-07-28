"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ExternalLink, X } from "lucide-react";

const CALENDAR_EMBED_URL = "https://calendar.google.com/calendar/embed?src=be105c46da747d44392166f5d32f6cfaf79da6a02bee759ec14ab3fb588518b3%40group.calendar.google.com&ctz=Africa%2FMaputo";
const GOOGLE_CALENDAR_URL = "https://calendar.google.com/calendar/u/0/r?cid=be105c46da747d44392166f5d32f6cfaf79da6a02bee759ec14ab3fb588518b3%40group.calendar.google.com";

export function CalendarDropdown() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

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
        <div className="absolute right-0 top-9 z-50 w-[min(860px,calc(100vw-2rem))] border border-ink-mid bg-ink-light shadow-2xl">
          <div className="flex items-center justify-between border-b border-ink-mid p-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-signal">SNC schedule</p>
              <h2 className="text-base font-semibold text-paper">Google Calendar</h2>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={GOOGLE_CALENDAR_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 border border-signal/40 bg-signal/10 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-signal hover:bg-signal/15"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Google
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center border border-ink-mid text-slate-light hover:text-paper"
                aria-label="Close calendar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <iframe
            src={CALENDAR_EMBED_URL}
            title="SNC Google Calendar"
            className="h-[600px] w-full bg-paper"
            frameBorder={0}
            scrolling="no"
          />
        </div>
      )}
    </div>
  );
}
