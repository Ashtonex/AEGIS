"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FileText, Plus, Trash2, CheckCircle,
  AlertCircle, Loader2, RefreshCw, Search, ArrowRight,
  TrendingUp, Calendar, DollarSign, BarChart2, Briefcase, FileDown, Layers, Brain,
  ThumbsUp, ThumbsDown, ShieldCheck, Copy, ArrowUpDown, ChevronLeft, ChevronRight, History, CircleHelp
} from "lucide-react";
import { getQuotations, getInternalProjects, getQuotationsNeedsBoq, decideQuotation, createQuotation, deleteQuotation, describeActionError } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { useModuleTour } from "@/hooks/useModuleTour";
import { ModuleTour, type ModuleTourStep } from "@/components/onboarding/ModuleTour";
import SopChecklistModal from "./SopChecklistModal";
import QuotationHistoryModal from "./QuotationHistoryModal";

const QUOTATIONS_TOUR_STEPS: ModuleTourStep[] = [
  {
    title: "From a rate buildup to a signed contract",
    body: "This module takes a quote from first cost estimate through commercial review to a won deal - and a won quote doesn't just change status, it seeds the real project budget it feeds into Finance. This tour covers the four tools and how a quote's real numbers move downstream.",
    placement: "center",
  },
  {
    title: "Pipeline Value and the KPI strip",
    body: "These totals are computed live from every quotation currently in your ledger below - not a separate manual tracker. Win a quote and Finance's own numbers move with it.",
    target: "quotations-kpis",
    placement: "bottom",
  },
  {
    title: "Builder, Drawing Takeoff, CCB, Intelligence Engine",
    body: "Manual Calculator / Builder is the real rate-buildup tool with live VAT and margin calculations. Drawing Takeoff measures real quantities off an uploaded drawing. Commercial Control Brain checks a site material request against justified earned progress before it gets flagged as excess. Intelligence Engine is the same commercial-guard logic plus rate benchmarking, in one place.",
    target: "quotations-tools",
    placement: "bottom",
  },
  {
    title: "Marking a quote Won is a real trigger, not a label",
    body: "Confirming Won seeds (or replaces) that project's approved execution budget directly from the quote's own cost breakdown - materials, labour, equipment, prelims, overhead, contingency - with protected profit deliberately excluded. If costs are already running ahead of what's justified, a margin-threat alert fires for Executive/Finance Manager automatically.",
    target: "quotations-ledger",
    placement: "right",
  },
  {
    title: "VAT follows the real rate table",
    body: "The VAT applied in the Builder isn't a hardcoded 15% anymore - it's fetched from Finance > Statutory > Rate Tables. Until a real rate is entered there, the Builder falls back to 15.5% with a visible notice, so pricing behaviour never changes silently.",
    placement: "center",
  },
];

