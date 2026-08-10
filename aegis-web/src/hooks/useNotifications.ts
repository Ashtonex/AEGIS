"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  SystemNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import { resolveBackendOrigin } from "@/lib/backend-url";

// The 15s poll below is now a fallback for the rare window where the
// WebSocket is reconnecting, not the primary update path - new
// notifications normally arrive the instant they're created via
// notifications_channel (see imperium-api/core/realtime.py).
const POLL_MS = 15000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

function wsUrl(token: string): string {
  const origin = resolveBackendOrigin().replace(/^http/, "ws");
  return `${origin}/api/v1/notifications/ws?token=${encodeURIComponent(token)}`;
}

export function useNotifications(limit = 20) {
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { session } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);

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

  // Live push: a new notification lands in local state the instant it's
  // created, no poll interval to wait out. Reconnects with backoff if the
  // connection drops (network blip, backend restart) rather than leaving
  // the user silently back on 15s polling until their next full page load.
  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const socket = new WebSocket(wsUrl(token));
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed?.type !== "notification" || !parsed.data) return;
          // The trigger's NOTIFY payload only carries a fresh notification's
          // fields, not the read/update bookkeeping columns - fill those
          // in explicitly rather than casting, since a just-pushed
          // notification is unread by definition.
          const incoming: SystemNotification = { ...parsed.data, is_read: false };
          setNotifications((current) => {
            if (current.some((item) => item.id === incoming.id)) return current;
            return [incoming, ...current].slice(0, limit);
          });
          setUnreadCount((current) => current + 1);
        } catch {
          // Malformed push payload - ignore rather than crash the socket handler.
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        const attempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = attempt;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [session?.access_token, limit]);

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
