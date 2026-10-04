"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  SystemNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";
import { useLiveConnected, useLiveNotification } from "@/lib/live/LiveDataProvider";

// New notifications normally arrive the instant they're created over the
// shared live connection (LiveDataProvider, mounted once in
// app/dashboard/layout.tsx). Polling is the fallback: every 15s while that
// connection is down, and only a slow safety-net poll while it's up -
// previously this polled every 15s regardless, 4 requests a minute per open
// tab even with live push working.
const POLL_MS = 15000;
const POLL_WHILE_LIVE_MS = 120000;

export function useNotifications(limit = 20) {
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const liveConnected = useLiveConnected();

  const refresh = useCallback(async () => {
    try {
      const response = await getNotifications({ limit });
      const rows = Array.isArray(response.data) ? response.data : [];
      setNotifications(rows);
      setUnreadCount(rows.filter((item) => !item.is_read).length);
      setError(null);
    } catch (refreshError) {
      const message = refreshError instanceof ApiError
        ? refreshError.message
        : "Notifications could not be loaded.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  // Initial load, plus catching up when the tab comes back into view.
  useEffect(() => {
    void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  // Fallback poll: fast while live push is down, slow while it's up.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, liveConnected ? POLL_WHILE_LIVE_MS : POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh, liveConnected]);

  // Live push: a new notification lands in local state the instant it's
  // created, no poll interval to wait out.
  useLiveNotification((data) => {
    // The trigger's NOTIFY payload only carries a fresh notification's
    // fields, not the read/update bookkeeping columns - fill those in
    // explicitly rather than casting, since a just-pushed notification is
    // unread by definition.
    const incoming = { ...data, is_read: false } as SystemNotification;
    setNotifications((current) => {
      if (current.some((item) => item.id === incoming.id)) return current;
      return [incoming, ...current].slice(0, limit);
    });
    setUnreadCount((current) => current + 1);
  });

  const markRead = useCallback(async (id: string) => {
    await markNotificationRead(id);
    setNotifications((current) =>
      current.map((item) => item.id === id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item)
    );
    setUnreadCount((current) => Math.max(0, current - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    setNotifications((current) =>
      current.map((item) => ({ ...item, is_read: true, read_at: item.read_at ?? new Date().toISOString() }))
    );
    setUnreadCount(0);
  }, []);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    refresh,
    markRead,
    markAllRead,
  };
}
