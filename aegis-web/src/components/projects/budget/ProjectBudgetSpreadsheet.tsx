"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Save,
  Download,
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Layers,
  DollarSign,
  TrendingUp,
  Percent,
  Search,
  RefreshCw,
  Sparkles,
  Link2,
  Plus,
  Trash2,
  Table,
  Check,
  ChevronRight,
  ShieldAlert,
  X,
  ExternalLink,
} from "lucide-react";
import {
  getProjectBudgetCategorySummary,
  importProjectBudgetFromQuotation,
  setProjectBudget,
  getFinanceBudgets,
  getEligibleQuotationsForProject,
  linkProjectToQuotation,
  type ProjectBudgetUploadLine,
  type EligibleQuotationSummary,
} from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export type BulkCategoryItem = {
  category: string;
  label: string;
  default_code: string;
  estimated_cost: number;
  budget: number;
  committed: number;
  actual: number;
  headroom: number;
  burn_pct: number;
};

export type LineItemRow = {
  id: string;
  cost_code: string;
  description: string;
  cost_category: "labour" | "equipment" | "materials" | "subcontract" | "overhead" | "other";
  quantity: number;
  unit: string;
  unit_rate: number;
  amount: number;
};

const CATEGORY_THEMES: Record<string, { border: string; bg: string; text: string; badge: string }> = {
  materials: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-950/20",
    text: "text-emerald-400",
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  },
  labour: {
    border: "border-cyan-500/30",
    bg: "bg-cyan-950/20",
    text: "text-cyan-400",
    badge: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  },
  equipment: {
    border: "border-amber-500/30",
    bg: "bg-amber-950/20",
    text: "text-amber-400",
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  subcontract: {
    border: "border-purple-500/30",
    bg: "bg-purple-950/20",
    text: "text-purple-400",
    badge: "border-purple-500/40 bg-purple-500/10 text-purple-300",
  },
  overhead: {
    border: "border-rose-500/30",
    bg: "bg-rose-950/20",
    text: "text-rose-400",
    badge: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  },
  contingency: {
    border: "border-orange-500/30",
    bg: "bg-orange-950/20",
    text: "text-orange-400",
    badge: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  },
  other: {
    border: "border-slate-500/30",
    bg: "bg-slate-950/20",
    text: "text-slate-400",
    badge: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  },
};

