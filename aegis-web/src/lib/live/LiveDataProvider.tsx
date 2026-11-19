"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import useSWR, { type SWRConfiguration, type SWRResponse } from "swr";

import { useAuth } from "@/lib/auth/AuthContext";
import { resolveBackendOrigin } from "@/lib/backend-url";

// Every page under /dashboard shares this one WebSocket connection (mounted
// once in app/dashboard/layout.tsx) instead of each opening its own - the
// backend pushes two kinds of events over it: per-user notifications and
// system-wide table-change signals (see imperium-api/core/realtime.py).
// A table-change event only ever carries {table, op, id} - never the row
// itself - so a subscriber's job is to treat it as "go refetch", not to
// read the new data out of the event. The exception is the tables in
// imperium-api/core/live_records.py: their events also carry the row as
// `data`, already filtered to what this user may see, so useLiveRecord can
// show it at once without a round trip through the API proxy.

/** One changed row. Parent ids (migration 302) say which record it belongs
 * to, so a record page can ignore changes to other tenders/opportunities. */
export type LiveChange = {
  type: "table_change";
  table: string;
  op: string;
  id: string;
  data?: Record<string, unknown>;
  project_id?: string;
  tender_id?: string;
  opportunity_id?: string;
  entity_type?: string;
  entity_id?: string;
};

type LiveEvent = { type: "notification"; data: Record<string, unknown> } | LiveChange;
type Listener = (event: LiveEvent) => void;

const LiveDataContext = createContext<{
  subscribe: (key: string, listener: Listener) => () => void;
  onReconnect: (listener: () => void) => () => void;
  connected: boolean;
} | null>(null);

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
  // Events sent while the socket was down are lost, so after a reconnect
  // every subscriber is told to catch up (useLiveTable refetches).
  const reconnectListenersRef = useRef<Set<() => void>>(new Set());
  const hasConnectedRef = useRef(false);
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
        if (hasConnectedRef.current) {
          reconnectListenersRef.current.forEach((listener) => listener());
        }
        hasConnectedRef.current = true;
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

  const onReconnect = useCallback((listener: () => void) => {
    reconnectListenersRef.current.add(listener);
    return () => {
      reconnectListenersRef.current.delete(listener);
    };
  }, []);

  const value = useMemo(() => ({ subscribe, onReconnect, connected }), [subscribe, onReconnect, connected]);
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

/** Runs `callback` each time the shared socket comes back after a drop, so a
 * page can fetch whatever it missed while offline. Not called on the first
 * connect. */
export function useLiveReconnect(callback: () => void) {
  const ctx = useContext(LiveDataContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!ctx) return;
    return ctx.onReconnect(() => callbackRef.current());
  }, [ctx]);
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

  useLiveReconnect(() => onChangeRef.current("RECONNECT", ""));

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

/** A change to one of the row-carrying tables (core/live_records.py):
 * `data` is the row as the list endpoint returns it, or undefined when the
 * server couldn't send it (refetch then). Delivered immediately, with no
 * debounce, since there is nothing to fetch. The table must be in LOADERS
 * as well as TABLE_PERMISSION_MAP. */
export function useLiveRecord<T = Record<string, unknown>>(
  table: string,
  onRecord: (op: string, id: string, data: T | undefined) => void,
) {
  const onRecordRef = useRef(onRecord);
  onRecordRef.current = onRecord;
  useLiveSubscription(`table_change:${table}`, (event) => {
    if (event.type !== "table_change") return;
    onRecordRef.current(event.op, event.id, event.data as T | undefined);
  });
}

/** Calls `listener` for every change to any of `tables`, undebounced. */
export function useLiveChanges(tables: readonly string[], listener: (change: LiveChange) => void) {
  const ctx = useContext(LiveDataContext);
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  const tableKey = tables.join(",");

  useEffect(() => {
    if (!ctx || !tableKey) return;
    const unsubscribers = tableKey.split(",").map((table) =>
      ctx.subscribe(`table_change:${table}`, (event) => {
        if (event.type === "table_change") listenerRef.current(event);
      }),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [ctx, tableKey]);
}

// Revalidations triggered by live changes are batched: a burst of row
// changes (a tender import, a bulk requirement seed) costs one refetch.
const LIVE_QUERY_DEBOUNCE_MS = 250;

export type LiveQueryOptions<T> = {
  /** schema.table names whose changes should refresh this data. Each must be
   * in TABLE_PERMISSION_MAP (imperium-api/core/realtime.py). */
  tables: readonly string[];
  /** Narrow to the changes that concern this data, e.g. one tender's rows.
   * Leave out to refresh on any change to the tables. */
  match?: (change: LiveChange) => boolean;
  config?: SWRConfiguration<T>;
};

/**
 * SWR data that stays live: it refetches when a matching row changes
 * anywhere (another user, a job, a webhook), after the live connection comes
 * back from a drop, and on tab focus. The previous data stays on screen while
 * it refetches, so pages don't flash a spinner. `key` null pauses it.
 * Call `mutate()` after your own writes for an immediate refresh.
 */
export function useLiveQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { tables, match, config }: LiveQueryOptions<T>,
): SWRResponse<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // The SWR cache is shared by the whole tab. Scoping every key to the
  // signed-in user and organisation means a different account signing in
  // here can never be shown the previous account's cached records (nor
  // have keepPreviousData carry them over). Signed out pauses the query.
  const { session } = useAuth();
  const userId = session?.user?.id;
  const appMetadata = (session?.user?.app_metadata ?? {}) as { org_id?: string; organization_id?: string };
  const orgId = appMetadata.org_id ?? appMetadata.organization_id ?? "";
  const scopedKey = key && userId ? `${userId}:${orgId}:${key}` : null;
  const response = useSWR<T>(scopedKey, () => fetcherRef.current(), { keepPreviousData: true, ...config });
  const { mutate } = response;
  const matchRef = useRef(match);
  matchRef.current = match;
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (!scopedKey) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void mutate();
    }, LIVE_QUERY_DEBOUNCE_MS);
  }, [scopedKey, mutate]);

  useLiveChanges(scopedKey ? tables : [], (change) => {
    if (matchRef.current && !matchRef.current(change)) return;
    scheduleRefresh();
  });
  useLiveReconnect(() => {
    if (scopedKey) void mutate();
  });

  return response;
}

/**
 * For screens that keep their own loader instead of useLiveQuery: calls
 * `refresh` (batched over 250 ms) when a matching row changes and after the
 * live connection comes back. Pass a quiet refresh - one that keeps the
 * current data on screen rather than showing a spinner.
 */
export function useLiveRefresh(
  tables: readonly string[],
  match: ((change: LiveChange) => boolean) | undefined,
  refresh: () => void,
  enabled = true,
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const matchRef = useRef(match);
  matchRef.current = match;
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  useLiveChanges(enabled ? tables : [], (change) => {
    if (matchRef.current && !matchRef.current(change)) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      refreshRef.current();
    }, LIVE_QUERY_DEBOUNCE_MS);
  });
  useLiveReconnect(() => {
    if (enabled) refreshRef.current();
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
