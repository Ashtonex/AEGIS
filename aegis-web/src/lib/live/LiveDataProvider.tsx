"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/lib/auth/AuthContext";
import { resolveBackendOrigin } from "@/lib/backend-url";

// Every page under /dashboard shares this one WebSocket connection (mounted
// once in app/dashboard/layout.tsx) instead of each opening its own - the
// backend pushes two kinds of events over it: per-user notifications and
// system-wide table-change signals (see imperium-api/core/realtime.py).
// A table-change event only ever carries {table, op, id} - never the row
// itself - so a subscriber's job is to treat it as "go refetch", not to
// read the new data out of the event.

type LiveEvent = { type: "notification"; data: Record<string, unknown> } | { type: "table_change"; table: string; op: string; id: string };
type Listener = (event: LiveEvent) => void;

const LiveDataContext = createContext<{ subscribe: (key: string, listener: Listener) => () => void } | null>(null);

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

function wsUrl(token: string): string {
  const origin = resolveBackendOrigin().replace(/^http/, "ws");
  return `${origin}/api/v1/notifications/ws?token=${encodeURIComponent(token)}`;
}

function keyFor(event: LiveEvent): string {
  return event.type === "notification" ? "notification" : `table_change:${event.table}`;
}

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const listenersRef = useRef<Map<string, Set<Listener>>>(new Map());
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const [connected, setConnected] = useState(false);

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
        setConnected(true);
      };

      socket.onmessage = (raw) => {
        let event: LiveEvent;
        try {
          event = JSON.parse(raw.data);
        } catch {
          return;
        }
        const key = keyFor(event);
        listenersRef.current.get(key)?.forEach((listener) => listener(event));
      };

      socket.onclose = () => {
        setConnected(false);
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
      setConnected(false);
    };
  }, [session?.access_token]);

  const subscribe = useCallback((key: string, listener: Listener) => {
    const set = listenersRef.current.get(key) ?? new Set<Listener>();
    set.add(listener);
    listenersRef.current.set(key, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) listenersRef.current.delete(key);
    };
  }, []);

  // `connected` is read nowhere in this component - it's only here so a
  // provider consumer *could* surface connection state later. Referencing
  // it avoids an unused-variable lint failure without inventing UI for it
  // now.
  void connected;

  return <LiveDataContext.Provider value={{ subscribe }}>{children}</LiveDataContext.Provider>;
}

function useLiveSubscription(key: string, listener: Listener) {
  const ctx = useContext(LiveDataContext);
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(key, (event) => listenerRef.current(event));
  }, [ctx, key]);
}

/** Fires `onChange` whenever the given schema.table has an insert/update/
 * delete anywhere in the org - the payload never carries row data, so the
 * callback's job is to refetch, not to read fields off the event. */
export function useLiveTable(table: string, onChange: (op: string, id: string) => void) {
  useLiveSubscription(`table_change:${table}`, (event) => {
    if (event.type === "table_change") onChange(event.op, event.id);
  });
}

export function useLiveNotification(onNotification: (data: Record<string, unknown>) => void) {
  useLiveSubscription("notification", (event) => {
    if (event.type === "notification") onNotification(event.data);
  });
}
