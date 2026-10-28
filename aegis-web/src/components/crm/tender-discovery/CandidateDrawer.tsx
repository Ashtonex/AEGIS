"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, FileText, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { createDocument, getDocumentSignedUrl } from "@/lib/api";
import {
  attachDiscoveryDocument,
  getDiscoveryCandidate,
  importDiscoveryCandidates,
  recheckDiscoveryCandidate,
  reviewDiscoveryCandidate,
  type CandidateDetail,
  type FieldEvidence,
  type ImportResult,
} from "@/lib/api/tender-discovery";
import { BAND_TONE, Chip, READINESS_LABEL, btn, errorMessage, fmtHarare, input } from "./shared";
import { ChangeList } from "./ChangesPanel";

// Fields shown in the evidence table, in reading order.
const FIELD_ROWS: { key: string; label: string; editable?: boolean; kind?: "datetime" }[] = [
  { key: "official_reference", label: "Official reference", editable: true },
  { key: "title", label: "Title", editable: true },
  { key: "description", label: "Description", editable: true },
  { key: "procuring_entity", label: "Procuring entity", editable: true },
  { key: "procurement_method", label: "Procurement method", editable: true },
  { key: "procurement_class", label: "Class of procurement" },
  { key: "required_categories", label: "Required supplier categories" },
  { key: "category_codes", label: "Category codes" },
  { key: "project_location", label: "Project location", editable: true },
  { key: "published_at", label: "Published" },
  { key: "closing_at", label: "Closing", editable: true, kind: "datetime" },
  { key: "site_visit", label: "Site visit / pre-bid meeting", editable: true },
  { key: "clarification_deadline", label: "Clarification deadline", editable: true },
  { key: "bid_security", label: "Bid security", editable: true },
  { key: "required_bid_documents", label: "Required bid documents", editable: true },
  { key: "bid_form_fee", label: "Bid form fee" },
  { key: "bid_validity_days", label: "Bid validity (days)" },
  { key: "delivery_period", label: "Delivery / contract period" },
  { key: "estimated_value", label: "Estimated value (only if published)", editable: true },
  { key: "official_contact", label: "Official contact", editable: true },
  { key: "addenda_count", label: "Addenda published" },
  { key: "notice_status", label: "Notice status" },
  { key: "board_status", label: "Bulletin Board scope" },
  { key: "entity_address", label: "Entity address" },
];

const ALLOWED_UPLOADS = [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".png", ".jpg", ".jpeg"];

function display(value: any): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") {
    if ("at" in value || "date" in value) {
      if (value.at) return `${fmtHarare(value.at)} Africa/Harare`;
      if (value.date) return `${value.date} (time not stated)`;
      return "";
    }
    if ("path" in value) return value.label || value.path;
    return JSON.stringify(value);
  }
  return String(value);
}

