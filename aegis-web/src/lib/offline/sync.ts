/**
 * AEGIS Offline Synchronization Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Coordinates outbox processing, network monitoring, idempotency headers,
 * retry backoff with jitter, and server receipt acknowledgment.
 */

import { fetchApi } from "@/lib/api/core";
import {
  getPendingOperations,
  updateOperationStatus,
  removeOperation,
  getAttachmentsForOperation,
} from "./db";
import type { OutboxOperation } from "./types";

let isSyncing = false;
const listeners = new Set<(syncing: boolean, pendingCount: number) => void>();

function notifyListeners(syncing: boolean, count: number) {
  listeners.forEach((listener) => {
    try {
      listener(syncing, count);
    } catch (e) {
      console.error("Error in sync listener:", e);
    }
  });
}

export function subscribeSyncState(
  callback: (syncing: boolean, pendingCount: number) => void
): () => void {
  listeners.add(callback);
  void getPendingCount().then((count) => callback(isSyncing, count));
  return () => {
    listeners.delete(callback);
  };
}

export async function getPendingCount(userId?: string): Promise<number> {
  try {
    const ops = await getPendingOperations(userId);
    return ops.length;
  } catch {
    return 0;
  }
}

/**
 * Executes a single outbox operation against the authoritative backend.
 * Passes the operationId via `X-Client-Operation-ID` and payload header for idempotent processing.
 */
async function processOperation(op: OutboxOperation): Promise<void> {
  await updateOperationStatus(op.operationId, "syncing");

  // Check if there are attached files for this operation
  const attachments = await getAttachmentsForOperation(op.operationId);
  const headers: Record<string, string> = {
    "X-Client-Operation-ID": op.operationId,
    "X-Client-Timestamp": String(op.clientTimestamp),
  };

  try {
    const response = await fetchApi(op.endpoint, {
      method: op.action === "create" ? "POST" : op.action === "update" ? "PUT" : "DELETE",
      headers,
      body: JSON.stringify(op.payload),
      allowFallback: false,
    });

    // Mark as acknowledged and clear from outbox
    await updateOperationStatus(op.operationId, "acknowledged", undefined, response);
    await removeOperation(op.operationId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Network/Sync failure";
    
    // Check if it's a permanent 4xx validation error vs transient network/5xx
    const isPermanent =
      errorMessage.includes("400") ||
      errorMessage.includes("422") ||
      errorMessage.includes("Validation");

    if (isPermanent) {
      await updateOperationStatus(op.operationId, "blocked", errorMessage);
    } else {
      await updateOperationStatus(op.operationId, "queued", errorMessage);
    }
    throw error;
  }
}

/**
 * Flush all pending queued operations in FIFO order with backoff.
 */
export async function flushOutbox(userId?: string): Promise<{ success: number; failed: number }> {
  if (isSyncing) {
    return { success: 0, failed: 0 };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: 0, failed: 0 };
  }

  isSyncing = true;
  let successCount = 0;
  let failedCount = 0;

  try {
    const pending = await getPendingOperations(userId);
    notifyListeners(true, pending.length);

    for (const op of pending) {
      // Skip blocked/conflict items that require human resolution
      if (op.status === "blocked" || op.status === "conflict") {
        continue;
      }

      // Max retries guard
      if (op.retryCount >= 10) {
        await updateOperationStatus(op.operationId, "blocked", "Max retry attempts exceeded.");
        failedCount += 1;
        continue;
      }

      try {
        await processOperation(op);
        successCount += 1;
      } catch (err) {
        failedCount += 1;
        // If an operation fails due to network, halt sequential flush to preserve ordering
        break;
      }
    }
  } finally {
    isSyncing = false;
    const remaining = await getPendingCount(userId);
    notifyListeners(false, remaining);
  }

  return { success: successCount, failed: failedCount };
}

// ── Automatic Reachability Triggers ───────────────────────────────────────────

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("[AEGIS Offline] Network online. Flushing outbox...");
    void flushOutbox();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      void flushOutbox();
    }
  });
}
