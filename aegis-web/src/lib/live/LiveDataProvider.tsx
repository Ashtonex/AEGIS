"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

const LiveDataContext = createContext<{ subscribe: (key: string, listener: Listener) => () => void; connected: boolean } | null>(null);

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const RECONNECT_JITTER_MS = 500;

function wsUrl(token: string): string {
  const origin = resolveBackendOrigin().replace(/^http/, "ws");
  return `${origin}/api/v1/notifications/ws?token=${encodeURIComponent(token)}`;
}

// Closing a socket that is still CONNECTING makes the browser log a failed
// connection (seen on every page load when the session token refreshes
// right after mount and replaces the first socket). Let it finish opening,
// then close it; handlers are detached so it can't trigger a reconnect.
function retire(socket: WebSocket | null) {
  if (!socket) return;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.onopen = () => socket.close();
  } else {
    socket.onopen = null;
    socket.close();
  }
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
  const connectionSeqRef = useRef(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      retire(socketRef.current);
      socketRef.current = null;
      reconnectAttemptRef.current = 0;
      setConnected(false);
      return;
    }

    let cancelled = false;
    const connectionSeq = connectionSeqRef.current + 1;
    connectionSeqRef.current = connectionSeq;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const isCurrentConnection = (socket: WebSocket) =>
      !cancelled && connectionSeq === connectionSeqRef.current && socketRef.current === socket;

    const connect = () => {
      if (cancelled || connectionSeq !== connectionSeqRef.current) return;
      clearReconnectTimer();
      retire(socketRef.current);
      const socket = new WebSocket(wsUrl(token));
      socketRef.current = socket;

      socket.onopen = () => {
        if (!isCurrentConnection(socket)) return;
        reconnectAttemptRef.current = 0;
        setConnected(true);
      };

      socket.onmessage = (raw) => {
        if (!isCurrentConnection(socket)) return;
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
        if (!isCurrentConnection(socket)) return;
        setConnected(false);
        const attempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = attempt;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS) + Math.floor(Math.random() * RECONNECT_JITTER_MS);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        if (isCurrentConnection(socket)) {
          socket.close();
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      connectionSeqRef.current += 1;
      clearReconnectTimer();
      retire(socketRef.current);
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

  const value = useMemo(() => ({ subscribe, connected }), [subscribe, connected]);
  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>;
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

// The DB trigger fires once per row, so a bulk write (a statement import,
// a multi-line journal, a stock issue) arrives as a burst of events. Each
// callback refetches, so collapse a burst into one call after it settles.
const LIVE_TABLE_DEBOUNCE_MS = 400;

/** Fires `onChange` whenever the given schema.table has an insert/update/
 * delete anywhere in the org - the payload never carries row data, so the
 * callback's job is to refetch, not to read fields off the event. A burst
 * of changes is collapsed into one call with the last event's op and id.
 * The table must be listed in TABLE_PERMISSION_MAP in
 * imperium-api/core/realtime.py, or no events are ever sent for it. */
export function useLiveTable(table: string, onChange: (op: string, id: string) => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  useLiveSubscription(`table_change:${table}`, (event) => {
    if (event.type !== "table_change") return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onChangeRef.current(event.op, event.id);
    }, LIVE_TABLE_DEBOUNCE_MS);
  });
}

export function useLiveNotification(onNotification: (data: Record<string, unknown>) => void) {
  useLiveSubscription("notification", (event) => {
    if (event.type === "notification") onNotification(event.data);
  });
}

/** Whether the shared live connection is currently open - lets a hook poll
 * often only while live push is down, instead of all the time. False
 * outside a LiveDataProvider. */
export function useLiveConnected(): boolean {
  return useContext(LiveDataContext)?.connected ?? false;
}
