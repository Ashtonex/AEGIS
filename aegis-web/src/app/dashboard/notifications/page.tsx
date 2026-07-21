"use client";

import Link from "next/link";
import { Bell, CheckCheck, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { useNotifications } from "@/hooks/useNotifications";

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function tone(priority?: string) {
  if (priority === "urgent") return "border-red-500/40 bg-red-950/20";
  if (priority === "high") return "border-amber-500/40 bg-amber-950/20";
  return "border-ink-mid bg-ink-light";
}

export default function NotificationsPage() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    refresh,
    markRead,
    markAllRead,
  } = useNotifications(100);

  const visible = useMemo(
    () => filter === "unread" ? notifications.filter((item) => !item.is_read) : notifications,
    [filter, notifications]
  );

  return (
    <div className="min-h-screen bg-ink p-6 text-paper">
      <section className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">System-wide alerts</p>
          <h1 className="mt-2 font-display text-4xl">Notifications</h1>
          <p className="mt-3 max-w-2xl text-slate-light">
            Live operational alerts from approvals, client portal messages, internal communication, compliance and site activity.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="border border-ink-mid bg-ink-light px-4 py-3">
            <p className="font-mono text-[10px] uppercase text-slate-light">Unread</p>
            <p className="text-2xl font-semibold">{unreadCount}</p>
          </div>
          <div className="border border-ink-mid bg-ink-light px-4 py-3">
            <p className="font-mono text-[10px] uppercase text-slate-light">Loaded</p>
            <p className="text-2xl font-semibold">{notifications.length}</p>
          </div>
        </div>
      </section>

      <section className="border border-ink-mid bg-ink-light">
        <div className="flex flex-col gap-4 border-b border-ink-mid p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Bell className="h-5 w-5 text-signal" />
            <div>
              <h2 className="text-xl font-semibold">Notification history</h2>
              <p className="text-sm text-slate-light">Refreshes automatically while this tab is active.</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex border border-ink-mid bg-ink">
              {(["all", "unread"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`px-3 py-2 font-mono text-xs uppercase ${filter === value ? "bg-signal text-ink" : "text-slate-light"}`}
                >
                  {value}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="flex items-center justify-center gap-2 border border-ink-mid px-4 py-2 text-sm text-paper hover:border-signal hover:text-signal"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
              className="flex items-center justify-center gap-2 border border-ink-mid px-4 py-2 text-sm text-paper hover:border-signal hover:text-signal disabled:opacity-40"
            >
              <CheckCheck className="h-4 w-4" /> Mark all read
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-signal" />
          </div>
        ) : error ? (
          <p className="p-6 text-sm text-red-200">{error}</p>
        ) : visible.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-light">
            {filter === "unread" ? "No unread notifications." : "No notifications have been recorded for your account."}
          </p>
        ) : (
          <div className="divide-y divide-ink-mid">
            {visible.map((notification) => {
              const card = (
                <article className={`p-5 ${tone(notification.priority)} ${notification.is_read ? "opacity-70" : ""}`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] uppercase text-signal">{notification.notification_type || "system"}</span>
                        <span className="font-mono text-[10px] uppercase text-slate-light">{notification.priority || "normal"}</span>
                        {!notification.is_read && <span className="h-2 w-2 rounded-full bg-signal" />}
                      </div>
                      <h3 className="mt-2 text-base font-semibold">{notification.title}</h3>
                      {notification.message && <p className="mt-2 text-sm leading-relaxed text-slate-light">{notification.message}</p>}
                    </div>
                    <span className="whitespace-nowrap font-mono text-[10px] uppercase text-slate-light">
                      {formatDate(notification.created_at)}
                    </span>
                  </div>
                </article>
              );

              if (notification.action_url) {
                return (
                  <Link key={notification.id} href={notification.action_url} onClick={() => void markRead(notification.id)}>
                    {card}
                  </Link>
                );
              }

              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void markRead(notification.id)}
                  className="block w-full text-left"
                >
                  {card}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
