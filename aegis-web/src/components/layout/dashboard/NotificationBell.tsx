"use client";

import Link from "next/link";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SystemNotification } from "@/lib/api";
import { useNotifications } from "@/hooks/useNotifications";

function formatAge(value: string) {
  const created = new Date(value).getTime();
  const diff = Date.now() - created;
  if (!Number.isFinite(diff) || diff < 0) return "now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function priorityClass(notification: SystemNotification) {
  if (notification.priority === "urgent") return "border-red-500/40 text-red-200";
  if (notification.priority === "high") return "border-amber-500/40 text-amber-100";
  return "border-ink-mid text-paper";
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | "urgent">("all");
  const bellRef = useRef<HTMLDivElement>(null);

  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    markRead,
    markAllRead,
  } = useNotifications(20);

  // Click outside and Escape key listener
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function openNotification(notification: SystemNotification) {
    if (!notification.is_read) {
      await markRead(notification.id);
    }
    setOpen(false);
  }

  const filteredNotifications = notifications.filter((item) => {
    if (filter === "unread") return !item.is_read;
    if (filter === "urgent") return item.priority === "urgent" || item.priority === "high";
    return true;
  });

  return (
    <div className="relative" ref={bellRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-slate hover:text-paper transition-colors relative p-1.5 rounded hover:bg-white/5"
        aria-label="Open notifications"
        aria-expanded={open}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-signal text-ink text-[10px] font-bold rounded-full border border-ink flex items-center justify-center animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 md:absolute md:inset-auto md:right-0 md:top-10 md:bg-transparent"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden border-t border-ink-mid bg-ink-light shadow-2xl md:static md:inset-auto md:w-[min(380px,calc(100vw-1.5rem))] md:max-h-none md:border md:border-ink-mid md:rounded-md animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="p-3.5 border-b border-ink-mid flex items-center justify-between bg-ink">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-signal font-semibold">Real-Time Alerts</p>
                <h2 className="text-sm font-semibold text-paper">Notification Center</h2>
              </div>
              <button
                type="button"
                onClick={() => void markAllRead()}
                disabled={unreadCount === 0}
                className="text-xs font-mono uppercase tracking-wider text-slate-light hover:text-signal disabled:opacity-30 flex items-center gap-1 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark read
              </button>
            </div>

            {/* Filter Tabs */}
            <div className="flex border-b border-ink-mid bg-ink/60 text-[11px] font-mono uppercase tracking-wider">
              {(["all", "unread", "urgent"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  className={`flex-1 py-1.5 text-center transition-colors border-b-2 ${
                    filter === tab
                      ? "border-signal text-signal bg-signal/5 font-semibold"
                      : "border-transparent text-slate hover:text-paper"
                  }`}
                >
                  {tab === "all" ? "All" : tab === "unread" ? `Unread (${unreadCount})` : "Urgent"}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="h-28 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-signal animate-spin" />
              </div>
            ) : error ? (
              <p className="p-4 text-xs text-red-300 font-mono">{error}</p>
            ) : filteredNotifications.length === 0 ? (
              <p className="p-6 text-xs text-slate-light text-center">
                {filter === "unread" ? "No unread alerts." : filter === "urgent" ? "No urgent alerts." : "No notifications yet."}
              </p>
            ) : (
              <div className="max-h-[380px] overflow-y-auto divide-y divide-ink-mid/40">
                {filteredNotifications.map((notification) => {
                  const content = (
                    <article className={`p-3.5 border-l-2 ${priorityClass(notification)} hover:bg-white/5 transition-colors`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-paper tracking-tight">{notification.title}</p>
                          {notification.message && (
                            <p className="text-[11px] text-slate-light mt-0.5 line-clamp-2 leading-relaxed">{notification.message}</p>
                          )}
                        </div>
                        <span className="font-mono text-[9px] uppercase text-slate whitespace-nowrap">
                          {formatAge(notification.created_at)}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-3">
                        <span className="font-mono text-[9px] uppercase tracking-wider text-slate">
                          {notification.notification_type || "system"}
                        </span>
                        {!notification.is_read && (
                          <span className="w-2 h-2 rounded-full bg-signal shrink-0" />
                        )}
                      </div>
                    </article>
                  );

                  if (notification.action_url) {
                    return (
                      <Link key={notification.id} href={notification.action_url} onClick={() => void openNotification(notification)}>
                        {content}
                      </Link>
                    );
                  }

                  return (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => void openNotification(notification)}
                      className="block w-full text-left"
                    >
                      {content}
                    </button>
                  );
                })}
              </div>
            )}

            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-ink-mid p-2.5 text-center font-mono text-[10px] uppercase tracking-widest text-signal hover:bg-ink transition-colors"
            >
              View all notifications &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
