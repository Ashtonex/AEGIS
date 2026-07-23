"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Brain, ShieldAlert, Cpu, Calculator, TrendingUp, Calendar, AlertTriangle,
  CheckCircle2, XCircle, FileSearch, ArrowRight, RefreshCw, Scale, Layers,
  DollarSign, Users, HardHat, FileText, Zap, ChevronRight, Lock, UserCheck, Search
} from "lucide-react";
import {
  evaluateQuotationIntelligence,
  getConstructionAssemblies,
  calculateAssemblyBreakdown,
  benchmarkRate,
  generateSpendForecast,
  auditSiteRequest,
  watchDocumentRevision,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";

export default function QuotationIntelligencePage() {
  const { session } = useAuth();
  const [activeTab, setActiveTab] = useState<
    "brain" | "assemblies" | "rates" | "spend" | "guard" | "documents" | "investigations"
  >("brain");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // --- TAB 1: BRAIN EVALUATION STATE --- //
  const [projectTitle, setProjectTitle] = useState("SNC Commercial Lodge Project");
  const [builtAreaSqm, setBuiltAreaSqm] = useState(450);
  const [durationWeeks, setDurationWeeks] = useState(16);
  const [profitRatePct, setProfitRatePct] = useState(18);
  const [brainResult, setBrainResult] = useState<any>(null);

  // --- TAB 2: ASSEMBLIES STATE --- //
  const [assembliesList, setAssembliesList] = useState<any[]>([]);
  const [selectedAssembly, setSelectedAssembly] = useState("CONC-25MPA");
  const [assemblyQuantity, setAssemblyQuantity] = useState(25);
  const [assemblyBreakdown, setAssemblyBreakdown] = useState<any>(null);

  // --- TAB 3: RATE INTELLIGENCE STATE --- //
  const [rateItemCode, setRateItemCode] = useState("CEMENT-50KG");
  const [proposedRate, setProposedRate] = useState(18.50);
  const [rateResult, setRateResult] = useState<any>(null);

  // --- TAB 4: SPEND FORECAST STATE --- //
  const [spendForecastResult, setSpendForecastResult] = useState<any>(null);

  // --- TAB 5: COMMERCIAL GUARD (BS DETECTOR) STATE --- //
  const [guardRequesterName, setGuardRequesterName] = useState("Site Foreman - Dave Miller");
  const [guardItemDesc, setGuardItemDesc] = useState("Cement 50kg bags (42.5N)");
  const [guardRequestedQty, setGuardRequestedQty] = useState(500);
  const [guardEarnedQty, setGuardEarnedQty] = useState(280);
  const [guardUnitRate, setGuardUnitRate] = useState(12.50);
  const [guardHistRate, setGuardHistRate] = useState(12.20);
  const [guardAuditResult, setGuardAuditResult] = useState<any>(null);

  // --- TAB 6: DOCUMENT WATCHER STATE --- //
  const [docName, setDocName] = useState("Structural Drawing Rev R2 - Foundation Beam Scale Up");
  const [docRevision, setDocRevision] = useState("R2");
  const [docOrigCost, setDocOrigCost] = useState(100000);
  const [docRevisedCost, setDocRevisedCost] = useState(118400);
  const [docResult, setDocResult] = useState<any>(null);

  // --- INITIAL DATA LOAD --- //
  const handleEvaluateBrain = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const payload = {
        quotation_id: "QT-INTEL-2026-001",
        project_title: projectTitle,
        built_area_sqm: builtAreaSqm,
        profit_rate: profitRatePct / 100.0,
        project_duration_weeks: durationWeeks,
        items: [
          {
            description: "Reinforced Concrete Foundations & Slab (25MPa)",
            quantity: 85,
            unit: "m3",
            rate: 145.0,
            material_rate: 70.0,
            labour_rate: 45.0,
            equipment_rate: 20.0,
            subcontractor_rate: 10.0,
          },
          {
            description: "Structural Brickwork 230mm Double Skin",
            quantity: 620,
            unit: "m2",
            rate: 52.0,
            material_rate: 28.0,
            labour_rate: 20.0,
            equipment_rate: 0.0,
            subcontractor_rate: 4.0,
          },
          {
            description: "Pitched IBR Roofing & Timber Structure",
            quantity: 480,
            unit: "m2",
            rate: 35.0,
            material_rate: 22.0,
            labour_rate: 10.0,
            equipment_rate: 0.0,
            subcontractor_rate: 3.0,
          },
        ],
      };
      const res = await evaluateQuotationIntelligence(payload);
      if (res.success) {
        setBrainResult(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to evaluate Quotation Intelligence.");
    } finally {
      setLoading(false);
    }
  }, [projectTitle, builtAreaSqm, profitRatePct, durationWeeks]);

  const handleFetchAssemblies = useCallback(async () => {
    try {
      const res = await getConstructionAssemblies();
      if (res.success && Array.isArray(res.data)) {
        setAssembliesList(res.data);
      }
    } catch (err: any) {
      console.error(err);
    }
  }, []);

  const handleCalculateAssembly = useCallback(async () => {
    try {
      const res = await calculateAssemblyBreakdown(selectedAssembly, assemblyQuantity);
      if (res.success) {
        setAssemblyBreakdown(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Assembly calculation failed.");
    }
  }, [selectedAssembly, assemblyQuantity]);

  const handleBenchmarkRate = useCallback(async () => {
    try {
      const res = await benchmarkRate(rateItemCode, proposedRate);
      if (res.success) {
        setRateResult(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Rate benchmarking failed.");
    }
  }, [rateItemCode, proposedRate]);

  const handleGenerateForecast = useCallback(async () => {
    try {
      const payload = {
        project_duration_weeks: durationWeeks,
        profit_margin_pct: profitRatePct,
        items: [
          { description: "Concrete Works", quantity: 85, rate: 145.0, material_rate: 70.0, labour_rate: 45.0, equipment_rate: 20.0, subcontractor_rate: 10.0 },
          { description: "Brickwork", quantity: 620, rate: 52.0, material_rate: 28.0, labour_rate: 20.0, equipment_rate: 0.0, subcontractor_rate: 4.0 },
          { description: "Roofing", quantity: 480, rate: 35.0, material_rate: 22.0, labour_rate: 10.0, equipment_rate: 0.0, subcontractor_rate: 3.0 },
        ],
      };
      const res = await generateSpendForecast(payload);
      if (res.success) {
        setSpendForecastResult(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Spend forecast failed.");
    }
  }, [durationWeeks, profitRatePct]);

  const handleAuditGuard = useCallback(async () => {
    try {
      const payload = {
        requester_name: guardRequesterName,
        document_type: "SITE_MATERIAL_REQUEST",
        item: guardItemDesc,
        requested_quantity: guardRequestedQty,
        earned_quantity: guardEarnedQty,
        unit_rate: guardUnitRate,
        historical_po_rate: guardHistRate,
      };
      const res = await auditSiteRequest(payload);
      if (res.success) {
        setGuardAuditResult(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Commercial guard audit failed.");
    }
  }, [guardRequesterName, guardItemDesc, guardRequestedQty, guardEarnedQty, guardUnitRate, guardHistRate]);

  const handleWatchDocument = useCallback(async () => {
    try {
      const payload = {
        document_name: docName,
        revision: docRevision,
        original_direct_cost: docOrigCost,
        revised_direct_cost: docRevisedCost,
        current_margin_pct: profitRatePct,
        contract_value: 135000,
      };
      const res = await watchDocumentRevision(payload);
      if (res.success) {
        setDocResult(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Document watch evaluation failed.");
    }
  }, [docName, docRevision, docOrigCost, docRevisedCost, profitRatePct]);

  useEffect(() => {
    void handleEvaluateBrain();
    void handleFetchAssemblies();
    void handleCalculateAssembly();
    void handleBenchmarkRate();
    void handleGenerateForecast();
    void handleAuditGuard();
    void handleWatchDocument();
  }, [
    handleEvaluateBrain,
    handleFetchAssemblies,
    handleCalculateAssembly,
    handleBenchmarkRate,
    handleGenerateForecast,
    handleAuditGuard,
    handleWatchDocument,
  ]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 text-paper font-sans">
      
      {/* Top Header Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-ink-dark via-ink-light to-ink-mid p-6 border border-ink-mid rounded-lg shadow-xl">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-signal/10 border border-signal/30 rounded-md text-signal">
              <Brain className="w-8 h-8 animate-pulse" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Quotation Intelligence Engine
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-signal/20 text-signal border border-signal/40 uppercase">
                  Commercial Control Brain
                </span>
              </h1>
              <p className="text-xs text-slate mt-1">
                Deterministic QS calculation core with automated document watching, rate benchmarking, spend forecasting, and BS anomaly detection.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <Link
            href="/dashboard/quotations"
            className="px-4 py-2 border border-ink-mid rounded text-xs font-semibold text-slate hover:text-white hover:border-signal/50 transition-colors"
          >
            &larr; Standard Quotes
          </Link>
          <button
            onClick={handleEvaluateBrain}
            disabled={loading}
            className="flex items-center space-x-2 bg-signal text-ink px-4 py-2 text-xs font-semibold rounded hover:bg-signal-hover transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Re-Evaluate Commercial Brain</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 border border-red-500/30 bg-red-950/30 text-red-400 text-xs rounded flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Primary Navigation Tabs */}
      <div className="flex flex-wrap border-b border-ink-mid gap-1">
        <button
          onClick={() => setActiveTab("brain")}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "brain"
              ? "border-signal text-signal font-semibold bg-signal/5"
              : "border-transparent text-slate hover:text-white hover:border-slate/40"
          }`}
        >
          <Brain className="w-4 h-4" />
          <span>1. Project Worthiness</span>
        </button>

        <button
          onClick={() => setActiveTab("assemblies")}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "assemblies"
              ? "border-signal text-signal font-semibold bg-signal/5"
              : "border-transparent text-slate hover:text-white hover:border-slate/40"
          }`}
        >
          <Calculator className="w-4 h-4" />
          <span>2. Assembly Recipes</span>
        </button>

        <button
          onClick={() => setActiveTab("rates")}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "rates"
              ? "border-signal text-signal font-semibold bg-signal/5"
              : "border-transparent text-slate hover:text-white hover:border-slate/40"
          }`}
        >
          <Scale className="w-4 h-4" />
          <span>3. Rate Intelligence</span>
        </button>

        <button
          onClick={() => setActiveTab("spend")}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "spend"
              ? "border-signal text-signal font-semibold bg-signal/5"
              : "border-transparent text-slate hover:text-white hover:border-slate/40"
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>4. Spend Forecast</span>
        </button>

        <button
          onClick={() => setActiveTab("guard")}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "guard"
              ? "border-signal text-signal font-semibold bg-signal/5"
              : "border-transparent text-slate hover:text-white hover:border-slate/40"
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>5. Commercial Guard (&quot;BS Detector&quot;)</span>
        </button>

        <button
          onClick={() => setActiveTab("documents")}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "documents"
              ? "border-signal text-signal font-semibold bg-signal/5"
              : "border-transparent text-slate hover:text-white hover:border-slate/40"
          }`}
        >
          <FileSearch className="w-4 h-4" />
          <span>6. Document Watcher</span>
        </button>

        <button
          onClick={() => setActiveTab("investigations")}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "investigations"
              ? "border-signal text-signal font-semibold bg-signal/5"
              : "border-transparent text-slate hover:text-white hover:border-slate/40"
          }`}
        >
          <HardHat className="w-4 h-4" />
          <span>7. Forensic Evidence Packs</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: BRAIN EVALUATION & WORTHINESS */}
      {/* ========================================================================= */}
      {activeTab === "brain" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Input Controls */}
            <div className="bg-ink-light border border-ink-mid rounded-lg p-6 space-y-4">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2 font-display">
                <Cpu className="w-4 h-4 text-signal" />
                Project Evaluation Controls
              </h2>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-slate block mb-1">Project Title</label>
                  <input
                    type="text"
                    value={projectTitle}
                    onChange={(e) => setProjectTitle(e.target.value)}
                    className="w-full bg-ink border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate block mb-1">Built Area (m²)</label>
                    <input
                      type="number"
                      value={builtAreaSqm}
                      onChange={(e) => setBuiltAreaSqm(Number(e.target.value))}
                      className="w-full bg-ink border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-slate block mb-1">Duration (Weeks)</label>
                    <input
                      type="number"
                      value={durationWeeks}
                      onChange={(e) => setDurationWeeks(Number(e.target.value))}
                      className="w-full bg-ink border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-slate block mb-1">Target Profit Margin (%)</label>
                  <input
                    type="number"
                    value={profitRatePct}
                    onChange={(e) => setProfitRatePct(Number(e.target.value))}
                    className="w-full bg-ink border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                  />
                </div>

                <button
                  onClick={handleEvaluateBrain}
                  disabled={loading}
                  className="w-full bg-signal text-ink py-2.5 font-bold rounded text-xs hover:bg-signal-hover transition-all flex items-center justify-center space-x-2"
                >
                  <Brain className="w-4 h-4" />
                  <span>Run Intelligence Evaluation</span>
                </button>
              </div>
            </div>

            {/* Verdict & Score */}
            {brainResult && (
              <div className="lg:col-span-2 bg-ink-light border border-ink-mid rounded-lg p-6 space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-ink-mid pb-4">
                  <div>
                    <p className="text-xs font-mono text-slate uppercase tracking-wider">Commercial Brain Verdict</p>
                    <div className="flex items-center space-x-3 mt-1">
                      <span className={`text-xl font-bold font-display px-3 py-1 rounded ${
                        brainResult.is_worth_taking
                          ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                          : "bg-red-950/60 text-red-400 border border-red-500/30"
                      }`}>
                        {brainResult.is_worth_taking ? "IS THIS PROJECT WORTH TAKING? YES" : "REJECT OR REPRICE PROJECT"}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-xs font-mono text-slate uppercase">Worthiness Score</p>
                    <p className="text-3xl font-black font-display text-signal">{brainResult.worthiness_score}/100</p>
                  </div>
                </div>

                {/* KPI Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                  <div className="p-3 bg-ink rounded border border-ink-mid">
                    <p className="text-slate uppercase text-[10px]">Direct Costs</p>
                    <p className="text-sm font-bold text-white mt-1">
                      ${brainResult.metrics?.total_direct_costs?.toLocaleString()}
                    </p>
                  </div>

                  <div className="p-3 bg-ink rounded border border-ink-mid">
                    <p className="text-slate uppercase text-[10px]">Target Selling Price</p>
                    <p className="text-sm font-bold text-signal mt-1">
                      ${brainResult.metrics?.target_selling_price?.toLocaleString()}
                    </p>
                  </div>

                  <div className="p-3 bg-ink rounded border border-ink-mid">
                    <p className="text-slate uppercase text-[10px]">Protected Margin</p>
                    <p className="text-sm font-bold text-emerald-400 mt-1">
                      ${brainResult.metrics?.protected_profit_amount?.toLocaleString()} ({brainResult.metrics?.protected_margin_pct}%)
                    </p>
                  </div>

                  <div className="p-3 bg-ink rounded border border-ink-mid">
                    <p className="text-slate uppercase text-[10px]">Cost / Built m²</p>
                    <p className="text-sm font-bold text-white mt-1">
                      ${brainResult.metrics?.cost_per_built_sqm}
                    </p>
                  </div>
                </div>

                {/* Recommendation & Governance Approvals */}
                <div className="space-y-3">
                  <div className="p-4 bg-ink/60 border border-ink-mid rounded text-xs space-y-1">
                    <p className="font-semibold text-white flex items-center gap-1.5">
                      <Zap className="w-4 h-4 text-signal" />
                      Executive Recommendation
                    </p>
                    <p className="text-slate">{brainResult.recommendation}</p>
                  </div>

                  <div className="p-4 bg-ink/60 border border-ink-mid rounded text-xs space-y-2">
                    <p className="font-semibold text-white flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-amber-400" />
                      Mandatory Governance Approval Gate
                    </p>
                    <ul className="space-y-1 text-slate font-mono">
                      {brainResult.mandatory_approvals?.map((app: string, idx: number) => (
                        <li key={idx} className="flex items-center space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-signal shrink-0" />
                          <span>{app}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: CONSTRUCTION ASSEMBLY LIBRARY */}
      {/* ========================================================================= */}
      {activeTab === "assemblies" && (
        <div className="space-y-6">
          <div className="bg-ink-light border border-ink-mid rounded-lg p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-base font-bold font-display text-white flex items-center gap-2">
                  <Calculator className="w-5 h-5 text-signal" />
                  Construction Assembly &amp; Material Recipe Calculator
                </h2>
                <p className="text-xs text-slate mt-0.5">
                  Deterministic recipes for 1m³ concrete, 1m² brickwork, plastering, roofing, tiling, excavation, and steel.
                </p>
              </div>

              <div className="flex items-center space-x-3 text-xs">
                <div>
                  <label className="text-slate block mb-0.5">Select Assembly</label>
                  <select
                    value={selectedAssembly}
                    onChange={(e) => setSelectedAssembly(e.target.value)}
                    className="bg-ink border border-ink-mid rounded p-2 text-white focus:border-signal outline-none font-mono"
                  >
                    {assembliesList.map((a) => (
                      <option key={a.assembly_code} value={a.assembly_code}>
                        {a.name} ({a.assembly_code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate block mb-0.5">Quantity</label>
                  <input
                    type="number"
                    value={assemblyQuantity}
                    onChange={(e) => setAssemblyQuantity(Number(e.target.value))}
                    className="w-24 bg-ink border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                  />
                </div>

                <div className="pt-4">
                  <button
                    onClick={handleCalculateAssembly}
                    className="bg-signal text-ink px-4 py-2 text-xs font-bold rounded hover:bg-signal-hover transition-all"
                  >
                    Calculate Recipe
                  </button>
                </div>
              </div>
            </div>

            {assemblyBreakdown && (
              <div className="space-y-6 border-t border-ink-mid pt-6">
                
                {/* Summary Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Calculated Unit Rate</p>
                    <p className="text-base font-bold text-signal mt-1">
                      ${assemblyBreakdown.calculated_unit_rate} / {assemblyBreakdown.unit}
                    </p>
                  </div>

                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Total Direct Cost</p>
                    <p className="text-base font-bold text-white mt-1">
                      ${assemblyBreakdown.total_direct_cost?.toLocaleString()}
                    </p>
                  </div>

                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Subcontractor Benchmark</p>
                    <p className="text-base font-bold text-amber-400 mt-1">
                      ${assemblyBreakdown.subcontractor_benchmark_rate} / {assemblyBreakdown.unit}
                    </p>
                  </div>

                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Est. Production Time</p>
                    <p className="text-base font-bold text-emerald-400 mt-1">
                      {assemblyBreakdown.estimated_production_days} Site Days
                    </p>
                  </div>
                </div>

                {/* Material Recipe Table */}
                <div className="space-y-2">
                  <h3 className="text-xs font-mono text-slate uppercase tracking-wider">
                    Material Recipe Breakdown (Includes {assemblyBreakdown.wastage_tolerance_pct}% Wastage Allowance)
                  </h3>
                  <div className="overflow-x-auto border border-ink-mid rounded">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-ink text-slate uppercase text-[10px] border-b border-ink-mid">
                        <tr>
                          <th className="p-3">Material Description</th>
                          <th className="p-3">Net Quantity</th>
                          <th className="p-3">Quantity + Waste</th>
                          <th className="p-3">Unit Cost</th>
                          <th className="p-3 text-right">Total Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-mid text-slate-light">
                        {assemblyBreakdown.materials?.map((m: any, idx: number) => (
                          <tr key={idx} className="hover:bg-ink-mid/30">
                            <td className="p-3 font-semibold text-white">{m.material}</td>
                            <td className="p-3">{m.net_quantity} {m.unit}</td>
                            <td className="p-3 text-signal font-bold">{m.total_quantity_with_waste} {m.unit}</td>
                            <td className="p-3">${m.unit_cost}</td>
                            <td className="p-3 text-right text-white font-bold">${m.total_cost}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Labour & Plant Breakdown Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Labour Gang */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-mono text-slate uppercase tracking-wider">Labour Gang Allocation</h3>
                    <div className="border border-ink-mid rounded overflow-x-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-ink text-slate uppercase text-[10px] border-b border-ink-mid">
                          <tr>
                            <th className="p-2.5">Role</th>
                            <th className="p-2.5">Total Hours</th>
                            <th className="p-2.5 text-right">Total Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-mid text-slate-light">
                          {assemblyBreakdown.labour?.map((l: any, idx: number) => (
                            <tr key={idx}>
                              <td className="p-2.5 text-white">{l.role}</td>
                              <td className="p-2.5">{l.total_hours} hrs</td>
                              <td className="p-2.5 text-right text-white font-semibold">${l.total_cost}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Plant Needs */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-mono text-slate uppercase tracking-wider">Plant &amp; Equipment Needs</h3>
                    <div className="border border-ink-mid rounded overflow-x-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-ink text-slate uppercase text-[10px] border-b border-ink-mid">
                          <tr>
                            <th className="p-2.5">Equipment</th>
                            <th className="p-2.5">Hours Needed</th>
                            <th className="p-2.5 text-right">Total Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-mid text-slate-light">
                          {assemblyBreakdown.plant?.length > 0 ? (
                            assemblyBreakdown.plant.map((p: any, idx: number) => (
                              <tr key={idx}>
                                <td className="p-2.5 text-white">{p.equipment}</td>
                                <td className="p-2.5">{p.total_hours} hrs</td>
                                <td className="p-2.5 text-right text-white font-semibold">${p.total_cost}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={3} className="p-3 text-center text-slate text-[11px]">
                                No heavy plant required for this assembly.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: RATE INTELLIGENCE */}
      {/* ========================================================================= */}
      {activeTab === "rates" && (
        <div className="space-y-6">
          <div className="bg-ink-light border border-ink-mid rounded-lg p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-base font-bold font-display text-white flex items-center gap-2">
                  <Scale className="w-5 h-5 text-signal" />
                  Rate Intelligence &amp; Outlier Detector
                </h2>
                <p className="text-xs text-slate mt-0.5">
                  Compares proposed rates against internal target, supplier quotes, subcontractor market rates, and last accepted PO rates.
                </p>
              </div>

              <div className="flex items-center space-x-3 text-xs">
                <div>
                  <label className="text-slate block mb-0.5">Item Code</label>
                  <select
                    value={rateItemCode}
                    onChange={(e) => setRateItemCode(e.target.value)}
                    className="bg-ink border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                  >
                    <option value="CEMENT-50KG">CEMENT-50KG (Cement 50kg bag)</option>
                    <option value="BRICK-COMMON">BRICK-COMMON (Common Brick)</option>
                    <option value="SAND-BUILDING">SAND-BUILDING (Building Sand m3)</option>
                    <option value="SUBBY-PLASTER-M2">SUBBY-PLASTER-M2 (Subcontractor Plaster m2)</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate block mb-0.5">Proposed Rate ($)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={proposedRate}
                    onChange={(e) => setProposedRate(Number(e.target.value))}
                    className="w-28 bg-ink border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                  />
                </div>

                <div className="pt-4">
                  <button
                    onClick={handleBenchmarkRate}
                    className="bg-signal text-ink px-4 py-2 text-xs font-bold rounded hover:bg-signal-hover transition-all"
                  >
                    Benchmark Rate
                  </button>
                </div>
              </div>
            </div>

            {rateResult && (
              <div className="space-y-6 border-t border-ink-mid pt-6">
                
                {/* Status Banner */}
                <div className={`p-4 rounded border flex items-center space-x-3 text-xs font-mono ${
                  rateResult.is_outlier
                    ? "bg-red-950/40 border-red-500/40 text-red-300"
                    : "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                }`}>
                  {rateResult.is_outlier ? (
                    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  )}
                  <div>
                    <p className="font-bold uppercase">{rateResult.status}: {rateResult.recommendation}</p>
                    <p className="text-[11px] text-slate mt-0.5">
                      Variance vs Last PO Rate: {rateResult.variance_vs_last_po_pct > 0 ? "+" : ""}{rateResult.variance_vs_last_po_pct}%
                    </p>
                  </div>
                </div>

                {/* Benchmark Comparison Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Internal Target Rate</p>
                    <p className="text-base font-bold text-white mt-1">${rateResult.target_rate}</p>
                  </div>

                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Supplier Quote Rate</p>
                    <p className="text-base font-bold text-signal mt-1">${rateResult.supplier_rate}</p>
                  </div>

                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Subby Market Rate</p>
                    <p className="text-base font-bold text-amber-400 mt-1">${rateResult.subcontractor_market_rate}</p>
                  </div>

                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Last PO Accepted Rate</p>
                    <p className="text-base font-bold text-emerald-400 mt-1">${rateResult.last_po_rate}</p>
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: SPEND FORECAST */}
      {/* ========================================================================= */}
      {activeTab === "spend" && (
        <div className="space-y-6">
          <div className="bg-ink-light border border-ink-mid rounded-lg p-6 space-y-6">
            <div>
              <h2 className="text-base font-bold font-display text-white flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-signal" />
                Project Spend &amp; Cashflow Baseline Forecast
              </h2>
              <p className="text-xs text-slate mt-0.5">
                Generates S-curve weekly cost plans, material delivery schedules, labour histograms, and margin-at-risk curves.
              </p>
            </div>

            {spendForecastResult && (
              <div className="space-y-6">
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Duration</p>
                    <p className="text-base font-bold text-white mt-1">{spendForecastResult.project_duration_weeks} Weeks</p>
                  </div>

                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Target Selling Price</p>
                    <p className="text-base font-bold text-signal mt-1">${spendForecastResult.target_selling_price?.toLocaleString()}</p>
                  </div>

                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Protected Profit</p>
                    <p className="text-base font-bold text-emerald-400 mt-1">${spendForecastResult.protected_profit_amount?.toLocaleString()}</p>
                  </div>

                  <div className="p-4 bg-ink border border-ink-mid rounded">
                    <p className="text-slate uppercase text-[10px]">Daily Spend Rate</p>
                    <p className="text-base font-bold text-amber-400 mt-1">${spendForecastResult.average_daily_cost?.toLocaleString()} / day</p>
                  </div>
                </div>

                {/* Weekly Cost Plan Table */}
                <div className="space-y-2">
                  <h3 className="text-xs font-mono text-slate uppercase tracking-wider">Weekly S-Curve Cost Plan</h3>
                  <div className="overflow-x-auto border border-ink-mid rounded">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-ink text-slate uppercase text-[10px] border-b border-ink-mid">
                        <tr>
                          <th className="p-2.5">Week</th>
                          <th className="p-2.5">Weekly Spend</th>
                          <th className="p-2.5">Cumulative Spend</th>
                          <th className="p-2.5">Materials (45%)</th>
                          <th className="p-2.5">Labour (25%)</th>
                          <th className="p-2.5">Subcontractor (20%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-mid text-slate-light">
                        {spendForecastResult.weekly_cost_plan?.map((w: any) => (
                          <tr key={w.week_number} className="hover:bg-ink-mid/30">
                            <td className="p-2.5 font-bold text-white">Week {w.week_number}</td>
                            <td className="p-2.5 text-signal font-semibold">${w.weekly_spend?.toLocaleString()}</td>
                            <td className="p-2.5 text-white font-bold">${w.cumulative_spend?.toLocaleString()}</td>
                            <td className="p-2.5">${w.materials_spend?.toLocaleString()}</td>
                            <td className="p-2.5">${w.labour_spend?.toLocaleString()}</td>
                            <td className="p-2.5">${w.subcontractor_spend?.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: COMMERCIAL GUARD ("BS DETECTOR") */}
      {/* ========================================================================= */}
      {activeTab === "guard" && (
        <div className="space-y-6">
          <div className="bg-ink-light border border-ink-mid rounded-lg p-6 space-y-6">
            <div>
              <h2 className="text-base font-bold font-display text-white flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-signal" />
                Commercial Control Guard &amp; Anomaly Auditor (&quot;BS Callout&quot;)
              </h2>
              <p className="text-xs text-slate mt-0.5">
                Automatically checks site requests, RFQs, material requisitions, and subcontractor claims against earned progress baselines to prevent theft, waste, and overbilling.
              </p>
            </div>

            {/* Test Input Form */}
            <div className="p-4 bg-ink border border-ink-mid rounded-lg space-y-4 text-xs">
              <h3 className="font-semibold text-white font-mono uppercase text-[11px]">Audit Request Simulator</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-slate block mb-1">Requester Employee / User</label>
                  <input
                    type="text"
                    value={guardRequesterName}
                    onChange={(e) => setGuardRequesterName(e.target.value)}
                    className="w-full bg-ink-light border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                  />
                </div>

                <div>
                  <label className="text-slate block mb-1">Item Description</label>
                  <input
                    type="text"
                    value={guardItemDesc}
                    onChange={(e) => setGuardItemDesc(e.target.value)}
                    className="w-full bg-ink-light border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                  />
                </div>

                <div>
                  <label className="text-slate block mb-1">Requested Quantity</label>
                  <input
                    type="number"
                    value={guardRequestedQty}
                    onChange={(e) => setGuardRequestedQty(Number(e.target.value))}
                    className="w-full bg-ink-light border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-slate block mb-1">Earned Progress Quantity (Justified)</label>
                  <input
                    type="number"
                    value={guardEarnedQty}
                    onChange={(e) => setGuardEarnedQty(Number(e.target.value))}
                    className="w-full bg-ink-light border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                  />
                </div>

                <div>
                  <label className="text-slate block mb-1">Requested Unit Rate ($)</label>
                  <input
                    type="number"
                    value={guardUnitRate}
                    onChange={(e) => setGuardUnitRate(Number(e.target.value))}
                    className="w-full bg-ink-light border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                  />
                </div>

                <div>
                  <label className="text-slate block mb-1">Historical Accepted PO Rate ($)</label>
                  <input
                    type="number"
                    value={guardHistRate}
                    onChange={(e) => setGuardHistRate(Number(e.target.value))}
                    className="w-full bg-ink-light border border-ink-mid rounded p-2 text-white font-mono focus:border-signal outline-none"
                  />
                </div>
              </div>

              <button
                onClick={handleAuditGuard}
                className="bg-signal text-ink px-4 py-2 font-bold rounded text-xs hover:bg-signal-hover transition-all flex items-center space-x-2"
              >
                <ShieldAlert className="w-4 h-4" />
                <span>Run Commercial Guard Audit</span>
              </button>
            </div>

            {/* Audit Output Result */}
            {guardAuditResult && (
              <div className="space-y-4 border-t border-ink-mid pt-6">
                
                <div className={`p-5 rounded border space-y-2 font-mono text-xs ${
                  guardAuditResult.is_flagged
                    ? "bg-red-950/40 border-red-500/40 text-red-300"
                    : "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm uppercase flex items-center gap-2">
                      {guardAuditResult.is_flagged ? <XCircle className="w-5 h-5 text-red-400" /> : <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                      AUDIT STATUS: {guardAuditResult.status} (Risk Level: {guardAuditResult.risk_level})
                    </span>
                    <span className="px-2.5 py-1 bg-ink border border-ink-mid text-white font-bold rounded uppercase">
                      Action: {guardAuditResult.recommended_action}
                    </span>
                  </div>

                  <p className="text-white mt-1">{guardAuditResult.anomaly_reason}</p>
                </div>

                {/* Evidence Pack Details */}
                {guardAuditResult.evidence_pack && (
                  <div className="p-5 bg-ink border border-ink-mid rounded-lg space-y-4 text-xs font-mono">
                    <h3 className="text-signal font-bold flex items-center gap-2 font-display text-sm">
                      <FileText className="w-4 h-4" />
                      Forensic Evidence Pack Generated
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate">
                      <div>
                        <p className="text-[10px] uppercase">Requester</p>
                        <p className="text-white font-semibold">{guardAuditResult.evidence_pack.requester?.name}</p>
                      </div>

                      <div>
                        <p className="text-[10px] uppercase">Theoretical Allowable</p>
                        <p className="text-emerald-400 font-semibold">
                          {guardAuditResult.evidence_pack.audit_metrics?.theoretical_allowable} units
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] uppercase">Overage Quantity</p>
                        <p className="text-red-400 font-semibold">
                          +{guardAuditResult.evidence_pack.audit_metrics?.overage_quantity} units
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] uppercase">Excess Financial Risk</p>
                        <p className="text-red-400 font-bold">
                          ${guardAuditResult.evidence_pack.audit_metrics?.excess_financial_value?.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: DOCUMENT WATCHER */}
      {/* ========================================================================= */}
      {activeTab === "documents" && (
        <div className="space-y-6">
          <div className="bg-ink-light border border-ink-mid rounded-lg p-6 space-y-6">
            <div>
              <h2 className="text-base font-bold font-display text-white flex items-center gap-2">
                <FileSearch className="w-5 h-5 text-signal" />
                Document Change Intelligence &amp; Revision Watcher
              </h2>
              <p className="text-xs text-slate mt-0.5">
                Continuously compares revised drawings, BOQs, and site instructions to calculate cost deltas and enforce MD or QS approval gates.
              </p>
            </div>

            <div className="p-4 bg-ink border border-ink-mid rounded-lg space-y-4 text-xs font-mono">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-slate block mb-1">Document / Drawing Name</label>
                  <input
                    type="text"
                    value={docName}
                    onChange={(e) => setDocName(e.target.value)}
                    className="w-full bg-ink-light border border-ink-mid rounded p-2 text-white outline-none focus:border-signal"
                  />
                </div>

                <div>
                  <label className="text-slate block mb-1">Original Direct Cost ($)</label>
                  <input
                    type="number"
                    value={docOrigCost}
                    onChange={(e) => setDocOrigCost(Number(e.target.value))}
                    className="w-full bg-ink-light border border-ink-mid rounded p-2 text-white outline-none focus:border-signal"
                  />
                </div>

                <div>
                  <label className="text-slate block mb-1">Revised Direct Cost ($)</label>
                  <input
                    type="number"
                    value={docRevisedCost}
                    onChange={(e) => setDocRevisedCost(Number(e.target.value))}
                    className="w-full bg-ink-light border border-ink-mid rounded p-2 text-white outline-none focus:border-signal"
                  />
                </div>
              </div>

              <button
                onClick={handleWatchDocument}
                className="bg-signal text-ink px-4 py-2 font-bold rounded text-xs hover:bg-signal-hover transition-all"
              >
                Analyze Document Change Impact
              </button>
            </div>

            {docResult && (
              <div className="p-5 bg-ink border border-ink-mid rounded-lg space-y-4 font-mono text-xs">
                <div className="flex items-center justify-between border-b border-ink-mid pb-3">
                  <span className="font-bold text-white text-sm">{docResult.document_name} ({docResult.revision})</span>
                  <span className="px-3 py-1 bg-amber-950/60 text-amber-400 border border-amber-500/30 rounded font-bold uppercase">
                    {docResult.approval_level_required}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <p className="text-slate uppercase text-[10px]">Original Cost</p>
                    <p className="text-white font-bold mt-1">${docResult.original_direct_cost?.toLocaleString()}</p>
                  </div>

                  <div>
                    <p className="text-slate uppercase text-[10px]">Revised Cost</p>
                    <p className="text-white font-bold mt-1">${docResult.revised_direct_cost?.toLocaleString()}</p>
                  </div>

                  <div>
                    <p className="text-slate uppercase text-[10px]">Cost Increase Delta</p>
                    <p className="text-red-400 font-bold mt-1">+${docResult.cost_delta?.toLocaleString()}</p>
                  </div>

                  <div>
                    <p className="text-slate uppercase text-[10px]">Revised Protected Margin</p>
                    <p className="text-emerald-400 font-bold mt-1">{docResult.revised_margin_pct}%</p>
                  </div>
                </div>

                <p className="text-slate bg-ink-light p-3 rounded border border-ink-mid">{docResult.governance_note}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 7: INVESTIGATION CASES */}
      {/* ========================================================================= */}
      {activeTab === "investigations" && (
        <div className="space-y-6">
          <div className="bg-ink-light border border-ink-mid rounded-lg p-6 space-y-6">
            <div>
              <h2 className="text-base font-bold font-display text-white flex items-center gap-2">
                <HardHat className="w-5 h-5 text-signal" />
                Forensic Investigation Cases &amp; Offender Profiles
              </h2>
              <p className="text-xs text-slate mt-0.5">
                Automatically logs repeat offenders, suspicious entries, and builds investigation case files for commercial resolution.
              </p>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-ink border border-ink-mid rounded-lg space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="px-2 py-0.5 bg-red-950/60 text-red-400 border border-red-500/30 rounded font-bold text-[10px] uppercase">
                      OPEN INVESTIGATION CASE #INV-2026-088
                    </span>
                    <span className="text-white font-bold">John Foreman (Site Supervisor - Zone 4)</span>
                  </div>
                  <span className="text-signal font-bold">Risk Profile Score: 85/100 (HIGH RISK)</span>
                </div>

                <p className="text-slate">
                  User logged 3 consecutive material over-requests (+78.5% cement overage, +42% rebar steel overage) exceeding site earned progress. Evidence pack locked for MD investigation.
                </p>

                <div className="flex items-center space-x-3 pt-2">
                  <button className="bg-red-500/20 text-red-400 border border-red-500/40 px-3 py-1.5 rounded font-bold hover:bg-red-500/30 transition-all">
                    Freeze Material Ordering Permissions
                  </button>
                  <button className="bg-signal text-ink px-3 py-1.5 rounded font-bold hover:bg-signal-hover transition-all">
                    Export MD Evidence Pack (PDF)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
