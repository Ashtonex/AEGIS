"use client";

/**
 * Estimating workspace for one quotation. One component tree for every
 * section, so switching sections never loses unsaved edits. All data is the
 * existing finance.quotations record; saving, revisions, approval and award
 * go through the same server endpoints and controls as the legacy builder.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, CircleAlert, ClipboardList, Copy, FileStack, Gauge, Layers, ListPlus, Loader2, MoveDown, MoveUp,
  Redo2, Ruler, Save, Search, Trash2, Truck, Undo2, Wrench,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  decideBoqApproval, getQuotationHistory, getQuotationWorkspace,
  type QuotationWorkspaceData, type ReviewFlag,
} from "@/lib/api/quotations";
import {
  BoqLine, CommercialInputs, DEFAULT_SECTION, formatMoney, normaliseLine, previewTotals, serialiseLine,
} from "@/components/quotations/workspace/domain";
import { blankLine, useBoqEditor } from "@/components/quotations/workspace/useBoqEditor";
import { clearStoredDraft, readStoredDraft, useWorkspaceSave, type StoredDraft } from "@/components/quotations/workspace/useWorkspaceSave";
import { BoqGrid } from "@/components/quotations/workspace/BoqGrid";
import { RateInspector } from "@/components/quotations/workspace/RateInspector";
import { PastePreviewDialog } from "@/components/quotations/workspace/PastePreviewDialog";
import { CommercialReview } from "@/components/quotations/workspace/CommercialReview";
import { RevisionsPanel } from "@/components/quotations/workspace/RevisionsPanel";
import { HandoffPanel } from "@/components/quotations/workspace/HandoffPanel";
import { OverviewPanel, type Particulars } from "@/components/quotations/workspace/OverviewPanel";
import { DrawingsPanel } from "@/components/quotations/workspace/DrawingsPanel";
import { RatesPanel } from "@/components/quotations/workspace/RatesPanel";
import { QUOTATION_WORKSPACE_ENABLED } from "@/components/quotations/workspace/flags";

const SECTIONS = [
  { id: "overview", label: "Overview", icon: ClipboardList },
  { id: "boq", label: "BOQ & Estimate", icon: Layers },
  { id: "drawings", label: "Drawings & Takeoff", icon: Ruler },
  { id: "rates", label: "Rates & Resources", icon: Wrench },
  { id: "commercial", label: "Commercial Review", icon: Gauge },
  { id: "revisions", label: "Revisions & Documents", icon: FileStack },
  { id: "handoff", label: "Award & Handoff", icon: Truck },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const BLOCKING_CODES = new Set(["missing_description", "missing_quantity", "missing_unit", "unpriced", "no_boq", "missing_client"]);
const listToText = (v: unknown) => (Array.isArray(v) ? v.join("\n") : typeof v === "string" ? v : "");
const textToList = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

function particularsFrom(q: QuotationWorkspaceData["quotation"]): Particulars {
  const m = q.metadata || {};
  return {
    client_name: q.client_name || "",
    client_email: m.client_email || "",
    project_title: m.project_title || "",
    reference_number: m.reference_number || "",
    quote_date: m.quote_date || "",
    valid_until_days: Number(m.valid_until_days) || 30,
    currency: m.currency || "USD",
    terms: m.terms || "",
    programme_weeks: m.programme_weeks ? String(m.programme_weeks) : "",
    inclusions: listToText(m.inclusions),
    exclusions: listToText(m.exclusions),
    assumptions: listToText(m.assumptions),
  };
}

function commercialFrom(m: Record<string, any>): CommercialInputs {
  const n = (v: unknown, d = 0) => (v === undefined || v === null || v === "" ? d : Number(v) || 0);
  return {
    preliminaries: n(m.preliminaries),
    overhead_pct: n(m.overhead_pct),
    contingency_pct: n(m.contingency_pct),
    profit_pct: n(m.profit_pct),
    discount: n(m.discount),
    provisional_sums: n(m.provisional_sums),
    // Same truthiness as the server calculator (metadata.get("apply_vat")).
    apply_vat: !!m.apply_vat,
    vat_rate: n(m.vat_rate, 0.155),
  };
}

function useViewportHeight() {
  const [h, setH] = useState(800);
  useEffect(() => {
    const update = () => setH(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return h;
}

export default function QuotationWorkspacePage() {
  return (
    <RBACGuard permission="quotations.read">
      <Workspace />
    </RBACGuard>
  );
}

function Workspace() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const section = (SECTIONS.find((s) => s.id === searchParams?.get("section"))?.id ?? "overview") as SectionId;
  const { permissions, isSuperAdmin } = useAuth();
  const can = useCallback((key: string) => isSuperAdmin || !!permissions?.has(key), [isSuperAdmin, permissions]);
  const viewport = useViewportHeight();

  const [data, setData] = useState<QuotationWorkspaceData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [particulars, setParticulars] = useState<Particulars | null>(null);
  const [commercial, setCommercial] = useState<CommercialInputs | null>(null);
  const [metaRevision, setMetaRevision] = useState(0);
  const [loadToken, setLoadToken] = useState(0);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "flagged" | "unpriced" | "takeoff" | "notes">("all");
  const [pasteText, setPasteText] = useState<{ text: string; at: string | null } | null>(null);
  const [storedDraft, setStoredDraft] = useState<StoredDraft | null>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const editor = useBoqEditor([]);

  const status = String(data?.quotation.status || "draft").toLowerCase();
  const closed = status === "won" || status === "lost";
  const readOnly = !data || closed || !can("quotations.update");
  const currency = particulars?.currency || "USD";
  const editRevision = editor.revision + metaRevision;

  const applyServer = useCallback((ws: QuotationWorkspaceData) => {
    setData(ws);
    setParticulars(particularsFrom(ws.quotation));
    setCommercial(commercialFrom(ws.quotation.metadata || {}));
    const items = Array.isArray(ws.quotation.metadata?.items) ? ws.quotation.metadata.items : [];
    editor.reset(items.map((it: Record<string, any>) => normaliseLine(it)));
    setLoadToken((t) => t + 1);
  }, [editor]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await getQuotationWorkspace(id);
      if (!res.data) throw new Error(res.message || "Quotation not found.");
      applyServer(res.data);
      const draft = readStoredDraft(id);
      setStoredDraft(draft);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [applyServer, id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  const buildPayload = useCallback((): Record<string, unknown> => {
    const base = data?.quotation.metadata || {};
    const p = particulars!;
    const c = commercial!;
    const validUntil = p.quote_date ? new Date(new Date(p.quote_date).getTime() + p.valid_until_days * 86400000).toISOString().slice(0, 10) : undefined;
    return {
      client_name: p.client_name,
      metadata: {
        ...base,
        client_email: p.client_email,
        project_title: p.project_title,
        reference_number: p.reference_number,
        quote_date: p.quote_date,
        valid_until_days: p.valid_until_days,
        valid_until: validUntil,
        currency: p.currency,
        terms: p.terms,
        programme_weeks: p.programme_weeks ? Number(p.programme_weeks) || p.programme_weeks : undefined,
        inclusions: textToList(p.inclusions),
        exclusions: textToList(p.exclusions),
        assumptions: textToList(p.assumptions),
        preliminaries: c.preliminaries,
        overhead_pct: c.overhead_pct,
        contingency_pct: c.contingency_pct,
        profit_pct: c.profit_pct,
        discount: c.discount,
        provisional_sums: c.provisional_sums,
        apply_vat: c.apply_vat,
        items: editor.lines.map(serialiseLine),
      },
    };
  }, [commercial, data, editor.lines, particulars]);

  const refreshServerView = useCallback(async () => {
    try {
      const res = await getQuotationWorkspace(id);
      const fresh = res.data;
      // Keep local edits; refresh only the server-derived view.
      if (fresh) setData(fresh);
    } catch {
      // the next explicit reload will show it
    }
  }, [id]);

  const saver = useWorkspaceSave({
    quotationId: id,
    rowVersion: data?.quotation.row_version ?? null,
    editRevision,
    enabled: !readOnly && !!particulars && !!commercial,
    buildPayload,
    onSaved: () => void refreshServerView(),
  });

  useEffect(() => {
    if (data) saver.rebase(data.quotation.row_version, editRevision);
    // only after a full load from the server
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadToken]);

  const dirty = saver.status === "dirty" || saver.status === "saving" || saver.status === "error" || saver.status === "conflict";

  // Keyboard: Ctrl+S saves from anywhere in the workspace.
  const saveNow = saver.save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveNow]);

  const setSection = (next: SectionId) => {
    const q = new URLSearchParams(searchParams?.toString() || "");
    q.set("section", next);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const flags = useMemo(() => data?.flags ?? [], [data]);
  const flagsByLine = useMemo(() => {
    const map = new Map<string, ReviewFlag[]>();
    flags.forEach((f) => f.line_id && map.set(f.line_id, [...(map.get(f.line_id) || []), f]));
    return map;
  }, [flags]);
  const preview = useMemo(() => previewTotals(editor.lines, commercial ?? commercialFrom({})), [editor.lines, commercial]);

  const visibleLineIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && filter === "all") return null;
    return new Set(editor.lines.filter((l) => {
      if (q && !(`${l.item_no} ${l.description} ${l.section} ${l.unit}`.toLowerCase().includes(q))) return false;
      if (filter === "flagged") return flagsByLine.has(l.line_id);
      if (filter === "unpriced") return l.item_type !== "note" && !l.rate;
      if (filter === "takeoff") return !!l.takeoff;
      if (filter === "notes") return l.item_type === "note";
      return true;
    }).map((l) => l.line_id));
  }, [editor.lines, filter, flagsByLine, search]);

  const activeLine = editor.lines.find((l) => l.line_id === activeLineId) ?? null;
  const openLine = (lineId: string) => {
    setSection("boq");
    setSearch("");
    setFilter("all");
    setActiveLineId(lineId);
    setInspectorOpen(true);
  };

  const insertBelow = () => {
    const anchor = activeLine;
    const line = blankLine(anchor?.section || editor.lines[editor.lines.length - 1]?.section || DEFAULT_SECTION);
    editor.insert(anchor?.line_id ?? editor.lines[editor.lines.length - 1]?.line_id ?? null, [line]);
    setActiveLineId(line.line_id);
  };
  const removeSelected = () => {
    if (!activeLine) return;
    if (activeLine.buildup.length && !window.confirm(`Remove "${activeLine.description || "this line"}" and its build-up? You can undo with Ctrl+Z.`)) return;
    const idx = editor.lines.findIndex((l) => l.line_id === activeLine.line_id);
    editor.remove([activeLine.line_id]);
    setActiveLineId(editor.lines[idx + 1]?.line_id ?? editor.lines[idx - 1]?.line_id ?? null);
  };
  const addSection = () => {
    const name = window.prompt("New bill / element name", `Bill ${new Set(editor.lines.map((l) => l.section)).size + 1}`);
    if (!name?.trim()) return;
    const line = blankLine(name.trim());
    editor.insert(editor.lines[editor.lines.length - 1]?.line_id ?? null, [line]);
    setActiveLineId(line.line_id);
  };

  const patchParticulars = (patch: Partial<Particulars>) => {
    setParticulars((p) => (p ? { ...p, ...patch } : p));
    setMetaRevision((r) => r + 1);
  };
  const patchCommercial = (patch: Partial<CommercialInputs>) => {
    setCommercial((c) => (c ? { ...c, ...patch } : c));
    setMetaRevision((r) => r + 1);
  };

  const restoreDraft = () => {
    const meta = (storedDraft?.payload?.metadata || {}) as Record<string, any>;
    if (!data || !storedDraft) return;
    const restored = { ...data.quotation, client_name: storedDraft.payload.client_name, metadata: { ...data.quotation.metadata, ...meta } } as QuotationWorkspaceData["quotation"];
    setParticulars(particularsFrom(restored));
    setCommercial(commercialFrom(restored.metadata));
    editor.reset((Array.isArray(meta.items) ? meta.items : []).map((it: Record<string, any>) => normaliseLine(it)));
    setMetaRevision((r) => r + 1);
    setStoredDraft(null);
  };

  useEffect(() => {
    if (section === "revisions" && history === null && id) {
      getQuotationHistory(id).then((res) => setHistory(res.data || [])).catch(() => setHistory([]));
    }
  }, [history, id, section]);

  if (!QUOTATION_WORKSPACE_ENABLED) {
    return (
      <div className="p-8 text-paper">
        <p className="text-sm text-slate">The estimating workspace is switched off for this deployment.</p>
        <Link className="text-signal hover:underline text-sm" href={`/dashboard/quotations/builder?edit=${id}`}>Open in the quotation builder</Link>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="p-8 text-paper space-y-3" role="alert">
        <p className="text-sm text-danger">Could not open this quotation: {loadError}</p>
        <div className="flex gap-3 text-sm"><button className="text-signal hover:underline" onClick={() => void load()}>Retry</button><Link className="text-slate hover:text-paper" href="/dashboard/quotations">Back to quotations</Link></div>
      </div>
    );
  }
  if (!data || !particulars || !commercial) {
    return <div className="p-8 text-slate text-sm flex items-center gap-2" aria-busy="true"><Loader2 className="w-4 h-4 animate-spin" /> Loading estimate…</div>;
  }

  const q = data.quotation;
  const rs = data.revision_state || {};
  const latest = data.revisions[0];
  const errors = flags.filter((f) => f.severity === "error").length;
  const warnings = flags.filter((f) => f.severity === "warning").length;
  const blockingFlags = flags.filter((f) => BLOCKING_CODES.has(f.code)).length;
  const approval = (q.metadata?.boq_approval as any) || null;
  const sourceLink = q.tender_id ? { label: "Tender", href: `/dashboard/crm/tenders` } : q.opportunity_id ? { label: "Opportunity", href: `/dashboard/crm/opportunities` } : q.project_id ? { label: "Project", href: `/dashboard/projects/${q.project_id}` } : { label: "Direct quotation (no tender or opportunity)", href: null };
  const saveLabel: Record<string, string> = { saved: "All changes saved", dirty: "Unsaved changes", saving: "Saving…", error: "Save failed", conflict: "Conflict - not saved", readonly: closed ? `Read only (${status})` : "Read only" };
  const saveTone = { saved: "text-success", dirty: "text-signal", saving: "text-slate", error: "text-danger", conflict: "text-danger", readonly: "text-slate" }[saver.status];
  const gridHeight = Math.max(320, viewport - 380);

  return (
    <div className="px-4 sm:px-6 py-4 max-w-[1600px] mx-auto text-paper space-y-4">
      {/* Header */}
      <header className="border border-ink-mid rounded-sm bg-ink p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href="/dashboard/quotations" className="text-xs text-slate hover:text-paper inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Quotations</Link>
            <h1 className="text-lg sm:text-xl font-display font-bold truncate">
              <span className="font-mono">{particulars.reference_number || q.id.slice(0, 8).toUpperCase()}</span>
              <span className="text-slate font-normal text-base"> · {rs.latest_issued_revision_number ? (data.working_matches_latest_revision ? `Rev ${rs.latest_issued_revision_number}` : `Draft after Rev ${rs.latest_issued_revision_number}`) : "Draft (not issued)"}</span>
            </h1>
            <p className="text-sm text-slate truncate">{particulars.client_name || "No client"} · {particulars.project_title || "Untitled works"} · {sourceLink.label}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-sm border border-ink-mid uppercase tracking-wider ${status === "won" ? "text-success" : status === "lost" ? "text-danger" : "text-paper"}`}>{status}</span>
            <span className="text-xs px-2 py-1 rounded-sm border border-ink-mid font-mono">{currency}</span>
            <span className={`text-xs ${saveTone}`} role="status" aria-live="polite">{saveLabel[saver.status]}{saver.lastSavedAt && saver.status === "saved" ? ` · ${saver.lastSavedAt.toLocaleTimeString()}` : ""}</span>
            {!readOnly && (
              <>
                <button type="button" onClick={editor.undo} disabled={!editor.canUndo} className="p-1.5 border border-ink-mid rounded-sm disabled:opacity-30" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)"><Undo2 className="w-4 h-4" /></button>
                <button type="button" onClick={editor.redo} disabled={!editor.canRedo} className="p-1.5 border border-ink-mid rounded-sm disabled:opacity-30" aria-label="Redo (Ctrl+Y)" title="Redo (Ctrl+Y)"><Redo2 className="w-4 h-4" /></button>
                <button type="button" onClick={() => void saver.save()} disabled={saver.status === "saving" || saver.status === "conflict" || saver.status === "saved"} className="px-3 py-1.5 text-xs rounded-sm bg-signal text-void font-semibold inline-flex items-center gap-1 disabled:opacity-40" title="Save (Ctrl+S)"><Save className="w-3.5 h-3.5" /> Save</button>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div><p className="text-[11px] uppercase tracking-wider text-slate">Client total (saved)</p><p className="font-mono font-semibold">{formatMoney(data.breakdown?.grand_total ?? q.quote_amount ?? 0, currency)}</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-slate">Preview{dirty ? " (unsaved)" : ""}</p><p className={`font-mono ${dirty ? "text-signal" : "text-slate"}`}>{formatMoney(preview.grand, currency)}</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-slate">Margin / markup</p><p className="font-mono">{data.breakdown?.margin_pct?.toFixed(1) ?? "—"}% / {data.breakdown?.markup_pct?.toFixed(1) ?? "—"}%</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-slate">Review</p>
            <button type="button" className="text-left" onClick={() => setSection("commercial")}><span className={errors ? "text-danger" : "text-success"}>{errors} blocking</span><span className="text-slate"> · </span><span className={warnings ? "text-warning" : "text-slate"}>{warnings} warnings</span></button>
          </div>
        </div>
        {saver.status === "conflict" && (
          <div className="border border-danger/50 bg-danger/10 rounded-sm p-3 text-sm flex flex-wrap items-center justify-between gap-2" role="alert">
            <span>{saver.error || "Someone else saved this quotation."} Your unsaved copy is kept in this browser.</span>
            <button type="button" className="text-signal hover:underline" onClick={() => void load()}>Load their version</button>
          </div>
        )}
        {saver.status === "error" && (
          <div className="border border-danger/50 rounded-sm p-3 text-sm flex flex-wrap items-center justify-between gap-2" role="alert">
            <span className="text-danger">{saver.error}</span>
            <button type="button" className="text-signal hover:underline" onClick={() => void saver.save()}>Retry save</button>
          </div>
        )}
        {storedDraft && !readOnly && (
          <div className="border border-signal/40 rounded-sm p-3 text-sm flex flex-wrap items-center justify-between gap-2">
            <span>Unsaved changes from {new Date(storedDraft.savedAt).toLocaleString()} were found in this browser.
              {storedDraft.rowVersion !== q.row_version ? " They were made against an older version - restoring and saving will replace newer changes." : ""}</span>
            <span className="flex gap-3">
              <button type="button" className="text-signal hover:underline" onClick={restoreDraft}>Restore</button>
              <button type="button" className="text-slate hover:text-paper" onClick={() => { clearStoredDraft(id); setStoredDraft(null); }}>Discard</button>
            </span>
          </div>
        )}
        {notice && <p className="text-xs text-success" role="status">{notice}</p>}
      </header>

      {/* Sections */}
      <nav className="flex gap-1 overflow-x-auto border-b border-ink-mid" aria-label="Workspace sections">
        {SECTIONS.map(({ id: sid, label, icon: Icon }) => (
          <button key={sid} type="button" onClick={() => setSection(sid)} aria-current={section === sid ? "page" : undefined}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px ${section === sid ? "border-signal text-paper" : "border-transparent text-slate hover:text-paper"}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </nav>

      {section === "overview" && (
        <OverviewPanel value={particulars} onChange={patchParticulars} readOnly={readOnly} source={sourceLink} currencyLocked={data.revisions.length > 0} />
      )}

      {section === "boq" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate" aria-hidden />
              <input className="bg-void border border-ink-mid rounded-sm pl-7 pr-2 py-1.5 text-xs w-56" placeholder="Search code, description, section" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search BOQ" />
            </label>
            <select className="bg-void border border-ink-mid rounded-sm px-2 py-1.5 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter lines">
              <option value="all">All lines ({editor.lines.length})</option>
              <option value="flagged">Flagged</option>
              <option value="unpriced">Unpriced</option>
              <option value="takeoff">From drawings</option>
              <option value="notes">Notes / exclusions</option>
            </select>
            {!readOnly && (
              <div className="flex flex-wrap gap-1">
                <button type="button" onClick={insertBelow} className="px-2 py-1.5 text-xs border border-ink-mid rounded-sm inline-flex items-center gap-1"><ListPlus className="w-3.5 h-3.5" /> Insert line</button>
                <button type="button" onClick={addSection} className="px-2 py-1.5 text-xs border border-ink-mid rounded-sm">New bill</button>
                <button type="button" disabled={!activeLine} onClick={() => activeLine && editor.duplicate(activeLine.line_id)} className="p-1.5 border border-ink-mid rounded-sm disabled:opacity-30" aria-label="Duplicate line" title="Duplicate line"><Copy className="w-3.5 h-3.5" /></button>
                <button type="button" disabled={!activeLine} onClick={() => activeLine && editor.move(activeLine.line_id, -1)} className="p-1.5 border border-ink-mid rounded-sm disabled:opacity-30" aria-label="Move line up" title="Move up within its section"><MoveUp className="w-3.5 h-3.5" /></button>
                <button type="button" disabled={!activeLine} onClick={() => activeLine && editor.move(activeLine.line_id, 1)} className="p-1.5 border border-ink-mid rounded-sm disabled:opacity-30" aria-label="Move line down" title="Move down within its section"><MoveDown className="w-3.5 h-3.5" /></button>
                <button type="button" disabled={!activeLine} onClick={removeSelected} className="p-1.5 border border-ink-mid rounded-sm text-danger disabled:opacity-30" aria-label="Remove line" title="Remove line"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            )}
            <span className="text-[11px] text-slate ml-auto hidden md:inline">Enter edit · Tab/Shift+Tab across · Shift+↓ select · Ctrl+D fill down · Ctrl+V paste from Excel · Ctrl+Z undo</span>
          </div>
          <div className={`grid gap-3 ${inspectorOpen ? "xl:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
            <BoqGrid
              lines={editor.lines}
              visibleLineIds={visibleLineIds}
              readOnly={readOnly}
              currency={currency}
              flagsByLine={flagsByLine}
              activeLineId={activeLineId}
              onActiveLineChange={(lid) => { setActiveLineId(lid); }}
              onUpdate={editor.update}
              onFillDown={editor.fillDown}
              onUndo={editor.undo}
              onRedo={editor.redo}
              onPasteTable={(text, at) => setPasteText({ text, at })}
              onAppendLine={insertBelow}
              height={gridHeight}
            />
            {inspectorOpen ? (
              <RateInspector line={activeLine} quotationId={id} currency={currency} readOnly={readOnly} flags={activeLine ? flagsByLine.get(activeLine.line_id) || [] : []} onUpdate={editor.update} onClose={() => setInspectorOpen(false)} />
            ) : (
              <button type="button" className="text-xs text-signal hover:underline justify-self-start" onClick={() => setInspectorOpen(true)}>Show rate build-up</button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate">
            {preview.sections.map((s) => <span key={s.section}>{s.section}: <span className="font-mono text-paper">{formatMoney(s.amount, currency)}</span></span>)}
            <span>Direct cost: <span className="font-mono text-paper">{formatMoney(preview.direct, currency)}</span></span>
          </div>
        </div>
      )}

      {section === "drawings" && (
        <DrawingsPanel quotationId={id} readOnly={readOnly} lines={editor.lines} onImport={(lines) => { editor.insert(editor.lines[editor.lines.length - 1]?.line_id ?? null, lines); setNotice(`${lines.length} measured line(s) added to the BOQ - price them before issue.`); }} />
      )}

      {section === "rates" && (
        <RatesPanel quotationId={id} currency={currency} lines={editor.lines} readOnly={readOnly} onApply={(lines) => { editor.replaceMany(lines); setNotice(`${lines.length} rate(s) updated with their source recorded. Save to keep them.`); }} onOpenLine={openLine} />
      )}

      {section === "commercial" && (
        <CommercialReview
          quotationId={id}
          currency={currency}
          inputs={commercial}
          onInputsChange={patchCommercial}
          preview={preview}
          breakdown={data.breakdown}
          flags={flags}
          readOnly={readOnly}
          dirty={dirty}
          approval={approval}
          canApprove={can("quotations.decide") && (!data.viewer.is_author || data.viewer.is_superadmin) && !closed}
          isAuthor={data.viewer.is_author}
          onApproveBoq={async (decision, notes) => {
            const res = await decideBoqApproval(id, decision, notes);
            setNotice(res.message || "BOQ decision recorded.");
            await refreshServerView();
          }}
          onOpenLine={openLine}
          onOpenSection={(s) => setSection((SECTIONS.find((x) => x.id === s)?.id ?? (s === "drawings" ? "drawings" : "commercial")) as SectionId)}
        />
      )}

      {section === "revisions" && (
        <>
          <RevisionsPanel
            quotationId={id}
            reference={particulars.reference_number}
            currency={currency}
            revisions={data.revisions}
            rowVersion={saver.rowVersion.current}
            status={status}
            dirty={dirty}
            workingMatchesLatest={data.working_matches_latest_revision}
            blockingFlags={blockingFlags}
            approved={approval?.status === "approved"}
            onIssued={(msg) => { setNotice(msg); void load(); }}
          />
          <section className="border border-ink-mid rounded-sm bg-ink p-4 mt-4">
            <h2 className="text-sm font-semibold text-paper mb-2">Audit trail</h2>
            {history === null ? <p className="text-sm text-slate">Loading…</p> : history.length === 0 ? <p className="text-sm text-slate">No recorded changes.</p> : (
              <ul className="text-xs space-y-1 max-h-64 overflow-y-auto">
                {history.map((h) => (
                  <li key={h.id} className="flex gap-3"><span className="text-slate font-mono w-40 shrink-0">{new Date(h.created_at).toLocaleString()}</span><span>{h.actor_name || h.actor_email || "System"} · {h.action}{h.changed_fields?.length ? ` (${h.changed_fields.join(", ")})` : ""}</span></li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {section === "handoff" && (
        <HandoffPanel quotationId={id} currency={currency} status={status} revisions={data.revisions} isAuthor={data.viewer.is_author && !data.viewer.is_superadmin} canDecide={can("quotations.decide")} dirty={dirty} onDecided={(msg) => { setNotice(msg); void load(); }} />
      )}

      {latest && (
        <p className="text-[11px] text-slate">Latest revision: Rev {latest.revision_number} ({latest.kind}) · {formatMoney(latest.grand_total, latest.currency || currency)} · {new Date(latest.created_at).toLocaleDateString()}</p>
      )}

      {pasteText && (
        <PastePreviewDialog
          key={pasteText.text}
          text={pasteText.text}
          defaultSection={editor.lines.find((l) => l.line_id === pasteText.at)?.section || DEFAULT_SECTION}
          currency={currency}
          onCancel={() => setPasteText(null)}
          onConfirm={(lines) => {
            editor.insert(pasteText.at ?? editor.lines[editor.lines.length - 1]?.line_id ?? null, lines);
            setNotice(`${lines.length} pasted line(s) inserted. Ctrl+Z undoes the paste.`);
            setPasteText(null);
          }}
        />
      )}
      {readOnly && !closed && !can("quotations.update") && (
        <p className="text-xs text-slate flex items-center gap-1"><CircleAlert className="w-3.5 h-3.5" /> You can view this estimate but not edit it.</p>
      )}
    </div>
  );
}
