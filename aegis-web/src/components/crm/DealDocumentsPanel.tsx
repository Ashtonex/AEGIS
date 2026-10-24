"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Calculator, CheckCircle2, ExternalLink, FileSpreadsheet, FileText, History, Loader2, Send, UploadCloud, X } from "lucide-react";

import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { createDocument, linkDocument } from "@/lib/api";
import {
  findSimilarPastBoqLines,
  getQuotation,
  getQuotationSourceLookup,
  importBoqFile,
  recordClientQuotation,
} from "@/lib/api/quotations";
import { supabase } from "@/lib/supabase";

const BOQ_ACCEPT = ".xlsx,.xlsm,.xltx,.xls,.csv,.tsv";
const QUOTE_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg";

const APPROVAL_LABEL: Record<string, { label: string; tone: string }> = {
  pending_review: { label: "Awaiting green light", tone: "text-amber-200 border-amber-400/30" },
  approved: { label: "Green-lit for production", tone: "text-emerald-300 border-emerald-500/30" },
  changes_requested: { label: "Changes requested", tone: "text-amber-300 border-amber-500/30" },
  rejected: { label: "Rejected", tone: "text-red-300 border-red-500/30" },
};

interface DealQuoteState {
  quotationId: string | null;
  status: string | null;
  approval: Record<string, any> | null;
  boqFile: string | null;
  lineCount: number;
  clientCopy: Record<string, any> | null;
}

interface BoqImportOutcome {
  quotationId: string | null;
  lines: number;
  sections: number;
  warnings: string[];
  pastMatches: number;
  libraryLines: number;
}

function message(reason: unknown, fallback: string) {
  const text = reason instanceof Error ? reason.message : String(reason ?? "");
  return text || fallback;
}

function plusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Stores the file in the private documents bucket and registers it as a
 * core.documents row linked to the deal under `linkRole`. */
async function storeDealDocument(
  file: File,
  opportunityId: string,
  category: string,
  linkRole: string,
): Promise<string> {
  const ext = file.name.split(".").pop();
  const storagePath = `portal-uploads/${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext ? `.${ext}` : ""}`;
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, file, { cacheControl: "3600", upsert: false });
  if (uploadError) throw uploadError;
  const created = await createDocument({
    title: file.name,
    category,
    file_name: file.name,
    file_size_bytes: file.size,
    storage_path: storagePath,
    mime_type: file.type || undefined,
  });
  const docId = created.data?.id;
  if (!created.success || !docId) throw new Error("The file uploaded but could not be registered as a document.");
  const linked = await linkDocument(docId, { entity_type: "opportunity", entity_id: opportunityId, link_role: linkRole });
  if (!linked.success) throw new Error("The document was stored but could not be attached to this deal.");
  return docId;
}

/**
 * The opportunity drawer's documents block. Three distinct ways in:
 *  - Upload BOQ: the workbook is read by the Quotations & Estimations engine,
 *    saved as this deal's estimate (editable in the builder) and held at
 *    "awaiting green light" until someone approves it for production -
 *    approval is what adds its lines to AEGIS's rate library.
 *  - Upload Quotation: the client copy that went out; recording it marks the
 *    quote sent, moves an early-stage deal to Quotation, closes the
 *    quote-prep tasks and schedules the client follow-up.
 *  - General documents: everything else, as before.
 */