export function ProjectBudgetSpreadsheet({
  projectId,
  contractValue = 0,
  onBudgetSaved,
}: {
  projectId: string;
  contractValue?: number;
  onBudgetSaved?: (newTotal: number) => void;
}) {
  const [categories, setCategories] = useState<BulkCategoryItem[]>([]);
  const [totals, setTotals] = useState({
    budget: 0,
    committed: 0,
    actual: 0,
    headroom: 0,
    burn_pct: 0,
  });
  const [linkedQuotation, setLinkedQuotation] = useState<any | null>(null);

  // Editable budget amounts keyed by category
  const [draftBudgets, setDraftBudgets] = useState<Record<string, number>>({});

  // View Mode: bulk categories (default) vs granular line items
  const [viewMode, setViewMode] = useState<"bulk" | "line_items">("bulk");

  // Line items state for granular mode
  const [lineItems, setLineItems] = useState<LineItemRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importingQuote, setImportingQuote] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [pasteBuffer, setPasteBuffer] = useState("");

  // Quotation selector modal state
  const [isQuoteSelectorOpen, setIsQuoteSelectorOpen] = useState(false);
  const [loadingEligibleQuotes, setLoadingEligibleQuotes] = useState(false);
  const [matchedQuotes, setMatchedQuotes] = useState<EligibleQuotationSummary[]>([]);
  const [allEligibleQuotes, setAllEligibleQuotes] = useState<EligibleQuotationSummary[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [quoteSearchTerm, setQuoteSearchTerm] = useState("");
  const [quoteTab, setQuoteTab] = useState<"matched" | "all">("matched");
  const [linkingOnly, setLinkingOnly] = useState(false);

  // Load category summary and linked quote
  const loadCategoryData = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await getProjectBudgetCategorySummary(projectId);
      if (res.success && res.data) {
        const cats = res.data.categories || [];
        setCategories(cats);
        setTotals(res.data.totals || { budget: 0, committed: 0, actual: 0, headroom: 0, burn_pct: 0 });
        setLinkedQuotation(res.data.linked_quotation || null);

        // Initialize draft budgets from server budget or estimates
        const drafts: Record<string, number> = {};
        cats.forEach((c) => {
          drafts[c.category] = c.budget > 0 ? c.budget : (c.estimated_cost > 0 ? c.estimated_cost : 0);
        });
        setDraftBudgets(drafts);
      }
    } catch (err: any) {
      console.warn("Could not load category summary, using fallback baseline", err);
      // Fallback sensible categories
      const fallbackCats: BulkCategoryItem[] = [
        { category: "materials", label: "Materials & Aggregates", default_code: "200-MATERIALS", estimated_cost: 0, budget: 0, committed: 0, actual: 0, headroom: 0, burn_pct: 0 },
        { category: "labour", label: "Direct Labour & Supervision", default_code: "100-LABOUR", estimated_cost: 0, budget: 0, committed: 0, actual: 0, headroom: 0, burn_pct: 0 },
        { category: "equipment", label: "Plant & Heavy Machinery", default_code: "300-EQUIP", estimated_cost: 0, budget: 0, committed: 0, actual: 0, headroom: 0, burn_pct: 0 },
        { category: "subcontract", label: "Specialist Subcontracts", default_code: "400-SUBCONT", estimated_cost: 0, budget: 0, committed: 0, actual: 0, headroom: 0, burn_pct: 0 },
        { category: "overhead", label: "Preliminaries & Site Overheads", default_code: "500-OVERHEAD", estimated_cost: 0, budget: 0, committed: 0, actual: 0, headroom: 0, burn_pct: 0 },
        { category: "contingency", label: "Contingency & Risk Reserve", default_code: "600-CONTINGENCY", estimated_cost: 0, budget: 0, committed: 0, actual: 0, headroom: 0, burn_pct: 0 },
      ];
      setCategories(fallbackCats);
      const drafts: Record<string, number> = {};
      fallbackCats.forEach((c) => { drafts[c.category] = 0; });
      setDraftBudgets(drafts);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadCategoryData();
  }, [loadCategoryData]);

  // Compute live totals from draft input
  const liveBudgetTotal = useMemo(() => {
    return Object.values(draftBudgets).reduce((acc, v) => acc + (Number(v) || 0), 0);
  }, [draftBudgets]);

  const liveGrossMargin = useMemo(() => {
    return Math.max(0, contractValue - liveBudgetTotal);
  }, [contractValue, liveBudgetTotal]);

  const liveMarginPct = useMemo(() => {
    if (contractValue <= 0) return 0;
    return Math.round((liveGrossMargin / contractValue) * 100);
  }, [contractValue, liveGrossMargin]);

  // Update a single bulk category amount
  const handleCategoryBudgetChange = (catKey: string, value: string) => {
    const num = Math.max(0, parseFloat(value) || 0);
    setDraftBudgets((prev) => ({ ...prev, [catKey]: num }));
  };

  // Open quotation selector and fetch candidate quotations
  const handleOpenQuoteSelector = async () => {
    setIsQuoteSelectorOpen(true);
    setLoadingEligibleQuotes(true);
    try {
      const res = await getEligibleQuotationsForProject(projectId);
      if (res.success && res.data) {
        const matched = res.data.matched_quotations || [];
        const allEligible = res.data.all_eligible_quotations || [];
        setMatchedQuotes(matched);
        setAllEligibleQuotes(allEligible);

        // Preselect linked quote or first matched quote
        if (linkedQuotation?.id) {
          setSelectedQuoteId(linkedQuotation.id);
        } else if (matched.length > 0) {
          setSelectedQuoteId(matched[0].id);
        } else if (allEligible.length > 0) {
          setSelectedQuoteId(allEligible[0].id);
        }
      }
    } catch (err: any) {
      console.error("Failed to load eligible quotations:", err);
      setFeedback({
        type: "error",
        message: err?.message || "Failed to load eligible quotations.",
      });
    } finally {
      setLoadingEligibleQuotes(false);
    }
  };

  // Explicitly link quotation without importing/overwriting budgets
  const handleLinkOnly = async () => {
    if (!selectedQuoteId) return;
    setLinkingOnly(true);
    try {
      const res = await linkProjectToQuotation(projectId, selectedQuoteId);
      if (res.success) {
        setFeedback({
          type: "success",
          message: res.message || "Project linked to quotation successfully.",
        });
        setIsQuoteSelectorOpen(false);
        await loadCategoryData();
      } else {
        setFeedback({
          type: "error",
          message: res.error?.message || "Failed to link quotation.",
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Network error linking quotation.",
      });
    } finally {
      setLinkingOnly(false);
    }
  };

  // 1-Click Import from Quotations & Estimations (or with explicit quotation ID)
  const handleImportQuotation = async (quotationId?: string) => {
    setImportingQuote(true);
    setFeedback(null);
    try {
      const res = await importProjectBudgetFromQuotation(projectId, quotationId);
      if (res.success) {
        setFeedback({
          type: "success",
          message: res.message || "Execution budget successfully imported from Quotations & Estimations.",
        });
        await loadCategoryData();
        if (onBudgetSaved && res.data?.total_amount) {
          onBudgetSaved(res.data.total_amount);
        }
      } else {
        setFeedback({
          type: "error",
          message: res.error?.message || "Failed to import quotation budget.",
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Error importing quotation budget.",
      });
    } finally {
      setImportingQuote(false);
    }
  };

  // Link quotation and import budget baseline
  const handleLinkAndImport = async (quoteId?: string) => {
    const targetQuoteId = quoteId || selectedQuoteId;
    if (!targetQuoteId) return;
    setIsQuoteSelectorOpen(false);
    await handleImportQuotation(targetQuoteId);
  };

  // Filtered quotes based on tab and search
  const activeQuoteList = quoteTab === "matched" ? matchedQuotes : allEligibleQuotes;
  const filteredQuotes = useMemo(() => {
    if (!quoteSearchTerm.trim()) return activeQuoteList;
    const term = quoteSearchTerm.toLowerCase();
    return activeQuoteList.filter(
      (q) =>
        q.client_name?.toLowerCase().includes(term) ||
        q.reference_number?.toLowerCase().includes(term) ||
        q.project_title?.toLowerCase().includes(term) ||
        q.id?.toLowerCase().includes(term)
    );
  }, [activeQuoteList, quoteSearchTerm]);

  // Selected quotation preview object
  const selectedQuoteObject = useMemo(() => {
    if (!selectedQuoteId) return null;
    return (
      matchedQuotes.find((q) => q.id === selectedQuoteId) ||
      allEligibleQuotes.find((q) => q.id === selectedQuoteId) ||
      null
    );
  }, [selectedQuoteId, matchedQuotes, allEligibleQuotes]);

  // Save current bulk category baseline
  const handleSaveBulkBudget = async () => {
    if (liveBudgetTotal <= 0) {
      setFeedback({ type: "error", message: "Please specify target amounts for at least one category before saving." });
      return;
    }

    setSaving(true);
    setFeedback(null);

    // Build upload lines for each category
    const lines: ProjectBudgetUploadLine[] = categories.map((cat, idx) => {
      const amount = draftBudgets[cat.category] ?? 0;
      return {
        cost_code: cat.default_code,
        cost_category: (cat.category === "contingency" ? "other" : cat.category) as any,
        description: `${cat.label} (Approved Execution Baseline)`,
        quantity: 1,
        unit: "sum",
        unit_rate: amount,
        amount: amount,
        source_line: idx + 1,
      };
    });

    try {
      const res = await setProjectBudget(projectId, liveBudgetTotal, "Approved bulk category budget baseline", {
        budgetStage: "master",
        lines,
      });

      if (res.success) {
        setFeedback({
          type: "success",
          message: `Saved master budget baseline of ${formatCurrency(liveBudgetTotal)}.`,
        });
        await loadCategoryData();
        if (onBudgetSaved) {
          onBudgetSaved(liveBudgetTotal);
        }
      } else {
        setFeedback({
          type: "error",
          message: res.error?.message || "Failed to save project budget.",
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Network error while saving budget.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Load granular line items if user toggles to detail mode
  const handleToggleViewMode = async () => {
    if (viewMode === "bulk") {
      setViewMode("line_items");
      if (lineItems.length === 0) {
        try {
          const res = await getFinanceBudgets({ project_id: projectId });
          const budgets = res.data || [];
          const current = budgets.find((b: any) => b.status === "approved" || b.status === "active") || budgets[0];
          if (current && Array.isArray(current.lines) && current.lines.length > 0) {
            setLineItems(
              current.lines.map((l: any, idx: number) => ({
                id: l.id || `line-${idx}`,
                cost_code: l.cost_code || `CC-${100 + idx}`,
                description: l.description || "Budget item",
                cost_category: (l.cost_category || "materials") as any,
                quantity: Number(l.quantity) || 1,
                unit: l.unit || "sum",
                unit_rate: Number(l.unit_rate) || Number(l.amount) || 0,
                amount: Number(l.amount) || 0,
              }))
            );
          } else {
            // Seed lines from current category drafts
            setLineItems(
              categories.map((c, idx) => ({
                id: `line-${idx}`,
                cost_code: c.default_code,
                description: `${c.label} Allowance`,
                cost_category: (c.category === "contingency" ? "other" : c.category) as any,
                quantity: 1,
                unit: "sum",
                unit_rate: draftBudgets[c.category] || 0,
                amount: draftBudgets[c.category] || 0,
              }))
            );
          }
        } catch {
          // fallback
        }
      }
    } else {
      setViewMode("bulk");
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`flex items-center justify-between border p-3.5 text-xs font-mono transition-all ${
            feedback.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300"
              : "border-red-500/40 bg-red-950/30 text-red-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-light hover:text-paper uppercase tracking-wider"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top Commercial Header Metrics: Full-Width Strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="border border-ink-mid bg-ink/70 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Agreed Contract Revenue</p>
          <p className="mt-1 font-mono text-xl font-bold text-paper sm:text-2xl">
            {formatCurrency(contractValue)}
          </p>
          <span className="text-[11px] text-slate-light">Agreed project commercial ceiling</span>
        </div>

        <div className="border border-signal/40 bg-signal/5 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-signal">Target Cost Budget</p>
          <p className="mt-1 font-mono text-xl font-bold text-signal sm:text-2xl">
            {formatCurrency(liveBudgetTotal)}
          </p>
          <span className="text-[11px] text-slate-light">Sum of execution cost categories</span>
        </div>

        <div className="border border-amber-500/30 bg-ink/70 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-amber-400">Committed Exposure</p>
          <p className="mt-1 font-mono text-xl font-bold text-amber-300 sm:text-2xl">
            {formatCurrency(totals.committed)}
          </p>
          <span className="text-[11px] text-slate-light">Active POs &amp; subcontracts</span>
        </div>

        <div className="border border-cyan-500/30 bg-ink/70 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-cyan-400">Actual Execution Cost</p>
          <p className="mt-1 font-mono text-xl font-bold text-cyan-300 sm:text-2xl">
            {formatCurrency(totals.actual)}
          </p>
          <span className="text-[11px] text-slate-light">Incurred spend &amp; site hours</span>
        </div>

        <div className={`border p-4 ${
          totals.headroom >= 0 ? "border-emerald-500/40 bg-emerald-950/20" : "border-rose-500/40 bg-rose-950/20"
        }`}>
          <p className={`font-mono text-[10px] uppercase tracking-wider ${
            totals.headroom >= 0 ? "text-emerald-400" : "text-rose-400"
          }`}>
            Available Headroom
          </p>
          <p className={`mt-1 font-mono text-xl font-bold sm:text-2xl ${
            totals.headroom >= 0 ? "text-emerald-300" : "text-rose-300"
          }`}>
            {formatCurrency(liveBudgetTotal - totals.actual - totals.committed)}
          </p>
          <span className="text-[11px] text-slate-light">
            Budget − Actual − Committed
          </span>
        </div>
      </section>

      {/* Linked Quotations & Estimations Bridge Bar */}
      <section className="border border-ink-mid bg-gradient-to-r from-ink-light/40 to-ink p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 border border-signal/50 bg-signal/10 flex items-center justify-center text-signal">
            <Link2 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-paper">
                Quotations &amp; Estimations Source
              </span>
              {linkedQuotation ? (
                <span className="border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase text-emerald-300">
                  {linkedQuotation.status || "Linked"}
                </span>
              ) : (
                <span className="border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase text-amber-300">
                  No Quotation Linked
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-light">
              {linkedQuotation ? (
                <span>
                  Linked Quote: <strong className="text-paper font-normal">{linkedQuotation.reference_number || linkedQuotation.id?.slice(0, 8)}</strong> ({linkedQuotation.client_name}) • Quoted Value:{" "}
                  <strong className="text-paper font-mono font-normal">{formatCurrency(linkedQuotation.quote_amount)}</strong>
                </span>
              ) : (
                "Link this project to an approved quotation to seed BOQ cost-category totals and line items automatically."
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadCategoryData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink px-3 py-1.5 font-mono text-xs text-slate-light hover:text-paper transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin text-signal" : ""}`} />
            <span>Refresh</span>
          </button>
          {linkedQuotation ? (
            <>
              <button
                onClick={() => void handleOpenQuoteSelector()}
                disabled={importingQuote}
                className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink px-3 py-1.5 font-mono text-xs text-slate-light hover:text-paper transition-colors"
              >
                <Link2 className="h-3 w-3 text-signal" />
                <span>Change Quote</span>
              </button>
              <button
                onClick={() => void handleImportQuotation(linkedQuotation?.id)}
                disabled={importingQuote}
                className="inline-flex items-center gap-2 border border-signal/60 bg-signal/15 px-3.5 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-signal hover:bg-signal hover:text-ink transition-colors disabled:opacity-50"
              >
                <Sparkles className={`h-3.5 w-3.5 ${importingQuote ? "animate-spin" : ""}`} />
                <span>{importingQuote ? "Syncing..." : "Sync from Quotation"}</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => void handleOpenQuoteSelector()}
              disabled={importingQuote}
              className="inline-flex items-center gap-2 border border-signal bg-signal/20 px-3.5 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-signal hover:bg-signal hover:text-ink transition-colors disabled:opacity-50 shadow-sm"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span>Choose &amp; Link Quotation</span>
            </button>
          )}
        </div>
      </section>

      {/* Main Budget Workspace Surface: 100% Full Width */}
      <section className="border border-ink-mid bg-ink">
        {/* Table Controls & Mode Switcher */}
        <div className="border-b border-ink-mid p-3.5 sm:px-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("bulk")}
              className={`inline-flex items-center gap-2 px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all ${
                viewMode === "bulk"
                  ? "border border-signal bg-signal/15 text-signal font-semibold"
                  : "border border-ink-mid bg-ink-light/30 text-slate-light hover:text-paper"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Bulk BOQ Cost Categories</span>
            </button>
            <button
              onClick={handleToggleViewMode}
              className={`inline-flex items-center gap-2 px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all ${
                viewMode === "line_items"
                  ? "border border-signal bg-signal/15 text-signal font-semibold"
                  : "border border-ink-mid bg-ink-light/30 text-slate-light hover:text-paper"
              }`}
            >
              <Table className="h-3.5 w-3.5" />
              <span>Granular Line-Item WBS</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveBulkBudget}
              disabled={saving}
              className="inline-flex items-center gap-2 border border-signal bg-signal px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal-light transition-colors disabled:opacity-50 shadow-md"
            >
              <Save className={`h-3.5 w-3.5 ${saving ? "animate-spin" : ""}`} />
              <span>{saving ? "Saving..." : "Save Budget Baseline"}</span>
            </button>
          </div>
        </div>

        {/* PRIMARY VIEW: BULK BOQ COST CATEGORY MATRIX */}
        {viewMode === "bulk" ? (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
                  <th className="py-3 px-4 sm:px-6">BOQ Cost Category</th>
                  <th className="py-3 px-4 text-right">Quotation Estimate</th>
                  <th className="py-3 px-4 text-right">Approved Budget Target</th>
                  <th className="py-3 px-4 text-right">Committed Cost</th>
                  <th className="py-3 px-4 text-right">Actual Incurred</th>
                  <th className="py-3 px-4 text-right">Remaining Headroom</th>
                  <th className="py-3 px-4 text-center">Execution Burn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/40 font-mono">
                {categories.map((cat) => {
                  const theme = CATEGORY_THEMES[cat.category] || CATEGORY_THEMES.other;
                  const currentBudget = draftBudgets[cat.category] ?? cat.budget;
                  const headroom = currentBudget - cat.actual - cat.committed;
                  const burnPct = currentBudget > 0 ? Math.round(((cat.actual + cat.committed) / currentBudget) * 100) : 0;
                  const isOverspent = headroom < 0;

                  return (
                    <tr key={cat.category} className="hover:bg-ink-light/20 transition-colors">
                      {/* Category Title & Cost Code */}
                      <td className="py-3 px-4 sm:px-6">
                        <div className="flex items-center gap-2.5">
                          <span className={`inline-block w-2.5 h-2.5 rounded-full ${theme.bg} border ${theme.border}`} />
                          <div>
                            <span className="font-semibold text-paper block text-sm font-sans">
                              {cat.label}
                            </span>
                            <span className="text-[10px] text-slate-light font-mono">
                              Code: {cat.default_code}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Quotation Estimate */}
                      <td className="py-3 px-4 text-right text-slate-light">
                        {cat.estimated_cost > 0 ? (
                          <span>{formatCurrency(cat.estimated_cost)}</span>
                        ) : (
                          <span className="text-slate">Unspecified</span>
                        )}
                      </td>

                      {/* Approved Budget Target (Directly Editable in Bulk) */}
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end">
                          <span className="text-slate mr-1">$</span>
                          <input
                            type="number"
                            min="0"
                            step="100"
                            value={draftBudgets[cat.category] ?? ""}
                            onChange={(e) => handleCategoryBudgetChange(cat.category, e.target.value)}
                            className="w-32 bg-ink-light/80 border border-ink-mid px-2.5 py-1 text-right font-mono text-xs text-paper focus:border-signal focus:outline-none"
                            placeholder="0"
                          />
                        </div>
                      </td>

                      {/* Committed Cost (Side-by-Side!) */}
                      <td className="py-3 px-4 text-right">
                        <span className="text-amber-300 font-medium">
                          {formatCurrency(cat.committed)}
                        </span>
                      </td>

                      {/* Actual Execution Cost (Side-by-Side!) */}
                      <td className="py-3 px-4 text-right">
                        <span className="text-cyan-300 font-medium">
                          {formatCurrency(cat.actual)}
                        </span>
                      </td>

                      {/* Remaining Headroom */}
                      <td className="py-3 px-4 text-right">
                        <span
                          className={`font-semibold ${
                            isOverspent ? "text-rose-400 font-bold" : "text-emerald-400"
                          }`}
                        >
                          {formatCurrency(headroom)}
                        </span>
                      </td>

                      {/* Execution Burn & Status */}
                      <td className="py-3 px-4 text-center">
                        <div className="inline-flex items-center gap-2 min-w-[120px]">
                          <div className="flex-1 h-1.5 bg-ink-light rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                burnPct > 100
                                  ? "bg-rose-500"
                                  : burnPct > 80
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(100, burnPct)}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-slate-light w-10 text-right">
                            {burnPct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Bulk Summary Footer Row */}
                <tr className="border-t-2 border-ink-mid bg-ink-light/40 font-bold">
                  <td className="py-4 px-4 sm:px-6 text-paper uppercase tracking-wider text-xs">
                    Total Project Execution Budget
                  </td>
                  <td className="py-4 px-4 text-right text-slate-light font-mono">
                    {formatCurrency(categories.reduce((acc, c) => acc + c.estimated_cost, 0))}
                  </td>
                  <td className="py-4 px-4 text-right text-signal font-mono text-sm">
                    {formatCurrency(liveBudgetTotal)}
                  </td>
                  <td className="py-4 px-4 text-right text-amber-300 font-mono">
                    {formatCurrency(totals.committed)}
                  </td>
                  <td className="py-4 px-4 text-right text-cyan-300 font-mono">
                    {formatCurrency(totals.actual)}
                  </td>
                  <td className="py-4 px-4 text-right font-mono">
                    <span className={liveBudgetTotal - totals.actual - totals.committed >= 0 ? "text-emerald-400 text-sm" : "text-rose-400 text-sm"}>
                      {formatCurrency(liveBudgetTotal - totals.actual - totals.committed)}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-center font-mono text-paper">
                    {liveBudgetTotal > 0 ? Math.round(((totals.actual + totals.committed) / liveBudgetTotal) * 100) : 0}% Burn
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          /* OPTIONAL SECONDARY VIEW: GRANULAR LINE-ITEM WBS */
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-light">
                Granular work breakdown structure (WBS). Useful for detailed BOQ imports, rate analysis, and supplier procurement breakdowns.
              </p>
              <button
                onClick={() => {
                  setLineItems((prev) => [
                    ...prev,
                    {
                      id: `line-${Date.now()}`,
                      cost_code: `CC-${100 + prev.length}`,
                      description: "New Cost Item",
                      cost_category: "materials",
                      quantity: 1,
                      unit: "sum",
                      unit_rate: 0,
                      amount: 0,
                    },
                  ]);
                }}
                className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink-light px-2.5 py-1 text-xs font-mono text-slate-light hover:text-paper"
              >
                <Plus className="h-3 w-3" />
                <span>Add Line</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Cost Code</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Item Description</th>
                    <th className="py-2.5 px-3 text-right">Quantity</th>
                    <th className="py-2.5 px-3 text-center">Unit</th>
                    <th className="py-2.5 px-3 text-right">Unit Rate ($)</th>
                    <th className="py-2.5 px-3 text-right">Total ($)</th>
                    <th className="py-2.5 px-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/40 font-mono">
                  {lineItems.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-ink-light/20">
                      <td className="py-2 px-3 text-slate">{idx + 1}</td>
                      <td className="py-2 px-3">
                        <input
                          value={item.cost_code}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLineItems((prev) => prev.map((l) => (l.id === item.id ? { ...l, cost_code: val } : l)));
                          }}
                          className="w-24 bg-ink border border-ink-mid px-2 py-0.5 text-xs text-paper"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={item.cost_category}
                          onChange={(e) => {
                            const val = e.target.value as any;
                            setLineItems((prev) => prev.map((l) => (l.id === item.id ? { ...l, cost_category: val } : l)));
                          }}
                          className="bg-ink border border-ink-mid px-2 py-0.5 text-xs text-paper"
                        >
                          <option value="materials">Materials</option>
                          <option value="labour">Labour</option>
                          <option value="equipment">Equipment</option>
                          <option value="subcontract">Subcontract</option>
                          <option value="overhead">Overhead</option>
                          <option value="other">Other</option>
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        <input
                          value={item.description}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLineItems((prev) => prev.map((l) => (l.id === item.id ? { ...l, description: val } : l)));
                          }}
                          className="w-full bg-ink border border-ink-mid px-2 py-0.5 text-xs text-paper"
                        />
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => {
                            const q = parseFloat(e.target.value) || 0;
                            setLineItems((prev) =>
                              prev.map((l) => (l.id === item.id ? { ...l, quantity: q, amount: Math.round(q * l.unit_rate * 100) / 100 } : l))
                            );
                          }}
                          className="w-16 bg-ink border border-ink-mid px-2 py-0.5 text-right text-xs text-paper"
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <input
                          value={item.unit}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLineItems((prev) => prev.map((l) => (l.id === item.id ? { ...l, unit: val } : l)));
                          }}
                          className="w-14 bg-ink border border-ink-mid px-1 py-0.5 text-center text-xs text-paper uppercase"
                        />
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          value={item.unit_rate}
                          onChange={(e) => {
                            const r = parseFloat(e.target.value) || 0;
                            setLineItems((prev) =>
                              prev.map((l) => (l.id === item.id ? { ...l, unit_rate: r, amount: Math.round(l.quantity * r * 100) / 100 } : l))
                            );
                          }}
                          className="w-24 bg-ink border border-ink-mid px-2 py-0.5 text-right text-xs text-paper"
                        />
                      </td>
                      <td className="py-2 px-3 text-right text-signal font-semibold">
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => setLineItems((prev) => prev.filter((l) => l.id !== item.id))}
                          className="text-slate hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* QUOTATION SELECTOR & SEEDING MODAL */}
      {isQuoteSelectorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-4xl max-h-[88vh] flex flex-col border border-ink-mid bg-ink shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="border-b border-ink-mid p-4 sm:px-6 flex items-center justify-between bg-ink-light/30">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 border border-signal/50 bg-signal/10 flex items-center justify-center text-signal">
                  <Link2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-paper">
                    Select Approved Quotation for Execution Budget
                  </h3>
                  <p className="text-xs text-slate-light">
                    Link an approved BOQ or tender estimation to populate real category cost baselines and WBS line items.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsQuoteSelectorOpen(false)}
                className="text-slate hover:text-paper p-1"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Filter and Search Bar */}
            <div className="border-b border-ink-mid p-3 sm:px-6 flex flex-wrap items-center justify-between gap-3 bg-ink">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQuoteTab("matched")}
                  className={`px-3 py-1 font-mono text-xs uppercase tracking-wider transition-colors ${
                    quoteTab === "matched"
                      ? "border border-signal bg-signal/15 text-signal font-semibold"
                      : "border border-ink-mid bg-ink-light/20 text-slate-light hover:text-paper"
                  }`}
                >
                  Suggested Matches ({matchedQuotes.length})
                </button>
                <button
                  onClick={() => setQuoteTab("all")}
                  className={`px-3 py-1 font-mono text-xs uppercase tracking-wider transition-colors ${
                    quoteTab === "all"
                      ? "border border-signal bg-signal/15 text-signal font-semibold"
                      : "border border-ink-mid bg-ink-light/20 text-slate-light hover:text-paper"
                  }`}
                >
                  All Approved Quotations ({allEligibleQuotes.length})
                </button>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate" />
                <input
                  type="text"
                  placeholder="Filter client, reference..."
                  value={quoteSearchTerm}
                  onChange={(e) => setQuoteSearchTerm(e.target.value)}
                  className="w-full bg-ink-light/40 border border-ink-mid pl-8 pr-3 py-1 text-xs text-paper placeholder-slate font-mono focus:border-signal focus:outline-none"
                />
              </div>
            </div>

            {/* Modal Body: Split List & Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 overflow-hidden min-h-[380px] max-h-[500px]">
              {/* Left Column: Quotation Selection List */}
              <div className="lg:col-span-7 border-b lg:border-b-0 lg:border-r border-ink-mid overflow-y-auto p-3 space-y-2">
                {loadingEligibleQuotes ? (
                  <div className="p-8 text-center text-slate-light font-mono text-xs space-y-2">
                    <Loader2 className="h-6 w-6 animate-spin text-signal mx-auto" />
                    <p>Loading eligible approved quotations...</p>
                  </div>
                ) : filteredQuotes.length === 0 ? (
                  <div className="p-8 text-center text-slate font-mono text-xs space-y-2">
                    <p>No quotations found matching the current criteria.</p>
                    {quoteTab === "matched" && (
                      <button
                        onClick={() => setQuoteTab("all")}
                        className="text-signal underline hover:text-signal-light"
                      >
                        Browse all approved quotations in the tenant
                      </button>
                    )}
                  </div>
                ) : (
                  filteredQuotes.map((q) => {
                    const isSelected = selectedQuoteId === q.id;
                    return (
                      <div
                        key={q.id}
                        onClick={() => setSelectedQuoteId(q.id)}
                        className={`p-3 border cursor-pointer transition-all ${
                          isSelected
                            ? "border-signal bg-signal/10"
                            : "border-ink-mid bg-ink hover:border-ink-light"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="selectedQuotation"
                              checked={isSelected}
                              onChange={() => setSelectedQuoteId(q.id)}
                              className="accent-signal cursor-pointer"
                            />
                            <span className="font-mono text-xs font-bold text-paper">
                              {q.reference_number || q.id.slice(0, 8)}
                            </span>
                            <span className="border border-ink-mid bg-ink-light/40 px-1.5 py-0.5 font-mono text-[9px] uppercase text-slate-light">
                              {q.status}
                            </span>
                            {q.has_approved_boq && (
                              <span className="border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-emerald-300">
                                BOQ Approved
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-xs font-bold text-paper">
                            {formatCurrency(q.quote_amount)}
                          </span>
                        </div>

                        <div className="mt-1 pl-5">
                          <p className="text-xs font-medium text-slate-light">
                            Client: <span className="text-paper">{q.client_name}</span>
                            {q.project_title && (
                              <span className="text-slate"> • {q.project_title}</span>
                            )}
                          </p>

                          {/* Match reasons & items */}
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {q.is_directly_linked && (
                              <span className="border border-signal/40 bg-signal/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-signal">
                                Current Linked Quote
                              </span>
                            )}
                            {q.match_reasons?.map((reason, idx) => (
                              <span
                                key={idx}
                                className="border border-ink-mid bg-ink-light/30 px-1.5 py-0.5 font-mono text-[9px] text-slate-light"
                              >
                                {reason}
                              </span>
                            ))}
                            <span className="border border-ink-mid/60 bg-ink-light/20 px-1.5 py-0.5 font-mono text-[9px] text-slate">
                              {q.items_count} items
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Right Column: Cost Breakdown Preview */}
              <div className="lg:col-span-5 bg-ink-light/10 p-4 flex flex-col justify-between overflow-y-auto">
                {selectedQuoteObject ? (
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-slate">
                          Quote Lineage &amp; Client
                        </span>
                        <span className="font-mono text-[10px] text-slate">
                          {selectedQuoteObject.created_at?.slice(0, 10)}
                        </span>
                      </div>
                      <p className="font-mono text-sm font-bold text-paper mt-0.5">
                        {selectedQuoteObject.reference_number || selectedQuoteObject.id.slice(0, 8)}
                      </p>
                      <p className="text-xs text-slate-light">{selectedQuoteObject.client_name}</p>
                    </div>

                    {/* Pricing vs Direct Costs */}
                    <div className="border border-ink-mid bg-ink p-3 space-y-2">
                      <div className="flex justify-between items-center text-xs font-mono">
                        <span className="text-slate">Contract Revenue (Selling):</span>
                        <span className="font-bold text-paper">
                          {formatCurrency(selectedQuoteObject.quote_amount)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs font-mono">
                        <span className="text-signal">Direct Execution Cost:</span>
                        <span className="font-bold text-signal">
                          {formatCurrency(
                            Object.values(selectedQuoteObject.category_estimates || {}).reduce(
                              (a, b) => a + Number(b || 0),
                              0
                            )
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Category Cost Breakdown */}
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-slate mb-2">
                        Reconstructed Execution Cost Breakdown
                      </p>
                      <div className="border border-ink-mid bg-ink divide-y divide-ink-mid/40 font-mono text-xs">
                        {Object.entries(selectedQuoteObject.category_estimates || {}).map(
                          ([catKey, val]) => {
                            const theme = CATEGORY_THEMES[catKey] || CATEGORY_THEMES.other;
                            return (
                              <div
                                key={catKey}
                                className="flex items-center justify-between p-2 px-3 hover:bg-ink-light/10"
                              >
                                <span className="capitalize text-slate-light">{catKey}</span>
                                <span className={`font-semibold ${val > 0 ? "text-paper" : "text-slate"}`}>
                                  {formatCurrency(val)}
                                </span>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>

                    <div className="border border-amber-500/30 bg-amber-950/20 p-2.5 text-[11px] text-amber-300">
                      Execution budgets import direct costs from the quotation buildup. Selling markup and sales tax are excluded from site delivery targets.
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center p-6 text-center font-mono text-xs text-slate">
                    Select a quotation on the left to preview its cost categories and commercial metrics.
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div className="border-t border-ink-mid p-3 sm:px-6 flex flex-wrap items-center justify-between gap-3 bg-ink-light/20">
              <span className="font-mono text-xs text-slate-light">
                {selectedQuoteObject ? (
                  <span>
                    Selected: <strong className="text-paper">{selectedQuoteObject.reference_number || selectedQuoteObject.id.slice(0, 8)}</strong>
                  </span>
                ) : (
                  "No quotation selected"
                )}
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsQuoteSelectorOpen(false)}
                  className="border border-ink-mid bg-ink px-3 py-1.5 font-mono text-xs text-slate-light hover:text-paper"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLinkOnly}
                  disabled={!selectedQuoteId || linkingOnly || importingQuote}
                  className="border border-ink-mid bg-ink px-3.5 py-1.5 font-mono text-xs text-slate-light hover:text-paper hover:border-slate transition-colors disabled:opacity-50"
                >
                  {linkingOnly ? "Linking..." : "Link Only"}
                </button>
                <button
                  onClick={() => handleLinkAndImport(selectedQuoteId || undefined)}
                  disabled={!selectedQuoteId || importingQuote || linkingOnly}
                  className="inline-flex items-center gap-1.5 border border-signal bg-signal px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal-light transition-colors disabled:opacity-50 shadow-md"
                >
                  <Sparkles className={`h-3.5 w-3.5 ${importingQuote ? "animate-spin" : ""}`} />
                  <span>{importingQuote ? "Importing..." : "Link & Import Budget"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
