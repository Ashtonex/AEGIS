"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  FileText,
  Camera,
  Plus,
  Loader2,
  RefreshCw,
  FolderOpen,
  Eye,
  History,
  CheckCircle2,
  Clock,
  Layers,
  FileCheck2,
  X,
  ExternalLink,
  MapPin,
  Sun,
  CloudRain,
  Wind,
} from "lucide-react";
import {
  listProjectControlledDrawings,
  recordProjectControlledDrawing,
  listProjectProgressPhotos,
  recordProjectProgressPhoto,
  type ControlledDrawingItem,
  type ProgressPhotoDiaryItem,
} from "@/lib/api/projects";
import { formatDate } from "@/lib/utils";
import { ProgressPackModal } from "@/components/projects/ProgressPackModal";

interface ControlledDrawingsWorkspaceProps {
  projectId: string;
}

export function ControlledDrawingsWorkspace({ projectId }: ControlledDrawingsWorkspaceProps) {
  const [loading, setLoading] = useState(true);
  const [drawings, setDrawings] = useState<ControlledDrawingItem[]>([]);
  const [photos, setPhotos] = useState<ProgressPhotoDiaryItem[]>([]);
  const [activeTab, setActiveTab] = useState<"drawings" | "photos">("drawings");
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>("all");
  const [selectedTag, setSelectedTag] = useState<string>("all");

  // Modals
  const [isDrawingModalOpen, setIsDrawingModalOpen] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isProgressPackOpen, setIsProgressPackOpen] = useState(false);
  const [inspectingDrawing, setInspectingDrawing] = useState<ControlledDrawingItem | null>(null);

  // Drawing Form
  const [drawingNumber, setDrawingNumber] = useState("");
  const [drawingTitle, setDrawingTitle] = useState("");
  const [discipline, setDiscipline] = useState("structural");
  const [revision, setRevision] = useState("Rev A");
  const [ifcStatus, setIfcStatus] = useState("issued_for_construction");
  const [dateReceived, setDateReceived] = useState(new Date().toISOString().split("T")[0]);
  const [fileUrl, setFileUrl] = useState("");
  const [submittingDrawing, setSubmittingDrawing] = useState(false);

  // Photo Form
  const [photoUrl, setPhotoUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [elementTag, setElementTag] = useState("Substructure");
  const [captureDate, setCaptureDate] = useState(new Date().toISOString().split("T")[0]);
  const [weatherCondition, setWeatherCondition] = useState("clear_sunny");
  const [gpsLat, setGpsLat] = useState("");
  const [gpsLng, setGpsLng] = useState("");
  const [submittingPhoto, setSubmittingPhoto] = useState(false);

  const [message, setMessage] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [dRes, pRes] = await Promise.all([
        listProjectControlledDrawings(projectId),
        listProjectProgressPhotos(projectId),
      ]);
      if (dRes.data) setDrawings(dRes.data);
      if (pRes.data) setPhotos(pRes.data);
    } catch (err) {
      console.error("Failed to load drawings & photos", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) {
      void loadData();
    }
  }, [projectId]);

  // Handle Drawing Submission
  const handleSaveDrawing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drawingNumber.trim() || !drawingTitle.trim()) return;
    setSubmittingDrawing(true);
    setMessage(null);
    try {
      const res = await recordProjectControlledDrawing(projectId, {
        drawing_number: drawingNumber.trim(),
        title: drawingTitle.trim(),
        discipline,
        current_revision: revision,
        ifc_status: ifcStatus,
        date_received: dateReceived,
        file_url: fileUrl.trim() || undefined,
      });
      setIsDrawingModalOpen(false);
      setDrawingNumber("");
      setDrawingTitle("");
      setMessage(
        res.data?.action === "revised"
          ? `Drawing revised to ${revision}. Previous version archived to superseded history.`
          : "Controlled drawing registered successfully."
      );
      await loadData();
    } catch (err: any) {
      setMessage(err?.message || "Failed to register drawing.");
    } finally {
      setSubmittingDrawing(false);
    }
  };

  // Handle Photo Submission
  const handleSavePhoto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoUrl.trim() || !caption.trim()) return;
    setSubmittingPhoto(true);
    setMessage(null);
    try {
      await recordProjectProgressPhoto(projectId, {
        photo_url: photoUrl.trim(),
        caption: caption.trim(),
        element_tag: elementTag,
        captured_date: captureDate,
        weather_condition: weatherCondition,
        gps_lat: gpsLat ? Number(gpsLat) : undefined,
        gps_lng: gpsLng ? Number(gpsLng) : undefined,
      });
      setIsPhotoModalOpen(false);
      setPhotoUrl("");
      setCaption("");
      setMessage("Site progress photo diary entry saved.");
      await loadData();
    } catch (err: any) {
      setMessage(err?.message || "Failed to save photo.");
    } finally {
      setSubmittingPhoto(false);
    }
  };

  const filteredDrawings = useMemo(() => {
    if (selectedDiscipline === "all") return drawings;
    return drawings.filter((d) => d.discipline === selectedDiscipline);
  }, [drawings, selectedDiscipline]);

  const filteredPhotos = useMemo(() => {
    if (selectedTag === "all") return photos;
    return photos.filter((p) => p.element_tag === selectedTag);
  }, [photos, selectedTag]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 text-slate-light font-mono text-sm">
        <Loader2 className="h-5 w-5 animate-spin text-signal" />
        Auditing controlled drawing register &amp; photo diary...
      </div>
    );
  }

  const ifcCount = drawings.filter((d) => d.ifc_status === "issued_for_construction").length;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FolderOpen className="h-6 w-6 text-signal" />
            <h3 className="font-display text-xl font-bold text-paper sm:text-2xl">
              Controlled Drawing Register &amp; Site Photo Diary
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-light">
            Controlled engineering revisions (Architectural, Structural, MEP, Civil), IFC status management, superseded history tracking, and element-tagged site progress photo diary.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink px-3 py-1.5 font-mono text-xs text-slate-light hover:text-paper"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => setIsProgressPackOpen(true)}
            className="inline-flex items-center gap-1.5 border border-emerald-500/50 bg-emerald-950/20 px-3.5 py-1.5 font-mono text-xs font-bold text-emerald-300 hover:bg-emerald-500 hover:text-ink active:scale-[0.98] transition-all"
          >
            <FileCheck2 className="h-3.5 w-3.5" />
            <span>Generate Progress Pack</span>
          </button>
          {activeTab === "drawings" ? (
            <button
              type="button"
              onClick={() => setIsDrawingModalOpen(true)}
              className="inline-flex items-center gap-1.5 border border-signal bg-signal px-3.5 py-1.5 font-mono text-xs font-bold text-ink hover:bg-signal/90 active:scale-[0.98] transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Register / Revise Drawing</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsPhotoModalOpen(true)}
              className="inline-flex items-center gap-1.5 border border-signal bg-signal px-3.5 py-1.5 font-mono text-xs font-bold text-ink hover:bg-signal/90 active:scale-[0.98] transition-all"
            >
              <Camera className="h-3.5 w-3.5" />
              <span>Add Progress Photo</span>
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="flex items-center justify-between border border-signal/40 bg-signal/10 px-4 py-2.5 font-mono text-xs text-paper">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} className="text-slate hover:text-paper">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Workspace Switcher */}
      <div className="flex border-b border-ink-mid">
        <button
          type="button"
          onClick={() => setActiveTab("drawings")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors ${
            activeTab === "drawings"
              ? "border-signal text-signal font-bold bg-signal/5"
              : "border-transparent text-slate hover:text-paper hover:bg-ink-light/40"
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Controlled Drawings Register ({drawings.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("photos")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors ${
            activeTab === "photos"
              ? "border-signal text-signal font-bold bg-signal/5"
              : "border-transparent text-slate hover:text-paper hover:bg-ink-light/40"
          }`}
        >
          <Camera className="h-4 w-4" />
          <span>Site Progress Photo Diary ({photos.length})</span>
        </button>
      </div>

      {activeTab === "drawings" ? (
        <div className="space-y-4">
          {/* Discipline Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 font-mono text-xs">
              {["all", "structural", "architectural", "mep_mechanical", "mep_electrical", "civil_infrastructure"].map((disc) => (
                <button
                  key={disc}
                  type="button"
                  onClick={() => setSelectedDiscipline(disc)}
                  className={`px-3 py-1 text-[11px] uppercase transition-colors ${
                    selectedDiscipline === disc
                      ? "bg-signal text-ink font-bold"
                      : "border border-ink-mid bg-ink text-slate hover:text-paper"
                  }`}
                >
                  {disc.replace(/_/g, " ")}
                </button>
              ))}
            </div>

            <div className="font-mono text-xs text-slate">
              <strong className="text-emerald-400">{ifcCount}</strong> IFC (Issued for Construction)
            </div>
          </div>

          {/* Drawings Register Table */}
          <section className="border border-ink-mid bg-ink/70">
            {filteredDrawings.length === 0 ? (
              <div className="p-12 text-center font-mono text-xs text-slate-light">
                No controlled drawings on register for this discipline. Click &quot;Register / Revise Drawing&quot; to add one.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="border-b border-ink-mid bg-ink-light/50 text-[11px] uppercase tracking-wider text-slate">
                    <tr>
                      <th className="p-3">Drawing Number</th>
                      <th className="p-3">Drawing Title</th>
                      <th className="p-3">Discipline</th>
                      <th className="p-3">Revision</th>
                      <th className="p-3">IFC Status</th>
                      <th className="p-3">Received Date</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid/40">
                    {filteredDrawings.map((drw) => {
                      const isIFC = drw.ifc_status === "issued_for_construction";
                      const historyCount = drw.superseded_history?.length || 0;

                      return (
                        <tr key={drw.id} className="hover:bg-ink-light/30 transition-colors">
                          <td className="p-3">
                            <span className="font-bold text-paper">{drw.drawing_number}</span>
                          </td>
                          <td className="p-3">
                            <div className="text-paper">{drw.title}</div>
                          </td>
                          <td className="p-3">
                            <span className="text-slate uppercase text-[10px]">
                              {drw.discipline.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className="font-bold text-signal px-2 py-0.5 border border-signal/40 bg-signal/10">
                              {drw.current_revision}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`inline-block border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              isIFC
                                ? "border-emerald-500/50 bg-emerald-950/20 text-emerald-400"
                                : "border-slate-500/40 text-slate-300"
                            }`}>
                              {drw.ifc_status.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="p-3 text-slate-light">
                            {drw.date_received ? formatDate(drw.date_received) : "-"}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {historyCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setInspectingDrawing(drw)}
                                  className="inline-flex items-center gap-1 border border-ink-mid bg-ink px-2 py-1 text-[10px] text-slate hover:text-paper"
                                  title="View superseded history"
                                >
                                  <History className="h-3 w-3" />
                                  <span>{historyCount} Superseded</span>
                                </button>
                              )}
                              {drw.file_url ? (
                                <a
                                  href={drw.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 border border-ink-mid bg-ink px-2 py-1 text-[10px] text-signal hover:border-signal"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  <span>Open</span>
                                </a>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Photo Tag Filter */}
          <div className="flex flex-wrap items-center gap-1 font-mono text-xs">
            {["all", "Substructure", "Superstructure", "Columns & Beams", "Slab Pour", "MEP Rough-in", "Finishes", "General Site"].map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(tag)}
                className={`px-3 py-1 text-[11px] transition-colors ${
                  selectedTag === tag
                    ? "bg-signal text-ink font-bold"
                    : "border border-ink-mid bg-ink text-slate hover:text-paper"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>

          {/* Photo Diary Gallery Grid */}
          {filteredPhotos.length === 0 ? (
            <div className="border border-ink-mid bg-ink/70 p-12 text-center font-mono text-xs text-slate-light">
              No site progress photos captured for this tag. Click &quot;Add Progress Photo&quot; to upload mobile evidence.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredPhotos.map((photo) => (
                <div key={photo.id} className="border border-ink-mid bg-ink overflow-hidden group">
                  <div className="aspect-video bg-ink-light/80 relative overflow-hidden flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.photo_url}
                      alt={photo.caption}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-2 left-2 border border-black/50 bg-black/70 px-2 py-0.5 font-mono text-[9px] uppercase font-bold text-signal">
                      {photo.element_tag}
                    </div>
                  </div>
                  <div className="p-3 font-mono space-y-1">
                    <p className="font-bold text-paper text-xs">{photo.caption}</p>
                    <div className="flex items-center justify-between text-[10px] text-slate pt-1 border-t border-ink-mid/40">
                      <span>{photo.captured_date ? formatDate(photo.captured_date) : ""}</span>
                      <span className="capitalize">{photo.weather_condition?.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: Register / Revise Drawing */}
      {isDrawingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-signal/50 bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-signal" />
                <h3 className="font-display text-lg font-bold text-paper">Register / Revise Controlled Drawing</h3>
              </div>
              <button type="button" onClick={() => setIsDrawingModalOpen(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveDrawing} className="space-y-3 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Drawing Number *</label>
                  <input
                    required
                    value={drawingNumber}
                    onChange={(e) => setDrawingNumber(e.target.value)}
                    placeholder="e.g. STR-04-101"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                  />
                  <span className="text-[9px] text-slate">If exists, will supersede revision.</span>
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Current Revision *</label>
                  <input
                    required
                    value={revision}
                    onChange={(e) => setRevision(e.target.value)}
                    placeholder="e.g. Rev B"
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate uppercase text-[10px]">Drawing Title *</label>
                <input
                  required
                  value={drawingTitle}
                  onChange={(e) => setDrawingTitle(e.target.value)}
                  placeholder="e.g. Ground Floor Column & Beam Reinforcement Layout"
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Engineering Discipline</label>
                  <select
                    value={discipline}
                    onChange={(e) => setDiscipline(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                  >
                    <option value="structural">Structural</option>
                    <option value="architectural">Architectural</option>
                    <option value="mep_mechanical">MEP - Mechanical</option>
                    <option value="mep_electrical">MEP - Electrical</option>
                    <option value="mep_plumbing">MEP - Plumbing</option>
                    <option value="civil_infrastructure">Civil Infrastructure</option>
                    <option value="geotechnical">Geotechnical</option>
                    <option value="landscape_external">Landscape &amp; External</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">IFC Status</label>
                  <select
                    value={ifcStatus}
                    onChange={(e) => setIfcStatus(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                  >
                    <option value="issued_for_construction">Issued for Construction (IFC)</option>
                    <option value="for_review_approval">For Review / Approval</option>
                    <option value="preliminary_tender">Preliminary / Tender</option>
                    <option value="for_information_only">For Information Only</option>
                    <option value="as_built">As-Built</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate uppercase text-[10px]">Drawing PDF / CAD URL</label>
                <input
                  value={fileUrl}
                  onChange={(e) => setFileUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setIsDrawingModalOpen(false)}
                  className="border border-ink-mid px-4 py-2 text-slate hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingDrawing}
                  className="border border-signal bg-signal px-4 py-2 font-bold text-ink hover:bg-signal/90 disabled:opacity-50"
                >
                  {submittingDrawing ? "Registering..." : "Commit Drawing"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Progress Photo */}
      {isPhotoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-signal/50 bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <div className="flex items-center gap-2">
                <Camera className="h-5 w-5 text-signal" />
                <h3 className="font-display text-lg font-bold text-paper">Record Site Progress Photo</h3>
              </div>
              <button type="button" onClick={() => setIsPhotoModalOpen(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSavePhoto} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-slate uppercase text-[10px]">Photo Image URL *</label>
                <input
                  required
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                  placeholder="https://... (or Supabase public storage URL)"
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                />
              </div>

              <div>
                <label className="block text-slate uppercase text-[10px]">Photo Caption *</label>
                <input
                  required
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="e.g. Ground floor slab rebar layout ready for inspection"
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate uppercase text-[10px]">Site Element Tag</label>
                  <select
                    value={elementTag}
                    onChange={(e) => setElementTag(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                  >
                    <option value="Substructure">Substructure &amp; Foundations</option>
                    <option value="Columns & Beams">Columns &amp; Beams</option>
                    <option value="Slab Pour">Slab Pour</option>
                    <option value="Superstructure">Superstructure</option>
                    <option value="MEP Rough-in">MEP Rough-in</option>
                    <option value="Finishes">Finishes &amp; Plaster</option>
                    <option value="General Site">General Site Overview</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate uppercase text-[10px]">Capture Date</label>
                  <input
                    type="date"
                    required
                    value={captureDate}
                    onChange={(e) => setCaptureDate(e.target.value)}
                    className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate uppercase text-[10px]">Weather Observation</label>
                <select
                  value={weatherCondition}
                  onChange={(e) => setWeatherCondition(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2 text-paper outline-none focus:border-signal"
                >
                  <option value="clear_sunny">Clear / Sunny</option>
                  <option value="overcast">Overcast</option>
                  <option value="light_rain">Light Rain</option>
                  <option value="heavy_rain">Heavy Rain</option>
                  <option value="windy">Windy</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setIsPhotoModalOpen(false)}
                  className="border border-ink-mid px-4 py-2 text-slate hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingPhoto}
                  className="border border-signal bg-signal px-4 py-2 font-bold text-ink hover:bg-signal/90 disabled:opacity-50"
                >
                  {submittingPhoto ? "Saving..." : "Record Photo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Superseded History */}
      {inspectingDrawing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md border border-ink-mid bg-ink p-5 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-ink-mid pb-2">
              <h4 className="font-bold text-paper">
                Superseded History: {inspectingDrawing.drawing_number}
              </h4>
              <button type="button" onClick={() => setInspectingDrawing(null)} className="text-slate hover:text-paper">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {inspectingDrawing.superseded_history?.map((h, i) => (
                <div key={i} className="border border-ink-mid bg-ink-light/40 p-2.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-signal">{h.revision}</span>
                    <span className="text-[10px] text-slate">Superseded: {formatDate(h.superseded_date)}</span>
                  </div>
                  {h.file_url && (
                    <a href={h.file_url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 text-[10px] underline">
                      View Archived Copy
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Progress Pack Full Preview Modal */}
      {isProgressPackOpen && (
        <ProgressPackModal projectId={projectId} onClose={() => setIsProgressPackOpen(false)} />
      )}
    </div>
  );
}