export default function QuotationsDashboard() {
  const { session } = useAuth();
  const quotationsTour = useModuleTour("quotations");
  const [quotes, setQuotes] = useState<any[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [needsBoq, setNeedsBoq] = useState<{ tenders: any[]; opportunities: any[]; leads: any[] }>({ tenders: [], opportunities: [], leads: [] });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<"created_at" | "client_name" | "quote_amount" | "status">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [sopModalQuote, setSopModalQuote] = useState<{ id: string; label: string } | null>(null);
  const [historyModalQuote, setHistoryModalQuote] = useState<{ id: string; label: string } | null>(null);
  const PAGE_SIZE = 15;
  const LOAD_LIMIT = 200;

  const handleDecision = async (id: string, status: "won" | "lost") => {
    if (status === "won" && !confirm(
      "Mark this quotation as WON? If it's linked to a project, this will seed/replace that project's execution budget from this quotation's numbers."
    )) {
      return;
    }
    setDecidingId(id);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const res = await decideQuotation(id, status);
      if (res.success) {
        let msg = res.message || `Quotation marked as ${status}.`;
        if (res.data?.margin_alert_raised) {
          msg += " A margin-threat alert was raised for this project's budget.";
        }
        setSuccessMsg(msg);
        await loadData();
      } else {
        setErrorMsg(res.message || "Failed to record decision.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to record decision.");
    } finally {
      setDecidingId(null);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    // Quotations and internal projects are fetched independently on purpose -
    // a failure on the (secondary) projects call must never blank the
    // (primary) quotations ledger. They used to be yoked in one Promise.all,
    // which meant a single missing permission on projects.read made every
    // real quotation disappear from this page.
    const [quotesResult, projectsResult, needsBoqResult] = await Promise.allSettled([
      getQuotations({ limit: LOAD_LIMIT, sort_by: "created_at", sort_dir: "desc" }),
      getInternalProjects(),
      getQuotationsNeedsBoq(),
    ]);

    if (quotesResult.status === "fulfilled" && quotesResult.value.success && Array.isArray(quotesResult.value.data)) {
      setQuotes(quotesResult.value.data);
      setTotalCount(Number((quotesResult.value.meta as any)?.total ?? quotesResult.value.data.length));
    } else {
      setQuotes([]);
      setTotalCount(0);
      const err = quotesResult.status === "rejected" ? quotesResult.reason : undefined;
      setErrorMsg(
        describeActionError(
          err,
          "You don't have permission to view quotations.",
          err?.message || "Failed to load estimates."
        )
      );
    }

    if (projectsResult.status === "fulfilled" && projectsResult.value.success && Array.isArray(projectsResult.value.data)) {
      setProjectsList(projectsResult.value.data);
    } else {
      setProjectsList([]);
      // Non-blocking: the projects list only feeds a secondary widget, so
      // surface it only if the primary quotations load already succeeded
      // (otherwise it would just overwrite a more important error above).
      if (quotesResult.status === "fulfilled" && quotesResult.value.success) {
        setErrorMsg(
          describeActionError(
            projectsResult.status === "rejected" ? projectsResult.reason : undefined,
            "You don't have permission to view linked project data - some figures on this page may be incomplete.",
            "Failed to load linked project data - some figures on this page may be incomplete."
          )
        );
      }
    }

    // Also non-blocking: this queue is a secondary discovery widget, so a
    // failure here should never affect the primary ledger or its errors.
    if (needsBoqResult.status === "fulfilled" && needsBoqResult.value.success && needsBoqResult.value.data) {
      setNeedsBoq(needsBoqResult.value.data);
    } else {
      setNeedsBoq({ tenders: [], opportunities: [], leads: [] });
    }

    setLoading(false);
  }, []);

  const handleDuplicate = async (q: any) => {
    setDuplicatingId(q.id);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const newRef = `SNC-QT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const clonedMetadata = {
        ...(q.metadata || {}),
        reference_number: newRef,
        status: "draft",
        quote_date: new Date().toISOString().split("T")[0],
      };
      const payload: any = {
        client_name: q.client_name,
        quote_amount: q.quote_amount,
        status: "draft",
        metadata: clonedMetadata,
      };
      if (q.project_id) payload.project_id = q.project_id;

      const res = await createQuotation(payload);
      if (res.success) {
        setSuccessMsg(`Duplicated as a new draft: ${newRef}`);
        await loadData();
      } else {
        setErrorMsg(res.message || "Failed to duplicate quotation.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to duplicate quotation.");
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleArchive = async (q: any) => {
    const refNum = q.metadata?.reference_number || q.id.slice(0, 8).toUpperCase();
    if (!confirm(`Archive quotation ${refNum} (${q.client_name})? This removes it from the active ledger.`)) {
      return;
    }
    setArchivingId(q.id);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const res = await deleteQuotation(q.id);
      if (res.success) {
        setSuccessMsg(`${refNum} archived.`);
        await loadData();
      } else {
        setErrorMsg(res.message || "Failed to archive quotation.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to archive quotation.");
    } finally {
      setArchivingId(null);
    }
  };

  const toggleSort = (key: "created_at" | "client_name" | "quote_amount" | "status") => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  };

  useEffect(() => {
    if (session) {
      void loadData();
    }
  }, [session, loadData]);

  // Any create/update/delete on a quotation anywhere in the org - by this
  // user, a teammate, or the CRM handoff flow - refetches this ledger in
  // the background. Safe to call plainly: loadData() only blanks the table
  // on a genuine first load (quotes.length === 0), not on this kind of
  // background refresh.
  useLiveTable("finance.quotations", () => {
    if (session) void loadData();
  });

  useEffect(() => {
    setPage(0);
  }, [searchTerm, statusFilter]);

  // Filter quotes based on search + status
  const filteredQuotes = quotes.filter(q => {
    const term = searchTerm.toLowerCase();
    const client = (q.client_name || "").toLowerCase();
    const title = (q.metadata?.project_title || "").toLowerCase();
    const ref = (q.metadata?.reference_number || q.id || "").toLowerCase();
    const matchesSearch = client.includes(term) || title.includes(term) || ref.includes(term);
    const status = q.metadata?.status || q.status || "draft";
    const matchesStatus = statusFilter === "all" || status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const sortedQuotes = [...filteredQuotes].sort((a, b) => {
    let av: any;
    let bv: any;
    if (sortKey === "client_name") {
      av = (a.client_name || "").toLowerCase();
      bv = (b.client_name || "").toLowerCase();
    } else if (sortKey === "quote_amount") {
      av = Number(a.quote_amount || 0);
      bv = Number(b.quote_amount || 0);
    } else if (sortKey === "status") {
      av = a.metadata?.status || a.status || "draft";
      bv = b.metadata?.status || b.status || "draft";
    } else {
      av = a.created_at || "";
      bv = b.created_at || "";
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const pageCount = Math.max(1, Math.ceil(sortedQuotes.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedQuotes = sortedQuotes.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  // Calculate high-level KPIs
  const pipelineTotal = quotes.reduce((acc, q) => acc + Number(q.quote_amount || 0), 0);
  const avgQuoteAmount = quotes.length > 0 ? pipelineTotal / quotes.length : 0;
  const activeCount = quotes.filter(q => q.metadata?.status !== "aborted").length;
  const averageMargin = quotes.length > 0 
    ? quotes.reduce((acc, q) => acc + Number(q.metadata?.profit_pct || 12), 0) / quotes.length 
    : 12;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 text-paper">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-2" data-tour="quotations-title">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white flex items-center gap-3">
              <Layers className="w-7 h-7 text-signal" />
              Estimating &amp; Quotations Command
            </h1>
            <p className="text-sm text-slate mt-1">
              Build robust cost structures, manage margins, and run commercial controls across all construction projects.
            </p>
          </div>
          <button
            onClick={quotationsTour.openTour}
            className="text-slate hover:text-paper transition-colors"
            title="Replay Quotations tour"
            aria-label="Replay Quotations tour"
          >
            <CircleHelp className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3" data-tour="quotations-tools">
          <button
            onClick={loadData}
            className="p-2 border border-ink-mid rounded-sm bg-ink hover:border-signal/50 text-slate hover:text-white transition-all"
            title="Refresh database records"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-signal' : ''}`} />
          </button>
          <Link
            href="/dashboard/quotations/builder"
            className="flex items-center space-x-2 border border-signal/40 text-signal px-3.5 py-2 text-xs font-semibold rounded-sm hover:bg-signal/10 transition-all"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3px]" />
            <span>Manual Calculator / Builder</span>
          </Link>
          <Link
            href="/dashboard/quotations/drawings"
            className="flex items-center space-x-2 border border-emerald-500/40 text-emerald-400 px-3.5 py-2 text-xs font-semibold rounded-sm hover:bg-emerald-500/10 transition-all"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Drawing Takeoff</span>
          </Link>
          <Link
            href="/dashboard/quotations/ccb"
            className="flex items-center space-x-2 border border-amber-500/40 text-amber-400 px-3.5 py-2 text-xs font-semibold rounded-sm hover:bg-amber-500/10 transition-all"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Commercial Control Brain (CCB)</span>
          </Link>
          <Link
            href="/dashboard/quotations/intelligence"
            className="flex items-center space-x-2 bg-gradient-to-r from-signal via-amber-400 to-amber-500 text-ink px-4 py-2 text-xs font-bold rounded-sm hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
          >
            <Brain className="w-4 h-4 text-ink" />
            <span>Quotation Intelligence Engine</span>
          </Link>
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

      {/* Needs BOQ queue - tenders/opportunities/leads with no estimate started yet */}
      {(needsBoq.tenders.length + needsBoq.opportunities.length + needsBoq.leads.length) > 0 && (
        <div className="border border-signal/20 bg-signal/5 rounded-sm p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-signal" />
            <h2 className="text-sm font-bold text-white">Needs BOQ</h2>
            <span className="text-xs text-slate">
              {needsBoq.tenders.length + needsBoq.opportunities.length + needsBoq.leads.length} awaiting an estimate
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {needsBoq.tenders.map((t) => (
              <Link
                key={`tender-${t.id}`}
                href={`/dashboard/quotations/builder?source_type=tender&source_id=${t.id}`}
                className="shrink-0 w-56 p-3 border border-ink-mid bg-ink rounded-sm hover:border-signal/50 transition-all"
              >
                <span className="text-[10px] font-mono uppercase text-amber-400">Tender</span>
                <p className="text-xs font-semibold text-white truncate mt-1">{t.label}</p>
                <p className="text-[11px] text-slate mt-1">
                  {t.bid_amount ? `$${Number(t.bid_amount).toLocaleString()}` : "TBD - pending BOQ"}
                </p>
              </Link>
            ))}
            {needsBoq.opportunities.map((o) => (
              <Link
                key={`opportunity-${o.id}`}
                href={`/dashboard/quotations/builder?source_type=opportunity&source_id=${o.id}`}
                className="shrink-0 w-56 p-3 border border-ink-mid bg-ink rounded-sm hover:border-signal/50 transition-all"
              >
                <span className="text-[10px] font-mono uppercase text-emerald-400">Opportunity</span>
                <p className="text-xs font-semibold text-white truncate mt-1">{o.label}</p>
                <p className="text-[11px] text-slate mt-1">
                  {o.bid_amount ? `$${Number(o.bid_amount).toLocaleString()}` : "TBD"}
                </p>
              </Link>
            ))}
            {needsBoq.leads.map((l) => (
              <Link
                key={`lead-${l.id}`}
                href={`/dashboard/quotations/builder?source_type=lead&source_id=${l.id}`}
                className="shrink-0 w-56 p-3 border border-ink-mid bg-ink rounded-sm hover:border-signal/50 transition-all"
              >
                <span className="text-[10px] font-mono uppercase text-sky-400">Lead</span>
                <p className="text-xs font-semibold text-white truncate mt-1">{l.label}</p>
                <p className="text-[11px] text-slate mt-1">
                  {l.bid_amount ? `$${Number(l.bid_amount).toLocaleString()}` : "TBD"}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6" data-tour="quotations-kpis">
        <div className="p-5 bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-2 relative group hover:border-signal/20 transition-colors">
          <DollarSign className="w-8 h-8 text-signal absolute right-5 top-5 opacity-40 group-hover:scale-110 transition-transform" />
          <p className="text-xs font-mono tracking-widest text-slate uppercase">Pipeline Value</p>
          <p className="text-xl font-bold font-display text-white">
            ${pipelineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] font-mono text-slate-light">Total generated estimating volume</p>
        </div>

        <div className="p-5 bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-2 relative group hover:border-signal/20 transition-colors">
          <BarChart2 className="w-8 h-8 text-signal right-5 top-5 absolute opacity-40 group-hover:scale-110 transition-transform" />
          <p className="text-xs font-mono tracking-widest text-slate uppercase">Avg proposal size</p>
          <p className="text-xl font-bold font-display text-white">
            ${avgQuoteAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] font-mono text-slate-light">Average cost buildup total</p>
        </div>

        <div className="p-5 bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-2 relative group hover:border-signal/20 transition-colors">
          <Briefcase className="w-8 h-8 text-signal right-5 top-5 absolute opacity-40 group-hover:scale-110 transition-transform" />
          <p className="text-xs font-mono tracking-widest text-slate uppercase">Active Estimates</p>
          <p className="text-xl font-bold font-display text-white">{activeCount}</p>
          <p className="text-[10px] font-mono text-slate-light">Excludes cancelled/archived files</p>
        </div>

        <div className="p-5 bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-2 relative group hover:border-signal/20 transition-colors">
          <TrendingUp className="w-8 h-8 text-signal right-5 top-5 absolute opacity-40 group-hover:scale-110 transition-transform" />
          <p className="text-xs font-mono tracking-widest text-slate uppercase">Avg Target Margin</p>
          <p className="text-xl font-bold font-display text-white">{averageMargin.toFixed(1)}%</p>
          <p className="text-[10px] font-mono text-slate-light">Average net markup target</p>
        </div>
      </div>

      {/* Main content split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Ledger - Left Col */}
        <div className="lg:col-span-2 space-y-6" data-tour="quotations-ledger">
          <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="font-display font-semibold text-lg text-white">Cost Proposals Ledger</h2>
                <p className="text-xs text-slate">Audit trail and status tracking of client cost structures.</p>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by client or project..."
                    className="w-full bg-ink border border-ink-mid rounded-sm pl-9 pr-4 py-1.5 text-xs text-paper placeholder-slate focus:outline-none focus:border-signal/50 focus:ring-1 focus:ring-signal/50 transition-all"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-ink border border-ink-mid rounded-sm px-2 py-1.5 text-xs text-paper focus:outline-none focus:border-signal/50 cursor-pointer"
                  title="Filter by status"
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
              </div>
            </div>
            {totalCount > quotes.length && (
              <p className="text-[10px] font-mono text-amber-400/80">
                Showing the most recent {quotes.length} of {totalCount} total quotations - refine your search to find older records.
              </p>
            )}

            {loading && quotes.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center space-y-3">
                <Loader2 className="w-8 h-8 text-signal animate-spin" />
                <span className="text-xs text-slate tracking-wider font-mono uppercase">Syncing records...</span>
              </div>
            ) : filteredQuotes.length === 0 ? (
              <div className="py-20 border border-dashed border-ink-mid rounded-sm flex flex-col items-center justify-center space-y-4">
                <FileText className="w-12 h-12 text-slate/40" />
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">No Proposals Found</p>
                  <p className="text-xs text-slate mt-1">Start estimating and cost building using the builder.</p>
                </div>
                <Link
                  href="/dashboard/quotations/builder"
                  className="flex items-center space-x-2 bg-ink border border-ink-mid text-paper hover:border-signal/50 text-xs px-4 py-2 font-semibold rounded-sm transition-all"
                >
                  <Plus className="w-4 h-4 text-signal" />
                  <span>Build First Estimate</span>
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono uppercase tracking-wider">
                      <th className="pb-3 font-normal cursor-pointer select-none hover:text-white transition-colors" onClick={() => toggleSort("client_name")}>
                        <span className="inline-flex items-center gap-1">Reference &amp; Client <ArrowUpDown className="w-3 h-3" /></span>
                      </th>
                      <th className="pb-3 font-normal">Project Title</th>
                      <th className="pb-3 font-normal text-right cursor-pointer select-none hover:text-white transition-colors" onClick={() => toggleSort("quote_amount")}>
                        <span className="inline-flex items-center gap-1 justify-end w-full">Estimate Total <ArrowUpDown className="w-3 h-3" /></span>
                      </th>
                      <th className="pb-3 font-normal text-center">Margin</th>
                      <th className="pb-3 font-normal text-center cursor-pointer select-none hover:text-white transition-colors" onClick={() => toggleSort("status")}>
                        <span className="inline-flex items-center gap-1 justify-center w-full">Status <ArrowUpDown className="w-3 h-3" /></span>
                      </th>
                      <th className="pb-3 font-normal text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedQuotes.map((q) => {
                      const refNum = q.metadata?.reference_number || q.id.slice(0, 8).toUpperCase();
                      const status = q.metadata?.status || "draft";
                      const statusColor = 
                        status === "won" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                        status === "lost" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                        "bg-amber-500/10 text-amber-400 border-amber-500/20";
                      
                      return (
                        <tr key={q.id} className="border-b border-ink-mid/30 hover:bg-white/[0.01] transition-colors">
                          <td className="py-4">
                            <p className="font-mono text-white text-xs font-semibold">{refNum}</p>
                            <p className="text-slate mt-0.5">{q.client_name}</p>
                          </td>
                          <td className="py-4 text-slate-light font-medium max-w-[200px] truncate">
                            {q.metadata?.project_title || "Untitled Estimate"}
                          </td>
                          <td className="py-4 text-right font-semibold text-white font-mono">
                            ${Number(q.quote_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-4 text-center font-mono text-slate">
                            {q.metadata?.profit_pct || 12}%
                          </td>
                          <td className="py-4 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-sm border text-[10px] font-mono uppercase tracking-wider ${statusColor}`}>
                              {status}
                            </span>
                          </td>
                          <td className="py-4 text-right">
                            <div className="flex items-center justify-end space-x-2">
                              {status !== "won" && status !== "lost" && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setSopModalQuote({ id: q.id, label: `${refNum} - ${q.client_name}` })}
                                    className="p-1.5 border border-ink-mid bg-ink rounded-sm hover:border-signal/50 text-slate hover:text-signal transition-colors"
                                    title="View/complete required SOP checklists"
                                  >
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDecision(q.id, "won")}
                                    disabled={decidingId === q.id}
                                    className="p-1.5 border border-ink-mid bg-ink rounded-sm hover:border-emerald-500/50 text-slate hover:text-emerald-400 transition-colors disabled:opacity-40"
                                    title="Mark as won - seeds the linked project's execution budget from this quotation"
                                  >
                                    {decidingId === q.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDecision(q.id, "lost")}
                                    disabled={decidingId === q.id}
                                    className="p-1.5 border border-ink-mid bg-ink rounded-sm hover:border-rose-500/50 text-slate hover:text-rose-400 transition-colors disabled:opacity-40"
                                    title="Mark as lost"
                                  >
                                    <ThumbsDown className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              <Link
                                href={`/dashboard/quotations/builder?edit=${q.id}`}
                                className="p-1.5 border border-ink-mid bg-ink rounded-sm hover:border-signal/50 text-slate hover:text-white transition-colors"
                                title="Edit estimate"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </Link>
                              <button
                                type="button"
                                onClick={() => handleDuplicate(q)}
                                disabled={duplicatingId === q.id}
                                className="p-1.5 border border-ink-mid bg-ink rounded-sm hover:border-signal/50 text-slate hover:text-white transition-colors disabled:opacity-40"
                                title="Duplicate as a new draft"
                              >
                                {duplicatingId === q.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => setHistoryModalQuote({ id: q.id, label: `${refNum} - ${q.client_name}` })}
                                className="p-1.5 border border-ink-mid bg-ink rounded-sm hover:border-signal/50 text-slate hover:text-white transition-colors"
                                title="View revision history"
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleArchive(q)}
                                disabled={archivingId === q.id}
                                className="p-1.5 border border-ink-mid bg-ink rounded-sm hover:border-rose-500/50 text-slate hover:text-rose-400 transition-colors disabled:opacity-40"
                                title="Archive estimate"
                              >
                                {archivingId === q.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex items-center justify-between pt-4 mt-2 border-t border-ink-mid/50">
                  <p className="text-[10px] font-mono text-slate uppercase tracking-wider">
                    Page {currentPage + 1} of {pageCount} &middot; {sortedQuotes.length} matching
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={currentPage === 0}
                      className="p-1.5 border border-ink-mid bg-ink rounded-sm hover:border-signal/50 text-slate hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Previous page"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={currentPage >= pageCount - 1}
                      className="p-1.5 border border-ink-mid bg-ink rounded-sm hover:border-signal/50 text-slate hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Next page"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Info & Workflows - Right Col */}
        <div className="space-y-6">
          
          {/* Quick link builder card */}
          <div className="bg-gradient-to-br from-ink-light to-ink border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-signal/5 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-signal/10 transition-colors"></div>
            <div className="space-y-4 relative">
              <div className="w-10 h-10 rounded-sm bg-signal/10 border border-signal/20 flex items-center justify-center text-signal">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-white">Quotation Builder</h3>
                <p className="text-xs text-slate mt-1">
                  Adjust Direct Costs, add Preliminaries, set contingency markups, and calculate tax structures interactively.
                </p>
              </div>
              <Link 
                href="/dashboard/quotations/builder"
                className="flex items-center space-x-2 text-xs text-signal font-semibold hover:text-signal-hover transition-colors font-mono group-hover:translate-x-1 duration-200"
              >
                <span>Launch builder</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 space-y-4">
            <div className="w-10 h-10 rounded-sm bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-300">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-white">Commercial Control Brain</h3>
              <p className="text-xs text-slate mt-1">
                Convert an estimate into material demand, spend guardrails, output targets, margin protection, and exception flags.
              </p>
            </div>
            <Link
              href="/dashboard/quotations/ccb"
              className="flex items-center space-x-2 text-xs text-signal font-semibold hover:text-signal-hover transition-colors font-mono"
            >
              <span>Open CCB</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Historical link card */}
          <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 space-y-4">
            <h3 className="font-display font-semibold text-white">Export &amp; History Archive</h3>
            <p className="text-xs text-slate">
              View historic estimations, export logs, generated PDF/Excel document caches, and cost variances.
            </p>
            <Link 
              href="/dashboard/quotations/history"
              className="flex items-center space-x-2 bg-ink border border-ink-mid hover:border-signal/50 hover:bg-ink-light px-4 py-2 rounded-sm text-xs font-semibold transition-all w-full justify-center"
            >
              <span>View Archives &amp; Logs</span>
            </Link>
          </div>

          {/* Active Projects Selector info */}
          <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] p-6 space-y-4">
            <h3 className="font-display font-semibold text-white">Delivery Integration</h3>
            <p className="text-xs text-slate">
              Marking a quotation linked to a project as <span className="text-emerald-400 font-semibold">Won</span> seeds that project&apos;s execution budget from this quotation&apos;s own cost breakdown, and takes an initial forecast snapshot. From then on, actual site costs are tracked against this same baseline - referenceable anytime on the Finance dashboard - and a margin-threat alert fires automatically if costs run over without a matching approved variation.
            </p>
            <Link
              href="/dashboard/finance"
              className="flex items-center space-x-2 bg-ink border border-ink-mid hover:border-emerald-500/50 hover:bg-ink-light px-4 py-2 rounded-sm text-xs font-semibold transition-all w-full justify-center text-emerald-400"
            >
              <span>View Budget vs. Actual (Finance)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <div className="border-t border-ink-mid/50 pt-4 space-y-3">
              <div className="flex justify-between text-[10px] font-mono text-slate uppercase tracking-wider">
                <span>Active Projects Count</span>
                <span className="text-white font-bold">{projectsList.length}</span>
              </div>
              <div className="flex flex-col space-y-2">
                {projectsList.slice(0, 3).map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-xs py-1 border-b border-ink-mid/20">
                    <span className="text-slate-light truncate max-w-[150px]">{p.name}</span>
                    <span className="text-emerald-400 font-mono font-medium text-[10px] uppercase">Active</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>

      </div>

      {sopModalQuote && (
        <SopChecklistModal
          quotationId={sopModalQuote.id}
          quotationLabel={sopModalQuote.label}
          onClose={() => setSopModalQuote(null)}
        />
      )}

      {historyModalQuote && (
        <QuotationHistoryModal
          quotationId={historyModalQuote.id}
          quotationLabel={historyModalQuote.label}
          onClose={() => setHistoryModalQuote(null)}
        />
      )}

      <ModuleTour
        steps={QUOTATIONS_TOUR_STEPS}
        open={quotationsTour.open}
        onClose={quotationsTour.closeTour}
        onComplete={quotationsTour.completeTour}
      />
    </div>
  );
}