function toHarareLocalInput(value: any): string {
  const at = value?.at;
  if (!at) return "";
  const d = new Date(at);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function CandidateDrawer({
  candidateId, canImport, canRun, users, onClose, onChanged,
}: {
  candidateId: string;
  canImport: boolean;
  canRun: boolean;
  users: { id: string; full_name: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDiscoveryCandidate(candidateId);
      setData(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err, "Could not load this notice."));
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<{ message?: string } | any>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      if (res?.message) setNotice(res.message);
      await load();
      onChanged();
      return res;
    } catch (err) {
      setError(errorMessage(err, "The action failed - nothing was changed."));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const saveCorrection = (key: string, kind?: string) => act("correct", () => reviewDiscoveryCandidate(candidateId, {
    corrections: { [key]: kind === "datetime" ? (draft || null) : (draft.trim() || null) },
    correction_notes: draftNote ? { [key]: draftNote } : undefined,
  })).then(() => setEditing(null));

  const runImport = async (extra: { link_to_tender_id?: string; create_new?: boolean } = {}) => {
    const res = await act("import", () => importDiscoveryCandidates({ items: [{ candidate_id: candidateId, ...extra }] }));
    if (res?.data?.[0]) setImportResult(res.data[0]);
  };

  const upload = async (file: File, candidateDocumentId?: string) => {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_UPLOADS.includes(ext)) { setError(`'${ext}' files are not accepted. Upload PDF, Word, Excel or an image.`); return; }
    if (file.size > 30 * 1024 * 1024) { setError("File is larger than 30 MB."); return; }
    await act("upload", async () => {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
      const path = `egp/${candidateId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;
      const doc = await createDocument({
        title: `e-GP ${data?.official_reference || data?.source_notice_id}: ${file.name}`,
        category: "tender", tender_id: data?.tender_id || undefined, file_name: safeName,
        file_size_bytes: file.size, storage_path: path, mime_type: file.type || undefined,
      });
      const documentId = (doc.data as any)?.id;
      if (!doc.success || !documentId) throw new Error("Document record was not created.");
      return attachDiscoveryDocument(candidateId, { document_id: documentId, candidate_document_id: candidateDocumentId, label: file.name });
    });
  };

  const preview = async (documentId: string) => {
    try {
      const res = await getDocumentSignedUrl(documentId);
      if (res.data?.url) window.open(res.data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(errorMessage(err, "Could not open this document."));
    }
  };

  const fields = data?.fields || {};
  const corrections = data?.corrections || {};

  return (
    // z-[70] like CommercialWorkspaceModal: above the bottom nav (40) and the release banner (60).
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/60" role="dialog" aria-modal="true" aria-label="Notice review">
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-[#070707] text-paper">
        <div className="flex items-start justify-between gap-3 border-b border-white/5 p-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate-light">e-GP notice {data?.source_notice_id}</p>
            <h2 className="mt-1 text-base font-semibold">{data?.title || (loading ? "Loading…" : "(no title captured)")}</h2>
          </div>
          <button onClick={onClose} className="rounded-sm p-1 text-slate-light hover:bg-white/5" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {loading && !data ? (
            <div className="flex h-60 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#D4AF37]" /></div>
          ) : !data ? (
            <p className="text-rose-300">{error}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.relevance_band && <Chip className={BAND_TONE[data.relevance_band]}>Relevance: {data.relevance_band} · {data.relevance_score}</Chip>}
                <Chip className={READINESS_LABEL[data.readiness].tone}>Readiness: {READINESS_LABEL[data.readiness].label}</Chip>
                <Chip className="border-white/10 text-slate-light">Extraction confidence: {data.extraction_confidence}</Chip>
                <Chip className="border-white/10 text-slate-light">Notice page: {data.detail_status.replace("_", " ")}</Chip>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={data.notice_url} target="_blank" rel="noopener noreferrer" className={btn.ghost}>Open official notice <ExternalLink className="h-3.5 w-3.5" /></a>
                {canRun && (
                  <button className={btn.ghost} disabled={!!busy} onClick={() => act("recheck", () => recheckDiscoveryCandidate(candidateId))} data-testid="recheck">
                    {busy === "recheck" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Recheck notice
                  </button>
                )}
                {data.tender_id && <Link href={`/dashboard/crm/tenders/${data.tender_id}`} className={btn.ghost}>Open saved tender →</Link>}
              </div>
              <p className="text-xs text-slate">
                First seen {fmtHarare(data.first_seen_at)} · last seen on board {fmtHarare(data.last_seen_at)} · notice page last read {fmtHarare(data.last_checked_at)}
                {data.detail_error ? ` · last read error: ${data.detail_error}` : ""}
              </p>
              {error && <p className="flex items-start gap-1.5 text-xs text-rose-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}
              {notice && <p className="text-xs text-emerald-300">{notice}</p>}

              {data.conflicts.length > 0 && (
                <section className="rounded-sm border border-rose-400/30 bg-rose-400/5 p-3">
                  <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-rose-300">Conflicting source values - both kept</h3>
                  {data.conflicts.map((c) => (
                    <div key={c.field} className="mb-2 text-xs">
                      <p className="font-medium">{c.field.replace(/_/g, " ")}</p>
                      {c.values.map((v, i) => (
                        <p key={i} className="text-slate-light"><span className="text-paper">{v.raw ?? display(v.value)}</span> — {v.source.replace("_", " ")} <a className="text-[#D4AF37]" href={v.source_url} target="_blank" rel="noopener noreferrer">source</a></p>
                      ))}
                    </div>
                  ))}
                </section>
              )}

              <section>
                <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-light">Why this score</h3>
                <ul className="space-y-1 text-xs">
                  {data.match_reasons.map((r, i) => (
                    <li key={i} className="flex gap-2"><span className={`w-10 shrink-0 text-right font-mono ${r.points > 0 ? "text-emerald-300" : r.points < 0 ? "text-rose-300" : "text-slate"}`}>{r.points > 0 ? "+" : ""}{r.points}</span><span className="text-slate-light">{r.detail}</span></li>
                  ))}
                </ul>
                {data.missing_evidence.length > 0 && (
                  <>
                    <h3 className="mb-1 mt-3 font-mono text-[10px] uppercase tracking-widest text-amber-300">Missing evidence / uncertainties</h3>
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-200/90">{data.missing_evidence.map((m, i) => <li key={i}>{m}</li>)}</ul>
                  </>
                )}
                {data.unresolved_questions.length > 0 && (
                  <details className="mt-2 text-xs"><summary className="cursor-pointer text-slate-light">{data.unresolved_questions.length} open question(s) from extraction</summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-light">{data.unresolved_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                  </details>
                )}
              </section>

              <section>
                <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-light">Captured fields and evidence</h3>
                <div className="divide-y divide-white/5 rounded-sm border border-white/5">
                  {FIELD_ROWS.map((row) => {
                    const ev: FieldEvidence | undefined = fields[row.key];
                    const correction = corrections[row.key];
                    const value = display(ev?.value);
                    return (
                      <div key={row.key} className="grid gap-1 p-2.5 sm:grid-cols-[180px,1fr]">
                        <p className="text-xs text-slate">{row.label}</p>
                        <div className="min-w-0 text-xs">
                          {correction && (
                            <p className="text-sky-200">Corrected: {display(correction.value)} <span className="text-slate">({fmtHarare(correction.at)}{correction.note ? ` · ${correction.note}` : ""})</span></p>
                          )}
                          {value ? (
                            <p className={correction ? "text-slate line-through" : "text-paper"}>{value}</p>
                          ) : (
                            <p className="italic text-amber-300/80">Unknown - not published on the captured source</p>
                          )}
                          {ev && (
                            <details className="mt-0.5">
                              <summary className="cursor-pointer text-[11px] text-slate">{ev.section} · {ev.confidence} confidence · {fmtHarare(ev.extracted_at)}</summary>
                              {ev.excerpt && <blockquote className="mt-1 border-l border-white/10 pl-2 text-[11px] text-slate-light">“{ev.excerpt}”</blockquote>}
                              <a href={ev.source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#D4AF37] hover:underline">{ev.source_url}</a>
                            </details>
                          )}
                          {canImport && row.editable && data.review_status !== "imported" && (
                            editing === row.key ? (
                              <div className="mt-2 space-y-1.5">
                                <input className={input} type={row.kind === "datetime" ? "datetime-local" : "text"} value={draft} onChange={(e) => setDraft(e.target.value)}
                                       placeholder={row.kind === "datetime" ? "" : "Leave empty to clear the correction"} />
                                {row.kind === "datetime" && <p className="text-[11px] text-slate">Entered as Africa/Harare time.</p>}
                                <input className={input} value={draftNote} onChange={(e) => setDraftNote(e.target.value)} placeholder="Where this comes from (document, page)" />
                                <div className="flex gap-2">
                                  <button className={btn.primary} disabled={!!busy} onClick={() => saveCorrection(row.key, row.kind)}>Save</button>
                                  <button className={btn.ghost} onClick={() => setEditing(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button className="mt-1 text-[11px] text-[#D4AF37] hover:underline"
                                      onClick={() => { setEditing(row.key); setDraftNote(""); setDraft(row.kind === "datetime" ? toHarareLocalInput(correction?.value ?? ev?.value) : display(correction?.value ?? ev?.value)); }}>
                                Correct
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-light">Official documents</h3>
                <p className="mb-2 text-xs text-slate-light">
                  e-GP serves bidding documents only to signed-in suppliers. <a className="text-[#D4AF37] hover:underline" href={data.documents_access.login_url} target="_blank" rel="noopener noreferrer">Sign in on the official portal</a>, download them, then attach them here. A document counts as reviewed only when its text was extracted.
                </p>
                <ul className="space-y-2">
                  {data.documents.map((doc) => (
                    <li key={doc.id} className="rounded-sm border border-white/5 p-2.5 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-slate" />
                        <span>{doc.label}</span>
                        <Chip className="border-white/10 text-slate-light">{doc.access.replace("_", " ")}</Chip>
                        {doc.document_id || doc.restricted ? (
                          <Chip className={doc.extraction_status === "extracted" ? "border-emerald-400/30 text-emerald-300" : "border-amber-400/30 text-amber-300"}>
                            {doc.restricted ? "restricted" : doc.extraction_status === "extracted" ? "text extracted" :
                              doc.extraction_status === "no_text_found" ? "no text (scan? OCR not available)" :
                              doc.extraction_status === "unsupported_format" ? "unsupported format - not reviewed" :
                              doc.extraction_status === "failed" ? "extraction failed - not reviewed" : "extraction pending"}
                          </Chip>
                        ) : <Chip className="border-amber-400/30 text-amber-300">not obtained</Chip>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-3">
                        {doc.official_url && <a href={doc.official_url} target="_blank" rel="noopener noreferrer" className="text-[#D4AF37] hover:underline">Official link (login required)</a>}
                        {doc.document_id && <button className="text-emerald-300 hover:underline" onClick={() => preview(doc.document_id!)}>Preview stored copy</button>}
                        {canImport && !doc.document_id && !doc.restricted && (
                          <label className="inline-flex cursor-pointer items-center gap-1 text-[#D4AF37] hover:underline">
                            <Upload className="h-3 w-3" /> Attach downloaded file
                            <input type="file" className="hidden" accept={ALLOWED_UPLOADS.join(",")} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], doc.id)} />
                          </label>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {canImport && (
                  <label className={`${btn.ghost} mt-2 cursor-pointer`}>
                    {busy === "upload" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Attach another official document
                    <input type="file" className="hidden" accept={ALLOWED_UPLOADS.join(",")} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  </label>
                )}
              </section>

              {data.changes.length > 0 && (
                <section>
                  <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-light">Changes and addenda</h3>
                  <ChangeList changes={data.changes} canDecide={canImport} onDecided={() => { void load(); onChanged(); }} />
                </section>
              )}

              <section>
                <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-light">Version history</h3>
                <ul className="space-y-1 text-xs text-slate-light">
                  {data.snapshots.length === 0 && <li>No notice-page version captured yet.</li>}
                  {data.snapshots.map((s) => (
                    <li key={s.id}>{fmtHarare(s.captured_at)} · {s.capture_kind}{s.captured_by_name ? ` by ${s.captured_by_name}` : ""} · <span className="font-mono">{s.content_hash.slice(0, 10)}</span></li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>

        {data && canImport && data.review_status !== "imported" && (
          <ReviewFooter data={data} users={users} busy={busy} rejectNote={rejectNote} setRejectNote={setRejectNote}
                        importResult={importResult}
                        onSave={(body) => act("review", () => reviewDiscoveryCandidate(candidateId, body))}
                        onImport={runImport} />
        )}
        {data?.review_status === "imported" && data.tender && (
          <div className="border-t border-white/5 p-4 text-sm">
            <p className="text-emerald-300">Imported as <Link className="underline" href={`/dashboard/crm/tenders/${data.tender.id}`}>{data.tender.tender_name}</Link> ({data.tender.stage}).</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewFooter({ data, users, busy, rejectNote, setRejectNote, importResult, onSave, onImport }: {
  data: CandidateDetail;
  users: { id: string; full_name: string }[];
  busy: string | null;
  rejectNote: string;
  setRejectNote: (v: string) => void;
  importResult: ImportResult | null;
  onSave: (body: Record<string, any>) => Promise<any>;
  onImport: (extra?: { link_to_tender_id?: string; create_new?: boolean }) => Promise<void>;
}) {
  const duplicates = importResult?.possible_duplicates || data.possible_duplicates.map((d) => ({ ...d, url: `/dashboard/crm/tenders/${d.id}` }));
  return (
    <div className="space-y-3 border-t border-white/5 bg-[#0A0A0A] p-4 text-xs">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-slate-light">Responsible person</span>
          <select className={input} value={data.responsible_user_id || ""} onChange={(e) => onSave({ responsible_user_id: e.target.value || null })} data-testid="responsible-select">
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-slate-light">Internal review date</span>
          <input className={input} type="date" value={data.internal_review_date || ""} onChange={(e) => onSave({ internal_review_date: e.target.value || null })} />
        </label>
      </div>
      {duplicates.length > 0 && (
        <div className="rounded-sm border border-amber-400/30 bg-amber-400/5 p-2.5">
          <p className="mb-1 text-amber-300">Possible existing tender - choose instead of merging silently:</p>
          {duplicates.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 py-0.5">
              <Link href={d.url} className="text-paper underline">{d.tender_name}</Link><span className="text-slate">{d.bid_number || ""}</span>
              <button className="text-[#D4AF37] hover:underline" disabled={!!busy} onClick={() => onImport({ link_to_tender_id: d.id })}>Link to this tender</button>
            </div>
          ))}
          <button className="mt-1 text-[#D4AF37] hover:underline" disabled={!!busy} onClick={() => onImport({ create_new: true })}>It is different - import as a new tender</button>
        </div>
      )}
      {importResult && importResult.status !== "needs_dedupe_review" && (
        <p className={importResult.status === "failed" ? "text-rose-300" : "text-emerald-300"}>
          {importResult.message} {importResult.tender_url && <Link href={importResult.tender_url} className="underline">Open saved tender →</Link>}
        </p>
      )}
      <input className={input} placeholder="Reason (required to reject)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button className={btn.primary} disabled={!!busy} onClick={() => onImport()} data-testid="import-one">
          {busy === "import" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Import into pipeline
        </button>
        <button className={btn.ghost} disabled={!!busy} onClick={() => onSave({ review_status: "deferred", review_note: rejectNote || null })}>Defer</button>
        <button className={btn.danger} disabled={!!busy || !rejectNote.trim()} onClick={() => onSave({ review_status: "rejected", review_note: rejectNote })}>Reject</button>
        {data.review_status !== "new" && <button className={btn.ghost} disabled={!!busy} onClick={() => onSave({ review_status: "new" })}>Back to queue</button>}
      </div>
    </div>
  );
}
