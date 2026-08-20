"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FileText, Upload, Loader2, AlertCircle, CheckCircle, CheckSquare, Square,
  Plus, Trash2, ArrowRight, Layers, ShieldCheck, Sparkles, Cpu, Eye, CircleHelp
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  createDrawingRevision, listDrawingRevisions, getDrawingRevision,
  replaceDrawingMeasurements, setDrawingChecklistItem, commitDrawingRevision,
  deleteDrawingRevision,
} from "@/lib/api";
import { useModuleTour } from "@/hooks/useModuleTour";
import { ModuleTour, type ModuleTourStep } from "@/components/onboarding/ModuleTour";

const DRAWINGS_TOUR_STEPS: ModuleTourStep[] = [
  {
    title: "From a drawing to a checked takeoff",
    body: "This tool turns an uploaded drawing into a draft bill of quantities, then walks it through a review checklist before it can be committed as the baseline measurements a quote gets built from.",
    placement: "center",
  },
  {
    title: "Upload a drawing revision",
    body: "AI Vision reads an image or PDF straight into draft rows. CAD Parsing only understands DXF - export a native DWG to DXF first, or pick Manual Reference and type the DWG's measurements in yourself. The reading mode is guessed from the file extension but you can override it.",
    target: "drawings-upload",
    placement: "right",
  },
  {
    title: "Every revision, one history",
    body: "Every drawing's revisions live here with a status badge - draft, committed, or superseded. Click any row to load its measurements and checklist on the right.",
    target: "drawings-revisions",
    placement: "right",
  },
  {
    title: "Draft measurements",
    body: "Extracted or manually entered rows - description, unit, quantity - each tagged with where it came from and, for extracted rows, a confidence score. Rows are editable only while the revision is still a draft; save before committing.",
    target: "drawings-measurements",
    placement: "left",
  },
  {
    title: "The checklist is a reviewer sign-off, not a to-do list",
    body: "Every item here has to be an independent reviewer checking your work - the system will not let you tick off the checklist on a revision you created yourself. If you uploaded it, get a colleague to review and check it before it can be committed.",
    target: "drawings-checklist",
    placement: "left",
  },
  {
    title: "Commit, then hand off to the Builder",
    body: "Commit Revision is locked until every checklist item is ticked, and committing supersedes whatever was previously committed for that drawing. Once committed, \"Send Measurements to Builder\" carries the quantities straight into a new cost estimate - no re-typing.",
    target: "drawings-actions",
    placement: "top",
  },
];

type SourceMode = "ai_vision" | "cad_dxf" | "manual_reference";

function guessModeFromFilename(name: string): SourceMode {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "dxf") return "cad_dxf";
  if (ext === "dwg") return "manual_reference"; // native DWG isn't parsed - reference only
  if (["png", "jpg", "jpeg", "webp", "pdf"].includes(ext)) return "ai_vision";
  return "manual_reference";
}

