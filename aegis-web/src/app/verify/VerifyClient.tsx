"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, FileSearch, XCircle } from "lucide-react";

export function VerifyCodeForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initial);

  return (
    <form
      className="flex flex-col sm:flex-row gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const cleaned = code.trim().toUpperCase();
        if (cleaned) router.push(`/verify/${encodeURIComponent(cleaned)}`);
      }}
    >
      <input
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="SNC-XXXX-XXXX-XXXX"
        aria-label="Verification code"
        autoComplete="off"
        spellCheck={false}
        className="flex-1 px-4 py-3 bg-[var(--dxl-ink)] border border-[var(--dxl-ink-mid)] text-[var(--dxl-paper)] font-mono tracking-wider uppercase focus:outline-none focus:border-[var(--dxl-signal)]"
      />
      <button
        type="submit"
        className="px-6 py-3 bg-[var(--dxl-signal)] text-[var(--dxl-void)] font-bold uppercase tracking-wide text-sm"
      >
        Verify
      </button>
    </form>
  );
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Hashes the dropped PDF in the browser and compares it with the hash on record. Nothing is uploaded. */
export function FileHashCheck({ expectedHash }: { expectedHash: string }) {
  const [state, setState] = useState<{ name: string; hash: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      setState({ name: file.name, hash: await sha256Hex(file) });
    } finally {
      setBusy(false);
    }
  }

  const matches = state ? state.hash === expectedHash : null;

  return (
    <div className="border border-[var(--dxl-ink-mid)] p-6">
      <div className="flex items-center gap-3 mb-2">
        <FileSearch className="w-5 h-5 text-[var(--dxl-signal)]" />
        <h3 className="font-bold text-[var(--dxl-paper)]">Check your copy of the file</h3>
      </div>
      <p className="text-sm text-[var(--dxl-slate-light)] mb-4">
        Choose the PDF you received. It is checked on this device and never uploaded. A match proves the file is exactly
        the one AEGIS issued, unaltered.
      </p>
      <label
        className="block border border-dashed border-[var(--dxl-ink-mid)] px-4 py-6 text-center text-sm text-[var(--dxl-slate-light)] cursor-pointer hover:border-[var(--dxl-signal)]"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          check(event.dataTransfer.files?.[0]);
        }}
      >
        <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => check(event.target.files?.[0])} />
        {busy ? "Checking…" : "Drop the PDF here or click to choose it"}
      </label>
      {state && (
        <div
          className={`mt-4 p-4 flex items-start gap-3 ${matches ? "bg-emerald-950/40 border border-emerald-700" : "bg-red-950/40 border border-red-700"}`}
        >
          {matches ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          )}
          <div className="text-sm min-w-0">
            <p className="font-bold text-[var(--dxl-paper)]">
              {matches ? "Match: this is the original, unaltered file." : "No match: this file differs from the one AEGIS issued."}
            </p>
            <p className="text-[var(--dxl-slate-light)] break-all mt-1">
              {state.name}: <span className="font-mono">{state.hash}</span>
            </p>
            {!matches && (
              <p className="text-[var(--dxl-slate-light)] mt-1">
                It may have been edited, re-saved or printed to PDF again. Contact Six Nine Construction before relying on it.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
