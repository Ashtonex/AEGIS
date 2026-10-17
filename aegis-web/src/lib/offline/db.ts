/**
 * AEGIS IndexedDB Persistence Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Zero-dependency, asynchronous IndexedDB storage for offline field operations.
 * Enforces strict multi-tenant and per-user partitioning.
 */

import type { CachedReference, DraftKey, OfflineAttachment, OfflineDraft, OutboxOperation } from "./types";

const DB_NAME = "aegis_offline_store_v1";
const DB_VERSION = 1;

const STORES = {
  DRAFTS: "drafts",
  OUTBOX: "outbox",
  ATTACHMENTS: "attachments",
  REFERENCES: "references",
} as const;

function buildDraftKey(key: DraftKey): string {
  return `${key.organizationId || "snc"}:${key.userId || "anon"}:${key.projectId || "global"}:${key.entityType}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not supported in this environment."));
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORES.DRAFTS)) {
        db.createObjectStore(STORES.DRAFTS, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORES.OUTBOX)) {
        const outboxStore = db.createObjectStore(STORES.OUTBOX, { keyPath: "operationId" });
        outboxStore.createIndex("by_user", "userId", { unique: false });
        outboxStore.createIndex("by_status", "status", { unique: false });
        outboxStore.createIndex("by_created", "clientTimestamp", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.ATTACHMENTS)) {
        const attStore = db.createObjectStore(STORES.ATTACHMENTS, { keyPath: "id" });
        attStore.createIndex("by_operation", "operationId", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.REFERENCES)) {
        db.createObjectStore(STORES.REFERENCES, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error("Failed to open IndexedDB"));
    };

    request.onblocked = () => {
      console.warn("IndexedDB upgrade blocked by open tab.");
    };
  });

  return dbPromise;
}

// ── Draft Operations ──────────────────────────────────────────────────────────

export async function saveDraft<T>(key: DraftKey, data: T): Promise<void> {
  const db = await getDb();
  const draftKey = buildDraftKey(key);

  const draft: OfflineDraft<T> = {
    key: draftKey,
    organizationId: key.organizationId,
    userId: key.userId,
    projectId: key.projectId,
    entityType: key.entityType,
    data,
    updatedAt: Date.now(),
    version: 1,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DRAFTS, "readwrite");
    const store = tx.objectStore(STORES.DRAFTS);
    const request = store.put(draft);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getDraft<T>(key: DraftKey): Promise<OfflineDraft<T> | null> {
  const db = await getDb();
  const draftKey = buildDraftKey(key);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DRAFTS, "readonly");
    const store = tx.objectStore(STORES.DRAFTS);
    const request = store.get(draftKey);

    request.onsuccess = () => {
      resolve((request.result as OfflineDraft<T>) || null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteDraft(key: DraftKey): Promise<void> {
  const db = await getDb();
  const draftKey = buildDraftKey(key);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DRAFTS, "readwrite");
    const store = tx.objectStore(STORES.DRAFTS);
    const request = store.delete(draftKey);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ── Outbox Operations ─────────────────────────────────────────────────────────

export async function enqueueOperation<T>(operation: OutboxOperation<T>): Promise<void> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.OUTBOX, "readwrite");
    const store = tx.objectStore(STORES.OUTBOX);
    const request = store.put(operation);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingOperations(userId?: string): Promise<OutboxOperation[]> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.OUTBOX, "readonly");
    const store = tx.objectStore(STORES.OUTBOX);
    const request = store.getAll();

    request.onsuccess = () => {
      const all = (request.result as OutboxOperation[]) || [];
      const filtered = all
        .filter((op) => op.status === "queued" || op.status === "syncing" || op.status === "draft")
        .filter((op) => (userId ? op.userId === userId : true))
        .sort((a, b) => a.clientTimestamp - b.clientTimestamp);
      resolve(filtered);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function updateOperationStatus(
  operationId: string,
  status: OutboxOperation["status"],
  error?: string,
  receipt?: unknown
): Promise<void> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.OUTBOX, "readwrite");
    const store = tx.objectStore(STORES.OUTBOX);
    const getReq = store.get(operationId);

    getReq.onsuccess = () => {
      const op = getReq.result as OutboxOperation | undefined;
      if (!op) {
        resolve();
        return;
      }
      op.status = status;
      op.lastAttemptAt = Date.now();
      if (error !== undefined) op.lastError = error;
      if (receipt !== undefined) op.serverReceipt = receipt;
      if (status === "queued") op.retryCount += 1;

      const putReq = store.put(op);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };

    getReq.onerror = () => reject(getReq.error);
  });
}

export async function removeOperation(operationId: string): Promise<void> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.OUTBOX, "readwrite");
    const store = tx.objectStore(STORES.OUTBOX);
    const request = store.delete(operationId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ── Attachment Operations ─────────────────────────────────────────────────────

export async function saveAttachment(attachment: OfflineAttachment): Promise<void> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.ATTACHMENTS, "readwrite");
    const store = tx.objectStore(STORES.ATTACHMENTS);
    const request = store.put(attachment);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getAttachmentsForOperation(operationId: string): Promise<OfflineAttachment[]> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.ATTACHMENTS, "readonly");
    const store = tx.objectStore(STORES.ATTACHMENTS);
    const index = store.index("by_operation");
    const request = index.getAll(operationId);

    request.onsuccess = () => {
      resolve((request.result as OfflineAttachment[]) || []);
    };
    request.onerror = () => reject(request.error);
  });
}

// ── Reference Caching Operations ──────────────────────────────────────────────

export async function saveReference<T>(key: string, data: T, ttlMs = 86400000): Promise<void> {
  const db = await getDb();
  const cached: CachedReference<T> = {
    key,
    data,
    cachedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.REFERENCES, "readwrite");
    const store = tx.objectStore(STORES.REFERENCES);
    const request = store.put(cached);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getReference<T>(key: string): Promise<T | null> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.REFERENCES, "readonly");
    const store = tx.objectStore(STORES.REFERENCES);
    const request = store.get(key);

    request.onsuccess = () => {
      const res = request.result as CachedReference<T> | undefined;
      if (!res || Date.now() > res.expiresAt) {
        resolve(null);
      } else {
        resolve(res.data);
      }
    };
    request.onerror = () => reject(request.error);
  });
}