export default function DrawingTakeoffPage() {
  const { session } = useAuth();
  const drawingsTour = useModuleTour("quotations_drawings");
  const [revisions, setRevisions] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Upload form state
  const [drawingName, setDrawingName] = useState("");
  const [revisionLabel, setRevisionLabel] = useState("R1");
  const [sourceMode, setSourceMode] = useState<SourceMode>("manual_reference");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Editable measurements for the selected revision
  const [measurements, setMeasurements] = useState<any[]>([]);
  const [savingMeasurements, setSavingMeasurements] = useState(false);
  const [committing, setCommitting] = useState(false);

  const loadRevisions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDrawingRevisions();
      if (res.success && Array.isArray(res.data)) setRevisions(res.data);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load drawing revisions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) void loadRevisions();
  }, [session, loadRevisions]);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setErrorMsg("");
    try {
      const res = await getDrawingRevision(id);
      if (res.success) {
        setSelected(res.data);
        setMeasurements(res.data.measurements || []);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load drawing revision detail.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setSelected(null);
  }, [selectedId, loadDetail]);

  const handleFileChange = (f: File | null) => {
    setFile(f);
    if (f) {
      setSourceMode(guessModeFromFilename(f.name));
      if (!drawingName) setDrawingName(f.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleUpload = async () => {
    if (!drawingName.trim()) {
      setErrorMsg("Drawing name is required.");
      return;
    }
    setUploading(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      let fileUrl: string | undefined;
      let fileName: string | undefined;
      let mimeType: string | undefined;

      if (file) {
        const fileExt = file.name.split(".").pop();
        const storedName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
        const filePath = `drawings/${storedName}`;
        const { error: uploadError } = await supabase.storage
          .from("construction-drawings")
          .upload(filePath, file, { cacheControl: "3600", upsert: false });
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from("construction-drawings").getPublicUrl(filePath);
        fileUrl = publicUrl;
        fileName = file.name;
        mimeType = file.type;
      }

      const res = await createDrawingRevision({
        drawing_name: drawingName.trim(),
        revision_label: revisionLabel.trim() || "R1",
        source_mode: sourceMode,
        file_url: fileUrl,
        file_name: fileName,
        mime_type: mimeType,
      });

      if (res.success) {
        setSuccessMsg(res.message || "Drawing revision created.");
        setDrawingName("");
        setRevisionLabel("R1");
        setFile(null);
        await loadRevisions();
        if (res.data?.id) setSelectedId(res.data.id);
      } else {
        setErrorMsg(res.message || "Failed to create drawing revision.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to upload drawing.");
    } finally {
      setUploading(false);
    }
  };

  const updateMeasurementRow = (idx: number, field: string, value: any) => {
    setMeasurements((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value, source: field === "description" || field === "quantity" || field === "unit" ? "manual" : copy[idx].source };
      return copy;
    });
  };

  const addMeasurementRow = () => {
    setMeasurements((prev) => [...prev, { description: "", unit: "unit", quantity: 0, source: "manual", confidence_pct: null }]);
  };

  const removeMeasurementRow = (idx: number) => {
    setMeasurements((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveMeasurements = async () => {
    if (!selectedId) return;
    setSavingMeasurements(true);
    setErrorMsg("");
    try {
      const res = await replaceDrawingMeasurements(selectedId, measurements);
      if (res.success) {
        setSuccessMsg("Measurements saved.");
        await loadDetail(selectedId);
      } else {
        setErrorMsg(res.message || "Failed to save measurements.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save measurements.");
    } finally {
      setSavingMeasurements(false);
    }
  };

  const handleToggleChecklist = async (itemId: string, checked: boolean) => {
    if (!selectedId) return;
    try {
      await setDrawingChecklistItem(selectedId, itemId, checked);
      await loadDetail(selectedId);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to update checklist item.");
    }
  };

  const handleCommit = async () => {
    if (!selectedId) return;
    if (!confirm("Commit this revision as the current baseline for this drawing? This will supersede any previously committed revision.")) return;
    setCommitting(true);
    setErrorMsg("");
    try {
      const res = await commitDrawingRevision(selectedId);
      if (res.success) {
        setSuccessMsg(res.message || "Revision committed.");
        await loadDetail(selectedId);
        await loadRevisions();
      } else {
        setErrorMsg(res.message || "Failed to commit revision.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to commit revision. Check that every checklist item is ticked.");
    } finally {
      setCommitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this draft revision?")) return;
    try {
      await deleteDrawingRevision(id);
      if (selectedId === id) setSelectedId(null);
      await loadRevisions();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to delete revision.");
    }
  };

  const allChecked = selected?.checklist?.length > 0 && selected.checklist.every((c: any) => c.is_checked);
  const boqQueryParam = selectedId ? `?from_drawing=${selectedId}` : "";

  const modeIcon = (mode: SourceMode) =>
    mode === "ai_vision" ? <Sparkles className="w-3.5 h-3.5" /> : mode === "cad_dxf" ? <Cpu className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />;

  const statusColor = (status: string) =>
    status === "committed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
    status === "superseded" ? "bg-slate-500/10 text-slate border-slate-500/20" :
    "bg-amber-500/10 text-amber-400 border-amber-500/20";

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 text-paper">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white flex items-center gap-3">
              <Layers className="w-7 h-7 text-signal" />
              Drawing Takeoff &amp; Change Control
            </h1>
            <p className="text-sm text-slate mt-1">
              Upload a drawing, get a draft bill of quantities (AI vision, DXF/CAD parsing, or plain manual reference), then commit it as the baseline once the checklist is complete.
            </p>
          </div>
          <button
            onClick={drawingsTour.openTour}
            className="text-slate hover:text-paper transition-colors"
            title="Replay Drawing Takeoff tour"
            aria-label="Replay Drawing Takeoff tour"
          >
            <CircleHelp className="w-5 h-5" />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 border border-red-500/20 bg-red-950/20 rounded-sm flex items-center space-x-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-4 border border-emerald-500/20 bg-emerald-950/20 rounded-sm flex items-center space-x-3 text-emerald-400 text-sm">
          <CheckCircle className="w-5 h-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* LEFT: Upload + revision list */}
        <div className="space-y-6">
          <div data-tour="drawings-upload" className="bg-ink-light border border-ink-mid p-6 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-4">
            <h2 className="font-display font-semibold text-sm text-white border-b border-ink-mid pb-2 flex items-center gap-2">
              <Upload className="w-4 h-4 text-signal" /> New Drawing Revision
            </h2>

            <label className="block">
              <span className="font-mono text-[9px] uppercase text-slate">Drawing Name</span>
              <input
                type="text"
                value={drawingName}
                onChange={(e) => setDrawingName(e.target.value)}
                placeholder="e.g. Ground Floor Plan"
                className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[9px] uppercase text-slate">Revision Label</span>
              <input
                type="text"
                value={revisionLabel}
                onChange={(e) => setRevisionLabel(e.target.value)}
                className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[9px] uppercase text-slate">Attach File (optional)</span>
              <input
                type="file"
                accept=".dxf,.dwg,.pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                className="mt-1.5 w-full text-xs text-slate-light file:mr-3 file:py-1.5 file:px-3 file:border file:border-ink-mid file:text-xs file:font-mono file:bg-ink file:text-paper hover:file:bg-signal/10 file:cursor-pointer"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[9px] uppercase text-slate">Reading Mode</span>
              <select
                value={sourceMode}
                onChange={(e) => setSourceMode(e.target.value as SourceMode)}
                className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
              >
                <option value="ai_vision">AI Vision (image/PDF drawings)</option>
                <option value="cad_dxf">CAD Parsing (DXF files only)</option>
                <option value="manual_reference">Manual Reference (I&apos;ll enter measurements myself)</option>
              </select>
              {sourceMode === "ai_vision" && (
                <p className="text-[10px] text-slate mt-1">Requires an AI vision key to be configured on the server. If it isn&apos;t, this falls back to an empty draft you fill in manually.</p>
              )}
              {sourceMode === "cad_dxf" && (
                <p className="text-[10px] text-slate mt-1">Native DWG files aren&apos;t parsed - export to DXF first, or use Manual Reference for DWG.</p>
              )}
            </label>

            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || !drawingName.trim()}
              className="w-full flex items-center justify-center space-x-2 bg-signal text-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide rounded-sm hover:bg-signal-hover transition-all disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span>{uploading ? "Uploading & Reading..." : "Create Draft Revision"}</span>
            </button>
          </div>

          <div data-tour="drawings-revisions" className="bg-ink-light border border-ink-mid p-6 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-3">
            <h2 className="font-display font-semibold text-sm text-white border-b border-ink-mid pb-2">
              Revisions
            </h2>
            {loading ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 text-signal animate-spin" /></div>
            ) : revisions.length === 0 ? (
              <p className="text-xs text-slate py-4 text-center">No drawing revisions yet.</p>
            ) : (
              <div className="space-y-2 max-h-[480px] overflow-y-auto">
                {revisions.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left p-3 border rounded-sm transition-colors ${selectedId === r.id ? "border-signal bg-signal/5" : "border-ink-mid hover:border-ink-mid/80 bg-ink"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white truncate max-w-[140px]">{r.drawing_name}</span>
                      <span className={`inline-flex px-1.5 py-0.5 rounded-sm border text-[9px] font-mono uppercase ${statusColor(r.status)}`}>{r.status}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate font-mono">
                      {modeIcon(r.source_mode)}
                      <span>{r.revision_label}</span>
                      <span>&middot;</span>
                      <span>{r.extraction_status}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Selected revision detail */}
        <div className="lg:col-span-2 space-y-6">
          {!selectedId ? (
            <div className="bg-ink-light border border-dashed border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] py-24 flex flex-col items-center justify-center space-y-3 text-slate">
              <FileText className="w-12 h-12 opacity-30" />
              <p className="text-sm">Select a revision to review its measurements and checklist.</p>
            </div>
          ) : loadingDetail || !selected ? (
            <div className="py-24 flex justify-center"><Loader2 className="w-8 h-8 text-signal animate-spin" /></div>
          ) : (
            <>
              <div className="bg-ink-light border border-ink-mid p-6 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-semibold text-lg text-white">{selected.drawing_name} ({selected.revision_label})</h2>
                  <span className={`inline-flex px-2 py-0.5 rounded-sm border text-[10px] font-mono uppercase ${statusColor(selected.status)}`}>{selected.status}</span>
                </div>
                <p className="text-xs text-slate">
                  Mode: {selected.source_mode} &middot; Extraction: {selected.extraction_status}
                  {selected.extraction_confidence_pct != null && ` (${selected.extraction_confidence_pct}% confidence)`}
                </p>
                {selected.extraction_notes && (
                  <p className="text-xs text-slate-light bg-ink border border-ink-mid/50 p-3 rounded-sm">{selected.extraction_notes}</p>
                )}
                {selected.file_url && (
                  <a href={selected.file_url} target="_blank" rel="noreferrer" className="text-xs text-signal hover:underline inline-block mt-1">
                    View attached file ({selected.file_name})
                  </a>
                )}
              </div>

              {/* Measurements table */}
              <div data-tour="drawings-measurements" className="bg-ink-light border border-ink-mid p-6 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-4">
                <div className="flex items-center justify-between border-b border-ink-mid pb-2">
                  <h3 className="font-display font-semibold text-sm text-white">Draft Measurements</h3>
                  <button
                    type="button"
                    onClick={addMeasurementRow}
                    disabled={selected.status !== "draft"}
                    className="flex items-center space-x-1 text-xs text-signal hover:text-signal-hover disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" /> <span>Add Row</span>
                  </button>
                </div>

                {measurements.length === 0 ? (
                  <p className="text-xs text-slate py-4 text-center">No measurements yet. Add rows manually or attach a file to auto-extract.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-12 gap-2 text-[9px] font-mono text-slate uppercase border-b border-ink-mid/30 pb-1">
                      <span className="col-span-5">Description</span>
                      <span className="col-span-2">Unit</span>
                      <span className="col-span-2 text-right">Quantity</span>
                      <span className="col-span-2 text-center">Source</span>
                      <span className="col-span-1"></span>
                    </div>
                    {measurements.map((m, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center text-xs">
                        <input
                          value={m.description}
                          onChange={(e) => updateMeasurementRow(idx, "description", e.target.value)}
                          disabled={selected.status !== "draft"}
                          className="col-span-5 bg-ink border border-ink-mid text-white text-xs p-1.5 focus:border-signal outline-none disabled:opacity-60"
                        />
                        <input
                          value={m.unit}
                          onChange={(e) => updateMeasurementRow(idx, "unit", e.target.value)}
                          disabled={selected.status !== "draft"}
                          className="col-span-2 bg-ink border border-ink-mid text-white text-xs p-1.5 focus:border-signal outline-none disabled:opacity-60"
                        />
                        <input
                          type="number"
                          step="any"
                          value={m.quantity}
                          onChange={(e) => updateMeasurementRow(idx, "quantity", parseFloat(e.target.value) || 0)}
                          disabled={selected.status !== "draft"}
                          className="col-span-2 bg-ink border border-ink-mid text-right text-white text-xs p-1.5 focus:border-signal outline-none disabled:opacity-60 font-mono"
                        />
                        <span className="col-span-2 text-center text-[9px] font-mono uppercase text-slate">
                          {m.source}{m.confidence_pct != null ? ` ${m.confidence_pct}%` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeMeasurementRow(idx)}
                          disabled={selected.status !== "draft"}
                          className="col-span-1 text-slate hover:text-red-400 disabled:opacity-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {selected.status === "draft" && (
                  <button
                    type="button"
                    onClick={handleSaveMeasurements}
                    disabled={savingMeasurements}
                    className="text-xs bg-ink border border-ink-mid hover:border-signal/50 text-white px-4 py-2 rounded-sm transition-all disabled:opacity-50"
                  >
                    {savingMeasurements ? "Saving..." : "Save Measurements"}
                  </button>
                )}
              </div>

              {/* Checklist */}
              <div data-tour="drawings-checklist" className="bg-ink-light border border-ink-mid p-6 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-3">
                <h3 className="font-display font-semibold text-sm text-white border-b border-ink-mid pb-2 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-signal" /> Change-Control Checklist
                </h3>
                <p className="text-xs text-slate">Every item must be ticked before this revision can be committed as the baseline.</p>
                <div className="space-y-2">
                  {(selected.checklist || []).map((item: any) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleToggleChecklist(item.id, !item.is_checked)}
                      disabled={selected.status !== "draft"}
                      className="w-full flex items-center space-x-3 text-left p-2 rounded-sm hover:bg-ink transition-colors disabled:opacity-60"
                    >
                      {item.is_checked ? <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" /> : <Square className="w-4 h-4 text-slate shrink-0" />}
                      <span className={`text-xs ${item.is_checked ? "text-slate-light line-through" : "text-white"}`}>{item.item_label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div data-tour="drawings-actions" className="flex flex-wrap items-center gap-3">
                {selected.status === "draft" && (
                  <button
                    type="button"
                    onClick={handleCommit}
                    disabled={!allChecked || committing}
                    className="flex items-center space-x-2 bg-emerald-600 text-white px-4 py-2.5 text-xs font-bold uppercase tracking-wide rounded-sm hover:bg-emerald-500 transition-all disabled:opacity-40"
                    title={!allChecked ? "Complete every checklist item first" : "Commit as the current baseline"}
                  >
                    {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    <span>Commit Revision</span>
                  </button>
                )}
                <Link
                  href={`/dashboard/quotations/builder${boqQueryParam}`}
                  className="flex items-center space-x-2 border border-signal/40 text-signal px-4 py-2.5 text-xs font-semibold rounded-sm hover:bg-signal/10 transition-all"
                >
                  <span>Send Measurements to Builder</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                {selected.status === "draft" && (
                  <button
                    type="button"
                    onClick={() => handleDelete(selected.id)}
                    className="flex items-center space-x-2 text-xs text-slate hover:text-red-400 px-3 py-2.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Draft</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ModuleTour
        steps={DRAWINGS_TOUR_STEPS}
        open={drawingsTour.open}
        onClose={drawingsTour.closeTour}
        onComplete={drawingsTour.completeTour}
      />
    </div>
  );
}