export function DealDocumentsPanel({
  opportunityId,
  dealValue,
  dealClosed = false,
  onDealChanged,
}: {
  opportunityId: string;
  dealValue?: number | null;
  /** Won/lost deals can't send a new client quotation (the API refuses). */
  dealClosed?: boolean;
  onDealChanged?: () => void | Promise<void>;
}) {
  const [quote, setQuote] = useState<DealQuoteState | null>(null);
  const [mode, setMode] = useState<"none" | "boq" | "quote">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boqOutcome, setBoqOutcome] = useState<BoqImportOutcome | null>(null);
  const [quoteNotice, setQuoteNotice] = useState<string | null>(null);
  const [docsRefresh, setDocsRefresh] = useState(0);
  const boqInput = useRef<HTMLInputElement>(null);
  const [quoteForm, setQuoteForm] = useState({
    file: null as File | null,
    amount: dealValue ? String(dealValue) : "",
    validUntil: plusDays(30),
    followUp: plusDays(3),
    notes: "",
  });

  const loadQuote = useCallback(async () => {
    try {
      const lookup = await getQuotationSourceLookup("opportunity", opportunityId);
      const qid = lookup.data?.existing_quotation_id;
      if (!qid) {
        setQuote({ quotationId: null, status: null, approval: null, boqFile: null, lineCount: 0, clientCopy: null });
        return;
      }
      const res = await getQuotation(qid);
      const q = res.data || {};
      const meta = (typeof q.metadata === "string" ? JSON.parse(q.metadata) : q.metadata) || {};
      setQuote({
        quotationId: qid,
        status: q.status || null,
        approval: meta.boq_approval || null,
        boqFile: meta.uploaded_boq?.filename || null,
        lineCount: Array.isArray(meta.items) ? meta.items.length : 0,
        clientCopy: meta.client_copy || null,
      });
    } catch {
      setQuote(null);
    }
  }, [opportunityId]);

  useEffect(() => {
    setMode("none");
    setBoqOutcome(null);
    setQuoteNotice(null);
    setError(null);
    void loadQuote();
  }, [loadQuote]);

  useEffect(() => {
    setQuoteForm((f) => ({ ...f, amount: dealValue ? String(dealValue) : f.amount }));
  }, [dealValue]);

  const handleBoqFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setBoqOutcome(null);
    try {
      const documentId = await storeDealDocument(file, opportunityId, "boq", "boq_source");
      const res = await importBoqFile(file, { source_type: "opportunity", source_id: opportunityId, document_id: documentId });
      const data = res.data;
      if (!data || !Array.isArray(data.items) || data.items.length === 0) {
        throw new Error(data?.warnings?.[0] || "No BOQ lines could be read from this workbook. Check it has description / unit / qty / rate columns.");
      }
      const quotationId = (data.linked?.quotation_id as string) || null;
      const sections = new Set(data.items.map((i: any) => i.section || "Measured Works")).size;
      let pastMatches = 0;
      let libraryLines = 0;
      try {
        const sample = data.items.slice(0, 150).map((i: any) => ({ description: i.description, unit: i.unit }));
        const similar = await findSimilarPastBoqLines(sample, quotationId, 1);
        pastMatches = similar.data?.results.filter((r) => r.matches.length > 0).length ?? 0;
        libraryLines = similar.data?.library.lines ?? 0;
      } catch {
        // The library lookup is a bonus - the import itself already succeeded.
      }
      setBoqOutcome({
        quotationId,
        lines: data.items.length,
        sections,
        warnings: data.warnings || [],
        pastMatches,
        libraryLines,
      });
      setDocsRefresh((n) => n + 1);
      await loadQuote();
      await onDealChanged?.();
    } catch (e) {
      setError(message(e, "The BOQ could not be imported."));
    } finally {
      setBusy(false);
      if (boqInput.current) boqInput.current.value = "";
    }
  };

  const handleQuoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quoteForm.file) return;
    setBusy(true);
    setError(null);
    setQuoteNotice(null);
    try {
      const documentId = await storeDealDocument(quoteForm.file, opportunityId, "quotation", "client_quotation");
      const amount = Number(quoteForm.amount);
      const res = await recordClientQuotation(opportunityId, {
        document_id: documentId,
        quote_amount: amount > 0 ? amount : undefined,
        valid_until: quoteForm.validUntil || undefined,
        follow_up_date: quoteForm.followUp || undefined,
        notes: quoteForm.notes.trim() || undefined,
      });
      if (!res.success) throw new Error(res.message || "The quotation could not be recorded.");
      const parts = [`Client quotation recorded; follow-up scheduled for ${res.data?.follow_up_date}.`];
      if (res.data?.moved_to_quotation) parts.push("Deal moved to Proposal.");
      if (res.data?.tasks_completed) parts.push(`${res.data.tasks_completed} quote-prep task(s) closed.`);
      setQuoteNotice(parts.join(" "));
      setQuoteForm((f) => ({ ...f, file: null, notes: "" }));
      setMode("none");
      setDocsRefresh((n) => n + 1);
      await loadQuote();
      await onDealChanged?.();
    } catch (err) {
      setError(message(err, "The quotation could not be recorded."));
    } finally {
      setBusy(false);
    }
  };

  const approval = quote?.approval?.status ? APPROVAL_LABEL[quote.approval.status] : null;
  const builderHref = quote?.quotationId ? `/dashboard/quotations/builder?edit=${quote.quotationId}` : null;

  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${dealClosed ? "grid-cols-1" : "grid-cols-2"}`}>
        <button
          type="button"
          disabled={busy}
          onClick={() => { setMode("boq"); setError(null); boqInput.current?.click(); }}
          className="flex items-center justify-center gap-1.5 border border-signal/40 bg-signal/5 px-2 py-2.5 font-mono text-[9px] uppercase text-paper hover:bg-signal/15 disabled:opacity-40"
        >
          {busy && mode === "boq" ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3 w-3 text-signal" />}
          Upload BOQ
        </button>
        {!dealClosed && <button
          type="button"
          disabled={busy}
          onClick={() => { setMode(mode === "quote" ? "none" : "quote"); setError(null); }}
          className="flex items-center justify-center gap-1.5 border border-[#D4AF37]/40 bg-[#D4AF37]/5 px-2 py-2.5 font-mono text-[9px] uppercase text-paper hover:bg-[#D4AF37]/15 disabled:opacity-40"
        >
          <Send className="h-3 w-3 text-[#D4AF37]" /> Upload quotation
        </button>}
      </div>
      <input
        ref={boqInput}
        type="file"
        accept={BOQ_ACCEPT}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleBoqFile(f); }}
      />

      {/* Estimate / BOQ status, linked into Quotations & Estimations */}
      {quote?.quotationId && (
        <div className="space-y-2 border border-white/5 bg-black/40 p-3 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase text-slate-light">
              <Calculator className="h-3 w-3" /> Estimate
            </span>
            {approval && (
              <span className={`border px-1.5 py-0.5 font-mono text-[8px] uppercase ${approval.tone}`}>{approval.label}</span>
            )}
          </div>
          <p className="text-paper">
            {quote.boqFile ? <>BOQ <span className="text-slate-light">{quote.boqFile}</span> · </> : null}
            {quote.lineCount > 0
              ? `${quote.lineCount} line${quote.lineCount === 1 ? "" : "s"}`
              : "No BOQ uploaded yet"} · quote {quote.status || "draft"}
          </p>
          {quote.approval?.notes && quote.approval.status !== "approved" && (
            <p className="text-amber-200/90">{quote.approval.notes}</p>
          )}
          {quote.clientCopy && (
            <p className="text-slate-light">
              Client copy <span className="text-paper">{quote.clientCopy.file_name}</span> sent {new Date(quote.clientCopy.sent_at).toLocaleDateString()}
              {quote.clientCopy.follow_up_date ? ` · follow-up ${quote.clientCopy.follow_up_date}` : ""}
            </p>
          )}
          {builderHref && (
            <Link
              href={builderHref}
              className="inline-flex items-center gap-1 font-mono text-[9px] uppercase text-signal hover:underline"
            >
              Open in Quotations & Estimations <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}

      {boqOutcome && (
        <div className="space-y-1.5 border border-emerald-500/20 bg-emerald-950/10 p-3 text-[11px] text-paper">
          <p className="flex items-center gap-1.5 text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> BOQ read: {boqOutcome.lines} lines across {boqOutcome.sections} section{boqOutcome.sections === 1 ? "" : "s"}.
          </p>
          <p className="flex items-center gap-1.5 text-slate-light">
            <History className="h-3.5 w-3.5" />
            {boqOutcome.libraryLines === 0
              ? "No approved past BOQs yet - this one starts the rate library once it is green-lit."
              : `${boqOutcome.pastMatches} line(s) have comparable items in past approved projects.`}
          </p>
          {boqOutcome.warnings.length > 0 && (
            <details className="text-amber-200/90">
              <summary className="cursor-pointer">{boqOutcome.warnings.length} import warning(s)</summary>
              <ul className="mt-1 list-disc pl-4">
                {boqOutcome.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
          <p className="text-slate-light">Review and edit it in the builder, then give it the green light for production.</p>
        </div>
      )}

      {mode === "quote" && !dealClosed && (
        <form onSubmit={handleQuoteSubmit} className="space-y-2 border border-[#D4AF37]/20 bg-black/40 p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase text-[#D4AF37]">Client copy of the quotation</span>
            <button type="button" onClick={() => setMode("none")} className="text-slate-light hover:text-paper"><X className="h-3.5 w-3.5" /></button>
          </div>
          <label className="flex cursor-pointer items-center justify-center gap-2 border border-dashed border-ink-mid px-3 py-3 text-xs text-slate-light hover:border-[#D4AF37] hover:text-paper">
            {quoteForm.file ? <><FileText className="h-4 w-4 text-[#D4AF37]" /> {quoteForm.file.name}</> : <><UploadCloud className="h-4 w-4" /> Choose the quotation sent to the client</>}
            <input
              type="file"
              accept={QUOTE_ACCEPT}
              className="hidden"
              onChange={(e) => setQuoteForm((f) => ({ ...f, file: e.target.files?.[0] || null }))}
            />
          </label>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <label className="space-y-1">
              <span className="font-mono uppercase text-slate-light">Amount</span>
              <input type="number" min="0" step="0.01" value={quoteForm.amount} onChange={(e) => setQuoteForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full border border-white/10 bg-ink px-2 py-1.5 text-xs text-paper" />
            </label>
            <label className="space-y-1">
              <span className="font-mono uppercase text-slate-light">Valid until</span>
              <input type="date" value={quoteForm.validUntil} onChange={(e) => setQuoteForm((f) => ({ ...f, validUntil: e.target.value }))}
                className="w-full border border-white/10 bg-ink px-2 py-1.5 text-xs text-paper" />
            </label>
            <label className="space-y-1">
              <span className="font-mono uppercase text-slate-light">Follow up</span>
              <input type="date" required value={quoteForm.followUp} onChange={(e) => setQuoteForm((f) => ({ ...f, followUp: e.target.value }))}
                className="w-full border border-white/10 bg-ink px-2 py-1.5 text-xs text-paper" />
            </label>
          </div>
          <textarea
            rows={2}
            value={quoteForm.notes}
            onChange={(e) => setQuoteForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Who it went to, how, anything agreed (optional)"
            className="w-full border border-white/10 bg-ink px-2 py-1.5 text-xs text-paper"
          />
          <p className="text-[10px] text-slate-light">
            Recording this marks the quote sent, moves an early deal to Proposal, closes quote-prep tasks, logs the activity and schedules the follow-up.
          </p>
          <button
            type="submit"
            disabled={busy || !quoteForm.file}
            className="flex w-full items-center justify-center gap-1.5 bg-[#D4AF37] px-2 py-2 font-mono text-[9px] font-bold uppercase text-black disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Record quotation sent
          </button>
        </form>
      )}

      {quoteNotice && <p className="text-xs text-emerald-400">{quoteNotice}</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}

      <div className="space-y-2 border-t border-white/5 pt-3">
        <span className="font-mono text-[9px] uppercase text-slate-light">General documents</span>
        <EntityDocumentsPanel entityType="opportunity" entityId={opportunityId} refreshKey={docsRefresh} />
      </div>
    </div>
  );
}
