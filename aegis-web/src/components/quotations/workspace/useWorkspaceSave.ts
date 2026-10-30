"use client";

/**
 * Save safety for the estimating workspace.
 *
 *  - One save in flight at a time; edits made while it runs are saved next,
 *    so an older response can never overwrite newer local edits.
 *  - Every save sends the row_version it is based on; the server answers 409
 *    STALE_VERSION if someone else saved first. Autosave then stops and the
 *    estimator decides - nothing is overwritten on either side.
 *  - Unsaved work is mirrored to localStorage (this browser only) and offered
 *    back after a crash or closed tab.
 *  - Leaving the page with unsaved or in-flight changes asks first.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isStaleVersionError, saveQuotationDraft } from "@/lib/api/quotations";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict" | "readonly";

interface Options {
  quotationId: string;
  rowVersion: number | null;
  editRevision: number;
  enabled: boolean;
  buildPayload: () => Record<string, unknown>;
  onSaved: (result: { row_version: number; quote_amount: string | number; totals: Record<string, any> }) => void;
  autosaveMs?: number;
}

const draftKey = (id: string) => `aegis.quotation-workspace.draft.${id}`;

export interface StoredDraft {
  rowVersion: number;
  savedAt: string;
  payload: Record<string, unknown>;
}

export function readStoredDraft(id: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    return null;
  }
}

export function clearStoredDraft(id: string) {
  try {
    window.localStorage.removeItem(draftKey(id));
  } catch {
    // storage unavailable - nothing to clear
  }
}

export function useWorkspaceSave({ quotationId, rowVersion, editRevision, enabled, buildPayload, onSaved, autosaveMs = 2500 }: Options) {
  const [status, setStatus] = useState<SaveStatus>(enabled ? "saved" : "readonly");
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const versionRef = useRef<number | null>(rowVersion);
  const savedRevisionRef = useRef(editRevision);
  const latestRevisionRef = useRef(editRevision);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const statusRef = useRef<SaveStatus>(status);
  const buildRef = useRef(buildPayload);
  const onSavedRef = useRef(onSaved);
  buildRef.current = buildPayload;
  onSavedRef.current = onSaved;
  statusRef.current = status;
  latestRevisionRef.current = editRevision;

  // A fresh load from the server (new rowVersion from outside) re-baselines.
  const rebase = useCallback((version: number, revision: number) => {
    versionRef.current = version;
    savedRevisionRef.current = revision;
    setStatus(enabled ? "saved" : "readonly");
    setError(null);
  }, [enabled]);

  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const save = useCallback(async (): Promise<boolean> => {
    if (!enabled || statusRef.current === "conflict" || versionRef.current === null) return false;
    if (inFlightRef.current) {
      queuedRef.current = true;
      return false;
    }
    const revisionAtRequest = latestRevisionRef.current;
    if (revisionAtRequest === savedRevisionRef.current) {
      setStatus("saved");
      return true;
    }
    inFlightRef.current = true;
    setStatus("saving");
    setError(null);
    try {
      const res = await saveQuotationDraft(quotationId, buildRef.current(), versionRef.current);
      if (!res.data) throw new Error(res.message || "Save returned no data.");
      versionRef.current = res.data.row_version;
      savedRevisionRef.current = revisionAtRequest;
      setLastSavedAt(new Date());
      onSavedRef.current(res.data);
      const stillDirty = latestRevisionRef.current !== revisionAtRequest;
      setStatus(stillDirty ? "dirty" : "saved");
      if (!stillDirty) clearStoredDraft(quotationId);
      return true;
    } catch (err) {
      if (isStaleVersionError(err)) {
        statusRef.current = "conflict"; // stop a queued save before the next render
        setStatus("conflict");
        setError((err as Error).message);
      } else {
        setStatus("error");
        setError((err as Error)?.message || "Save failed.");
      }
      return false;
    } finally {
      inFlightRef.current = false;
      if (queuedRef.current && (statusRef.current as SaveStatus) !== "conflict") {
        queuedRef.current = false;
        void Promise.resolve().then(() => saveRef.current?.());
      }
    }
  }, [enabled, quotationId]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Dirty tracking, local draft mirror and debounced autosave.
  useEffect(() => {
    if (!enabled) return;
    if (editRevision === savedRevisionRef.current) return;
    if (statusRef.current !== "conflict" && statusRef.current !== "saving") setStatus("dirty");
    const mirror = window.setTimeout(() => {
      if (latestRevisionRef.current === savedRevisionRef.current) return; // re-baselined meanwhile
      try {
        const draft: StoredDraft = { rowVersion: versionRef.current ?? 0, savedAt: new Date().toISOString(), payload: buildRef.current() };
        window.localStorage.setItem(draftKey(quotationId), JSON.stringify(draft));
      } catch {
        // quota/private mode: autosave to the server still protects the work
      }
    }, 600);
    const autosave = window.setTimeout(() => {
      if (statusRef.current === "dirty" || statusRef.current === "error") void save();
    }, autosaveMs);
    return () => {
      window.clearTimeout(mirror);
      window.clearTimeout(autosave);
    };
  }, [editRevision, enabled, quotationId, save, autosaveMs]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (["dirty", "saving", "error", "conflict"].includes(statusRef.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return { status, error, lastSavedAt, save, rebase, rowVersion: versionRef };
}
