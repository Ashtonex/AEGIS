"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import { Camera, Upload, CheckCircle2, Loader2, FileText, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchApi } from "@/lib/api/core";
import { getCachedAccessToken } from "@/lib/supabase";
import { useLiveReconnect, useLiveRecord } from "@/lib/live/LiveDataProvider";
import {
  saveAttachment,
  getAttachmentsForOperation,
  deleteAttachment,
  removeOperation,
} from "@/lib/offline/db";
import type { OfflineAttachment } from "@/lib/offline/types";
import type { ApiResponse } from "@/types/api";

export interface SiteEvidenceCaptureProps {
  reportId: string;
  onDocumentAdded?: () => void;
}

type EvidenceRole = "evidence_photo" | "delivery_docket";

interface ServerEvidence {
  id: string;
  report_id?: string;
  title: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  link_role: string | null;
  linked_at: string | null;
  uploaded_by_name: string | null;
  has_file: boolean;
  url: string | null;
  /** Small preview the uploader's browser made; null for older files and non-images. */
  thumb_url?: string | null;
}

interface LocalEvidence {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  previewUrl?: string;
  status: "waiting" | "uploading" | "failed";
  /** 0-100 while the original is uploading. */
  progress?: number;
}

const ROLE_LABEL: Record<string, string> = {
  evidence_photo: "Photo",
  delivery_docket: "Docket",
};

/**
 * Compresses camera photos before storage or network transmission to optimize
 * mobile field performance over cellular 3G/LTE site connections.
 */
