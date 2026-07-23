"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { 
  FileText, Plus, Trash2, CheckCircle, 
  AlertCircle, Loader2, RefreshCw, Search, ArrowRight,
  TrendingUp, Calendar, DollarSign, BarChart2, Briefcase, FileDown, Layers, Brain
} from "lucide-react";
import { getQuotations, getProjects } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";

export default function QuotationsDashboard() {
  const { session } = useAuth();
  const [quotes, setQuotes] = useState<any[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const [quotesRes, projectsRes] = await Promise.all([
        getQuotations(),
        getProjects()
      ]);

      if (quotesRes.success && Array.isArray(quotesRes.data)) {
        setQuotes(quotesRes.data);
      } else {
        setQuotes([]);
      }

      if (projectsRes.success && Array.isArray(projectsRes.data)) {
        setProjectsList(projectsRes.data);
      } else {
        setProjectsList([]);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load estimates and project data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      void loadData();
    }
  }, [session, loadData]);

  // Filter quotes based on search
  const filteredQuotes = quotes.filter(q => {
    const term = searchTerm.toLowerCase();
    const client = (q.client_name || "").toLowerCase();
    const title = (q.metadata?.project_title || "").toLowerCase();
    const ref = (q.metadata?.reference_number || q.id || "").toLowerCase();
    return client.includes(term) || title.includes(term) || ref.includes(term);
  });

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
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            <Layers className="w-7 h-7 text-signal" />
            Estimating &amp; Quotations Command
          </h1>
          <p className="text-sm text-slate mt-1">
            Build robust cost structures, manage margins, and generate client-ready construction proposals.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button 
            onClick={loadData}
            className="p-2 border border-ink-mid rounded-sm bg-ink hover:border-signal/50 text-slate hover:text-white transition-all"
            title="Refresh database records"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-signal' : ''}`} />
          </button>
          <Link
            href="/dashboard/quotations/intelligence"
            className="flex items-center space-x-2 bg-gradient-to-r from-signal via-amber-400 to-amber-500 text-ink px-4 py-2 text-sm font-bold rounded-sm hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
          >
            <Brain className="w-4 h-4 text-ink" />
            <span>Quotation Intelligence Engine</span>
          </Link>
          <Link
            href="/dashboard/quotations/builder"
            className="flex items-center space-x-2 border border-signal/40 text-signal px-4 py-2 text-sm font-semibold rounded-sm hover:bg-signal/10 transition-all"
          >
            <Plus className="w-4 h-4 stroke-[3px]" />
            <span>New Estimate</span>
          </Link>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 border border-red-500/20 bg-red-950/20 rounded-sm flex items-center space-x-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="p-5 bg-ink-light border border-ink-mid rounded-sm space-y-2 relative group hover:border-signal/20 transition-colors">
          <DollarSign className="w-8 h-8 text-signal absolute right-5 top-5 opacity-40 group-hover:scale-110 transition-transform" />
          <p className="text-xs font-mono tracking-widest text-slate uppercase">Pipeline Value</p>
          <p className="text-xl font-bold font-display text-white">
            ${pipelineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] font-mono text-slate-light">Total generated estimating volume</p>
        </div>

        <div className="p-5 bg-ink-light border border-ink-mid rounded-sm space-y-2 relative group hover:border-signal/20 transition-colors">
          <BarChart2 className="w-8 h-8 text-signal right-5 top-5 absolute opacity-40 group-hover:scale-110 transition-transform" />
          <p className="text-xs font-mono tracking-widest text-slate uppercase">Avg proposal size</p>
          <p className="text-xl font-bold font-display text-white">
            ${avgQuoteAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] font-mono text-slate-light">Average cost buildup total</p>
        </div>

        <div className="p-5 bg-ink-light border border-ink-mid rounded-sm space-y-2 relative group hover:border-signal/20 transition-colors">
          <Briefcase className="w-8 h-8 text-signal right-5 top-5 absolute opacity-40 group-hover:scale-110 transition-transform" />
          <p className="text-xs font-mono tracking-widest text-slate uppercase">Active Estimates</p>
          <p className="text-xl font-bold font-display text-white">{activeCount}</p>
          <p className="text-[10px] font-mono text-slate-light">Excludes cancelled/archived files</p>
        </div>

        <div className="p-5 bg-ink-light border border-ink-mid rounded-sm space-y-2 relative group hover:border-signal/20 transition-colors">
          <TrendingUp className="w-8 h-8 text-signal right-5 top-5 absolute opacity-40 group-hover:scale-110 transition-transform" />
          <p className="text-xs font-mono tracking-widest text-slate uppercase">Avg Target Margin</p>
          <p className="text-xl font-bold font-display text-white">{averageMargin.toFixed(1)}%</p>
          <p className="text-[10px] font-mono text-slate-light">Average net markup target</p>
        </div>
      </div>

      {/* Main content split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Ledger - Left Col */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-ink-light border border-ink-mid rounded-sm p-6 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="font-display font-semibold text-lg text-white">Cost Proposals Ledger</h2>
                <p className="text-xs text-slate">Audit trail and status tracking of client cost structures.</p>
              </div>
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
            </div>

            {loading ? (
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
                      <th className="pb-3 font-normal">Reference &amp; Client</th>
                      <th className="pb-3 font-normal">Project Title</th>
                      <th className="pb-3 font-normal text-right">Estimate Total</th>
                      <th className="pb-3 font-normal text-center">Margin</th>
                      <th className="pb-3 font-normal text-center">Status</th>
                      <th className="pb-3 font-normal text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQuotes.map((q) => {
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
                              <Link 
                                href={`/dashboard/quotations/builder?edit=${q.id}`}
                                className="p-1.5 border border-ink-mid bg-ink rounded-sm hover:border-signal/50 text-slate hover:text-white transition-colors"
                                title="Edit estimate"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Info & Workflows - Right Col */}
        <div className="space-y-6">
          
          {/* Quick link builder card */}
          <div className="bg-gradient-to-br from-ink-light to-ink border border-ink-mid rounded-sm p-6 relative overflow-hidden group">
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

          <div className="bg-ink-light border border-ink-mid rounded-sm p-6 space-y-4">
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
          <div className="bg-ink-light border border-ink-mid rounded-sm p-6 space-y-4">
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
          <div className="bg-ink-light border border-ink-mid rounded-sm p-6 space-y-4">
            <h3 className="font-display font-semibold text-white">Delivery Integration</h3>
            <p className="text-xs text-slate">
              Winning a CRM opportunity or public tender automatically sets up a new Active Project. You can then attach cost estimates to manage project budgets seamlessly.
            </p>
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

    </div>
  );
}
