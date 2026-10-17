/**
 * AEGIS Offline & Field Operations — Core Types
 * ─────────────────────────────────────────────────────────────────────────────
 * Defines the contract for local IndexedDB persistence, immutable outbox
 * operations, draft auto-saving, and file attachment queues.
 */

export type OperationStatus =
  | "draft"
  | "queued"
  | "syncing"
  | "acknowledged"
  | "conflict"
  | "blocked";

export interface DraftKey {
  organizationId: string;
  userId: string;
  projectId: string;
  entityType: string;
}

export interface OfflineDraft<T = unknown> {
  key: string; // Composite: `${organizationId}:${userId}:${projectId}:${entityType}`
  organizationId: string;
  userId: string;
  projectId: string;
  entityType: string;
  data: T;
  updatedAt: number;
  version: number;
}

export interface OfflineAttachment {
  id: string; // Unique attachment ID
  operationId: string; // Associated outbox operation
  name: string;
  mimeType: string;
  size: number;
  blob: Blob;
  createdAt: number;
  uploaded: boolean;
}

export interface OutboxOperation<T = unknown> {
  operationId: string; // UUID v4
  organizationId: string;
  userId: string;
  projectId: string;
  entityType: string; // e.g. "site_daily_report", "site_plant_request", "stock_count"
  action: "create" | "update" | "delete";
  endpoint: string; // Target API endpoint, e.g. "/api/v1/site-operations/daily-reports"
  payload: T;
  clientTimestamp: number;
  status: OperationStatus;
  retryCount: number;
  lastAttemptAt?: number;
  lastError?: string;
  serverReceipt?: unknown;
}

export interface CachedReference<T = unknown> {
  key: string;
  data: T;
  cachedAt: number;
  expiresAt: number;
}
