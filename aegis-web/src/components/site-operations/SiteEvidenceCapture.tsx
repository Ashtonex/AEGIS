"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import { Camera, Upload, CheckCircle2, Loader2, Image as ImageIcon, FileText, X } from "lucide-react";
import { saveAttachment, getAttachmentsForOperation } from "@/lib/offline/db";
import { useOutbox } from "@/lib/offline/useOffline";

export interface SiteEvidenceCaptureProps {
  reportId: string;
  projectId: string;
  documents?: { id: string; title: string; file_name?: string; created_at?: string }[];
  onDocumentAdded?: () => void;
}

interface LocalEvidence {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  previewUrl?: string;
  status: "queued" | "uploading" | "synced" | "failed";
}

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

export function SiteEvidenceCapture({
  reportId,
  projectId,
  documents = [],
  onDocumentAdded,
}: SiteEvidenceCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localItems, setLocalItems] = useState<LocalEvidence[]>([]);
  const [processing, setProcessing] = useState(false);
  const { enqueue, isOnline } = useOutbox();

  // Load existing queued attachments for this report on mount
  useEffect(() => {
    let active = true;
    async function loadQueued() {
      try {
        const queued = await getAttachmentsForOperation(reportId);
        if (active && queued.length > 0) {
          const items: LocalEvidence[] = queued.map((att) => ({
            id: att.id,
            name: att.name,
            size: att.size,
            mimeType: att.mimeType,
            previewUrl: att.mimeType.startsWith("image/") ? URL.createObjectURL(att.blob) : undefined,
            status: "queued",
          }));
          setLocalItems(items);
        }
      } catch (err) {
        console.warn("Unable to load offline attachments:", err);
      }
    }
    void loadQueued();
    return () => {
      active = false;
    };
  }, [reportId]);

  const handleCapture = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      setProcessing(true);
      try {
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          const compressedBlob = await compressImage(file);
          const evidenceId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `att-${Date.now()}-${i}`;

          // Save binary blob to IndexedDB
          await saveAttachment({
            id: evidenceId,
            operationId: reportId,
            name: file.name,
            mimeType: file.type || "image/jpeg",
            size: compressedBlob.size,
            blob: compressedBlob,
            createdAt: Date.now(),
            uploaded: false,
          });

          // Enqueue attachment metadata into outbox
          await enqueue({
            operationId: evidenceId,
            organizationId: "snc",
            userId: "site-engineer",
            projectId,
            entityType: "site_daily_report_attachment",
            action: "create",
            endpoint: `/api/v1/site-operations/daily-reports/${reportId}/documents`,
            payload: {
              document_id: evidenceId,
              link_role: "evidence_photo",
              file_name: file.name,
              size_bytes: compressedBlob.size,
            },
          });

          const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(compressedBlob) : undefined;
          setLocalItems((prev) => [
            ...prev,
            {
              id: evidenceId,
              name: file.name,
              size: compressedBlob.size,
              mimeType: file.type || "image/jpeg",
              previewUrl,
              status: isOnline ? "uploading" : "queued",
            },
          ]);
        }

        if (onDocumentAdded) onDocumentAdded();
      } catch (err) {
        console.error("Evidence capture failed:", err);
      } finally {
        setProcessing(false);
        if (event.target) event.target.value = "";
      }
    },
    [reportId, projectId, enqueue, isOnline, onDocumentAdded]
  );

  return (
    <div className="space-y-4">
      {/* Hidden Mobile Camera Input */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCapture}
        className="hidden"
      />

      {/* Hidden File Picker Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx"
        multiple
        onChange={handleCapture}
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

      {/* Evidence Gallery / Attachment List */}
      {(localItems.length > 0 || documents.length > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-2">
          {/* Server-synced documents */}
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="rounded-sm border border-ink-mid bg-ink-high p-2 flex flex-col justify-between text-xs space-y-1.5"
            >
              <div className="flex items-center gap-1.5 text-slate-light truncate">
                <FileText className="w-4 h-4 text-signal shrink-0" />
                <span className="truncate">{doc.file_name || doc.title}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate font-mono">
                <span>Verified</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              </div>
            </div>
          ))}

          {/* Local pending/queued evidence items */}
          {localItems.map((item) => (
            <div
              key={item.id}
              className="rounded-sm border border-ink-mid bg-ink-high overflow-hidden flex flex-col text-xs"
            >
              {item.previewUrl ? (
                <div className="h-24 w-full bg-void relative overflow-hidden flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt={item.name} className="object-cover h-full w-full" />
                </div>
              ) : (
                <div className="h-24 w-full bg-void flex items-center justify-center">
                  <FileText className="w-8 h-8 text-slate" />
                </div>
              )}
              <div className="p-2 space-y-1">
                <span className="truncate block font-mono text-[11px] text-paper">{item.name}</span>
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-slate">{(item.size / 1024).toFixed(0)} KB</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-xs ${
                      item.status === "synced"
                        ? "bg-success/20 text-success"
                        : item.status === "uploading"
                        ? "bg-signal/20 text-signal animate-pulse"
                        : "bg-warning/20 text-warning"
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
