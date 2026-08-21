"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ScanSearch, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";

import { decideHrVendorVerification, getHrVendorVerificationQueue, runHrVendorSystemCheck } from "@/lib/api";

type RecordData = Record<string, any>;

function textValue(value: unknown, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function dateValue(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function VendorVerificationPanel() {
  const [queue, setQueue] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHrVendorVerificationQueue();
      setQueue(res.data ?? []);
    } catch {
      setNotice("Vendor verification queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runSystemCheck(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await runHrVendorSystemCheck(id);
      const stage = res.data?.verification_stage;
      setNotice(
        stage === "system_verified"
          ? "Passed automated checks - ready for HR review."
          : "Still incomplete - see the notes below for what's missing."
      );
      await load();
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
    } catch {
      setNotice("Could not approve this vendor profile.");
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
    } catch {
      setNotice("Could not reject this vendor profile.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Vendor onboarding</p>
          <h2 className="mt-1 text-xl font-semibold">Verification queue</h2>
          <p className="mt-1 text-sm text-slate-light">
            Every supplier/subcontractor not yet fully verified - including ones added directly by staff, which start
            here and need a system check before HR can approve them.
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
            return (
            <div key={row.id} className="p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
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
                  {!readyForDecision && row.system_verification_notes && (
                    <p className="mt-1 text-xs text-amber-300">{row.system_verification_notes}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
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
                    <button
                      type="button"
                      onClick={() => void runSystemCheck(row.id)}
                      disabled={busyId === row.id}
                      className="inline-flex h-9 items-center gap-2 border border-signal/40 px-3 font-mono text-xs uppercase tracking-widest text-signal hover:bg-signal/10 disabled:opacity-50"
                    >
                      {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                      Run System Check
                    </button>
                  )}
                </div>
              </div>
              {rejectingId === row.id && (
                <div className="mt-3 flex flex-col gap-2 border-t border-ink-mid pt-3 sm:flex-row">
                  <input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
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
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
