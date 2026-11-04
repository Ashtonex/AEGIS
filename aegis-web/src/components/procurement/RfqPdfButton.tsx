"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { downloadRfqPdf } from "@/lib/api";
import { type Rec, tx } from "@/components/procurement/shared";

/** Downloads the AEGIS-signed request for quotation to send to suppliers. */
export function RfqPdfButton({ rfq }: { rfq: Rec }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await downloadRfqPdf(String(rfq.id));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `SNC_Request_for_Quotation_${tx(rfq.rfq_number, String(rfq.id).slice(0, 8)).replace(/[^A-Za-z0-9_-]/g, "")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the RFQ document.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" onClick={() => void download()} disabled={busy}
        title="Download the signed request for quotation to send to suppliers"
        className="inline-flex items-center gap-1 border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper disabled:opacity-50">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}RFQ PDF
      </button>
      {error && <span className="mt-1 max-w-[14rem] text-[10px] text-red-300">{error}</span>}
    </span>
  );
}
