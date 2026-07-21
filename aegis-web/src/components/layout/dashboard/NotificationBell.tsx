"use client";

import Link from "next/link";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { useState } from "react";

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
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    markRead,
    markAllRead,
  } = useNotifications(12);

  async function openNotification(notification: SystemNotification) {
    if (!notification.is_read) {
      await markRead(notification.id);
    }
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-slate hover:text-paper transition-colors relative"
        aria-label="Open notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-2 -right-2 min-w-4 h-4 px-1 bg-signal text-ink text-[10px] font-bold rounded-full border border-ink flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-[360px] border border-ink-mid bg-ink-light shadow-2xl">
          <div className="p-4 border-b border-ink-mid flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Live notifications</p>
              <h2 className="text-base font-semibold text-paper">Notification Center</h2>
            </div>
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
              className="text-xs text-slate-light hover:text-signal disabled:opacity-40 flex items-center gap-1"
            >
              <CheckCheck className="w-3 h-3" /> Clear
            </button>
          </div>

          {isLoading ? (
            <div className="h-28 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-signal animate-spin" />
            </div>
          ) : error ? (
            <p className="p-4 text-sm text-red-200">{error}</p>
          ) : notifications.length === 0 ? (
            <p className="p-5 text-sm text-slate-light">No notifications yet.</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto divide-y divide-ink-mid">
              {notifications.map((notification) => {
                const content = (
                  <article className={`p-4 border-l-2 ${priorityClass(notification)} hover:bg-ink/60`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-paper">{notification.title}</p>
                        {notification.message && (
                          <p className="text-xs text-slate-light mt-1 line-clamp-2">{notification.message}</p>
                        )}
                      </div>
                      <span className="font-mono text-[10px] uppercase text-slate-light whitespace-nowrap">
                        {formatAge(notification.created_at)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] uppercase text-slate">
                        {notification.notification_type || "system"}
                      </span>
                      {!notification.is_read && (
                        <span className="w-2 h-2 rounded-full bg-signal" />
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
            className="block border-t border-ink-mid p-3 text-center font-mono text-[10px] uppercase tracking-widest text-signal hover:bg-ink"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
