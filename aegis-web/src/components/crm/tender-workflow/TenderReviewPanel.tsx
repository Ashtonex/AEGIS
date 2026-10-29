"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, CircleDashed, Clock, ExternalLink, FileText, Loader2, MinusCircle, RefreshCw, RotateCcw, Send, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getDocumentSignedUrl } from "@/lib/api";
import {
  collectTenderMaterial, getTenderWorkflow, recordQsDecision, startTenderWorkflow, submitTenderReview, updateReviewItem,
  updateTenderDetails, STATUS_STEPS, type DetailsPatch, type ItemStatus, type ReviewItem, type TenderWorkflowView,
} from "@/lib/api/tender-workflow";
import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { Chip, Panel, btn, errorMessage, fmtHarare, input, relativeDays } from "@/components/crm/tender-discovery/shared";

const SOURCE_LABEL: Record<string, string> = {
  egp_notice: "from e-GP notice", egp_schedule: "from e-GP schedule", reviewer: "entered by reviewer",
};
const SITE_LABEL: Record<string, string> = {
  required: "Compulsory", optional: "Optional", not_required: "Not required", unknown: "Not confirmed",
};
const ACTION_LABEL: Record<string, string> = {
  captured: "Tender captured", review_assigned: "Initial review assigned", review_item_updated: "Checklist updated",
  details_updated: "Details updated", review_submitted: "Review submitted to QS", qs_assigned: "QS assigned",
  returned_for_correction: "Returned for correction", qs_verified: "QS verified - preparation started",
  source_material_collected: "e-GP material collected", blocked_no_reviewers: "Blocked: no reviewers configured",
  blocked_no_qs: "Blocked: no QS configured", reassigned_primary_reviewer: "Primary reviewer changed", reassigned_qs: "QS changed",
};

/** ISO (UTC) -> value for <input type="datetime-local"> in Harare time. */
function toLocalInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}
/** datetime-local (Harare wall clock) -> ISO with +02:00. */
const fromLocalInput = (value: string): string | null => (value ? `${value}:00+02:00` : null);

function VerifiedChip({ status }: { status?: ItemStatus }) {
  if (status === "done") return <Chip className="border-emerald-400/30 text-emerald-300"><CheckCircle2 className="h-3 w-3" />Verified</Chip>;
  if (status === "not_applicable") return <Chip className="border-white/10 text-slate-light">Not applicable</Chip>;
  return <Chip className="border-amber-400/30 text-amber-300"><CircleDashed className="h-3 w-3" />Unverified</Chip>;
}

