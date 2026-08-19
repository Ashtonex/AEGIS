"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Eye, FileText, Loader2, Trash2, X } from "lucide-react";
import { PortalDocumentUpload, type UploadedDocumentResult } from "@/components/portal/PortalDocumentUpload";
import {
  createDocument,
  linkDocument,
  getDocumentsForEntity,
  getDocumentSignedUrl,
  deleteDocument,
} from "@/lib/api";

export type DocumentEntityType = "lead" | "opportunity" | "tender" | "project" | "fleet" | "machinery";

interface DocRecord {
  id: string;
  title: string;
  category: string;
  file_name: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  file_attachment_id: string | null;
  created_at: string;
  uploaded_by_name: string | null;
  uploaded_by_email: string | null;
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message || fallback;
}

/**
 * Documents attached to one lead/opportunity/tender/project/fleet/machinery
 * record. Multiple people can upload against the same entity_id - every
 * upload lands in the shared feed with who uploaded it and when, there is
 * no per-uploader partitioning.
 */
export function EntityDocumentsPanel({ entityType, entityId }: { entityType: DocumentEntityType; entityId: string }) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ doc: DocRecord; url: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDocumentsForEntity(entityType, entityId);
      if (!res.success || !Array.isArray(res.data)) throw new Error("Documents did not load.");
      setDocs(res.data);
    } catch (e) {
      setError(normalizeError(e, "Documents did not load."));
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { void load(); }, [load]);

  const handleUploaded = async (result: UploadedDocumentResult) => {
    setNotice(null);
    try {
      const created = await createDocument({
        title: result.file_name,
        category: "other",
        file_name: result.file_name,
        file_size_bytes: result.size_bytes,
        storage_path: result.storage_path,
        mime_type: result.mime_type,
      });
      const docId = created.data?.id;
      if (!created.success || !docId) throw new Error("Document could not be registered.");
      const linkRes = await linkDocument(docId, { entity_type: entityType, entity_id: entityId });
      if (!linkRes.success) throw new Error("Document was uploaded but could not be attached to this record.");
      setNotice(`"${result.file_name}" attached.`);
      await load();
    } catch (e) {
      setError(normalizeError(e, "Upload failed."));
    }
  };

  const handlePreview = async (doc: DocRecord) => {
    setBusyId(doc.id);
    setError(null);
    try {
      const res = await getDocumentSignedUrl(doc.id);
      const url = res.data?.url;
      if (!res.success || !url) throw new Error("Could not generate a preview link for this file.");
      setPreview({ doc, url });
    } catch (e) {
      setError(normalizeError(e, "Preview failed."));
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (doc: DocRecord) => {
    setBusyId(doc.id);
    setError(null);
    try {
      const res = await getDocumentSignedUrl(doc.id);
      const url = res.data?.url;
      if (!res.success || !url) throw new Error("Could not generate a download link for this file.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(normalizeError(e, "Download failed."));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (doc: DocRecord) => {
    if (!window.confirm(`Remove "${doc.title}"? This cannot be undone.`)) return;
    setBusyId(doc.id);
    setError(null);
    try {
      const res = await deleteDocument(doc.id);
      if (!res.success) throw new Error("Document could not be removed.");
      setDocs((current) => current.filter((d) => d.id !== doc.id));
    } catch (e) {
      setError(normalizeError(e, "Delete failed."));
    } finally {
      setBusyId(null);
    }
  };

  const isPreviewable = (mime: string | null) => !!mime && (mime.startsWith("image/") || mime === "application/pdf");

  return (
    <div className="space-y-3">
      <PortalDocumentUpload label="Upload document or image" onUploaded={handleUploaded} />

      {notice && <p className="text-xs text-emerald-400">{notice}</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-slate-light">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : docs.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-light">No documents attached yet.</p>
      ) : (
        <ul className="divide-y divide-ink-mid border border-ink-mid">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <FileText className="h-4 w-4 shrink-0 text-signal" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-paper">{doc.title}</p>
                  <p className="truncate text-[11px] text-slate-light">
                    {doc.uploaded_by_name || doc.uploaded_by_email || "Unknown uploader"} · {new Date(doc.created_at).toLocaleDateString()}
                    {doc.file_size_bytes ? ` · ${formatSize(doc.file_size_bytes)}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {isPreviewable(doc.mime_type) && (
                  <button
                    type="button"
                    disabled={busyId === doc.id}
                    onClick={() => void handlePreview(doc)}
                    title="Preview"
                    className="rounded-sm p-1.5 text-slate-light hover:bg-ink-mid/50 hover:text-paper disabled:opacity-40"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === doc.id || !doc.file_attachment_id}
                  onClick={() => void handleDownload(doc)}
                  title={doc.file_attachment_id ? "Download" : "No file uploaded"}
                  className="rounded-sm p-1.5 text-slate-light hover:bg-ink-mid/50 hover:text-paper disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busyId === doc.id}
                  onClick={() => void handleDelete(doc)}
                  title="Remove"
                  className="rounded-sm p-1.5 text-slate-light hover:bg-red-950/40 hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col bg-ink border border-ink-mid" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between border-b border-ink-mid p-3">
              <p className="truncate text-sm text-paper">{preview.doc.title}</p>
              <button onClick={() => setPreview(null)} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
            </header>
            <div className="flex-1 overflow-auto bg-black/40 p-2">
              {preview.doc.mime_type?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.url} alt={preview.doc.title} className="mx-auto max-h-[75vh] w-auto" />
              ) : (
                <iframe src={preview.url} title={preview.doc.title} className="h-[75vh] w-full border-0" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
