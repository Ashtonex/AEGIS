"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Eye, FileText, Loader2, RefreshCw, ScanSearch, ShieldAlert, ShieldCheck, X, XCircle } from "lucide-react";

import {
  acceptHrVendorVerificationWithGaps,
  decideHrVendorVerification,
  decideHrVendorVerificationDocument,
  getHrVendorVerificationDetail,
  getHrVendorVerificationDocumentSignedUrl,
  getHrVendorVerificationDocuments,
  getHrVendorVerificationQueue,
  runHrVendorSystemCheck,
  type HrVendorVerificationDetail,
  type SupplierComplianceDocumentStatus,
  type SupplierComplianceDocumentType,
  type VendorDocument,
} from "@/lib/api";

type RecordData = Record<string, any>;

const REQUIRED_DOCUMENTS: Array<{ key: SupplierComplianceDocumentType; label: string }> = [
  { key: "tax_clearance", label: "Tax Clearance" },
  { key: "nssa", label: "NSSA" },
  { key: "praz", label: "PRAZ" },
  { key: "vat", label: "VAT" },
  { key: "company_registration", label: "Company Registration" },
];

function textValue(value: unknown, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function dateValue(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-ZW", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function docStatusClass(status: string) {
  if (status === "verified") return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  if (status === "rejected") return "border-red-500/30 bg-red-950/20 text-red-300";
  if (status === "needs_update") return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  return "border-blue-500/30 bg-blue-950/20 text-blue-300";
}

export function VendorVerificationPanel() {
  const [queue, setQueue] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [documentsByVendor, setDocumentsByVendor] = useState<Record<string, VendorDocument[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HrVendorVerificationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHrVendorVerificationQueue();
      setQueue(res.data ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Vendor verification queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const handle = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(handle);
  }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await getHrVendorVerificationDetail(id);
      setDetail(res.data ?? null);
      setDocumentsByVendor((current) => ({ ...current, [id]: res.data?.documents ?? current[id] ?? [] }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Vendor review detail could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function openVendorReview(id: string) {
    setSelectedId(id);
    setExpandedId(id);
    setDetail(null);
    void loadDetail(id);
  }

  async function runSystemCheck(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await runHrVendorSystemCheck(id);
      const stage = res.data?.verification_stage;
      setNotice(stage === "system_verified" ? "Passed automated checks - ready for HR review." : "Still incomplete - see the notes below for what's missing.");
      await load();
      if (selectedId === id) await loadDetail(id);
    } catch {
      setNotice("Could not run the system check for this vendor.");
    } finally {
      setBusyId(null);
    }
  }

  async function approve(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      await decideHrVendorVerification(id, "approve");
      setNotice("Vendor verified.");
      await load();
      if (selectedId === id) await loadDetail(id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not approve this vendor profile.");
    } finally {
      setBusyId(null);
    }
  }

  async function acceptWithGaps(id: string) {
    const note = window.prompt("Reason for accepting this vendor before onboarding is complete:");
    if (note === null) return;
    setBusyId(id);
    setNotice(null);
    try {
      await acceptHrVendorVerificationWithGaps(id, note.trim() || undefined);
      setNotice("Vendor accepted and flagged for incomplete onboarding. SUPERADMIN has been notified.");
      await load();
      if (selectedId === id) await loadDetail(id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not accept this vendor with onboarding gaps.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) {
      setNotice("A rejection reason is required.");
      return;
    }
    setBusyId(id);
    setNotice(null);
    try {
      await decideHrVendorVerification(id, "reject", rejectReason.trim());
      setNotice("Vendor profile rejected.");
      setRejectingId(null);
      setRejectReason("");
      await load();
      if (selectedId === id) await loadDetail(id);
    } catch {
      setNotice("Could not reject this vendor profile.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleDocuments(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (documentsByVendor[id]) return;
    setBusyId(id);
    try {
      const res = await getHrVendorVerificationDocuments(id);
      setDocumentsByVendor((current) => ({ ...current, [id]: res.data ?? [] }));
    } catch {
      setNotice("Vendor documents could not be loaded.");
    } finally {
      setBusyId(null);
    }
  }

  async function viewDocument(vendorId: string, documentId: string) {
    try {
      const res = await getHrVendorVerificationDocumentSignedUrl(vendorId, documentId);
      if (res.data?.url) window.open(res.data.url, "_blank", "noopener,noreferrer");
    } catch {
      setNotice("Document could not be opened.");
    }
  }

  async function decideDocument(vendorId: string, documentId: string, status: SupplierComplianceDocumentStatus) {
    const reviewNotes = status === "verified" ? undefined : window.prompt("Record the reason or correction needed:") ?? undefined;
    if (status !== "verified" && !reviewNotes?.trim()) return;
    setBusyId(documentId);
    try {
      await decideHrVendorVerificationDocument(vendorId, documentId, { status, review_notes: reviewNotes?.trim() });
      const res = await getHrVendorVerificationDocuments(vendorId);
      setDocumentsByVendor((current) => ({ ...current, [vendorId]: res.data ?? [] }));
      if (selectedId === vendorId) await loadDetail(vendorId);
      await load();
      setNotice(status === "verified" ? "Document verified." : "Document marked for correction.");
    } catch {
      setNotice("Document decision could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Vendor onboarding</p>
          <h2 className="mt-1 text-xl font-semibold">Verification queue</h2>
          <p className="mt-1 text-sm text-slate-light">
            Every supplier/subcontractor not yet fully verified, including profiles added directly by staff.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 border border-ink-mid px-3 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {notice && <p className="border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper">{notice}</p>}

      {loading ? (
        <div className="flex h-32 items-center justify-center border border-ink-mid bg-ink-light">
          <Loader2 className="h-5 w-5 animate-spin text-signal" />
        </div>
      ) : queue.length === 0 ? (
        <div className="border border-ink-mid bg-ink-light p-8 text-center text-sm text-slate-light">
          No vendor profiles are waiting on HR review right now.
        </div>
      ) : (
        <div className="divide-y divide-ink-mid border border-ink-mid bg-ink-light">
          {queue.map((row) => {
            const stage = row.verification_stage as string | undefined;
            const readyForDecision = stage === "system_verified";
            const docs = documentsByVendor[row.id] ?? [];
            return (
              <div key={row.id} className="p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{textValue(row.name)}</p>
                      <span className="border border-ink-mid px-2 py-0.5 font-mono text-[10px] uppercase text-slate-light">
                        {textValue(row.account_type, "vendor")}
                      </span>
                      <span className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${readyForDecision ? "border border-emerald-500/30 bg-emerald-950/20 text-emerald-300" : "border border-amber-500/30 bg-amber-950/20 text-amber-300"}`}>
                        {textValue(stage, "incomplete").replace("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-light">
                      Reg. {textValue(row.registration_number)} · Tax {textValue(row.tax_clearance_number)} · Verified by system {dateValue(row.system_verified_at)}
                    </p>
                    <p className="mt-1 text-xs text-slate-light">{textValue(row.contact_email)} · {textValue(row.contact_phone)}</p>
                    <p className="mt-1 text-xs text-slate-light">
                      Documents {row.compliance_document_count ?? 0}/5 uploaded · {row.verified_document_count ?? 0}/5 verified
                    </p>
                    {!readyForDecision && row.system_verification_notes && (
                      <p className="mt-1 text-xs text-amber-300">{row.system_verification_notes}</p>
                    )}
                    {row.onboarding_bypass_enabled && (
                      <p className="mt-2 border border-amber-500/30 bg-amber-950/20 px-2 py-1 text-xs text-amber-200">
                        {row.onboarding_bypass_message || "Accepted with onboarding gaps. Complete onboarding properly before relying on this vendor as fully compliant."}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openVendorReview(row.id)}
                      disabled={busyId === row.id}
                      className="inline-flex h-9 items-center gap-2 border border-signal/40 px-3 font-mono text-xs uppercase tracking-widest text-signal hover:bg-signal/10 disabled:opacity-50"
                    >
                      <Eye className="h-4 w-4" />
                      Review
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleDocuments(row.id)}
                      disabled={busyId === row.id}
                      className="inline-flex h-9 items-center gap-2 border border-ink-mid px-3 font-mono text-xs uppercase tracking-widest text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"
                    >
                      {busyId === row.id && expandedId !== row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                      Documents
                    </button>
                    {readyForDecision ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void approve(row.id)}
                          disabled={busyId === row.id}
                          className="inline-flex h-9 items-center gap-2 bg-emerald-600 px-3 font-mono text-xs uppercase tracking-widest text-white disabled:opacity-50"
                        >
                          {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectingId(rejectingId === row.id ? null : row.id)}
                          className="inline-flex h-9 items-center gap-2 border border-red-500/40 px-3 font-mono text-xs uppercase tracking-widest text-red-300 hover:bg-red-950/20"
                        >
                          <XCircle className="h-4 w-4" />
                          Reject
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void runSystemCheck(row.id)}
                          disabled={busyId === row.id}
                          className="inline-flex h-9 items-center gap-2 border border-signal/40 px-3 font-mono text-xs uppercase tracking-widest text-signal hover:bg-signal/10 disabled:opacity-50"
                        >
                          {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                          Run System Check
                        </button>
                        <button
                          type="button"
                          onClick={() => void acceptWithGaps(row.id)}
                          disabled={busyId === row.id}
                          className="inline-flex h-9 items-center gap-2 border border-amber-500/50 px-3 font-mono text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-950/20 disabled:opacity-50"
                        >
                          <BadgeCheck className="h-4 w-4" />
                          Accept
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {rejectingId === row.id && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-ink-mid pt-3 sm:flex-row">
                    <input
                      value={rejectReason}
                      onChange={(event) => setRejectReason(event.target.value)}
                      placeholder="Reason for rejection..."
                      className="h-9 flex-1 border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal"
                    />
                    <button
                      type="button"
                      onClick={() => void reject(row.id)}
                      disabled={busyId === row.id}
                      className="inline-flex h-9 items-center justify-center gap-2 border border-red-500/40 px-3 font-mono text-xs uppercase tracking-widest text-red-300 disabled:opacity-50"
                    >
                      <ShieldAlert className="h-4 w-4" />
                      Confirm rejection
                    </button>
                  </div>
                )}

                {expandedId === row.id && (
                  <div className="mt-4 border-t border-ink-mid pt-4">
                    <div className="grid gap-3 lg:grid-cols-5">
                      {REQUIRED_DOCUMENTS.map((required) => {
                        const doc = docs.find((item) => (item.document_type ?? item.category) === required.key);
                        const status = doc?.status ?? doc?.review_status ?? "pending_review";
                        const documentId = doc?.document_id ?? doc?.id;
                        return (
                          <div key={required.key} className="border border-ink-mid bg-ink p-3">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold">{required.label}</p>
                              <span className={`shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase ${docStatusClass(status)}`}>
                                {doc ? status.replace("_", " ") : "missing"}
                              </span>
                            </div>
                            <p className="mt-2 min-h-8 text-xs text-slate-light">
                              {doc ? textValue(doc.file_name ?? doc.title) : "No file uploaded."}
                            </p>
                            {doc?.review_notes && <p className="mt-2 text-xs text-amber-300">{doc.review_notes}</p>}
                            {doc && documentId && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void viewDocument(row.id, documentId)}
                                  className="inline-flex h-8 items-center gap-1 border border-ink-mid px-2 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper"
                                >
                                  <FileText className="h-3 w-3" />
                                  View
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void decideDocument(row.id, documentId, "verified")}
                                  disabled={busyId === documentId}
                                  className="inline-flex h-8 items-center gap-1 bg-emerald-600 px-2 font-mono text-[10px] uppercase text-white disabled:opacity-50"
                                >
                                  <ShieldCheck className="h-3 w-3" />
                                  Verify
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void decideDocument(row.id, documentId, "needs_update")}
                                  disabled={busyId === documentId}
                                  className="inline-flex h-8 items-center gap-1 border border-amber-500/40 px-2 font-mono text-[10px] uppercase text-amber-300 disabled:opacity-50"
                                >
                                  <ShieldAlert className="h-3 w-3" />
                                  Update
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {selectedId && (
        <VendorReviewModal
          detail={detail}
          loading={detailLoading}
          busyId={busyId}
          onClose={() => {
            setSelectedId(null);
            setDetail(null);
          }}
          onRunSystemCheck={() => void runSystemCheck(selectedId)}
          onApprove={() => void approve(selectedId)}
          onAcceptWithGaps={() => void acceptWithGaps(selectedId)}
          onReject={() => setRejectingId(selectedId)}
          onDecideDocument={(documentId: string, status: SupplierComplianceDocumentStatus) => void decideDocument(selectedId, documentId, status)}
          onViewDocument={(documentId: string) => void viewDocument(selectedId, documentId)}
        />
      )}
    </div>
    </>
  );
}

function VendorReviewModal({
  detail,
  loading,
  busyId,
  onClose,
  onRunSystemCheck,
  onApprove,
  onAcceptWithGaps,
  onReject,
  onDecideDocument,
  onViewDocument,
}: {
  detail: HrVendorVerificationDetail | null;
  loading: boolean;
  busyId: string | null;
  onClose: () => void;
  onRunSystemCheck: () => void;
  onApprove: () => void;
  onAcceptWithGaps: () => void;
  onReject: () => void;
  onDecideDocument: (documentId: string, status: SupplierComplianceDocumentStatus) => void;
  onViewDocument: (documentId: string) => void;
}) {
  const vendor = detail?.vendor;
  const docs = detail?.documents ?? [];
  const readyForDecision = vendor?.verification_stage === "system_verified";
  const acceptedWithGaps = Boolean(vendor?.onboarding_bypass_enabled);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-6xl overflow-hidden border border-ink-mid bg-ink shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Vendor review</p>
            <h3 className="mt-1 text-lg font-semibold">{textValue(vendor?.name, "Loading vendor...")}</h3>
          </div>
          <button type="button" onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper">
            <X className="h-5 w-5" />
          </button>
        </header>

        {loading ? (
          <div className="flex h-72 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-signal" />
          </div>
        ) : (
          <div className="grid max-h-[72vh] overflow-y-auto lg:grid-cols-[0.9fr_1.1fr]">
            <section className="border-b border-ink-mid p-4 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between">
                <h4 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">Filled profile fields</h4>
                <span className="border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase text-slate-light">
                  {textValue(vendor?.verification_stage, "incomplete").replace("_", " ")}
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {(detail?.filled_fields ?? []).map((field) => (
                  <div key={field.key} className="border border-ink-mid bg-ink-light p-3">
                    <p className="font-mono text-[10px] uppercase text-slate-light">{field.label}</p>
                    <p className="mt-1 break-words text-sm text-paper">{textValue(field.value)}</p>
                  </div>
                ))}
              </div>
              {vendor?.system_verification_notes && (
                <p className="mt-4 border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-200">
                  {vendor.system_verification_notes}
                </p>
              )}
              {acceptedWithGaps && (
                <p className="mt-4 border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-200">
                  {vendor?.onboarding_bypass_message || "Accepted with onboarding gaps. Complete onboarding properly before relying on this vendor as fully compliant."}
                </p>
              )}
            </section>

            <section className="p-4">
              <div className="flex items-center justify-between">
                <h4 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">Uploaded compliance documents</h4>
                <span className="font-mono text-[10px] uppercase text-slate-light">{docs.length}/5 uploaded</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {REQUIRED_DOCUMENTS.map((required) => {
                  const doc = docs.find((item) => (item.document_type ?? item.category) === required.key);
                  const status = doc?.status ?? doc?.review_status ?? "pending_review";
                  const documentId = doc?.document_id ?? doc?.id;
                  return (
                    <div key={required.key} className="border border-ink-mid bg-ink-light p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold">{required.label}</p>
                        <span className={`shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase ${docStatusClass(status)}`}>
                          {doc ? status.replace("_", " ") : "missing"}
                        </span>
                      </div>
                      <p className="mt-2 min-h-8 text-xs text-slate-light">
                        {doc ? textValue(doc.file_name ?? doc.title) : "No file uploaded."}
                      </p>
                      {doc?.review_notes && <p className="mt-2 text-xs text-amber-300">{doc.review_notes}</p>}
                      {doc && documentId && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => onViewDocument(documentId)} className="inline-flex h-8 items-center gap-1 border border-ink-mid px-2 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper">
                            <FileText className="h-3 w-3" />
                            View
                          </button>
                          <button type="button" onClick={() => onDecideDocument(documentId, "verified")} disabled={busyId === documentId} className="inline-flex h-8 items-center gap-1 bg-emerald-600 px-2 font-mono text-[10px] uppercase text-white disabled:opacity-50">
                            <ShieldCheck className="h-3 w-3" />
                            Verify
                          </button>
                          <button type="button" onClick={() => onDecideDocument(documentId, "needs_update")} disabled={busyId === documentId} className="inline-flex h-8 items-center gap-1 border border-amber-500/40 px-2 font-mono text-[10px] uppercase text-amber-300 disabled:opacity-50">
                            <ShieldAlert className="h-3 w-3" />
                            Update
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        <footer className="flex flex-wrap justify-end gap-2 border-t border-ink-mid p-4">
          <button type="button" onClick={onRunSystemCheck} className="inline-flex h-9 items-center gap-2 border border-signal/40 px-3 font-mono text-xs uppercase tracking-widest text-signal">
            <ScanSearch className="h-4 w-4" />
            Run System Check
          </button>
          {readyForDecision && (
            <button type="button" onClick={onApprove} className="inline-flex h-9 items-center gap-2 bg-emerald-600 px-3 font-mono text-xs uppercase tracking-widest text-white">
              <ShieldCheck className="h-4 w-4" />
              Approve
            </button>
          )}
          {!readyForDecision && !acceptedWithGaps && (
            <button type="button" onClick={onAcceptWithGaps} className="inline-flex h-9 items-center gap-2 border border-amber-500/50 px-3 font-mono text-xs uppercase tracking-widest text-amber-200">
              <BadgeCheck className="h-4 w-4" />
              Accept
            </button>
          )}
          <button type="button" onClick={onReject} className="inline-flex h-9 items-center gap-2 border border-red-500/40 px-3 font-mono text-xs uppercase tracking-widest text-red-300">
            <XCircle className="h-4 w-4" />
            Reject
          </button>
        </footer>
      </div>
    </div>
  );
}
