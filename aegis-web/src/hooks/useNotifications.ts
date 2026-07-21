"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  SystemNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";

const POLL_MS = 15000;

export function useNotifications(limit = 20) {
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

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
