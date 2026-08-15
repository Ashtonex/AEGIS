"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2, UploadCloud } from "lucide-react";

import { supabase } from "@/lib/supabase";

export interface UploadedDocumentResult {
  storage_path: string;
  file_name: string;
  mime_type?: string;
  size_bytes: number;
}

/**
 * Uploads a file directly to the shared private "documents" Supabase Storage
 * bucket, the same bucket/path convention dashboard/documents/page.tsx uses.
 * Callers then register the metadata against whichever entity the upload is
 * for (compliance doc, receipt, ...) via their own portal endpoint - this
 * component only handles the storage half.
 */
export function PortalDocumentUpload({
  label,
  onUploaded,
  disabled,
  accept = ".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx",
}: {
  label: string;
  onUploaded: (result: UploadedDocumentResult) => void | Promise<void>;
  disabled?: boolean;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop();
      const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext ? `.${ext}` : ""}`;
      const filePath = `portal-uploads/${storedName}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      setFileName(file.name);
      await onUploaded({
        storage_path: filePath,
        file_name: file.name,
        mime_type: file.type || undefined,
        size_bytes: file.size,
      });
    } catch (uploadErr) {
      setError(uploadErr instanceof Error ? uploadErr.message : "The file could not be uploaded.");
      setFileName(null);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 border border-dashed border-ink-mid bg-ink px-4 py-4 text-sm text-slate-light transition-colors hover:border-signal hover:text-paper disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Uploading...
          </>
        ) : fileName ? (
          <>
            <FileUp className="h-4 w-4 text-emerald-400" /> {fileName}
          </>
        ) : (
          <>
            <UploadCloud className="h-4 w-4" /> {label}
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
