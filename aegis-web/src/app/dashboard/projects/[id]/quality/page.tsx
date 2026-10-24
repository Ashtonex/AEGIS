"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Award,
  Plus,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CheckSquare,
  Square,
  FileCheck,
  Camera,
  Layers,
  FlaskConical,
  Flame,
  ArrowRight,
  Loader2,
  Trash2,
  Edit2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useProject } from "@/context/ProjectWorkspaceContext";
import {
  listProjectPourCards,
  createProjectPourCard,
  updateProjectPourCard,
  authorizeProjectPour,
  listProjectSnags,
  createProjectSnag,
  updateProjectSnag,
  signOffProjectSnag,
  ConcretePourCard,
  SiteSnag,
} from "@/lib/api/projects";
import { formatDate } from "@/lib/utils";

export default function ProjectQualityPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { project } = useProject();

  const [activeTab, setActiveTab] = useState<"pour_cards" | "snags">("pour_cards");
  const [pourCards, setPourCards] = useState<ConcretePourCard[]>([]);
  const [snags, setSnags] = useState<SiteSnag[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Pour Card Modal State
  const [isPourModalOpen, setIsPourModalOpen] = useState(false);
  const [pourNumber, setPourNumber] = useState("");
  const [elementName, setElementName] = useState("");
  const [structureLevel, setStructureLevel] = useState("Substructure");
  const [concreteGrade, setConcreteGrade] = useState("C25/30");
  const [designVolume, setDesignVolume] = useState("15");
  const [targetSlump, setTargetSlump] = useState("100");
  const [supplierName, setSupplierName] = useState("Site Ready-Mix Batch Plant");
  const [pourNotes, setPourNotes] = useState("");
  const [savingPour, setSavingPour] = useState(false);
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);

  // Snag Modal State
  const [isSnagModalOpen, setIsSnagModalOpen] = useState(false);
  const [snagNumber, setSnagNumber] = useState("");
  const [snagTitle, setSnagTitle] = useState("");
  const [locationZone, setLocationZone] = useState("");
  const [severity, setSeverity] = useState<"cosmetic" | "minor" | "major" | "critical_safety">("minor");
  const [trade, setTrade] = useState("Formwork & Concrete");
  const [dueDate, setDueDate] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [snagDescription, setSnagDescription] = useState("");
  const [savingSnag, setSavingSnag] = useState(false);
  const [rectifyingId, setRectifyingId] = useState<string | null>(null);
  const [signingOffId, setSigningOffId] = useState<string | null>(null);

  // Filters
  const [pourFilter, setPourFilter] = useState("all");
  const [snagFilter, setSnagFilter] = useState("all");

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const [pcRes, sngRes] = await Promise.all([
        listProjectPourCards(projectId),
        listProjectSnags(projectId),
      ]);
      if (pcRes?.data) setPourCards(pcRes.data);
      if (sngRes?.data) setSnags(sngRes.data);
    } catch (err) {
      console.error("Failed to load QA data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  // Pour Card KPI calculation
  const pourStats = useMemo(() => {
    const total = pourCards.length;
    const approved = pourCards.filter((c) => c.status === "approved_for_pour" || c.status === "poured").length;
    const testing = pourCards.filter((c) => c.status === "curing_and_testing").length;
    const compliant = pourCards.filter((c) => c.test_result_verdict === "pass" || c.status === "compliant").length;
    const totalVolume = pourCards.reduce((acc, c) => acc + (Number(c.actual_volume_m3 || c.design_volume_m3) || 0), 0);
    return { total, approved, testing, compliant, totalVolume };
  }, [pourCards]);

  // Snag KPI calculation
  const snagStats = useMemo(() => {
    const total = snags.length;
    const open = snags.filter((s) => s.status === "open").length;
    const rectified = snags.filter((s) => s.status === "rectified").length;
    const closed = snags.filter((s) => s.status === "closed").length;
    const critical = snags.filter((s) => s.severity === "critical_safety" || s.severity === "major").length;
    return { total, open, rectified, closed, critical };
  }, [snags]);

  // Handlers for Pour Card
  const handleOpenNewPour = () => {
    const count = pourCards.length + 1;
    setPourNumber(`PC-${new Date().getFullYear()}-${String(count).padStart(3, "0")}`);
    setElementName("");
    setStructureLevel("Substructure");
    setConcreteGrade("C25/30");
    setDesignVolume("15");
    setTargetSlump("100");
    setSupplierName("Site Ready-Mix Batch Plant");
    setPourNotes("");
    setIsPourModalOpen(true);
  };

  const handleCreatePourCard = async () => {
    if (!elementName.trim() || !pourNumber.trim()) return;
    setSavingPour(true);
    try {
      await createProjectPourCard(projectId, {
        pour_number: pourNumber.trim(),
        element_name: elementName.trim(),
        structure_level: structureLevel,
        concrete_grade: concreteGrade,
        design_volume_m3: parseFloat(designVolume) || 0,
        target_slump_mm: parseInt(targetSlump, 10) || 100,
        supplier_name: supplierName.trim() || undefined,
        notes: pourNotes.trim() || undefined,
      });
      setIsPourModalOpen(false);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingPour(false);
    }
  };

  const handleToggleCheck = async (
    card: ConcretePourCard,
    field: "rebar_inspected" | "formwork_inspected" | "cleanliness_inspected" | "embedded_mep_inspected" | "cover_blocks_verified"
  ) => {
    const newVal = !card[field];
    try {
      await updateProjectPourCard(projectId, card.id, { [field]: newVal });
      setPourCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, [field]: newVal } : c))
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleAuthorizePour = async (card: ConcretePourCard) => {
    setAuthorizingId(card.id);
    try {
      await authorizeProjectPour(projectId, card.id);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setAuthorizingId(null);
    }
  };

  const handleRecordCubeStrength = async (card: ConcretePourCard, strength7d: number, strength28d: number) => {
    const verdict = strength28d >= 25 ? "pass" : strength28d > 0 ? "fail" : "pending";
    try {
      await updateProjectPourCard(projectId, card.id, {
        strength_7d_mpa: strength7d,
        strength_28d_mpa: strength28d,
        test_result_verdict: verdict,
        status: verdict === "pass" ? "compliant" : card.status,
      });
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  // Handlers for Snag
  const handleOpenNewSnag = () => {
    const count = snags.length + 1;
    setSnagNumber(`SNG-${String(count).padStart(3, "0")}`);
    setSnagTitle("");
    setLocationZone("");
    setSeverity("minor");
    setTrade("Formwork & Concrete");
    setDueDate("");
    setPhotoUrl("");
    setSnagDescription("");
    setIsSnagModalOpen(true);
  };

  const handleCreateSnag = async () => {
    if (!snagTitle.trim() || !locationZone.trim()) return;
    setSavingSnag(true);
    try {
      await createProjectSnag(projectId, {
        snag_number: snagNumber.trim(),
        title: snagTitle.trim(),
        location_zone: locationZone.trim(),
        severity,
        trade,
        due_date: dueDate || undefined,
        photo_url: photoUrl.trim() || undefined,
        description: snagDescription.trim() || undefined,
      });
      setIsSnagModalOpen(false);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingSnag(false);
    }
  };

  const handleMarkRectified = async (snag: SiteSnag) => {
    setRectifyingId(snag.id);
    try {
      await updateProjectSnag(projectId, snag.id, {
        status: "rectified",
      });
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setRectifyingId(null);
    }
  };

  const handleSignOffSnag = async (snag: SiteSnag) => {
    setSigningOffId(snag.id);
    try {
      await signOffProjectSnag(projectId, snag.id);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSigningOffId(null);
    }
  };

  const statusPills: Record<string, string> = {
    pre_pour_check: "text-amber-400 border-amber-500/40 bg-amber-950/20",
    approved_for_pour: "text-emerald-400 border-emerald-500/40 bg-emerald-950/20",
    poured: "text-sky-400 border-sky-500/40 bg-sky-950/20",
    curing_and_testing: "text-purple-400 border-purple-500/40 bg-purple-950/20",
    compliant: "text-emerald-400 border-emerald-500/40 bg-emerald-950/20",
    condemned: "text-red-400 border-red-500/40 bg-red-950/20",
    open: "text-amber-400 border-amber-500/40 bg-amber-950/20",
    rectified: "text-sky-400 border-sky-500/40 bg-sky-950/20",
    closed: "text-emerald-400 border-emerald-500/40 bg-emerald-950/20",
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="border border-ink-mid bg-ink p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
                Site Quality & Structural Controls
              </h2>
              <span className="font-mono text-xs uppercase px-2 py-0.5 border border-signal/40 bg-signal/10 text-signal font-bold">
                QA Verification Gate
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-light max-w-3xl">
              Concrete Pour Cards with strict 5-point pre-pour sign-off gates, 7d/28d cube crushing strength tracking,
              and mobile snag defect resolution workflows.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {activeTab === "pour_cards" ? (
              <button
                type="button"
                onClick={handleOpenNewPour}
                className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 border border-signal bg-signal px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 transition-all min-h-[40px]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Initiate Pour Card</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleOpenNewSnag}
                className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 border border-signal bg-signal px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 transition-all min-h-[40px]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Log Site Defect</span>
              </button>
            )}
          </div>
        </div>

        {/* Dynamic KPIs depending on active view */}
        {activeTab === "pour_cards" ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-ink-mid/60">
            <div className="p-3 border border-ink-mid/40 bg-ink-light/20">
              <span className="block font-mono text-[10px] uppercase text-slate-light">Total Structural Pours</span>
              <span className="font-mono text-lg font-bold text-paper">{pourStats.total}</span>
            </div>
            <div className="p-3 border border-emerald-500/30 bg-emerald-950/15">
              <span className="block font-mono text-[10px] uppercase text-emerald-400">Pour Authorized</span>
              <span className="font-mono text-lg font-bold text-emerald-300">{pourStats.approved}</span>
            </div>
            <div className="p-3 border border-purple-500/30 bg-purple-950/15">
              <span className="block font-mono text-[10px] uppercase text-purple-400">Cube Curing & Testing</span>
              <span className="font-mono text-lg font-bold text-purple-300">{pourStats.testing}</span>
            </div>
            <div className="p-3 border border-ink-mid/40 bg-ink-light/20">
              <span className="block font-mono text-[10px] uppercase text-slate-light">Concrete Volume Cast</span>
              <span className="font-mono text-lg font-bold text-paper">{pourStats.totalVolume.toFixed(1)} m³</span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-ink-mid/60">
            <div className="p-3 border border-ink-mid/40 bg-ink-light/20">
              <span className="block font-mono text-[10px] uppercase text-slate-light">Total Snags Logged</span>
              <span className="font-mono text-lg font-bold text-paper">{snagStats.total}</span>
            </div>
            <div className="p-3 border border-amber-500/30 bg-amber-950/15">
              <span className="block font-mono text-[10px] uppercase text-amber-400">Open Rectifications</span>
              <span className="font-mono text-lg font-bold text-amber-300">{snagStats.open}</span>
            </div>
            <div className="p-3 border border-sky-500/30 bg-sky-950/15">
              <span className="block font-mono text-[10px] uppercase text-sky-400">Rectified / Pending Review</span>
              <span className="font-mono text-lg font-bold text-sky-300">{snagStats.rectified}</span>
            </div>
            <div className="p-3 border border-emerald-500/30 bg-emerald-950/15">
              <span className="block font-mono text-[10px] uppercase text-emerald-400">QA Signed-Off & Closed</span>
              <span className="font-mono text-lg font-bold text-emerald-300">{snagStats.closed}</span>
            </div>
          </div>
        )}
      </div>

      {/* View Switcher: Pour Cards vs Snags */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-ink-mid bg-ink p-3">
        <div className="flex border border-ink-mid bg-ink-light">
          <button
            type="button"
            onClick={() => setActiveTab("pour_cards")}
            className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors flex items-center gap-2 ${
              activeTab === "pour_cards" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"
            }`}
          >
            <FlaskConical className="h-3.5 w-3.5" />
            <span>Concrete Pour Cards ({pourCards.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("snags")}
            className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors flex items-center gap-2 ${
              activeTab === "snags" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Snag & Defect Register ({snags.length})</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="border border-ink-mid bg-ink-light px-3 py-1.5 font-mono text-xs text-slate-light hover:text-paper"
        >
          {refreshing ? "Refreshing..." : "Refresh Records"}
        </button>
      </div>

      {/* SECTION 1: CONCRETE POUR CARDS */}
      {activeTab === "pour_cards" && (
        <section className="space-y-4">
          {pourCards.length === 0 ? (
            <div className="border border-ink-mid bg-ink p-12 text-center text-xs font-mono text-slate-light">
              No concrete pour cards recorded for this project. Click &quot;Initiate Pour Card&quot; to begin QA sign-off.
            </div>
          ) : (
            <div className="space-y-4">
              {pourCards.map((card) => {
                const allChecksPassed =
                  card.rebar_inspected &&
                  card.formwork_inspected &&
                  card.cleanliness_inspected &&
                  card.embedded_mep_inspected &&
                  card.cover_blocks_verified;

                const isApproved = card.status !== "pre_pour_check";

                return (
                  <div key={card.id} className="border border-ink-mid bg-ink p-4 sm:p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-mid/60 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-signal">{card.pour_number}</span>
                          <span className={`text-[10px] font-mono uppercase px-2 py-0.5 border ${statusPills[card.status] || statusPills.pre_pour_check}`}>
                            {card.status.replace(/_/g, " ")}
                          </span>
                          <span className="font-mono text-xs text-slate-light">
                            Level: {card.structure_level || "General"}
                          </span>
                        </div>
                        <h3 className="font-display text-base font-bold text-paper mt-1">
                          {card.element_name}
                        </h3>
                      </div>

                      <div className="flex items-center gap-4 text-xs font-mono text-slate-light">
                        <div>
                          Grade: <span className="font-bold text-paper">{card.concrete_grade}</span>
                        </div>
                        <div>
                          Vol: <span className="font-bold text-paper">{card.actual_volume_m3 || card.design_volume_m3} m³</span>
                        </div>
                        <div>
                          Target Slump: <span className="font-bold text-paper">{card.target_slump_mm}mm</span>
                        </div>
                      </div>
                    </div>

                    {/* Pre-Pour Sign-Off Gate Checklist */}
                    <div className="bg-ink-light/20 border border-ink-mid/40 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs uppercase font-bold text-paper flex items-center gap-1.5">
                          <ShieldCheck className="h-4 w-4 text-signal" />
                          Pre-Pour Engineering Sign-Off Gate
                        </span>
                        <span className={`font-mono text-[11px] font-bold ${allChecksPassed ? "text-emerald-400" : "text-amber-400"}`}>
                          {allChecksPassed ? "All 5 Checks Satisfied" : "Pending Inspections"}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-xs font-mono">
                        <button
                          type="button"
                          disabled={isApproved}
                          onClick={() => handleToggleCheck(card, "rebar_inspected")}
                          className={`p-2 border flex items-center gap-2 text-left transition-all ${
                            card.rebar_inspected
                              ? "border-emerald-500/60 bg-emerald-950/20 text-emerald-300"
                              : "border-ink-mid bg-ink text-slate-light hover:text-paper"
                          }`}
                        >
                          {card.rebar_inspected ? <CheckSquare className="h-4 w-4 text-emerald-400" /> : <Square className="h-4 w-4 text-slate-600" />}
                          <span>1. Rebar & Tie-Wire Placement</span>
                        </button>

                        <button
                          type="button"
                          disabled={isApproved}
                          onClick={() => handleToggleCheck(card, "formwork_inspected")}
                          className={`p-2 border flex items-center gap-2 text-left transition-all ${
                            card.formwork_inspected
                              ? "border-emerald-500/60 bg-emerald-950/20 text-emerald-300"
                              : "border-ink-mid bg-ink text-slate-light hover:text-paper"
                          }`}
                        >
                          {card.formwork_inspected ? <CheckSquare className="h-4 w-4 text-emerald-400" /> : <Square className="h-4 w-4 text-slate-600" />}
                          <span>2. Formwork Bracing & Rigidity</span>
                        </button>

                        <button
                          type="button"
                          disabled={isApproved}
                          onClick={() => handleToggleCheck(card, "cleanliness_inspected")}
                          className={`p-2 border flex items-center gap-2 text-left transition-all ${
                            card.cleanliness_inspected
                              ? "border-emerald-500/60 bg-emerald-950/20 text-emerald-300"
                              : "border-ink-mid bg-ink text-slate-light hover:text-paper"
                          }`}
                        >
                          {card.cleanliness_inspected ? <CheckSquare className="h-4 w-4 text-emerald-400" /> : <Square className="h-4 w-4 text-slate-600" />}
                          <span>3. Cleanliness & Air Blowout</span>
                        </button>

                        <button
                          type="button"
                          disabled={isApproved}
                          onClick={() => handleToggleCheck(card, "embedded_mep_inspected")}
                          className={`p-2 border flex items-center gap-2 text-left transition-all ${
                            card.embedded_mep_inspected
                              ? "border-emerald-500/60 bg-emerald-950/20 text-emerald-300"
                              : "border-ink-mid bg-ink text-slate-light hover:text-paper"
                          }`}
                        >
                          {card.embedded_mep_inspected ? <CheckSquare className="h-4 w-4 text-emerald-400" /> : <Square className="h-4 w-4 text-slate-600" />}
                          <span>4. Embedded MEP & Sleeves</span>
                        </button>

                        <button
                          type="button"
                          disabled={isApproved}
                          onClick={() => handleToggleCheck(card, "cover_blocks_verified")}
                          className={`p-2 border flex items-center gap-2 text-left transition-all ${
                            card.cover_blocks_verified
                              ? "border-emerald-500/60 bg-emerald-950/20 text-emerald-300"
                              : "border-ink-mid bg-ink text-slate-light hover:text-paper"
                          }`}
                        >
                          {card.cover_blocks_verified ? <CheckSquare className="h-4 w-4 text-emerald-400" /> : <Square className="h-4 w-4 text-slate-600" />}
                          <span>5. Concrete Cover Spacers</span>
                        </button>

                        {/* Action Gate Button */}
                        {!isApproved ? (
                          <button
                            type="button"
                            onClick={() => handleAuthorizePour(card)}
                            disabled={!allChecksPassed || authorizingId === card.id}
                            className="p-2 border border-signal bg-signal text-ink font-bold font-mono text-xs uppercase flex items-center justify-center gap-1.5 hover:bg-signal/90 disabled:opacity-40"
                          >
                            {authorizingId === card.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                            <span>Authorize Pour</span>
                          </button>
                        ) : (
                          <div className="p-2 border border-emerald-500/40 bg-emerald-950/20 text-emerald-300 text-xs font-mono flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            <span>Authorized by {card.approved_by_name || "Lead Engineer"}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Cube Testing Results Section */}
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono pt-2 border-t border-ink-mid/40">
                      <div className="flex items-center gap-4 text-slate-light">
                        <span>Cubes Sampled: <strong className="text-paper">{card.cubes_sampled_count || 6}</strong></span>
                        <span>7-Day Strength: <strong className="text-paper">{card.strength_7d_mpa ? `${card.strength_7d_mpa} MPa` : "Pending"}</strong></span>
                        <span>28-Day Strength: <strong className="text-paper">{card.strength_28d_mpa ? `${card.strength_28d_mpa} MPa` : "Pending"}</strong></span>
                        {card.test_result_verdict && (
                          <span className={`px-2 py-0.5 border uppercase font-bold ${
                            card.test_result_verdict === "pass" ? "border-emerald-500 text-emerald-400 bg-emerald-950/30" : "border-red-500 text-red-400"
                          }`}>
                            Verdict: {card.test_result_verdict}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const s7 = prompt("Enter 7-Day Crushing Strength (MPa):", String(card.strength_7d_mpa || 22.0));
                            const s28 = prompt("Enter 28-Day Crushing Strength (MPa):", String(card.strength_28d_mpa || 32.5));
                            if (s7 && s28) {
                              void handleRecordCubeStrength(card, parseFloat(s7), parseFloat(s28));
                            }
                          }}
                          className="border border-ink-mid bg-ink-light px-3 py-1 text-slate-light hover:text-paper"
                        >
                          Record Cube Test
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* SECTION 2: MOBILE SNAG & DEFECT MANAGEMENT */}
      {activeTab === "snags" && (
        <section className="space-y-4">
          {snags.length === 0 ? (
            <div className="border border-ink-mid bg-ink p-12 text-center text-xs font-mono text-slate-light">
              No snags or defects logged for this project. Site is defect-free! Click &quot;Log Site Defect&quot; to report an item.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {snags.map((sng) => {
                const isClosed = sng.status === "closed";
                const isRectified = sng.status === "rectified";

                return (
                  <div key={sng.id} className="border border-ink-mid bg-ink p-4 space-y-3 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-signal">{sng.snag_number}</span>
                          <span className={`text-[10px] font-mono uppercase px-2 py-0.5 border ${statusPills[sng.status] || statusPills.open}`}>
                            {sng.status}
                          </span>
                          <span className={`text-[10px] font-mono uppercase px-2 py-0.5 border ${
                            sng.severity === "critical_safety"
                              ? "border-red-500 bg-red-950/40 text-red-300 font-bold"
                              : sng.severity === "major"
                              ? "border-amber-500 bg-amber-950/30 text-amber-300"
                              : "border-ink-mid text-slate-light"
                          }`}>
                            {sng.severity.replace(/_/g, " ")}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-slate-light">
                          {formatDate(sng.created_at)}
                        </span>
                      </div>

                      <h4 className="font-display text-sm font-bold text-paper">{sng.title}</h4>
                      {sng.description && (
                        <p className="text-xs text-slate-light font-mono line-clamp-2">{sng.description}</p>
                      )}

                      <div className="text-xs font-mono text-slate-light space-y-1 pt-1 border-t border-ink-mid/40">
                        <div>Location: <strong className="text-paper">{sng.location_zone}</strong></div>
                        <div>Trade: <strong className="text-paper">{sng.trade || "General Works"}</strong></div>
                        {sng.due_date && <div>Due Date: <span className="text-amber-400">{formatDate(sng.due_date)}</span></div>}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-ink-mid flex items-center justify-between text-xs font-mono">
                      <div>
                        {isClosed ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Closed by {sng.closed_by_name || "QA Engineer"}
                          </span>
                        ) : isRectified ? (
                          <span className="text-sky-400 flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" /> Rectified - Awaiting Sign-off
                          </span>
                        ) : (
                          <span className="text-amber-400">Action Required</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {!isClosed && !isRectified && (
                          <button
                            type="button"
                            onClick={() => handleMarkRectified(sng)}
                            disabled={rectifyingId === sng.id}
                            className="border border-sky-500/50 bg-sky-950/30 px-3 py-1 text-sky-300 hover:bg-sky-500 hover:text-ink transition-colors"
                          >
                            Mark Rectified
                          </button>
                        )}
                        {!isClosed && isRectified && (
                          <button
                            type="button"
                            onClick={() => handleSignOffSnag(sng)}
                            disabled={signingOffId === sng.id}
                            className="border border-emerald-500 bg-emerald-950/40 px-3 py-1 text-emerald-300 hover:bg-emerald-500 hover:text-ink font-bold transition-colors"
                          >
                            QA Sign-Off
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Modal: Initiate Pour Card */}
      {isPourModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <h3 className="font-display text-lg font-bold text-paper">Initiate Concrete Pour Card</h3>
              <button type="button" onClick={() => setIsPourModalOpen(false)} className="text-slate-light hover:text-paper font-mono text-base">
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Pour Number *</label>
                <input
                  value={pourNumber}
                  onChange={(e) => setPourNumber(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Structure Level</label>
                <select
                  value={structureLevel}
                  onChange={(e) => setStructureLevel(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                >
                  <option value="Substructure">Substructure / Footings</option>
                  <option value="Ground Floor">Ground Floor Slab</option>
                  <option value="First Floor">First Floor Beams & Slab</option>
                  <option value="Columns">Reinforced Concrete Columns</option>
                  <option value="Retaining Wall">Retaining Wall</option>
                  <option value="Roof Level">Roof Beams & Deck</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Structural Element Name *</label>
              <input
                value={elementName}
                onChange={(e) => setElementName(e.target.value)}
                placeholder="e.g. Grid C-F Pad Footings & Ground Beams"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal min-h-[44px] sm:min-h-0"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Grade *</label>
                <select
                  value={concreteGrade}
                  onChange={(e) => setConcreteGrade(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                >
                  <option value="C20/25">C20/25</option>
                  <option value="C25/30">C25/30</option>
                  <option value="C30/37">C30/37</option>
                  <option value="C35/45">C35/45</option>
                  <option value="C40/50">C40/50</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Volume (m³)</label>
                <input
                  type="number"
                  step="0.5"
                  value={designVolume}
                  onChange={(e) => setDesignVolume(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Slump (mm)</label>
                <input
                  type="number"
                  value={targetSlump}
                  onChange={(e) => setTargetSlump(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Concrete Supplier / Plant</label>
              <input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal min-h-[44px] sm:min-h-0"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Notes / Mix Details</label>
              <textarea
                rows={2}
                value={pourNotes}
                onChange={(e) => setPourNotes(e.target.value)}
                placeholder="Waterproofing admixture, vibrator count, curing compound..."
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-mid">
              <button
                type="button"
                onClick={() => setIsPourModalOpen(false)}
                className="border border-ink-mid px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreatePourCard}
                disabled={savingPour || !elementName.trim()}
                className="border border-signal bg-signal px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 disabled:opacity-50"
              >
                {savingPour ? "Initiating..." : "Create Pour Card"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Log Defect / Snag */}
      {isSnagModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <h3 className="font-display text-lg font-bold text-paper">Log Site Snag / Defect</h3>
              <button type="button" onClick={() => setIsSnagModalOpen(false)} className="text-slate-light hover:text-paper font-mono text-base">
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Snag Number *</label>
                <input
                  value={snagNumber}
                  onChange={(e) => setSnagNumber(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Severity *</label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as any)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                >
                  <option value="cosmetic">Cosmetic</option>
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                  <option value="critical_safety">Critical Safety</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Defect Title *</label>
              <input
                value={snagTitle}
                onChange={(e) => setSnagTitle(e.target.value)}
                placeholder="e.g. Honeycombing on Column C3, Reinforcement Exposed"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal min-h-[44px] sm:min-h-0"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Location Zone / Room *</label>
                <input
                  value={locationZone}
                  onChange={(e) => setLocationZone(e.target.value)}
                  placeholder="e.g. Level 1 - Grid B4"
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal min-h-[44px] sm:min-h-0"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Responsible Trade</label>
                <select
                  value={trade}
                  onChange={(e) => setTrade(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                >
                  <option value="Formwork & Concrete">Formwork & Concrete</option>
                  <option value="Brickwork & Masonry">Brickwork & Masonry</option>
                  <option value="Plumbing & Drainage">Plumbing & Drainage</option>
                  <option value="Electrical Services">Electrical Services</option>
                  <option value="Plastering & Finishes">Plastering & Finishes</option>
                  <option value="Roofing & Waterproofing">Roofing & Waterproofing</option>
                  <option value="Carpentry & Joinery">Carpentry & Joinery</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Rectification Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Defect Description / Scope</label>
              <textarea
                rows={2}
                value={snagDescription}
                onChange={(e) => setSnagDescription(e.target.value)}
                placeholder="Observed void depth, non-conformance specification, remedial grout required..."
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-mid">
              <button
                type="button"
                onClick={() => setIsSnagModalOpen(false)}
                className="border border-ink-mid px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSnag}
                disabled={savingSnag || !snagTitle.trim() || !locationZone.trim()}
                className="border border-signal bg-signal px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 disabled:opacity-50"
              >
                {savingSnag ? "Saving..." : "Record Defect"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
