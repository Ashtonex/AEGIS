"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { DraftKey, OfflineDraft, OutboxOperation } from "./types";
import {
  saveDraft as dbSaveDraft,
  getDraft as dbGetDraft,
  deleteDraft as dbDeleteDraft,
  enqueueOperation as dbEnqueueOperation,
  getPendingOperations,
} from "./db";
import { flushOutbox, subscribeSyncState } from "./sync";

/**
 * Hook to observe network connectivity and outbox sync status in the UI.
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const unsubscribe = subscribeSyncState((syncing, count) => {
      setIsSyncing(syncing);
      setPendingCount(count);
    });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribe();
    };
  }, []);

  const syncNow = useCallback(async () => {
    return await flushOutbox();
  }, []);

  return { isOnline, isSyncing, pendingCount, syncNow };
}

/**
 * Hook to manage an autosaved local draft with debouncing.
 */
export function useOfflineDraft<T>(key: DraftKey, initialData: T) {
  const [draft, setDraft] = useState<T>(initialData);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load existing draft from IndexedDB on mount or key change
  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const stored = await dbGetDraft<T>(key);
        if (active && stored && stored.data) {
          setDraft(stored.data);
          setLastSavedAt(stored.updatedAt);
        }
      } catch (e) {
        console.warn("Failed to load offline draft:", e);
      } finally {
        if (active) setIsLoaded(true);
      }
    }

    void load();

    return () => {
      active = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [key.organizationId, key.userId, key.projectId, key.entityType]);

  // Save draft with debounce
  const updateDraft = useCallback(
    (newData: T | ((prev: T) => T)) => {
      setDraft((prev) => {
        const next = typeof newData === "function" ? (newData as (prev: T) => T)(prev) : newData;

        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(async () => {
          try {
            await dbSaveDraft(key, next);
            setLastSavedAt(Date.now());
          } catch (err) {
            console.error("Failed to auto-save draft to IndexedDB:", err);
          }
        }, 500);

        return next;
      });
    },
    [key]
  );

  const clearDraft = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    await dbDeleteDraft(key);
    setDraft(initialData);
    setLastSavedAt(null);
  }, [key, initialData]);

  return {
    draft,
    updateDraft,
    clearDraft,
    isLoaded,
    lastSavedAt,
  };
}

/**
 * Hook to enqueue operations into the durable offline outbox.
 */
export function useOutbox(userId?: string) {
  const [pendingOps, setPendingOps] = useState<OutboxOperation[]>([]);
  const { isOnline, isSyncing, syncNow } = useNetworkStatus();

  const reload = useCallback(async () => {
    try {
      const ops = await getPendingOperations(userId);
      setPendingOps(ops);
    } catch {
      // Ignored in non-browser env
    }
  }, [userId]);

  useEffect(() => {
    void reload();
    const unsubscribe = subscribeSyncState(() => {
      void reload();
    });
    return () => unsubscribe();
  }, [reload]);

  const enqueue = useCallback(
    async <T>(op: Omit<OutboxOperation<T>, "clientTimestamp" | "status" | "retryCount">) => {
      const fullOp: OutboxOperation<T> = {
        ...op,
        clientTimestamp: Date.now(),
        status: "queued",
        retryCount: 0,
      };

      await dbEnqueueOperation(fullOp);
      await reload();

      // If online, immediately trigger outbox flush
      if (typeof navigator !== "undefined" && navigator.onLine) {
        void flushOutbox(userId);
      }
    },
    [userId, reload]
  );

  return {
    pendingOps,
    enqueue,
    syncNow,
    isOnline,
    isSyncing,
  };
}
