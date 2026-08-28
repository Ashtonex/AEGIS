"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, Loader2, RefreshCw } from "lucide-react";

import { clearFinanceVendorPaymentRequest, createDocument, getFinanceVendorPaymentRequests } from "@/lib/api";
import { PortalDocumentUpload, type UploadedDocumentResult } from "@/components/portal/PortalDocumentUpload";

type RecordData = Record<string, any>;

function money(amount: unknown, currency: unknown) {
  const num = typeof amount === "number" ? amount : Number(amount);
  return `${currency || "USD"} ${Number.isFinite(num) ? num.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

function dateValue(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function VendorPaymentsPanel() {
  const [requests, setRequests] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getFinanceVendorPaymentRequests();
      setRequests(res.data ?? []);
    } catch {
      setNotice("Vendor payment requests could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openRequests = requests.filter((r) => r.status === "submitted" || r.status === "acknowledged");
  const clearedRequests = requests.filter((r) => r.status === "cleared");

  async function handleReceiptUpload(result: UploadedDocumentResult, requestId: string) {
    setBusyId(requestId);
    setNotice(null);
    try {
      const doc = await createDocument({
        title: `Receipt - ${result.file_name}`,
        category: "receipt",
        storage_path: result.storage_path,
        file_name: result.file_name,
        mime_type: result.mime_type,
        file_size_bytes: result.size_bytes,
      });
      if (!doc.data?.id) throw new Error("Document registration failed.");
      await clearFinanceVendorPaymentRequest(requestId, doc.data.id);
      setNotice("Payment request cleared and posted to the cashbook.");
      setClearingId(null);
      await load();
    } catch {
      setNotice("Could not clear this payment request.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Self-service</p>
          <h2 className="mt-1 text-xl font-semibold">Vendor payment requests</h2>
          <p className="mt-1 text-sm text-slate-light">Payment requests raised by suppliers and subcontractors from their portal.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center gap-2 border border-ink-mid px-3 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {notice && <p className="border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper">{notice}</p>}

      {loading ? (
        <div className="flex h-32 items-center justify-center border border-ink-mid bg-ink-light"><Loader2 className="h-5 w-5 animate-spin text-signal" /></div>
      ) : (
        <>
          <div className="border border-ink-mid bg-ink-light">
            <p className="border-b border-ink-mid px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-slate-light">Open ({openRequests.length})</p>
            {openRequests.length === 0 ? (
              <p className="p-6 text-sm text-slate-light">No open vendor payment requests.</p>
            ) : (
              <div className="divide-y divide-ink-mid">
                {openRequests.map((req) => (
                  <div key={req.id} className="p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">{req.vendor_name} <span className="font-mono text-[10px] uppercase text-slate-light">({req.account_type})</span></p>
                        <p className="mt-1 text-sm text-slate-light">{req.reference_description}</p>
                        {req.vendor_onboarding_bypass_enabled && (
                          <p className="mt-2 border border-amber-500/30 bg-amber-950/20 px-2 py-1 text-xs text-amber-200">
                            {req.vendor_onboarding_bypass_message || "Vendor was accepted before onboarding was complete. Complete onboarding properly before treating this vendor as fully compliant."}
                          </p>
                        )}
                        <p className="mt-1 font-mono text-[10px] text-slate-light">Submitted {dateValue(req.submitted_at)}</p>
                      </div>
                      <span className="shrink-0 font-mono text-lg">{money(req.amount, req.currency)}</span>
                    </div>
                    <div className="mt-3">
                      {clearingId === req.id ? (
                        <div className="max-w-xs">
                          <PortalDocumentUpload label="Attach receipt to clear" onUploaded={(r) => handleReceiptUpload(r, req.id)} disabled={busyId === req.id} />
                        </div>
                      ) : (
                        <button type="button" onClick={() => setClearingId(req.id)} className="inline-flex h-9 items-center gap-2 bg-signal px-3 font-mono text-xs uppercase tracking-widest text-ink">
                          <Banknote className="h-4 w-4" /> Clear with receipt
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {clearedRequests.length > 0 && (
            <div className="border border-ink-mid bg-ink-light">
              <p className="border-b border-ink-mid px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-slate-light">Cleared ({clearedRequests.length})</p>
              <div className="divide-y divide-ink-mid">
                {clearedRequests.slice(0, 20).map((req) => (
                  <div key={req.id} className="flex items-center justify-between p-4 text-sm">
                    <div>
                      <p>{req.vendor_name} - {req.reference_description}</p>
                      {req.vendor_onboarding_bypass_enabled && (
                        <p className="mt-1 text-xs text-amber-300">Onboarding incomplete when accepted - follow-up required.</p>
                      )}
                      <p className="mt-1 font-mono text-[10px] uppercase text-slate-light">Cleared by {req.cleared_by_party} on {dateValue(req.cleared_at)}</p>
                    </div>
                    <span className="font-mono text-emerald-400">{money(req.amount, req.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