async function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => resolve(blob || file),
          "image/jpeg",
          quality
        );
      } else {
        resolve(file);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

/** A ~320 px JPEG preview, so other people's screens show the photo straight
 * away instead of pulling the 1600 px original into a small tile. */
async function makeThumbnail(blob: Blob, maxDim = 320, quality = 0.7): Promise<Blob | null> {
  if (!blob.type.startsWith("image/")) return null;
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((out) => resolve(out), "image/jpeg", quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

/**
 * Uploads one object to the private "documents" bucket the same way
 * supabase-js `upload()` does (multipart POST with the user's token), but over
 * XHR so the progress can be shown. A path that already exists counts as done:
 * the path is derived from the file's own id, so it is this same file from an
 * earlier, half-finished attempt.
 */
function putObject(path: string, blob: Blob, contentType: string, onProgress?: (percent: number) => void): Promise<void> {
  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const token = getCachedAccessToken() || anonKey;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${baseUrl}/storage/v1/object/documents/${encodedPath}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      if (/exist|duplicate/i.test(xhr.responseText || "")) {
        resolve();
        return;
      }
      let message = `Storage upload failed (${xhr.status}).`;
      try {
        const parsed = JSON.parse(xhr.responseText || "{}");
        message = parsed.message || parsed.error || message;
      } catch {
        // keep the status message
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("The connection dropped during the upload."));
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", new File([blob], path.split("/").pop() || "file", { type: contentType }));
    xhr.send(body);
  });
}

function extensionFor(name: string, mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  const fromName = name.includes(".") ? name.split(".").pop() : "";
  const clean = (fromName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean || "bin";
}

function isOnlineNow(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

/**
 * Sends one locally saved file to the server: the bytes go to the private
 * "documents" bucket, then the report's evidence endpoint registers and links
 * it. The storage path is derived from the file's own id, so a retry after a
 * half-finished attempt lands on the same object and the same document.
 */
async function uploadAttachment(
  reportId: string,
  att: OfflineAttachment,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const mimeType = att.blob.type || att.mimeType || "application/octet-stream";
  const storagePath = `site-evidence/${reportId}/${att.id}.${extensionFor(att.name, mimeType)}`;

  // The thumbnail goes first: it is a few KB, and a failure here only costs
  // the preview, never the upload.
  let thumbnailPath: string | null = null;
  const thumb = await makeThumbnail(att.blob).catch(() => null);
  if (thumb) {
    const candidate = `site-evidence/${reportId}/${att.id}.thumb.jpg`;
    try {
      await putObject(candidate, thumb, "image/jpeg");
      thumbnailPath = candidate;
    } catch (err) {
      console.warn("Thumbnail upload failed; continuing without it:", err);
    }
  }

  await putObject(storagePath, att.blob, mimeType, onProgress);

  const res = await fetchApi<ApiResponse<{ id: string }>>(
    `/api/v1/site-operations/daily-reports/${reportId}/evidence`,
    {
      method: "POST",
      body: JSON.stringify({
        storage_path: storagePath,
        file_name: att.name,
        mime_type: mimeType,
        size_bytes: att.size,
        link_role: att.linkRole === "delivery_docket" ? "delivery_docket" : "evidence_photo",
        thumbnail_path: thumbnailPath,
      }),
      allowFallback: false,
    }
  );
  if (!res.success) throw new Error(res.message || "The file could not be attached to the report.");

  await deleteAttachment(att.id);
  // Earlier builds queued a link request under the same id that the server
  // could never accept; clear it so it stops holding up the offline queue.
  await removeOperation(att.id).catch(() => undefined);
}

function upsertEvidence(current: ServerEvidence[], incoming: ServerEvidence): ServerEvidence[] {
  const next = [incoming, ...current.filter((item) => item.id !== incoming.id)];
  next.sort((a, b) => (b.linked_at ? Date.parse(b.linked_at) : 0) - (a.linked_at ? Date.parse(a.linked_at) : 0));
  return next;
}

export function SiteEvidenceCapture({ reportId, onDocumentAdded }: SiteEvidenceCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [serverItems, setServerItems] = useState<ServerEvidence[]>([]);
  const [localItems, setLocalItems] = useState<LocalEvidence[]>([]);
  const [processing, setProcessing] = useState(false);
  const flushingRef = useRef(false);
  const onAddedRef = useRef(onDocumentAdded);
  useEffect(() => {
    onAddedRef.current = onDocumentAdded;
  }, [onDocumentAdded]);
  const previewUrlsRef = useRef(new Map<string, string>());

  const loadServer = useCallback(async () => {
    if (!isOnlineNow()) return;
    try {
      const res = await fetchApi<ApiResponse<ServerEvidence[]>>(
        `/api/v1/site-operations/daily-reports/${reportId}/evidence`,
        { cache: "no-store", allowFallback: false }
      );
      if (res.success && Array.isArray(res.data)) setServerItems(res.data);
    } catch (err) {
      console.warn("Unable to load report evidence:", err);
    }
  }, [reportId]);

  // A photo or docket added by anyone else (or by this user on another
  // device) arrives as the finished item, signed links included, already
  // filtered by report access and project scope on the server.
  useLiveRecord<ServerEvidence & { deleted?: boolean }>("core.document_links", (_op, _id, item) => {
    if (!item || item.report_id !== reportId) return;
    if (item.deleted) {
      // Tombstone: the file was removed from the report (or deleted).
      setServerItems((current) => current.filter((doc) => doc.id !== item.id));
      return;
    }
    setServerItems((current) => upsertEvidence(current, item));
  });
  // Catch up on anything added while this device's connection was down.
  useLiveReconnect(() => void loadServer());

  const previewFor = useCallback((att: OfflineAttachment): string | undefined => {
    const type = att.blob.type || att.mimeType;
    if (!type.startsWith("image/")) return undefined;
    const cache = previewUrlsRef.current;
    if (!cache.has(att.id)) cache.set(att.id, URL.createObjectURL(att.blob));
    return cache.get(att.id);
  }, []);

  /** Uploads everything still held on this device for the report. */
  const flushPending = useCallback(
    async (announce: boolean) => {
      if (flushingRef.current) return;
      flushingRef.current = true;
      try {
        const pending = await getAttachmentsForOperation(reportId);
        const online = isOnlineNow();
        setLocalItems(
          pending.map((att) => ({
            id: att.id,
            name: att.name,
            size: att.size,
            mimeType: att.blob.type || att.mimeType,
            previewUrl: previewFor(att),
            status: online ? "uploading" : "waiting",
            progress: 0,
          }))
        );
        if (!online || pending.length === 0) return;

        let sent = 0;
        let lastError = "";
        for (const att of pending) {
          try {
            await uploadAttachment(reportId, att, (percent) =>
              setLocalItems((prev) =>
                prev.map((item) => (item.id === att.id ? { ...item, progress: percent } : item))
              )
            );
            sent += 1;
            setLocalItems((prev) => prev.filter((item) => item.id !== att.id));
          } catch (err) {
            lastError = err instanceof Error ? err.message : "Upload failed.";
            setLocalItems((prev) =>
              prev.map((item) => (item.id === att.id ? { ...item, status: "failed" } : item))
            );
          }
        }
        if (sent > 0) {
          await loadServer();
          onAddedRef.current?.();
          if (announce) toast.success(sent === 1 ? "File uploaded to the report." : `${sent} files uploaded to the report.`);
        }
        if (lastError) {
          toast.error(`Upload failed: ${lastError}`, {
            description: "The file is kept on this device. Use Retry when the connection is back.",
          });
        }
      } catch (err) {
        console.warn("Unable to process saved attachments:", err);
      } finally {
        flushingRef.current = false;
      }
    },
    [reportId, loadServer, previewFor]
  );

  useEffect(() => {
    void loadServer();
    void flushPending(false);
    const onOnline = () => {
      void loadServer();
      void flushPending(true);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [loadServer, flushPending]);

  useEffect(() => {
    const cache = previewUrlsRef.current;
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  const handleCapture = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>, role: EvidenceRole) => {
      const input = event.target;
      const files = input.files ? Array.from(input.files) : [];
      if (files.length === 0) return;

      setProcessing(true);
      try {
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          const blob = await compressImage(file);
          const id =
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `att-${Date.now()}-${i}`;
          // Saved on the device first so a dropped connection never loses it.
          await saveAttachment({
            id,
            operationId: reportId,
            name: file.name || `site-photo-${Date.now()}.jpg`,
            mimeType: blob.type || file.type || "image/jpeg",
            size: blob.size,
            blob,
            createdAt: Date.now(),
            uploaded: false,
            linkRole: role,
          });
        }
        if (!isOnlineNow()) {
          toast.info("Saved on this device. It will upload when you are back online.");
        }
      } catch (err) {
        console.error("Evidence capture failed:", err);
        toast.error("The file could not be saved on this device.");
      } finally {
        setProcessing(false);
        input.value = "";
      }
      await flushPending(true);
    },
    [reportId, flushPending]
  );

  const hasFailed = localItems.some((item) => item.status === "failed");

  return (
    <div className="space-y-4">
      {/* Hidden Mobile Camera Input */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => void handleCapture(event, "evidence_photo")}
        className="hidden"
      />

      {/* Hidden File Picker Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx"
        multiple
        onChange={(event) => void handleCapture(event, "delivery_docket")}
        className="hidden"
      />

      {/* Action Buttons with 48px touch targets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          disabled={processing}
          className="flex items-center justify-center gap-2.5 min-h-[48px] px-4 py-3 rounded-sm bg-ink-light border border-ink-mid hover:border-signal/50 text-paper font-sans text-sm font-medium transition-colors active:scale-[0.98]"
        >
          {processing ? (
            <Loader2 className="w-5 h-5 text-signal animate-spin" />
          ) : (
            <Camera className="w-5 h-5 text-signal" />
          )}
          <span>Snap Site Progress Photo</span>
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={processing}
          className="flex items-center justify-center gap-2.5 min-h-[48px] px-4 py-3 rounded-sm bg-ink-light border border-ink-mid hover:border-signal/50 text-paper font-sans text-sm font-medium transition-colors active:scale-[0.98]"
        >
          <Upload className="w-5 h-5 text-slate-light" />
          <span>Upload Delivery Docket / File</span>
        </button>
      </div>

      {hasFailed && (
        <button
          type="button"
          onClick={() => void flushPending(true)}
          className="flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-sm border border-warning/50 text-warning font-mono text-xs uppercase tracking-wider hover:bg-ink-light"
        >
          <RefreshCw className="w-4 h-4" />
          Retry failed uploads
        </button>
      )}

      {/* Evidence Gallery / Attachment List */}
      {(localItems.length > 0 || serverItems.length > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-2">
          {/* Still on this device */}
          {localItems.map((item) => (
            <div
              key={item.id}
              className="rounded-sm border border-ink-mid bg-ink-high overflow-hidden flex flex-col text-xs"
            >
              {item.previewUrl ? (
                <div className="h-32 w-full bg-void overflow-hidden flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt={item.name} className="object-cover h-full w-full" />
                </div>
              ) : (
                <div className="h-32 w-full bg-void flex items-center justify-center">
                  <FileText className="w-8 h-8 text-slate" />
                </div>
              )}
              <div className="p-2 space-y-1">
                <span className="truncate block font-mono text-[11px] text-paper">{item.name}</span>
                {item.status === "uploading" && (
                  <div
                    className="h-1 w-full overflow-hidden rounded-full bg-ink-mid"
                    role="progressbar"
                    aria-valuenow={item.progress ?? 0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Uploading ${item.name}`}
                  >
                    <div className="h-full bg-signal transition-[width] duration-150" style={{ width: `${item.progress ?? 0}%` }} />
                  </div>
                )}
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-slate">{(item.size / 1024).toFixed(0)} KB</span>
                  <span
                    className={
                      item.status === "uploading"
                        ? "text-signal animate-pulse"
                        : item.status === "failed"
                        ? "text-danger"
                        : "text-warning"
                    }
                  >
                    {item.status === "uploading"
                      ? `Uploading ${item.progress ?? 0}%`
                      : item.status === "failed"
                      ? "Not uploaded"
                      : "Waiting for signal"}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {/* Stored on the server */}
          {serverItems.map((doc) => {
            const name = doc.file_name || doc.title;
            const isImage = !!(doc.thumb_url || doc.url) && (doc.mime_type || "").startsWith("image/");
            const body = (
              <>
                {isImage ? (
                  <div className="h-32 w-full bg-void overflow-hidden flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={doc.thumb_url || doc.url || ""} alt={name} loading="lazy" className="object-cover h-full w-full" />
                  </div>
                ) : (
                  <div className="h-32 w-full bg-void flex flex-col items-center justify-center gap-1.5">
                    <FileText className="w-8 h-8 text-slate" />
                    {!doc.has_file && (
                      <span className="font-mono text-[10px] text-slate">No file stored</span>
                    )}
                  </div>
                )}
                <div className="p-2 space-y-1">
                  <span className="truncate block font-mono text-[11px] text-paper">{name}</span>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate">
                    <span className="truncate">
                      {ROLE_LABEL[doc.link_role || ""] || "File"}
                      {doc.linked_at ? ` · ${new Date(doc.linked_at).toLocaleDateString()}` : ""}
                    </span>
                    {doc.has_file && <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />}
                  </div>
                </div>
              </>
            );
            const className =
              "rounded-sm border border-ink-mid bg-ink-high overflow-hidden flex flex-col text-xs";
            return doc.url ? (
              <a
                key={doc.id}
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${name}`}
                className={`${className} hover:border-signal/50 transition-colors`}
              >
                {body}
              </a>
            ) : (
              <div key={doc.id} className={className}>
                {body}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