export function TenderReviewPanel({ tenderId, onChanged }: { tenderId: string; onChanged?: () => void }) {
  const [view, setView] = useState<TenderWorkflowView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [naReason, setNaReason] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [submitNote, setSubmitNote] = useState("");
  const [qsNotes, setQsNotes] = useState("");
  const [reopen, setReopen] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await getTenderWorkflow(tenderId);
      setView(res.data ?? null);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Could not load the review workflow."));
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, action: () => Promise<{ data?: TenderWorkflowView | unknown; message?: string }>, after?: () => void) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    setProblems([]);
    try {
      const res = await action();
      if (res?.data && typeof res.data === "object" && "workflow" in (res.data as object)) setView(res.data as TenderWorkflowView);
      else await load();
      if (res?.message) setNotice(res.message);
      after?.();
      // Only actions that change what the rest of the tender page shows
      // (stage, deadline, bond, site visit) - the page reloads on this.
      if (["details", "submit", "qs", "start"].includes(key)) onChanged?.();
    } catch (e) {
      // FastAPI body {"detail": {"message", "problems"}} lands in ApiError.details.
      const detail = (e as { details?: { detail?: { problems?: string[]; message?: string } } })?.details?.detail;
      if (detail?.problems) {
        setProblems(detail.problems);
        setError(detail.message || "The review is not complete yet.");
      } else {
        setError(errorMessage(e, "That did not work."));
      }
    } finally {
      setBusy(null);
    }
  };

  const status = view?.workflow.status ?? null;
  const t = view?.tender;
  const perms = view?.permissions;
  const material = view?.source_material ?? {};
  const failedOfficial = useMemo(() => (view?.official_documents ?? []).filter((d) => !d.document_id), [view]);

  const beginEdit = () => {
    if (!t) return;
    setDraft({
      submission_deadline: toLocalInput(t.submission_deadline), submission_instructions: t.submission_instructions ?? "",
      clarification_deadline: toLocalInput(t.clarification_deadline), site_visit_status: t.site_visit_status ?? "unknown",
      site_visit_at: toLocalInput(t.site_visit_at), site_visit_location: t.site_visit_location ?? "",
      site_visit_details: t.site_visit_details ?? "", bond_amount: t.bond_amount ? String(t.bond_amount) : "",
      bid_security_currency: t.bid_security_currency ?? "", bid_security_form: t.bid_security_form ?? "",
      bid_security_validity: t.bid_security_validity ?? "", outstanding_notes: t.outstanding_notes ?? "",
    });
    setEditing(true);
  };

  const saveDetails = () => {
    if (!t) return;
    const patch: DetailsPatch = {
      submission_deadline: fromLocalInput(draft.submission_deadline), submission_instructions: draft.submission_instructions || null,
      clarification_deadline: fromLocalInput(draft.clarification_deadline),
      site_visit_status: (draft.site_visit_status || null) as DetailsPatch["site_visit_status"],
      site_visit_at: fromLocalInput(draft.site_visit_at), site_visit_location: draft.site_visit_location || null,
      site_visit_details: draft.site_visit_details || null, bond_amount: draft.bond_amount ? Number(draft.bond_amount) : null,
      bid_security_currency: draft.bid_security_currency || null, bid_security_form: draft.bid_security_form || null,
      bid_security_validity: draft.bid_security_validity || null, outstanding_notes: draft.outstanding_notes || null,
    };
    void run("details", () => updateTenderDetails(tenderId, patch), () => setEditing(false));
  };

  const setItem = (item: ReviewItem, next: ItemStatus) => {
    if (next === "not_applicable" && (naReason[item.item_key] || "").trim().length < 3) {
      setError(`Give the reason "${item.label}" does not apply.`);
      return;
    }
    void run(`item:${item.item_key}`, async () => {
      await updateReviewItem(tenderId, item.item_key, {
        status: next, not_applicable_reason: next === "not_applicable" ? naReason[item.item_key] : null,
        ...(notes[item.item_key] !== undefined ? { notes: notes[item.item_key] } : {}),
      });
      return getTenderWorkflow(tenderId);
    });
  };

  const openDocument = async (documentId: string) => {
    try {
      const res = await getDocumentSignedUrl(documentId);
      if (res.data?.url) window.open(res.data.url, "_blank", "noopener,noreferrer");
      else setError("Could not open that file.");
    } catch (e) {
      setError(errorMessage(e, "Could not open that file."));
    }
  };

  if (loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-[#D4AF37]" /></div>;
  }
  if (!view || !t || !perms) {
    return <Panel><p className="text-sm text-rose-300">{error || "The review workflow could not be loaded."}</p></Panel>;
  }

  const stepIndex = STATUS_STEPS.findIndex((s) => s.key === (status === "returned_for_correction" ? "pending_tender_review" : status));
  const reviewOpen = status === "pending_tender_review" || status === "returned_for_correction";

  return (
    <div className="space-y-4">
      {(error || notice) && (
        <div className={cn("rounded-sm border px-3 py-2 text-sm", error ? "border-rose-400/30 bg-rose-400/10 text-rose-200" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200")}>
          {error || notice}
          {problems.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}

      {/* Workflow position */}
      <Panel
        title="Tender workflow"
        actions={status === null && perms.is_admin ? (
          <>
            <button className={btn.ghost} disabled={!!busy} onClick={() => run("start", () => startTenderWorkflow(tenderId, false))}>Start review</button>
            <button className={btn.primary} disabled={!!busy} onClick={() => run("start", () => startTenderWorkflow(tenderId, true))}>Start review + send new-tender email</button>
          </>
        ) : status === "captured" && perms.is_admin ? (
          <button className={btn.primary} disabled={!!busy} onClick={() => run("start", () => startTenderWorkflow(tenderId, false))}>Assign reviewers</button>
        ) : undefined}
      >
        {status === "captured" && (
          <p className="mb-3 text-sm text-amber-200">No initial reviewers were configured when this tender arrived, so it is waiting in Captured. Add reviewers in Tender automation (waiting tenders move to review when you save), or{perms.is_admin ? " assign them here." : " ask a tender workflow admin to assign them."}</p>
        )}
        {status === null ? (
          <p className="text-sm text-slate-light">This tender was entered before the review workflow existed and is not on it.{perms.is_admin ? "" : " A tender workflow admin can start it."}</p>
        ) : (
          <>
            <ol className="grid gap-2 sm:grid-cols-4">
              {STATUS_STEPS.map((step, i) => (
                <li key={step.key} className={cn("rounded-sm border px-3 py-2 text-xs",
                  i < stepIndex ? "border-emerald-400/30 text-emerald-300" : i === stepIndex ? "border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[#F3D77A]" : "border-white/10 text-slate-light")}>
                  <span className="font-mono text-[10px] uppercase tracking-widest">{i + 1}. {step.label}</span>
                </li>
              ))}
            </ol>
            {status === "returned_for_correction" && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-300"><RotateCcw className="h-4 w-4" />Returned by QS for correction (round {view.workflow.round}) - see the history for the QS notes.</p>
            )}
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <div><dt className="text-slate-light">Primary reviewer</dt><dd className="text-paper">{view.workflow.primary_reviewer?.name ?? "—"}</dd></div>
              <div><dt className="text-slate-light">Supporting reviewer(s)</dt><dd className="text-paper">{view.workflow.support_reviewers.map((p) => p.name).join(", ") || "—"}</dd></div>
              <div><dt className="text-slate-light">QS</dt><dd className="text-paper">{view.workflow.qs?.name ?? "Assigned when the review is submitted"}</dd></div>
              {view.workflow.submitted_by && <div><dt className="text-slate-light">Review submitted</dt><dd className="text-paper">{view.workflow.submitted_by.name}, {fmtHarare(view.workflow.submitted_at)}</dd></div>}
              {view.workflow.qs_verified_by && <div><dt className="text-slate-light">QS verified</dt><dd className="text-paper">{view.workflow.qs_verified_by.name}, {fmtHarare(view.workflow.qs_verified_at)}</dd></div>}
            </dl>
          </>
        )}
      </Panel>

      {/* Key facts */}
      <Panel
        title="Deadline, site visit and bid bond"
        actions={perms.can_edit_details && !editing ? <button className={btn.ghost} onClick={beginEdit}>Edit details</button> : undefined}
      >
        {!editing ? (
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-sm border border-white/5 bg-black/30 p-3">
              <div className="mb-1 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-widest text-slate-light">Submission deadline</span><VerifiedChip status={view.verification.deadline} /></div>
              <p className="text-sm text-paper">{fmtHarare(t.submission_deadline)} <span className="text-xs text-slate-light">{relativeDays(t.submission_deadline) ?? ""}</span></p>
              {t.clarification_deadline && <p className="mt-1 text-xs text-slate-light">Clarifications by {fmtHarare(t.clarification_deadline)}</p>}
              <p className="mt-1 whitespace-pre-wrap text-xs text-slate-light">{t.submission_instructions || "Submission instructions not recorded yet."}</p>
            </div>
            <div className="rounded-sm border border-white/5 bg-black/30 p-3">
              <div className="mb-1 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-widest text-slate-light">Site visit / briefing</span><VerifiedChip status={view.verification.site_visit} /></div>
              <p className="text-sm text-paper">{t.site_visit_at ? fmtHarare(t.site_visit_at) : "No date recorded"}{t.site_visit_location ? ` · ${t.site_visit_location}` : ""}</p>
              <p className="mt-1 text-xs"><span className={t.site_visit_status === "required" ? "text-amber-300" : "text-slate-light"}>Attendance: {SITE_LABEL[t.site_visit_status ?? "unknown"]}</span>
                {t.site_visit_source && <span className="text-slate"> · {SOURCE_LABEL[t.site_visit_source] ?? t.site_visit_source}</span>}</p>
              {t.site_visit_details && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-light">{t.site_visit_details}</p>}
            </div>
            <div className="rounded-sm border border-white/5 bg-black/30 p-3">
              <div className="mb-1 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-widest text-slate-light">Bid bond / security</span><VerifiedChip status={view.verification.bid_bond} /></div>
              <p className="text-sm text-paper">{t.bond_amount ? `${t.bid_security_currency ?? "Currency?"} ${t.bond_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "No amount recorded"}</p>
              <p className="mt-1 text-xs text-slate-light">Form: {t.bid_security_form || "not recorded"}{t.bid_security_validity ? ` · valid ${t.bid_security_validity}` : ""}</p>
              {t.bid_security_source && <p className="mt-1 text-xs text-slate">{SOURCE_LABEL[t.bid_security_source] ?? t.bid_security_source}</p>}
              {material?.facts?.bid_bond_establishment_fee && <p className="mt-1 text-xs text-slate-light">e-GP cash bid bond establishment fee: {String(material.facts.bid_bond_establishment_fee)}</p>}
              {material?.facts?.spoc_fee && <p className="mt-1 text-xs text-slate-light">e-GP SPOC fee: {String(material.facts.spoc_fee)}</p>}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-slate-light">Submission deadline (Harare)<input type="datetime-local" className={input} value={draft.submission_deadline} onChange={(e) => setDraft({ ...draft, submission_deadline: e.target.value })} /></label>
            <label className="text-xs text-slate-light">Clarification deadline (Harare)<input type="datetime-local" className={input} value={draft.clarification_deadline} onChange={(e) => setDraft({ ...draft, clarification_deadline: e.target.value })} /></label>
            <label className="text-xs text-slate-light md:col-span-2">Submission instructions (where, how, copies, format)<textarea rows={2} className={input} value={draft.submission_instructions} onChange={(e) => setDraft({ ...draft, submission_instructions: e.target.value })} /></label>
            <label className="text-xs text-slate-light">Site visit / briefing attendance
              <select className={input} value={draft.site_visit_status} onChange={(e) => setDraft({ ...draft, site_visit_status: e.target.value })}>
                <option value="unknown">Not confirmed</option><option value="required">Compulsory</option><option value="optional">Optional</option><option value="not_required">Not required</option>
              </select>
            </label>
            <label className="text-xs text-slate-light">Site visit date and time (Harare)<input type="datetime-local" className={input} value={draft.site_visit_at} onChange={(e) => setDraft({ ...draft, site_visit_at: e.target.value })} /></label>
            <label className="text-xs text-slate-light">Venue / meeting point<input className={input} value={draft.site_visit_location} onChange={(e) => setDraft({ ...draft, site_visit_location: e.target.value })} /></label>
            <label className="text-xs text-slate-light">Site visit notes (what to bring, certificate, contact)<input className={input} value={draft.site_visit_details} onChange={(e) => setDraft({ ...draft, site_visit_details: e.target.value })} /></label>
            <label className="text-xs text-slate-light">Bid bond amount<input type="number" min={0} step="0.01" className={input} value={draft.bond_amount} onChange={(e) => setDraft({ ...draft, bond_amount: e.target.value })} /></label>
            <label className="text-xs text-slate-light">Currency (e.g. USD, ZWG)<input className={input} value={draft.bid_security_currency} onChange={(e) => setDraft({ ...draft, bid_security_currency: e.target.value })} /></label>
            <label className="text-xs text-slate-light">Form (bank guarantee, cash to PRAZ, bid-securing declaration, none)<input className={input} value={draft.bid_security_form} onChange={(e) => setDraft({ ...draft, bid_security_form: e.target.value })} /></label>
            <label className="text-xs text-slate-light">Validity<input className={input} placeholder="e.g. 90 days + 28 days after closing" value={draft.bid_security_validity} onChange={(e) => setDraft({ ...draft, bid_security_validity: e.target.value })} /></label>
            <label className="text-xs text-slate-light md:col-span-2">Discrepancies and outstanding items<textarea rows={3} className={input} value={draft.outstanding_notes} onChange={(e) => setDraft({ ...draft, outstanding_notes: e.target.value })} /></label>
            <div className="flex gap-2 md:col-span-2">
              <button className={btn.primary} disabled={!!busy} onClick={saveDetails}>{busy === "details" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Save details</button>
              <button className={btn.ghost} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
        {!editing && (
          <div className="mt-3 rounded-sm border border-white/5 bg-black/30 p-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-light">Outstanding items and discrepancies</span>
            <p className="mt-1 whitespace-pre-wrap text-sm text-paper">{t.outstanding_notes || "None recorded."}</p>
            {(material?.discrepancies ?? []).length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-amber-300">
                {(material.discrepancies as { field: string; tender: unknown; source: unknown }[]).map((d, i) => (
                  <li key={i}><AlertTriangle className="mr-1 inline h-3 w-3" />{d.field.replace(/_/g, " ")}: AEGIS has {String(d.tender)}, e-GP says {String(d.source)}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      {/* Documents */}
      <Panel
        title={`Documents (${view.documents.length} attached)`}
        actions={t.source_key === "praz_egp" && (perms.can_review || perms.can_qs || perms.is_admin) ? (
          <button className={btn.ghost} disabled={!!busy} onClick={() => run("collect", () => collectTenderMaterial(tenderId), () => setTimeout(() => void load(), 45000))}>
            <RefreshCw className={cn("h-3.5 w-3.5", busy === "collect" && "animate-spin")} />Re-collect from e-GP
          </button>
        ) : undefined}
      >
        {material?.collected_at && (
          <p className="mb-2 text-xs text-slate-light">
            e-GP checked {fmtHarare(material.collected_at)}: {material.documents?.listed ?? 0} listed, {(material.documents?.downloaded ?? 0) + (material.documents?.already_attached ?? 0)} attached, {material.documents?.failed ?? 0} failed
            {material.notice === "failed" && " · notice page failed"}{material.schedule === "failed" && " · schedule failed"}
          </p>
        )}
        {failedOfficial.length > 0 && (
          <div className="mb-3 rounded-sm border border-rose-400/30 bg-rose-400/10 p-2 text-xs text-rose-200">
            <p className="mb-1 font-semibold">Not attached - fetch these by hand and upload them below:</p>
            <ul className="space-y-0.5">
              {failedOfficial.map((d) => <li key={d.id}>{d.label} - {d.download_status === "pending" ? "not downloaded yet" : d.download_error || d.download_status}</li>)}
            </ul>
          </div>
        )}
        <ul className="divide-y divide-white/5">
          {view.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-slate-light" /><span className="truncate text-paper">{d.file_name || d.title}</span></span>
              <span className="flex items-center gap-2 text-xs text-slate-light">
                {d.extraction_status === "no_text_found" && <Chip className="border-amber-400/30 text-amber-300" title="Scanned - read it yourself">scanned</Chip>}
                {d.uploaded_by_name ?? "AEGIS (e-GP)"} · {fmtHarare(d.created_at, false)}
                <button className="text-[#D4AF37] hover:underline" onClick={() => void openDocument(d.id)}>Open</button>
              </span>
            </li>
          ))}
          {view.documents.length === 0 && <li className="py-2 text-sm text-slate-light">No documents attached yet.</li>}
        </ul>
        {(perms.can_review || perms.is_admin) && (
          <div className="mt-3">
            <EntityDocumentsPanel entityType="tender" entityId={tenderId} />
          </div>
        )}
      </Panel>

      {/* Review checklist */}
      {status !== null && (
        <Panel title={`Initial review checklist${view.workflow.round > 1 ? ` · round ${view.workflow.round}` : ""}`}>
          <ul className="space-y-2">
            {view.items.map((item) => (
              <li key={item.id} className="rounded-sm border border-white/5 bg-black/30 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm text-paper">
                      {item.status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : item.status === "not_applicable" ? <MinusCircle className="h-4 w-4 text-slate-light" /> : <CircleDashed className="h-4 w-4 text-amber-300" />}
                      {item.label}
                    </p>
                    {item.guidance && <p className="mt-0.5 text-xs text-slate-light">{item.guidance}</p>}
                    {item.completed_by_name && <p className="mt-0.5 text-[11px] text-slate">{item.status === "done" ? "Done" : "Marked not applicable"} by {item.completed_by_name}, {fmtHarare(item.completed_at)}</p>}
                    {item.not_applicable_reason && <p className="mt-0.5 text-xs text-slate-light">Reason: {item.not_applicable_reason}</p>}
                    {item.reopened_note && item.status === "pending" && <p className="mt-0.5 text-xs text-amber-300">Reopened by QS: {item.reopened_note}</p>}
                    {item.notes && <p className="mt-0.5 whitespace-pre-wrap text-xs text-paper/80">Notes: {item.notes}</p>}
                  </div>
                  {reviewOpen && perms.can_review && (
                    <div className="flex shrink-0 flex-wrap gap-1">
                      <button className={btn.ghost} disabled={!!busy || item.status === "done"} onClick={() => setItem(item, "done")}>Done</button>
                      <button className={btn.ghost} disabled={!!busy || item.status === "not_applicable"} onClick={() => setItem(item, "not_applicable")}>N/A</button>
                      {item.status !== "pending" && <button className={btn.ghost} disabled={!!busy} onClick={() => setItem(item, "pending")}>Reopen</button>}
                    </div>
                  )}
                </div>
                {reviewOpen && perms.can_review && (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <input className={input} placeholder="Reason it does not apply (needed for N/A)" value={naReason[item.item_key] ?? ""} onChange={(e) => setNaReason({ ...naReason, [item.item_key]: e.target.value })} />
                    <div className="flex gap-2">
                      <input className={input} placeholder="Notes" value={notes[item.item_key] ?? item.notes ?? ""} onChange={(e) => setNotes({ ...notes, [item.item_key]: e.target.value })} />
                      <button className={btn.ghost} disabled={!!busy || notes[item.item_key] === undefined} onClick={() => run(`notes:${item.item_key}`, async () => { await updateReviewItem(tenderId, item.item_key, { notes: notes[item.item_key] }); return getTenderWorkflow(tenderId); })}>Save</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {reviewOpen && perms.can_review && (
            <div className="mt-4 rounded-sm border border-[#D4AF37]/30 bg-[#D4AF37]/5 p-3">
              {view.gate.problems.length > 0 && (
                <div className="mb-2 text-xs text-amber-300">
                  <p className="font-semibold">Before this can go to QS:</p>
                  <ul className="list-disc pl-5">{view.gate.problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              )}
              <textarea rows={2} className={input} placeholder="Review note for the QS (optional)" value={submitNote} onChange={(e) => setSubmitNote(e.target.value)} />
              <label className="mt-2 flex items-start gap-2 text-sm text-paper">
                <input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                I checked this tender against the original notice and the documents, and the information recorded here is correct.
              </label>
              <button className={cn(btn.primary, "mt-2")} disabled={!!busy || !confirm || view.gate.problems.length > 0}
                onClick={() => run("submit", () => submitTenderReview(tenderId, { confirm, note: submitNote || undefined }), () => { setConfirm(false); setSubmitNote(""); })}>
                {busy === "submit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {status === "returned_for_correction" ? "Resubmit to QS" : "Submit to QS"}
              </button>
            </div>
          )}
        </Panel>
      )}

      {/* QS verification */}
      {status === "pending_qs_verification" && (
        <Panel title={`QS verification · ${view.workflow.qs?.name ?? "no QS assigned"}`}>
          {view.workflow.confirmation_note && <p className="mb-2 text-sm text-paper">Reviewer note: {view.workflow.confirmation_note}</p>}
          {perms.can_qs ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-light">Check the reviewer&apos;s work first: tender details, every document, the deadline, site visit and bid bond.</p>
              <textarea rows={3} className={input} placeholder="Notes (required when returning - say exactly what to correct)" value={qsNotes} onChange={(e) => setQsNotes(e.target.value)} />
              <div>
                <p className="mb-1 text-xs text-slate-light">Reopen checklist items (optional, when returning):</p>
                <div className="flex flex-wrap gap-2">
                  {view.review_items.map((ri) => (
                    <label key={ri.key} className="flex items-center gap-1 text-xs text-paper">
                      <input type="checkbox" checked={reopen.includes(ri.key)} onChange={(e) => setReopen(e.target.checked ? [...reopen, ri.key] : reopen.filter((k) => k !== ri.key))} />
                      {ri.label.length > 48 ? `${ri.label.slice(0, 48)}…` : ri.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={btn.primary} disabled={!!busy} onClick={() => run("qs", () => recordQsDecision(tenderId, { decision: "verified", notes: qsNotes || undefined }), () => setQsNotes(""))}>
                  <ShieldCheck className="h-3.5 w-3.5" />Verified - start QS preparation
                </button>
                <button className={btn.danger} disabled={!!busy || qsNotes.trim().length < 10} onClick={() => run("qs", () => recordQsDecision(tenderId, { decision: "return", notes: qsNotes, reopen_items: reopen }), () => { setQsNotes(""); setReopen([]); })}>
                  <RotateCcw className="h-3.5 w-3.5" />Return for correction
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-light">Waiting for {view.workflow.qs?.name ?? "a QS to be assigned"} to verify the review.</p>
          )}
        </Panel>
      )}

      {/* Tasks, emails, history */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Workflow tasks">
          <ul className="space-y-1 text-xs">
            {view.tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-paper">{task.title}</span>
                <span className="text-slate-light">{task.assignee_name ?? "Unassigned"} · {task.status.replace(/_/g, " ")}{task.due_date ? ` · due ${task.due_date}` : ""}</span>
              </li>
            ))}
            {view.tasks.length === 0 && <li className="text-slate-light">No workflow tasks yet.</li>}
          </ul>
          <p className="mt-2 text-[11px] text-slate">These tasks close themselves when the review is submitted or the QS decision is recorded here.</p>
        </Panel>
        <Panel title="New-tender email">
          <ul className="space-y-1 text-xs">
            {view.deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-paper">{d.recipient_label}{d.recipient_email ? ` <${d.recipient_email}>` : ""}</span>
                <span className={cn(d.status === "sent" ? "text-emerald-300" : d.status === "failed" || d.status === "unresolved" ? "text-rose-300" : "text-slate-light")} title={d.last_error ?? undefined}>
                  {d.status}{d.status === "failed" ? ` (${d.attempts} tries)` : ""}
                </span>
              </li>
            ))}
            {view.deliveries.length === 0 && <li className="text-slate-light">No new-tender email for this tender.</li>}
          </ul>
        </Panel>
      </div>

      <Panel title="History">
        <ol className="space-y-1.5 text-xs">
          {view.events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2">
              <span className="text-slate">{fmtHarare(e.created_at)}</span>
              <span className="text-paper">{ACTION_LABEL[e.action] ?? e.action.replace(/_/g, " ")}{e.action === "review_item_updated" && e.data?.item ? `: ${String(e.data.item).replace(/_/g, " ")} → ${String(e.data.status).replace(/_/g, " ")}` : ""}</span>
              <span className="text-slate-light">{e.automated ? "AEGIS" : e.actor_name ?? ""}</span>
              {e.note && <span className="w-full whitespace-pre-wrap pl-4 text-slate-light">“{e.note}”</span>}
            </li>
          ))}
          {view.events.length === 0 && <li className="text-slate-light">No workflow history.</li>}
        </ol>
      </Panel>

      {t.source_url && (
        <p className="text-xs text-slate-light">
          <Clock className="mr-1 inline h-3 w-3" />Original notice: <a className="text-[#D4AF37] hover:underline" href={t.source_url} target="_blank" rel="noopener noreferrer">{t.source_reference || `e-GP ${t.source_notice_id}`} <ExternalLink className="inline h-3 w-3" /></a>
        </p>
      )}
    </div>
  );
}
