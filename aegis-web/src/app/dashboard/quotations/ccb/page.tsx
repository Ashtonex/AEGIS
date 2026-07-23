"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  FileWarning,
  Gauge,
  HardHat,
  History,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sliders,
  TrendingUp,
  UserCheck,
  Zap,
} from "lucide-react";
import {
  auditSiteRequest,
  benchmarkRate,
  calculateAssemblyBreakdown,
  classifyBoqDescription,
  createCustomAssembly,
  createRateBenchmark,
  deleteCustomAssembly,
  deleteRateBenchmark,
  evaluateQuotationIntelligence,
  exportCcbControlFilePdf,
  forecastInflationImpact,
  generateAutonomousQuote,
  getCommercialBaselineHistory,
  getConstructionAssemblies,
  getDocumentChangeHistory,
  getGuardAuditHistory,
  getProjects,
  getQuotations,
  getRecommendedSubcontractors,
  listRateBenchmarks,
  saveCcbOverride,
  simulateCcbScenario,
  watchDocumentRevision,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";

type Severity = "critical" | "high" | "medium" | "low";
type AutonomousSourceType = "project" | "lead" | "opportunity" | "tender" | "manual";

type BuildupRow = {
  type: "material" | "labour" | "equipment" | "subcontractor" | "other";
  name: string;
  qty: number;
  unit: string;
  rate: number;
};

type QuoteLine = {
  description: string;
  qty: number;
  unit: string;
  rate: number;
  buildup?: BuildupRow[];
};

type QuotationRecord = {
  id: string;
  client_name?: string;
  quote_amount?: number | string;
  project_id?: string;
  metadata?: {
    project_title?: string;
    reference_number?: string;
    quote_date?: string;
    direct_costs?: number;
    preliminaries?: number;
    overhead_pct?: number;
    contingency_pct?: number;
    profit_pct?: number;
    subtotal?: number;
    vat?: number;
    currency?: string;
    valid_until?: string;
    items?: QuoteLine[];
    status?: string;
    ccb_overrides?: Array<{
      flag_title: string;
      approver_role: string;
      approved_by: string;
      approved_at: string;
      baseline_id?: string | null;
      notes?: string;
    }>;
  };
};

type ProjectRecord = {
  id: string;
  name?: string;
  title?: string;
  project_name?: string;
  client_name?: string;
  contract_value?: number | string;
  project_type?: string;
  status?: string;
};

type BackendAssembly = {
  id?: string;
  assembly_code: string;
  name: string;
  category: string;
  unit: string;
  subcontractor_benchmark_rate: number;
  wastage_tolerance_pct: number;
  output_rate_per_day: number;
  labour_gang: Array<{ role: string; hours_per_unit: number; hourly_rate: number }>;
  source?: "default" | "custom";
};

type AssemblyBreakdown = {
  assembly_code: string;
  name: string;
  unit: string;
  quantity: number;
  calculated_unit_rate: number;
  total_direct_cost: number;
  subcontractor_benchmark_rate: number;
  estimated_production_days: number;
  materials: Array<{
    material: string;
    unit: string;
    net_quantity: number;
    total_quantity_with_waste: number;
    unit_cost: number;
    total_cost: number;
  }>;
  labour: Array<{
    role: string;
    total_hours: number;
    hourly_rate: number;
    total_cost: number;
  }>;
};

type BrainResult = {
  quotation_id: string;
  project_title: string;
  is_worth_taking: boolean;
  worthiness_score: number;
  worthiness_rating: string;
  recommendation: string;
  metrics: {
    total_direct_costs: number;
    target_selling_price: number;
    protected_profit_amount: number;
    protected_margin_pct: number;
    cost_per_built_sqm: number;
    average_daily_spend: number;
    project_duration_weeks: number;
  };
  rate_outliers_count: number;
  rate_outlier_details: any[];
  spend_forecast: {
    weekly_cost_plan: Array<{
      week_number: number;
      weekly_spend: number;
      cumulative_spend: number;
      materials_spend: number;
      labour_spend: number;
      equipment_spend: number;
      subcontractor_spend: number;
      earned_value_target: number;
    }>;
  };
  mandatory_approvals: string[];
};

type Flag = {
  severity: Severity;
  title: string;
  detail: string;
  action: string;
};

const ASSEMBLY_RULES: Array<{ code: string; match: RegExp }> = [
  { code: "CONC-25MPA", match: /concrete|slab|foundation|footing|beam|column/i },
  { code: "BRICK-DOUBLE-230", match: /brick|block|masonry|wall/i },
  { code: "PLASTER-INT-12", match: /plaster|render|skim/i },
  { code: "ROOF-PITCH-SHEET", match: /roof|truss|sheet|covering/i },
  { code: "REBAR-Y10-Y16", match: /rebar|steel|reinforce/i },
  { code: "EXCAV-TRENCH", match: /excavat|trench|earth/i },
  { code: "ELEC-ROUGH-IN", match: /electrical|wiring|conduit|socket|switch|distribution board|cabling/i },
  { code: "PLUMB-ROUGH-IN", match: /plumbing|pipework|pipe|sanitary|drainage/i },
  { code: "TILE-FLOOR-CERAMIC", match: /tiling|tile|ceramic|porcelain|grout/i },
  { code: "PAINT-INT-2COAT", match: /paint|emulsion|primer|decorating/i },
  { code: "WATERPROOF-MEMBRANE", match: /waterproof|membrane|damp proof|tanking/i },
  { code: "DOOR-WINDOW-FIX", match: /door frame|window frame|joinery|ironmongery|aluminium (door|window)/i },
];

const money = (value: number, currency = "USD") =>
  `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const qty = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 });

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getQuoteLines(quote: QuotationRecord | null): QuoteLine[] {
  if (!quote?.metadata?.items || !Array.isArray(quote.metadata.items)) return [];
  return quote.metadata.items.map((item) => ({
    description: String(item.description || "Unspecified work item"),
    qty: toNumber(item.qty, 0),
    unit: String(item.unit || "unit"),
    rate: toNumber(item.rate, 0),
    buildup: Array.isArray(item.buildup) ? item.buildup : [],
  }));
}

function matchAssemblyCode(description: string): string | undefined {
  const rule = ASSEMBLY_RULES.find((item) => item.match.test(description));
  return rule?.code;
}

function buildBrainFlags(brain: BrainResult | null): Flag[] {
  if (!brain) return [];
  const flags: Flag[] = [];

  if (brain.metrics.protected_margin_pct < 12) {
    flags.push({
      severity: "critical",
      title: "Margin below protected threshold",
      detail: `Target margin is ${brain.metrics.protected_margin_pct.toFixed(1)}%. Company protection floor is 12%.`,
      action: "Force MD approval or revise price/scope before submission.",
    });
  } else if (brain.metrics.protected_margin_pct < 18) {
    flags.push({
      severity: "medium",
      title: "Thin margin",
      detail: `Target margin is ${brain.metrics.protected_margin_pct.toFixed(1)}%, leaving limited cover for site waste and escalation.`,
      action: "Commercial review required before bid close.",
    });
  }

  if (brain.rate_outliers_count > 0) {
    flags.push({
      severity: "high",
      title: "Rate outliers detected",
      detail: `${brain.rate_outliers_count} rate item(s) exceed benchmark threshold by >15%.`,
      action: "Requires Commercial Manager review and supplier re-quote.",
    });
  }

  if (brain.worthiness_score < 65) {
    flags.push({
      severity: "critical",
      title: "Commercial worthiness score below threshold",
      detail: `Project score is ${brain.worthiness_score}/100. Minimum viable score is 65/100.`,
      action: "Mandatory Executive Board review before bid signoff.",
    });
  }

  return flags;
}

function buildStructuralFlags(
  quote: QuotationRecord | null,
  project: ProjectRecord | null,
  lines: QuoteLine[],
  matchedLines: number,
): Flag[] {
  if (!quote) return [];
  const flags: Flag[] = [];

  if (lines.length === 0) {
    flags.push({
      severity: "critical",
      title: "No BOQ intelligence available",
      detail: "The selected quotation has no itemized BOQ metadata for the CCB to interrogate.",
      action: "Return to quotation builder and load measured BOQ lines before commercial approval.",
    });
  }

  if (lines.length > 0 && matchedLines / lines.length < 0.5) {
    flags.push({
      severity: "high",
      title: "Low assembly recognition",
      detail: `${matchedLines} of ${lines.length} lines matched the construction assembly library.`,
      action: "QS must classify unmatched lines before this quote becomes the execution baseline.",
    });
  }

  return flags;
}

function severityClass(severity: Severity): string {
  if (severity === "critical") return "border-red-500/30 bg-red-950/25 text-red-300";
  if (severity === "high") return "border-orange-500/30 bg-orange-950/20 text-orange-300";
  if (severity === "medium") return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  return "border-slate-500/30 bg-slate-900/20 text-slate-300";
}

export default function CommercialControlBrainPage() {
  const { session } = useAuth();
  const [quotations, setQuotations] = useState<QuotationRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [assemblies, setAssemblies] = useState<BackendAssembly[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [durationWeeks, setDurationWeeks] = useState(16);
  const [builtAreaSqm, setBuiltAreaSqm] = useState(450);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [sourceType, setSourceType] = useState<AutonomousSourceType>("project");
  const [sourceId, setSourceId] = useState("");
  const [scopeText, setScopeText] = useState("");
  const [generatingQuote, setGeneratingQuote] = useState(false);

  const [activeTab, setActiveTab] = useState<"controls" | "scenarios" | "rates" | "vendors" | "guard" | "watcher">("controls");

  const [brain, setBrain] = useState<BrainResult | null>(null);
  const [breakdowns, setBreakdowns] = useState<AssemblyBreakdown[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  // --- ENHANCEMENT STATES --- //
  // 1. Scenario Simulation
  const [simMatHike, setSimMatHike] = useState(10);
  const [simSubHike, setSimSubHike] = useState(5);
  const [simResult, setSimResult] = useState<any>(null);
  const [simulating, setSimulating] = useState(false);

  // 2. Inflation & Escalation
  const [inflationForecast, setInflationForecast] = useState<any>(null);

  // 3. Recommended Subcontractors
  const [recommendedVendors, setRecommendedVendors] = useState<any[]>([]);

  // 4. Semantic Classifier Test
  const [classifyQuery, setClassifyQuery] = useState("150mm reinforced concrete slab in C30/37");
  const [classifyResult, setClassifyResult] = useState<any>(null);

  // 5. Rate Benchmarking
  const [rateItemCode, setRateItemCode] = useState("CEMENT-50KG");
  const [proposedRate, setProposedRate] = useState(18.5);
  const [rateResult, setRateResult] = useState<any>(null);

  // 6. Site Commercial Guard
  const [guardRequester, setGuardRequester] = useState("Site Foreman - Dave Miller");
  const [guardItem, setGuardItem] = useState("Cement 50kg bags (42.5N)");
  const [guardReqQty, setGuardReqQty] = useState(500);
  const [guardEarnedQty, setGuardEarnedQty] = useState(280);
  const [guardUnitRate, setGuardUnitRate] = useState(12.5);
  const [guardAuditResult, setGuardAuditResult] = useState<any>(null);
  const [guardAuditsLog, setGuardAuditsLog] = useState<any[]>([]);

  // 7. Scope & Document Watcher
  const [docName, setDocName] = useState("Structural Foundation Drawing R2");
  const [docRev, setDocRev] = useState("R2");
  const [docOrigCost, setDocOrigCost] = useState(100000);
  const [docRevisedCost, setDocRevisedCost] = useState(118400);
  const [docWatchResult, setDocWatchResult] = useState<any>(null);
  const [docChangesLog, setDocChangesLog] = useState<any[]>([]);

  const [overridingFlag, setOverridingFlag] = useState<string | null>(null);

  // 8. Custom Assembly Library Management (admin)
  const [showAddAssembly, setShowAddAssembly] = useState(false);
  const [newAssembly, setNewAssembly] = useState({
    assembly_code: "",
    name: "",
    category: "Custom",
    unit: "m2",
    subcontractor_benchmark_rate: 0,
    output_rate_per_day: 10,
  });
  const [savingAssembly, setSavingAssembly] = useState(false);
  const [assemblyAdminError, setAssemblyAdminError] = useState("");

  // 3. Custom Rate Benchmark Management (admin)
  const [customRateBenchmarks, setCustomRateBenchmarks] = useState<any[]>([]);
  const [showAddRateBenchmark, setShowAddRateBenchmark] = useState(false);
  const [newRateBenchmark, setNewRateBenchmark] = useState({
    item_code: "",
    description: "",
    unit: "unit",
    target_rate: 0,
    supplier_rate: 0,
    subcontractor_rate: 0,
    last_po_rate: 0,
  });
  const [savingRateBenchmark, setSavingRateBenchmark] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const [quotesRes, projectsRes, assembliesRes, guardLogRes, docLogRes, subbyRes, rateBenchmarksRes] = await Promise.all([
        getQuotations(),
        getProjects(),
        getConstructionAssemblies(),
        getGuardAuditHistory(),
        getDocumentChangeHistory(),
        getRecommendedSubcontractors("Concrete & Structure"),
        listRateBenchmarks(),
      ]);

      const quoteData = quotesRes.success && Array.isArray(quotesRes.data) ? quotesRes.data : [];
      const projectData = projectsRes.success && Array.isArray(projectsRes.data) ? projectsRes.data : [];
      const assemblyData = assembliesRes.success && Array.isArray(assembliesRes.data) ? assembliesRes.data : [];

      setQuotations(quoteData);
      setProjects(projectData);
      setAssemblies(assemblyData);
      setSelectedQuoteId((current) => current || quoteData[0]?.id || "");

      if (guardLogRes.success && Array.isArray(guardLogRes.data)) setGuardAuditsLog(guardLogRes.data);
      if (docLogRes.success && Array.isArray(docLogRes.data)) setDocChangesLog(docLogRes.data);
      if (subbyRes.success && Array.isArray(subbyRes.data)) setRecommendedVendors(subbyRes.data);
      if (rateBenchmarksRes.success && Array.isArray(rateBenchmarksRes.data)) setCustomRateBenchmarks(rateBenchmarksRes.data);
    } catch (error: any) {
      setErrorMsg(error?.message || "CCB could not load system intelligence.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) void loadData();
  }, [session, loadData]);

  const selectedQuote = useMemo(
    () => quotations.find((quote) => quote.id === selectedQuoteId) || quotations[0] || null,
    [quotations, selectedQuoteId],
  );

  const selectedProject = useMemo(() => {
    if (!selectedQuote?.project_id) return null;
    return projects.find((project) => project.id === selectedQuote.project_id) || null;
  }, [projects, selectedQuote]);

  const lines = useMemo(() => getQuoteLines(selectedQuote), [selectedQuote]);
  const currency = selectedQuote?.metadata?.currency || "USD";

  const runEvaluation = useCallback(async () => {
    if (!selectedQuote) return;
    setEvaluating(true);
    setErrorMsg("");
    try {
      const itemsPayload = lines.map((line) => ({
        description: line.description,
        quantity: line.qty,
        rate: line.rate,
        unit: line.unit,
      }));

      const payload = {
        quotation_id: selectedQuote.id,
        project_id: selectedQuote.project_id,
        project_title: selectedQuote.metadata?.project_title || selectedProject?.name || "Construction Quotation",
        built_area_sqm: builtAreaSqm,
        profit_rate: (selectedQuote.metadata?.profit_pct || 15) / 100.0,
        project_duration_weeks: durationWeeks,
        items: itemsPayload,
      };

      const [evalRes, historyRes, inflRes] = await Promise.all([
        evaluateQuotationIntelligence(payload),
        getCommercialBaselineHistory({ quotationId: selectedQuote.id }),
        forecastInflationImpact({
          base_cost: selectedQuote.metadata?.direct_costs || 100000,
          duration_weeks: durationWeeks,
          currency,
        }),
      ]);

      if (evalRes.success && evalRes.data) {
        setBrain(evalRes.data as BrainResult);
        setBaselineId(((evalRes.meta as any)?.baseline_id as string | null) ?? null);
      }
      if (historyRes.success && Array.isArray(historyRes.data)) {
        setHistory(historyRes.data);
      }
      if (inflRes.success) {
        setInflationForecast(inflRes.data);
      }

      const qtyByCode = new Map<string, number>();
      for (const line of lines) {
        const code = matchAssemblyCode(line.description);
        if (!code) continue;
        qtyByCode.set(code, (qtyByCode.get(code) || 0) + Math.max(0, line.qty));
      }

      const breakdownResults = await Promise.all(
        Array.from(qtyByCode.entries()).map(([code, matchedQty]) => calculateAssemblyBreakdown(code, matchedQty)),
      );
      setBreakdowns(
        breakdownResults
          .filter((result) => result.success && result.data)
          .map((result) => result.data as AssemblyBreakdown),
      );
    } catch (error: any) {
      setErrorMsg(error?.message || "CCB evaluation failed.");
    } finally {
      setEvaluating(false);
    }
  }, [selectedQuote, selectedProject, lines, durationWeeks, builtAreaSqm, currency]);

  useEffect(() => {
    if (selectedQuote) void runEvaluation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuote?.id]);

  const matchedLines = useMemo(
    () => lines.filter((line) => matchAssemblyCode(line.description)).length,
    [lines],
  );

  const flags = useMemo(
    () => [...buildBrainFlags(brain), ...buildStructuralFlags(selectedQuote, selectedProject, lines, matchedLines)],
    [brain, selectedQuote, selectedProject, lines, matchedLines],
  );

  const overrides = useMemo(() => selectedQuote?.metadata?.ccb_overrides || [], [selectedQuote?.metadata?.ccb_overrides]);

  const handleGenerateAutonomousQuote = async () => {
    setGeneratingQuote(true);
    setErrorMsg("");
    try {
      const selectedSourceId = sourceType === "project" ? sourceId || projects[0]?.id || "" : sourceId.trim();
      const payload: Record<string, unknown> = {
        source_type: sourceType,
        scope_text: scopeText,
        built_area_sqm: builtAreaSqm,
        project_duration_weeks: durationWeeks,
      };

      if (sourceType !== "manual") {
        payload.source_id = selectedSourceId;
      }

      const res = await generateAutonomousQuote(payload);
      if (res.success && res.data?.quotation?.id) {
        setSelectedQuoteId(res.data.quotation.id);
        setBrain(res.data.brain || null);
        setActiveTab("controls");
        await loadData();
        setSelectedQuoteId(res.data.quotation.id);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Autonomous quote generation failed.");
    } finally {
      setGeneratingQuote(false);
    }
  };
  const activeEnforcementQueue = useMemo(
    () =>
      flags.filter(
        (flag) =>
          (flag.severity === "critical" || flag.severity === "high") &&
          // A stale override (approved against an earlier baseline) no longer suppresses the flag.
          !overrides.some((o) => o.flag_title === flag.title && (!baselineId || o.baseline_id === baselineId)),
      ),
    [flags, overrides, baselineId],
  );

  const materialPlan = useMemo(
    () =>
      breakdowns
        .flatMap((breakdown) =>
          breakdown.materials.map((material) => ({
            ...material,
            assembly: breakdown.name,
          })),
        )
        .sort((a, b) => b.total_cost - a.total_cost),
    [breakdowns],
  );

  const decisionClass =
    brain?.worthiness_rating === "HIGHLY_VIABLE"
      ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
      : brain?.worthiness_rating === "VIABLE_WITH_CONTROLS"
        ? "border-amber-500/30 bg-amber-950/20 text-amber-300"
        : "border-red-500/30 bg-red-950/25 text-red-300";

  const handleRecordOverride = async (flagTitle: string, role: string) => {
    if (!selectedQuote) return;
    setOverridingFlag(flagTitle);
    try {
      const res = await saveCcbOverride({
        quotation_id: selectedQuote.id,
        flag_title: flagTitle,
        approver_role: role,
        baseline_id: baselineId,
        notes: `Overridden by ${role} from CCB portal.`,
      });
      if (res.success) {
        await loadData();
        await runEvaluation();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to record commercial override.");
    } finally {
      setOverridingFlag(null);
    }
  };

  const handleRunScenario = async () => {
    if (!selectedQuote) return;
    setSimulating(true);
    try {
      const itemsPayload = lines.map((line) => ({
        description: line.description,
        quantity: line.qty,
        rate: line.rate,
        unit: line.unit,
      }));

      const basePayload = {
        quotation_id: selectedQuote.id,
        project_title: selectedQuote.metadata?.project_title || "Construction Project",
        built_area_sqm: builtAreaSqm,
        profit_rate: (selectedQuote.metadata?.profit_pct || 15) / 100.0,
        project_duration_weeks: durationWeeks,
        items: itemsPayload,
      };

      const res = await simulateCcbScenario({
        base_payload: basePayload,
        material_price_hike_pct: simMatHike,
        subcontractor_rate_hike_pct: simSubHike,
      });

      if (res.success) {
        setSimResult(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Scenario simulation failed.");
    } finally {
      setSimulating(false);
    }
  };

  const handleRunClassification = async () => {
    try {
      const res = await classifyBoqDescription(classifyQuery);
      if (res.success) setClassifyResult(res.data);
    } catch (err: any) {
      setErrorMsg(err?.message || "Classification failed.");
    }
  };

  const handleBenchmarkRateSub = async () => {
    try {
      const res = await benchmarkRate(rateItemCode, proposedRate);
      if (res.success) setRateResult(res.data);
    } catch (err: any) {
      setErrorMsg(err?.message || "Rate benchmark failed.");
    }
  };

  const handleRunGuardAudit = async () => {
    try {
      const res = await auditSiteRequest({
        requester_name: guardRequester,
        document_type: "SITE_MATERIAL_REQUEST",
        item: guardItem,
        requested_quantity: guardReqQty,
        earned_quantity: guardEarnedQty,
        unit_rate: guardUnitRate,
        project_id: selectedQuote?.project_id,
      });
      if (res.success) {
        setGuardAuditResult(res.data);
        const historyRes = await getGuardAuditHistory();
        if (historyRes.success && Array.isArray(historyRes.data)) setGuardAuditsLog(historyRes.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Commercial guard audit failed.");
    }
  };

  const handleRunDocWatch = async () => {
    try {
      const res = await watchDocumentRevision({
        document_name: docName,
        revision: docRev,
        original_direct_cost: docOrigCost,
        revised_direct_cost: docRevisedCost,
        project_id: selectedQuote?.project_id,
      });
      if (res.success) {
        setDocWatchResult(res.data);
        const historyRes = await getDocumentChangeHistory();
        if (historyRes.success && Array.isArray(historyRes.data)) setDocChangesLog(historyRes.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Document watch failed.");
    }
  };

  const handleCreateAssembly = async () => {
    if (!newAssembly.assembly_code.trim() || !newAssembly.name.trim()) {
      setAssemblyAdminError("Assembly code and name are required.");
      return;
    }
    setSavingAssembly(true);
    setAssemblyAdminError("");
    try {
      const res = await createCustomAssembly(newAssembly);
      if (res.success) {
        setShowAddAssembly(false);
        setNewAssembly({ assembly_code: "", name: "", category: "Custom", unit: "m2", subcontractor_benchmark_rate: 0, output_rate_per_day: 10 });
        await loadData();
      } else {
        setAssemblyAdminError(res.message || "Failed to save custom assembly.");
      }
    } catch (err: any) {
      setAssemblyAdminError(err?.message || "Failed to save custom assembly.");
    } finally {
      setSavingAssembly(false);
    }
  };

  const handleDeleteAssembly = async (assemblyId: string) => {
    try {
      const res = await deleteCustomAssembly(assemblyId);
      if (res.success) await loadData();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to delete custom assembly.");
    }
  };

  const handleCreateRateBenchmark = async () => {
    if (!newRateBenchmark.item_code.trim()) {
      setErrorMsg("Item code is required for a rate benchmark.");
      return;
    }
    setSavingRateBenchmark(true);
    try {
      const res = await createRateBenchmark(newRateBenchmark);
      if (res.success) {
        setShowAddRateBenchmark(false);
        setNewRateBenchmark({ item_code: "", description: "", unit: "unit", target_rate: 0, supplier_rate: 0, subcontractor_rate: 0, last_po_rate: 0 });
        const historyRes = await listRateBenchmarks();
        if (historyRes.success && Array.isArray(historyRes.data)) setCustomRateBenchmarks(historyRes.data);
      } else {
        setErrorMsg(res.message || "Failed to save rate benchmark.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save rate benchmark.");
    } finally {
      setSavingRateBenchmark(false);
    }
  };

  const handleDeleteRateBenchmark = async (benchmarkId: string) => {
    try {
      const res = await deleteRateBenchmark(benchmarkId);
      if (res.success) {
        const historyRes = await listRateBenchmarks();
        if (historyRes.success && Array.isArray(historyRes.data)) setCustomRateBenchmarks(historyRes.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to delete rate benchmark.");
    }
  };

  const exportControlFile = () => {
    if (!brain) return;
    const controlFile = { brain, breakdowns, flags, history, overrides, inflationForecast };
    const blob = new Blob([JSON.stringify(controlFile, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${brain.quotation_id}-ccb-control-file.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  const exportControlFilePdf = async () => {
    if (!brain) return;
    setExportingPdf(true);
    setErrorMsg("");
    try {
      const blob = await exportCcbControlFilePdf({
        quotation_id: brain.quotation_id,
        project_title: brain.project_title,
        client_name: selectedQuote?.client_name || "Unassigned client",
        currency,
        recommendation: brain.recommendation,
        worthiness_rating: brain.worthiness_rating,
        worthiness_score: brain.worthiness_score,
        metrics: brain.metrics,
        mandatory_approvals: brain.mandatory_approvals,
        rate_outlier_details: brain.rate_outlier_details,
        material_plan: materialPlan,
        weekly_cost_plan: brain.spend_forecast.weekly_cost_plan,
        flags,
        overrides,
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${brain.quotation_id}-ccb-control-file.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to export CCB control file PDF.");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8 text-paper">
      {/* HEADER */}
      <div className="flex flex-col gap-4 border-b border-ink-mid pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Link href="/dashboard/quotations" className="inline-flex items-center gap-2 font-mono text-xs uppercase text-slate transition-colors hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" />
            Quotations
          </Link>
          <div>
            <h1 className="flex items-center gap-3 font-display text-2xl font-bold tracking-tight text-white">
              <BrainCircuit className="h-7 w-7 text-signal" />
              Commercial Control Brain (CCB Enterprise)
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate">
              Deterministic calculation core, AI semantic classification, what-if scenario simulator, macro inflation forecaster, vendor matchmaker, site BS-detector, and MD governance.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center justify-center gap-2 border border-ink-mid bg-ink px-4 py-2 text-xs font-semibold text-slate transition-colors hover:border-signal/50 hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-signal" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={exportControlFile}
            disabled={!brain}
            className="inline-flex items-center justify-center gap-2 border border-ink-mid bg-ink px-4 py-2 text-xs font-semibold text-slate transition-colors hover:border-signal/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => void exportControlFilePdf()}
            disabled={!brain || exportingPdf}
            className="inline-flex items-center justify-center gap-2 bg-signal px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Export PDF Control File
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 border border-red-500/20 bg-red-950/20 p-4 text-sm text-red-300">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* NAVIGATION TABS */}
      <div className="flex border-b border-ink-mid space-x-2 font-mono text-xs overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("controls")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 font-semibold transition-colors shrink-0 ${
            activeTab === "controls" ? "border-signal text-signal bg-ink-light" : "border-transparent text-slate hover:text-white"
          }`}
        >
          <BrainCircuit className="h-4 w-4" />
          1. Baseline & Controls
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("scenarios")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 font-semibold transition-colors shrink-0 ${
            activeTab === "scenarios" ? "border-signal text-signal bg-ink-light" : "border-transparent text-slate hover:text-white"
          }`}
        >
          <Sliders className="h-4 w-4" />
          2. What-If Simulator
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("rates")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 font-semibold transition-colors shrink-0 ${
            activeTab === "rates" ? "border-signal text-signal bg-ink-light" : "border-transparent text-slate hover:text-white"
          }`}
        >
          <Scale className="h-4 w-4" />
          3. Rate Intelligence
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("vendors")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 font-semibold transition-colors shrink-0 ${
            activeTab === "vendors" ? "border-signal text-signal bg-ink-light" : "border-transparent text-slate hover:text-white"
          }`}
        >
          <Building2 className="h-4 w-4" />
          4. Subby Matchmaker
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("guard")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 font-semibold transition-colors shrink-0 ${
            activeTab === "guard" ? "border-signal text-signal bg-ink-light" : "border-transparent text-slate hover:text-white"
          }`}
        >
          <ShieldAlert className="h-4 w-4" />
          5. Site Commercial Guard
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("watcher")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 font-semibold transition-colors shrink-0 ${
            activeTab === "watcher" ? "border-signal text-signal bg-ink-light" : "border-transparent text-slate hover:text-white"
          }`}
        >
          <FileText className="h-4 w-4" />
          6. Scope Watcher
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
        {/* SIDEBAR */}
        <aside className="space-y-4">
          <div className="border border-ink-mid bg-ink-light p-5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-slate">Quotation Baseline</label>
            <select
              value={selectedQuote?.id || ""}
              onChange={(event) => setSelectedQuoteId(event.target.value)}
              className="mt-3 h-11 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none transition-colors focus:border-signal/60"
            >
              {quotations.map((quote) => (
                <option key={quote.id} value={quote.id}>
                  {quote.metadata?.reference_number || quote.id.slice(0, 8)} - {quote.client_name || "No client"}
                </option>
              ))}
            </select>
            <div className="mt-4">
              <label className="font-mono text-[10px] uppercase tracking-widest text-slate">Planned Duration: {durationWeeks} weeks</label>
              <input
                type="range"
                min={2}
                max={52}
                value={durationWeeks}
                onChange={(event) => setDurationWeeks(toNumber(event.target.value, 16))}
                className="mt-3 w-full accent-[var(--snc-gold)]"
              />
            </div>
            <div className="mt-4">
              <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-slate">
                <Building2 className="h-3 w-3" /> Built area (sqm)
              </label>
              <input
                type="number"
                min={1}
                value={builtAreaSqm}
                onChange={(event) => setBuiltAreaSqm(Math.max(1, toNumber(event.target.value, 450)))}
                className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none transition-colors focus:border-signal/60"
              />
            </div>
            <button
              type="button"
              onClick={() => void runEvaluation()}
              disabled={!selectedQuote || evaluating}
              className="mt-4 flex w-full items-center justify-center gap-2 bg-signal px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {evaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
              Recalculate Baseline
            </button>
          </div>

          <div className="border border-ink-mid bg-ink-light p-5">
            <h2 className="flex items-center gap-2 font-display text-base font-semibold text-white">
              <Zap className="h-4 w-4 text-signal" />
              Autonomous Quote Builder
            </h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-widest text-slate">Source</label>
                <select
                  value={sourceType}
                  onChange={(event) => setSourceType(event.target.value as AutonomousSourceType)}
                  className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-xs text-paper outline-none transition-colors focus:border-signal/60"
                >
                  <option value="project">Project</option>
                  <option value="lead">CRM Lead</option>
                  <option value="opportunity">CRM Opportunity</option>
                  <option value="tender">CRM Tender</option>
                  <option value="manual">Manual Scope</option>
                </select>
              </div>

              {sourceType === "project" ? (
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-widest text-slate">Project</label>
                  <select
                    value={sourceId || projects[0]?.id || ""}
                    onChange={(event) => setSourceId(event.target.value)}
                    className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-xs text-paper outline-none transition-colors focus:border-signal/60"
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name || project.title || project.project_name || project.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : sourceType !== "manual" ? (
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-widest text-slate">CRM Record ID</label>
                  <input
                    type="text"
                    value={sourceId}
                    onChange={(event) => setSourceId(event.target.value)}
                    className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-xs text-paper outline-none transition-colors focus:border-signal/60"
                  />
                </div>
              ) : null}

              <div>
                <label className="font-mono text-[10px] uppercase tracking-widest text-slate">Scope</label>
                <textarea
                  value={scopeText}
                  onChange={(event) => setScopeText(event.target.value)}
                  rows={4}
                  className="mt-2 w-full resize-none border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none transition-colors focus:border-signal/60"
                />
              </div>

              <button
                type="button"
                onClick={() => void handleGenerateAutonomousQuote()}
                disabled={generatingQuote || (sourceType !== "manual" && sourceType !== "project" && !sourceId.trim()) || (sourceType === "project" && projects.length === 0)}
                className="flex w-full items-center justify-center gap-2 bg-signal px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generatingQuote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Generate Draft Quote
              </button>
            </div>
          </div>
          {/* MACRO INFLATION CARD */}
          {inflationForecast && (
            <div className="border border-ink-mid bg-ink-light p-5">
              <h2 className="flex items-center gap-2 font-display text-xs font-semibold text-white uppercase tracking-wider font-mono">
                <TrendingUp className="h-4 w-4 text-signal" />
                Macro Inflation Risk ({inflationForecast.currency})
              </h2>
              <div className="mt-3 space-y-2 text-xs text-slate">
                <div className="flex justify-between">
                  <span>Annual Inflation:</span>
                  <span className="font-mono text-white">{inflationForecast.annual_inflation_rate_pct}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Projected Escalation:</span>
                  <span className="font-mono text-amber-300">+{money(inflationForecast.projected_escalation_amount, currency)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-ink-mid font-semibold text-white">
                  <span>Total Escalated Cost:</span>
                  <span className="font-mono">{money(inflationForecast.total_escalated_cost, currency)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="border border-ink-mid bg-ink-light p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display text-base font-semibold text-white">
                <ClipboardList className="h-4 w-4 text-signal" />
                Engine Assemblies ({assemblies.length})
              </h2>
              <button
                type="button"
                onClick={() => setShowAddAssembly((v) => !v)}
                className="font-mono text-[10px] uppercase text-signal hover:text-signal-hover"
              >
                {showAddAssembly ? "Cancel" : "+ Add"}
              </button>
            </div>

            {showAddAssembly && (
              <div className="mt-3 space-y-2 border border-ink-mid bg-ink p-3">
                <input
                  type="text"
                  placeholder="Assembly code (e.g. HVAC-DUCT)"
                  value={newAssembly.assembly_code}
                  onChange={(e) => setNewAssembly((v) => ({ ...v, assembly_code: e.target.value.toUpperCase() }))}
                  className="h-8 w-full border border-ink-mid bg-ink-light px-2 text-[11px] text-white outline-none"
                />
                <input
                  type="text"
                  placeholder="Name"
                  value={newAssembly.name}
                  onChange={(e) => setNewAssembly((v) => ({ ...v, name: e.target.value }))}
                  className="h-8 w-full border border-ink-mid bg-ink-light px-2 text-[11px] text-white outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Unit (e.g. m2)"
                    value={newAssembly.unit}
                    onChange={(e) => setNewAssembly((v) => ({ ...v, unit: e.target.value }))}
                    className="h-8 w-full border border-ink-mid bg-ink-light px-2 text-[11px] text-white outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Category"
                    value={newAssembly.category}
                    onChange={(e) => setNewAssembly((v) => ({ ...v, category: e.target.value }))}
                    className="h-8 w-full border border-ink-mid bg-ink-light px-2 text-[11px] text-white outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    placeholder="Subby rate"
                    value={newAssembly.subcontractor_benchmark_rate}
                    onChange={(e) => setNewAssembly((v) => ({ ...v, subcontractor_benchmark_rate: toNumber(e.target.value, 0) }))}
                    className="h-8 w-full border border-ink-mid bg-ink-light px-2 text-[11px] text-white outline-none"
                  />
                  <input
                    type="number"
                    placeholder="Output/day"
                    value={newAssembly.output_rate_per_day}
                    onChange={(e) => setNewAssembly((v) => ({ ...v, output_rate_per_day: toNumber(e.target.value, 10) }))}
                    className="h-8 w-full border border-ink-mid bg-ink-light px-2 text-[11px] text-white outline-none"
                  />
                </div>
                {assemblyAdminError && <p className="text-[10px] text-red-400">{assemblyAdminError}</p>}
                <button
                  type="button"
                  onClick={() => void handleCreateAssembly()}
                  disabled={savingAssembly}
                  className="flex w-full items-center justify-center gap-1.5 bg-signal px-3 py-1.5 text-[11px] font-semibold text-ink hover:bg-signal-hover disabled:opacity-40"
                >
                  {savingAssembly ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Save custom assembly
                </button>
                <p className="text-[10px] text-slate">
                  Recipe (materials/labour/plant) defaults empty — the benchmark rate and output target are still used for spend/output planning.
                </p>
              </div>
            )}

            <div className="mt-4 space-y-3 max-h-60 overflow-y-auto pr-1">
              {assemblies.map((assembly) => (
                <div key={assembly.assembly_code} className="border border-ink-mid bg-ink p-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-white">
                      {assembly.name}
                      {assembly.source === "custom" && (
                        <span className="ml-2 border border-signal/40 px-1 py-0.5 text-[9px] uppercase text-signal">Custom</span>
                      )}
                    </p>
                    <span className="font-mono text-[10px] uppercase text-signal">{assembly.unit}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-light">
                    Output {assembly.output_rate_per_day}/day | Subby {money(assembly.subcontractor_benchmark_rate)}
                  </p>
                  {assembly.source === "custom" && assembly.id && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteAssembly(assembly.id as string)}
                      className="mt-2 font-mono text-[10px] uppercase text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* MAIN DISPLAY BODY */}
        <main className="space-y-6">
          {/* TAB 1: BASELINE & CONTROLS */}
          {activeTab === "controls" && (
            <>
              {loading ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center border border-ink-mid bg-ink-light">
                  <Loader2 className="h-8 w-8 animate-spin text-signal" />
                  <p className="mt-3 font-mono text-xs uppercase tracking-widest text-slate">Loading CCB intelligence</p>
                </div>
              ) : !selectedQuote ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center border border-dashed border-ink-mid bg-ink-light text-center">
                  <FileWarning className="h-10 w-10 text-slate" />
                  <p className="mt-3 text-sm font-semibold text-white">No quotation baseline found</p>
                </div>
              ) : evaluating && !brain ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center border border-ink-mid bg-ink-light">
                  <Loader2 className="h-8 w-8 animate-spin text-signal" />
                  <p className="mt-3 font-mono text-xs uppercase tracking-widest text-slate">Evaluating Commercial Control Brain</p>
                </div>
              ) : !brain ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center border border-dashed border-ink-mid bg-ink-light text-center">
                  <FileWarning className="h-10 w-10 text-slate" />
                  <p className="mt-3 text-sm font-semibold text-white">Evaluation unavailable</p>
                </div>
              ) : (
                <>
                  {/* DECISION SUMMARY BANNER */}
                  <section className={`border p-5 ${decisionClass}`}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-widest opacity-80">CCB Decision & Risk Evaluation</p>
                        <h2 className="mt-1 font-display text-xl font-bold text-white">{brain.recommendation}</h2>
                        <p className="mt-1 text-sm opacity-90">
                          {brain.quotation_id} | {brain.project_title} | {selectedQuote.client_name || "Unassigned client"}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Metric label="Score" value={`${brain.worthiness_score}/100`} />
                        <Metric label="Margin" value={`${brain.metrics.protected_margin_pct.toFixed(1)}%`} />
                        <Metric label="Matched" value={`${matchedLines}/${lines.length}`} />
                        <Metric label="Duration" value={`${brain.metrics.project_duration_weeks}w`} />
                      </div>
                    </div>
                  </section>

                  {/* KPIS */}
                  <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
                    <Kpi icon={TrendingUp} label="Target Selling Price" value={money(brain.metrics.target_selling_price, currency)} />
                    <Kpi icon={Gauge} label="Cost / Built Sqm" value={money(brain.metrics.cost_per_built_sqm, currency)} />
                    <Kpi icon={HardHat} label="Direct Works Cost" value={money(brain.metrics.total_direct_costs, currency)} />
                    <Kpi icon={ShieldAlert} label="Protected Profit" value={money(brain.metrics.protected_profit_amount, currency)} />
                  </section>

                  {/* MATERIAL DEMAND & SITE OUTPUT */}
                  <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <Panel title="Material Demand Schedule" icon={Package}>
                      {materialPlan.length === 0 ? (
                        <p className="text-sm text-slate">No matched assemblies — classify BOQ lines against the engineering library.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-ink-mid font-mono uppercase tracking-wider text-slate">
                              <tr>
                                <th className="pb-3 font-normal">Material</th>
                                <th className="pb-3 text-right font-normal">Qty (w/ waste)</th>
                                <th className="pb-3 text-right font-normal">Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {materialPlan.slice(0, 10).map((item, index) => (
                                <tr key={`${item.material}-${item.unit}-${index}`} className="border-b border-ink-mid/30">
                                  <td className="py-3 text-white">
                                    {item.material}
                                    <span className="ml-2 text-[10px] text-slate">{item.assembly}</span>
                                  </td>
                                  <td className="py-3 text-right font-mono text-slate-light">{qty(item.total_quantity_with_waste)} {item.unit}</td>
                                  <td className="py-3 text-right font-mono text-slate">{money(item.total_cost, currency)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </Panel>

                    <Panel title="Expected Site Output Targets" icon={HardHat}>
                      <div className="space-y-3">
                        {breakdowns.length === 0 ? (
                          <p className="text-sm text-slate">No output plan until BOQ lines match construction assemblies.</p>
                        ) : (
                          breakdowns.map((breakdown) => (
                            <div key={breakdown.assembly_code} className="border border-ink-mid bg-ink p-3">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="font-semibold text-white">{breakdown.name}</p>
                                  <p className="mt-1 text-xs text-slate">{breakdown.labour.map((l) => l.role).join(", ")}</p>
                                </div>
                                <span className="font-mono text-xs text-signal">{qty(breakdown.quantity)} {breakdown.unit}</span>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] uppercase text-slate">
                                <span>Est. production: {breakdown.estimated_production_days} days</span>
                                <span>Subby benchmark: {money(breakdown.subcontractor_benchmark_rate, currency)}/{breakdown.unit}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </Panel>
                  </section>

                  {/* SPEND GUARDRAILS */}
                  <Panel title="S-Curve Weekly Spend Guardrails" icon={Gauge}>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {brain.spend_forecast.weekly_cost_plan.slice(0, 12).map((week) => (
                        <div key={week.week_number} className="border border-ink-mid bg-ink p-3">
                          <div className="flex items-center justify-between">
                            <p className="font-mono text-xs uppercase text-white">Week {week.week_number}</p>
                            <p className="font-mono text-xs text-signal">{money(week.weekly_spend, currency)}</p>
                          </div>
                          <div className="mt-3 h-1.5 bg-ink-mid">
                            <div
                              className="h-1.5 bg-signal"
                              style={{ width: `${Math.min(100, (week.cumulative_spend / Math.max(1, brain.metrics.total_direct_costs)) * 100)}%` }}
                            />
                          </div>
                          <p className="mt-2 font-mono text-[10px] uppercase text-slate">
                            Remaining buffer {money(Math.max(0, brain.metrics.total_direct_costs - week.cumulative_spend), currency)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </Panel>

                  {/* FLAGS & INTERACTIVE ENFORCEMENT QUEUE */}
                  <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <Panel title="Commercial Exceptions (BS Flags)" icon={AlertTriangle}>
                      <div className="space-y-3">
                        {flags.length === 0 ? (
                          <div className="flex items-center gap-3 border border-emerald-500/20 bg-emerald-950/15 p-4 text-emerald-300">
                            <CheckCircle2 className="h-5 w-5" />
                            <span className="text-sm">No commercial exceptions detected against current CCB rules.</span>
                          </div>
                        ) : (
                          flags.map((flag, index) => <FlagRow key={`${flag.title}-${index}`} flag={flag} />)
                        )}
                      </div>
                    </Panel>

                    <Panel title="Interactive MD/Admin Enforcement Queue" icon={ShieldAlert}>
                      <div className="space-y-3">
                        {activeEnforcementQueue.length === 0 && overrides.length === 0 ? (
                          <p className="text-sm text-slate">No blocking actions required by current baseline.</p>
                        ) : (
                          <>
                            {activeEnforcementQueue.map((flag, index) => (
                              <div key={`${flag.action}-${index}`} className={`border p-4 ${severityClass(flag.severity)}`}>
                                <div className="flex items-center justify-between gap-4">
                                  <p className="font-semibold text-white">{flag.title}</p>
                                  <span className="font-mono text-[10px] uppercase tracking-widest">{flag.severity}</span>
                                </div>
                                <p className="mt-2 text-sm opacity-90">{flag.detail}</p>
                                <div className="mt-3 flex items-center justify-between border-t border-current/20 pt-3">
                                  <span className="font-mono text-[10px] uppercase tracking-wider">{flag.action}</span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      disabled={overridingFlag === flag.title}
                                      onClick={() => void handleRecordOverride(flag.title, "MD")}
                                      className="inline-flex items-center gap-1 bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold px-2.5 py-1 rounded-xs transition-colors"
                                    >
                                      {overridingFlag === flag.title ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
                                      MD Override
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}

                            {overrides.length > 0 && (
                              <div className="border border-emerald-500/30 bg-emerald-950/15 p-4 space-y-2">
                                <p className="font-mono text-[10px] uppercase tracking-widest text-emerald-400 font-bold flex items-center gap-1">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Approved Commercial Overrides ({overrides.length})
                                </p>
                                {overrides.map((ov, i) => {
                                  const isStale = Boolean(baselineId) && ov.baseline_id !== baselineId;
                                  return (
                                    <div key={i} className="text-xs text-emerald-200 border-t border-emerald-500/20 pt-2">
                                      <span className="font-semibold">{ov.flag_title}</span> — Approved by {ov.approver_role} on {new Date(ov.approved_at).toLocaleDateString()}
                                      {isStale && (
                                        <span className="ml-2 border border-amber-500/40 bg-amber-950/30 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
                                          Stale — re-approve against latest baseline
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </Panel>
                  </section>
                </>
              )}
            </>
          )}

          {/* TAB 2: WHAT-IF SCENARIO SIMULATOR */}
          {activeTab === "scenarios" && (
            <div className="space-y-6">
              <Panel title="What-If Commercial Stress Simulator" icon={Sliders}>
                <div className="space-y-4">
                  <p className="text-sm text-slate">
                    Simulate material cost spikes or subcontractor rate hikes and measure their real-time impact on project worthiness and selling price before submitting bids.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-ink-mid bg-ink p-4">
                    <div>
                      <label className="font-mono text-[10px] uppercase tracking-widest text-slate">Material Price Hike: {simMatHike}%</label>
                      <input
                        type="range"
                        min={0}
                        max={50}
                        value={simMatHike}
                        onChange={(e) => setSimMatHike(toNumber(e.target.value, 10))}
                        className="mt-2 w-full accent-[var(--snc-gold)]"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase tracking-widest text-slate">Subcontractor Rate Hike: {simSubHike}%</label>
                      <input
                        type="range"
                        min={0}
                        max={50}
                        value={simSubHike}
                        onChange={(e) => setSimSubHike(toNumber(e.target.value, 5))}
                        className="mt-2 w-full accent-[var(--snc-gold)]"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleRunScenario()}
                    disabled={simulating}
                    className="flex items-center gap-2 bg-signal text-ink text-xs font-semibold px-4 py-2 hover:bg-signal-hover transition-colors disabled:opacity-40"
                  >
                    {simulating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sliders className="h-4 w-4" />}
                    Run Stress Simulation
                  </button>

                  {simResult && (
                    <div className="border border-ink-mid bg-ink p-5 space-y-4">
                      <h3 className="font-display font-semibold text-white text-base">Simulation Delta Output</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
                        <div className="border border-white/10 bg-black/20 p-3">
                          <p className="text-slate uppercase text-[10px]">Cost Delta</p>
                          <p className="text-amber-300 font-bold text-base mt-1">+{money(simResult.delta.cost_increase_amount, currency)}</p>
                        </div>
                        <div className="border border-white/10 bg-black/20 p-3">
                          <p className="text-slate uppercase text-[10px]">Cost Increase %</p>
                          <p className="text-amber-300 font-bold text-base mt-1">+{simResult.delta.cost_increase_pct}%</p>
                        </div>
                        <div className="border border-white/10 bg-black/20 p-3">
                          <p className="text-slate uppercase text-[10px]">Score Drop</p>
                          <p className="text-red-400 font-bold text-base mt-1">-{simResult.delta.score_drop} pts</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
            </div>
          )}

          {/* TAB 3: RATE INTELLIGENCE & SEMANTIC CLASSIFIER */}
          {activeTab === "rates" && (
            <div className="space-y-6">
              <Panel title="Semantic BOQ Description Classifier (AI Engine)" icon={Zap}>
                <div className="space-y-4">
                  <p className="text-sm text-slate">
                    Test semantic keyword matching that maps unstandardized BOQ item descriptions to standard engineering assemblies.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={classifyQuery}
                      onChange={(e) => setClassifyQuery(e.target.value)}
                      className="h-10 flex-1 border border-ink-mid bg-ink px-3 text-xs text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleRunClassification()}
                      className="bg-signal text-ink px-4 py-2 text-xs font-semibold hover:bg-signal-hover"
                    >
                      Classify
                    </button>
                  </div>
                  {classifyResult && (
                    <div className="border border-emerald-500/30 bg-emerald-950/20 p-4 text-xs space-y-1">
                      <p className="font-semibold text-white">Match: {classifyResult.assembly_name || "No Match"}</p>
                      <p className="text-slate">Confidence: {classifyResult.confidence_pct}% | Code: {classifyResult.assembly_code || "N/A"}</p>
                    </div>
                  )}
                </div>
              </Panel>

              <Panel title="Rate Intelligence & Outlier Detector" icon={Scale}>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-ink-mid bg-ink p-4">
                    <div>
                      <label className="font-mono text-[10px] uppercase tracking-widest text-slate">Item Code</label>
                      <select
                        value={rateItemCode}
                        onChange={(e) => setRateItemCode(e.target.value)}
                        className="mt-2 h-10 w-full border border-ink-mid bg-ink-light px-3 text-xs text-paper outline-none"
                      >
                        <option value="CEMENT-50KG">CEMENT-50KG (Cement 42.5N)</option>
                        <option value="BRICK-COMMON">BRICK-COMMON (Standard Clay Common Brick)</option>
                        <option value="SAND-BUILDING">SAND-BUILDING (Washed Building Sand m3)</option>
                        <option value="SUBBY-PLASTER-M2">SUBBY-PLASTER-M2 (Plastering Subcontractor Rate m2)</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase tracking-widest text-slate">Proposed Rate (USD)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={proposedRate}
                        onChange={(e) => setProposedRate(toNumber(e.target.value, 18.5))}
                        className="mt-2 h-10 w-full border border-ink-mid bg-ink-light px-3 text-xs text-paper outline-none"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => void handleBenchmarkRateSub()}
                        className="h-10 w-full bg-signal text-ink text-xs font-semibold hover:bg-signal-hover transition-colors"
                      >
                        Run Rate Benchmark
                      </button>
                    </div>
                  </div>

                  {rateResult && (
                    <div className={`border p-4 ${rateResult.is_outlier ? "border-red-500/40 bg-red-950/20" : "border-emerald-500/40 bg-emerald-950/20"}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-white">{rateResult.status}</span>
                        <span className="font-mono text-xs text-slate-light">Variance vs PO: {rateResult.variance_vs_last_po_pct}%</span>
                      </div>
                      <p className="mt-2 text-xs text-paper">{rateResult.recommendation}</p>
                    </div>
                  )}
                </div>
              </Panel>

              <Panel title="Org Rate Benchmark Library (Admin)" icon={Scale}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate">
                      Custom benchmarks override the default seed for the same item code across rate checks and outlier detection.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowAddRateBenchmark((v) => !v)}
                      className="shrink-0 font-mono text-[10px] uppercase text-signal hover:text-signal-hover"
                    >
                      {showAddRateBenchmark ? "Cancel" : "+ Add benchmark"}
                    </button>
                  </div>

                  {showAddRateBenchmark && (
                    <div className="grid grid-cols-1 gap-2 border border-ink-mid bg-ink p-4 md:grid-cols-3">
                      <input
                        type="text"
                        placeholder="Item code"
                        value={newRateBenchmark.item_code}
                        onChange={(e) => setNewRateBenchmark((v) => ({ ...v, item_code: e.target.value.toUpperCase() }))}
                        className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-white outline-none"
                      />
                      <input
                        type="text"
                        placeholder="Description"
                        value={newRateBenchmark.description}
                        onChange={(e) => setNewRateBenchmark((v) => ({ ...v, description: e.target.value }))}
                        className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-white outline-none md:col-span-2"
                      />
                      <input
                        type="number"
                        placeholder="Target rate"
                        value={newRateBenchmark.target_rate}
                        onChange={(e) => setNewRateBenchmark((v) => ({ ...v, target_rate: toNumber(e.target.value, 0) }))}
                        className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-white outline-none"
                      />
                      <input
                        type="number"
                        placeholder="Supplier rate"
                        value={newRateBenchmark.supplier_rate}
                        onChange={(e) => setNewRateBenchmark((v) => ({ ...v, supplier_rate: toNumber(e.target.value, 0) }))}
                        className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-white outline-none"
                      />
                      <input
                        type="number"
                        placeholder="Last PO rate"
                        value={newRateBenchmark.last_po_rate}
                        onChange={(e) => setNewRateBenchmark((v) => ({ ...v, last_po_rate: toNumber(e.target.value, 0) }))}
                        className="h-9 border border-ink-mid bg-ink-light px-2 text-xs text-white outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateRateBenchmark()}
                        disabled={savingRateBenchmark}
                        className="flex items-center justify-center gap-1.5 bg-signal px-3 py-2 text-xs font-semibold text-ink hover:bg-signal-hover disabled:opacity-40 md:col-span-3"
                      >
                        {savingRateBenchmark ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Save benchmark
                      </button>
                    </div>
                  )}

                  {customRateBenchmarks.length === 0 ? (
                    <p className="text-sm text-slate">No org-specific rate benchmarks recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {customRateBenchmarks.map((bm) => (
                        <div key={bm.id} className="flex items-center justify-between border border-ink-mid bg-ink p-3 text-xs">
                          <div>
                            <p className="font-semibold text-white">{bm.item_code} — {bm.description}</p>
                            <p className="text-slate">Target {money(toNumber(bm.target_rate))} | Last PO {money(toNumber(bm.last_po_rate))}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleDeleteRateBenchmark(bm.id)}
                            className="font-mono text-[10px] uppercase text-red-400 hover:text-red-300"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Panel>
            </div>
          )}

          {/* TAB 4: SUBCONTRACTOR MATCHMAKER */}
          {activeTab === "vendors" && (
            <Panel title="Subcontractor Matchmaker & Vendor Scorecards" icon={Building2}>
              <div className="space-y-4">
                <p className="text-sm text-slate">
                  Pre-vetted subcontractor vendors matching CCB benchmark target rates and historical performance.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {recommendedVendors.map((vendor) => (
                    <div key={vendor.vendor_id} className="border border-ink-mid bg-ink p-4 text-xs space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-white text-sm">{vendor.name}</span>
                        <span className="font-mono text-signal">Rating: {vendor.rating}/5.0</span>
                      </div>
                      <p className="text-slate">Category: {vendor.category}</p>
                      <div className="flex justify-between font-mono text-[10px] text-slate-light pt-2 border-t border-ink-mid">
                        <span>On-Time: {vendor.on_time_pct}%</span>
                        <span>Rate Variance: {vendor.historical_variance_pct}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {/* TAB 5: SITE COMMERCIAL GUARD */}
          {activeTab === "guard" && (
            <div className="space-y-6">
              <Panel title="Site Commercial Guard & BS Detector Audit" icon={ShieldAlert}>
                <div className="space-y-4">
                  <p className="text-sm text-slate">
                    Intercepts material over-requests and site claims by auditing requested quantities against earned site progress.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 border border-ink-mid bg-ink p-4">
                    <div>
                      <label className="font-mono text-[10px] uppercase text-slate">Requester</label>
                      <input
                        type="text"
                        value={guardRequester}
                        onChange={(e) => setGuardRequester(e.target.value)}
                        className="mt-1 h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase text-slate">Item Description</label>
                      <input
                        type="text"
                        value={guardItem}
                        onChange={(e) => setGuardItem(e.target.value)}
                        className="mt-1 h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase text-slate">Requested Qty</label>
                      <input
                        type="number"
                        value={guardReqQty}
                        onChange={(e) => setGuardReqQty(toNumber(e.target.value, 500))}
                        className="mt-1 h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase text-slate">Earned Qty Baseline</label>
                      <input
                        type="number"
                        value={guardEarnedQty}
                        onChange={(e) => setGuardEarnedQty(toNumber(e.target.value, 280))}
                        className="mt-1 h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-white"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRunGuardAudit()}
                    className="bg-signal text-ink text-xs font-semibold px-4 py-2 hover:bg-signal-hover transition-colors"
                  >
                    Audit Site Request
                  </button>

                  {guardAuditResult && (
                    <div className={`border p-4 ${guardAuditResult.is_flagged ? "border-red-500/40 bg-red-950/20" : "border-emerald-500/40 bg-emerald-950/20"}`}>
                      <p className="font-mono text-xs font-bold text-white">Status: {guardAuditResult.status} | Risk Level: {guardAuditResult.risk_level}</p>
                      <p className="mt-1 text-xs text-paper">{guardAuditResult.anomaly_reason}</p>
                      <p className="mt-2 font-mono text-[10px] uppercase text-signal">Action: {guardAuditResult.recommended_action}</p>
                    </div>
                  )}
                </div>
              </Panel>

              {guardAuditsLog.length > 0 && (
                <Panel title="Recent Commercial Guard Audit History" icon={History}>
                  <div className="space-y-2">
                    {guardAuditsLog.slice(0, 5).map((log) => (
                      <div key={log.id} className="border border-ink-mid bg-ink p-3 text-xs flex justify-between items-center">
                        <div>
                          <p className="font-semibold text-white">{log.item_description}</p>
                          <p className="text-slate">{log.requester_name} | Variance: {log.variance_pct}%</p>
                        </div>
                        <span className={`font-mono px-2 py-0.5 text-[10px] uppercase border ${log.status === "FLAGGED" ? "border-red-500/40 text-red-300" : "border-emerald-500/40 text-emerald-300"}`}>
                          {log.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
            </div>
          )}

          {/* TAB 6: DOCUMENT WATCHER */}
          {activeTab === "watcher" && (
            <div className="space-y-6">
              <Panel title="Document Change & Scope Delta Watcher" icon={FileText}>
                <div className="space-y-4">
                  <p className="text-sm text-slate">
                    Analyzes commercial margin impact whenever drawings or BOQs are revised, and determines required MD/QS approval levels.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-ink-mid bg-ink p-4">
                    <div>
                      <label className="font-mono text-[10px] uppercase text-slate">Document Name</label>
                      <input
                        type="text"
                        value={docName}
                        onChange={(e) => setDocName(e.target.value)}
                        className="mt-1 h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase text-slate">Revision</label>
                      <input
                        type="text"
                        value={docRev}
                        onChange={(e) => setDocRev(e.target.value)}
                        className="mt-1 h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase text-slate">Original Direct Cost (USD)</label>
                      <input
                        type="number"
                        value={docOrigCost}
                        onChange={(e) => setDocOrigCost(toNumber(e.target.value, 100000))}
                        className="mt-1 h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] uppercase text-slate">Revised Direct Cost (USD)</label>
                      <input
                        type="number"
                        value={docRevisedCost}
                        onChange={(e) => setDocRevisedCost(toNumber(e.target.value, 118400))}
                        className="mt-1 h-9 w-full border border-ink-mid bg-ink-light px-2 text-xs text-white"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRunDocWatch()}
                    className="bg-signal text-ink text-xs font-semibold px-4 py-2 hover:bg-signal-hover transition-colors"
                  >
                    Analyze Revision Impact
                  </button>

                  {docWatchResult && (
                    <div className="border border-amber-500/40 bg-amber-950/20 p-4">
                      <p className="font-mono text-xs font-bold text-white">Cost Delta: {money(docWatchResult.cost_delta)} | Required Governance: {docWatchResult.approval_level_required}</p>
                      <p className="mt-1 text-xs text-paper">{docWatchResult.governance_note}</p>
                    </div>
                  )}
                </div>
              </Panel>

              {docChangesLog.length > 0 && (
                <Panel title="Recent Document Change Logs" icon={History}>
                  <div className="space-y-2">
                    {docChangesLog.slice(0, 5).map((log) => (
                      <div key={log.id} className="border border-ink-mid bg-ink p-3 text-xs flex justify-between items-center">
                        <div>
                          <p className="font-semibold text-white">{log.document_name} ({log.revision})</p>
                          <p className="text-slate">Delta: {money(toNumber(log.margin_impact_amount))}</p>
                        </div>
                        <span className="font-mono text-[10px] text-signal uppercase">{log.approval_level_required}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24 border border-white/10 bg-black/10 p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest opacity-70">{label}</p>
      <p className="mt-1 font-display text-lg font-bold text-white">{value}</p>
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="border border-ink-mid bg-ink-light p-5">
      <Icon className="h-6 w-6 text-signal" />
      <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-slate">{label}</p>
      <p className="mt-1 font-display text-lg font-bold text-white">{value}</p>
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="border border-ink-mid bg-ink-light p-5">
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-white">
        <Icon className="h-5 w-5 text-signal" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function FlagRow({ flag }: { flag: Flag }) {
  return (
    <div className={`border p-4 ${severityClass(flag.severity)}`}>
      <div className="flex items-center justify-between gap-4">
        <p className="font-semibold text-white">{flag.title}</p>
        <span className="font-mono text-[10px] uppercase tracking-widest">{flag.severity}</span>
      </div>
      <p className="mt-2 text-sm opacity-90">{flag.detail}</p>
      <p className="mt-3 border-t border-current/20 pt-3 font-mono text-[10px] uppercase tracking-wider">{flag.action}</p>
    </div>
  );
}



