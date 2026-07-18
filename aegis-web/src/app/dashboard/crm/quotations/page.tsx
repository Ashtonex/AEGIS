"use client";

import React, { useCallback, useEffect, useState } from "react";
import { 
  FileText, Plus, Trash2, Printer, CheckCircle, 
  AlertCircle, Loader2, RefreshCw, FileDown, Search, ArrowRight,
  TrendingDown, TrendingUp, Calendar, Clock, DollarSign, Package,
  AlertTriangle, Hammer, ShieldAlert, Zap, Layers, Users, Sliders
} from "lucide-react";
import { getQuotations, createQuotation, getProjects } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";

interface CostBuildupItem {
  type: "material" | "labour" | "equipment" | "other";
  name: string;
  qty: number;
  unit: string;
  rate: number;
}

interface LineItem {
  description: string;
  qty: number;
  unit: string;
  rate: number;
  buildup?: CostBuildupItem[];
}

export default function QuotationsPage() {
  const { session } = useAuth();
  const [activeTab, setActiveTab] = useState<"ledger" | "builder" | "schedule" | "variance">("ledger");
  const [quotes, setQuotes] = useState<any[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Builder state
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [quoteRef, setQuoteRef] = useState(() => `SNC-QT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`);
  const [quoteDate, setQuoteDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [validDays, setValidDays] = useState(30);
  const [currency, setCurrency] = useState("USD");
  const [applyVat, setApplyVat] = useState(true);
  
  // Project-Level Allocations
  const [preliminaries, setPreliminaries] = useState(4500);
  const [overheadPct, setOverheadPct] = useState(5); // 5%
  const [contingencyPct, setContingencyPct] = useState(5); // 5%
  const [profitPct, setProfitPct] = useState(12); // 12%
  
  const [terms, setTerms] = useState(
    "1. Prices are valid for 30 days from date of issue.\n2. Payment terms: 50% mobilization deposit, balance certified upon handover.\n3. All construction works executed conform to standard SNC HSE Zero-Harm codes."
  );

  const [lineItems, setLineItems] = useState<LineItem[]>([
    { 
      description: "Concrete Foundation Slab Pour", 
      qty: 45, 
      unit: "m3", 
      rate: 135,
      buildup: [
        { type: "material", name: "Cement PC15", qty: 6, unit: "bags", rate: 12 },
        { type: "material", name: "Crushed Stone", qty: 0.8, unit: "m3", rate: 25 },
        { type: "material", name: "Washed Sand", qty: 0.5, unit: "m3", rate: 18 },
        { type: "labour", name: "Concrete Crew Placer", qty: 2, unit: "hours", rate: 10 },
        { type: "equipment", name: "Concrete Mixer Rental", qty: 0.5, unit: "hours", rate: 15 }
      ]
    }
  ]);

  // Rate Builder Modal State
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [tempBuildup, setTempBuildup] = useState<CostBuildupItem[]>([]);

  // Schedule Generator State
  const [selectedQuoteId, setSelectedQuoteId] = useState<string>("");
  const [selectedWeek, setSelectedWeek] = useState<number>(1);

  // Variance & Alert Monitor State
  const [selectedActiveProject, setSelectedActiveProject] = useState<string>("apex-concentrator");
  const [varianceAlerts, setVarianceAlerts] = useState<any[]>([
    {
      id: "var-001",
      scope: "Excavation Works - Base Footings",
      item: "Diesel Fuel (Equipment Mobilisation)",
      foreman: "Tinashe Moyo",
      boqQty: 500,
      reqQty: 750,
      unit: "Litres",
      rate: 1.65,
      variance: 250,
      impact: -412.50,
      justification: "Hard granite rock encountered requiring continuous pneumatic hammer operation.",
      status: "pending",
      date: "2026-07-16"
    },
    {
      id: "var-002",
      scope: "Concrete Foundation Slab Pour",
      item: "PC15 Portland Cement Bags",
      foreman: "Tinashe Moyo",
      boqQty: 270,
      reqQty: 340,
      unit: "Bags",
      rate: 12.00,
      variance: 70,
      impact: -840.00,
      justification: "Rain wash occurred on Sector B require clean re-pour of alignment block.",
      status: "pending",
      date: "2026-07-16"
    }
  ]);

  // Printable quote state
  const [printQuoteData, setPrintQuoteData] = useState<any>(null);
  const [printType, setPrintType] = useState<"quotation" | "boq" | "schedule">("quotation");

  const normalizeLoadError = (value: unknown, fallback: string) => {
    const message = value instanceof Error ? value.message : String(value ?? "");
    if (/aborted|cancelled|timed out|network error|fetch failed/i.test(message)) {
      return fallback;
    }
    return fallback;
  };

  const loadQuotes = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    setSourceWarnings([]);
    try {
      const [quoteResult, projectResult] = await Promise.allSettled([getQuotations(), getProjects()]);

      const nextWarnings: string[] = [];

      if (quoteResult.status === "fulfilled") {
        if (quoteResult.value.success && Array.isArray(quoteResult.value.data)) {
          setQuotes(quoteResult.value.data);
        } else {
          setQuotes([]);
          nextWarnings.push("Quotation ledger is available in fallback mode.");
        }
      } else {
        setQuotes([]);
        nextWarnings.push(normalizeLoadError(quoteResult.reason, "Quotation ledger is available in fallback mode."));
      }

      if (projectResult.status === "fulfilled") {
        if (projectResult.value.success && Array.isArray(projectResult.value.data)) {
          setProjectsList(projectResult.value.data);
        } else {
          setProjectsList([]);
          nextWarnings.push("Project selector is synchronizing in fallback mode.");
        }
      } else {
        setProjectsList([]);
        nextWarnings.push(normalizeLoadError(projectResult.reason, "Project selector is synchronizing in fallback mode."));
      }

      setSourceWarnings(nextWarnings);
    } catch (err: any) {
      setErrorMsg(normalizeLoadError(err, "Records are synchronizing in fallback mode."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      void loadQuotes();
    }
  }, [session, loadQuotes]);

  const addLineItem = () => {
    setLineItems((prev) => [...prev, { description: "", qty: 1, unit: "m3", rate: 0, buildup: [] }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length === 1) return;
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleLineItemChange = (index: number, field: keyof LineItem, value: any) => {
    setLineItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  // Calculations
  const directCosts = lineItems.reduce((acc, item) => acc + item.qty * item.rate, 0);
  const totalDirectAndPrelims = directCosts + preliminaries;
  const overheadAmount = totalDirectAndPrelims * (overheadPct / 100);
  const contingencyAmount = totalDirectAndPrelims * (contingencyPct / 100);
  const subtotalBeforeProfit = totalDirectAndPrelims + overheadAmount + contingencyAmount;
  const profitAmount = subtotalBeforeProfit * (profitPct / 100);
  const subtotal = subtotalBeforeProfit + profitAmount;
  const vat = applyVat ? subtotal * 0.15 : 0;
  const total = subtotal + vat;

  // Rate Buildup Functions
  const openRateBuilder = (index: number) => {
    setSelectedRowIndex(index);
    setTempBuildup(lineItems[index].buildup || []);
  };

  const addBuildupRow = () => {
    setTempBuildup((prev) => [...prev, { type: "material", name: "", qty: 1, unit: "unit", rate: 0 }]);
  };

  const removeBuildupRow = (idx: number) => {
    setTempBuildup((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveRateBuildup = () => {
    if (selectedRowIndex === null) return;
    const computedUnitRate = tempBuildup.reduce((acc, item) => acc + item.qty * item.rate, 0);
    setLineItems((prev) => {
      const copy = [...prev];
      copy[selectedRowIndex] = {
        ...copy[selectedRowIndex],
        rate: Number(computedUnitRate.toFixed(2)),
        buildup: tempBuildup
      };
      return copy;
    });
    setSelectedRowIndex(null);
  };

  const handleSaveQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName || !projectTitle || lineItems.some(i => !i.description)) {
      setErrorMsg("Please fill out all required fields and item descriptions.");
      return;
    }

    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    const payload = {
      client_name: clientName,
      quote_amount: total,
      metadata: {
        client_email: clientEmail,
        project_title: projectTitle,
        reference_number: quoteRef,
        quote_date: quoteDate,
        valid_until: new Date(new Date(quoteDate).getTime() + validDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        currency,
        direct_costs: directCosts,
        preliminaries,
        overhead_pct: overheadPct,
        contingency_pct: contingencyPct,
        profit_pct: profitPct,
        subtotal,
        vat,
        apply_vat: applyVat,
        terms,
        items: lineItems
      }
    };

    try {
      const res = await createQuotation(payload);
      if (res.success) {
        setSuccessMsg(`Quotation ${quoteRef} saved successfully to Project Brain database!`);
        setPrintQuoteData(payload);
        setPrintType("quotation");
        // Clear builder form
        setClientName("");
        setClientEmail("");
        setProjectTitle("");
        setQuoteRef(`SNC-QT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`);
        setLineItems([{ description: "Concrete Foundation Slab Pour", qty: 45, unit: "m3", rate: 135 }]);
        void loadQuotes();
        setActiveTab("ledger");
      }
    } catch (err: any) {
      setErrorMsg("Failed to save quotation. Please retry once the connection is ready.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVarianceDecision = (alertId: string, decision: "approved" | "rejected") => {
    setVarianceAlerts((prev) => 
      prev.map((alert) => 
        alert.id === alertId ? { ...alert, status: decision } : alert
      )
    );
    setSuccessMsg(`Variance request ${alertId} has been ${decision} by Executive Authority.`);
  };

  // Mock schedule data generation based on selected quote
  const getSelectedQuoteDetails = () => {
    const selected = quotes.find(q => String(q.id) === selectedQuoteId);
    if (selected) return selected;
    
    // Standard Demo Estimate fallback
    return {
      client_name: "Apex Mining Ltd",
      quote_amount: 87025,
      metadata: {
        project_title: "Phase II Concentrator Foundations",
        reference_number: "SNC-QT-2291",
        quote_date: "2026-07-16",
        currency: "USD",
        items: lineItems
      }
    };
  };

  const activeQuote = getSelectedQuoteDetails();

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ink-mid pb-4">
        <div>
          <h1 className="font-display text-4xl text-paper">Project Estimator & Scheduling Brain</h1>
          <p className="text-sm text-slate-light mt-1">Nail down exact BOQ builders, project timelines, and margin threats before and during construction.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setActiveTab("ledger")} 
            className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider border transition-colors ${
              activeTab === "ledger" ? "bg-signal text-ink border-signal" : "bg-ink border-ink-mid text-slate-light hover:text-paper"
            }`}
          >
            Ledger
          </button>
          <button 
            onClick={() => setActiveTab("builder")} 
            className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider border transition-colors ${
              activeTab === "builder" ? "bg-signal text-ink border-signal" : "bg-ink border-ink-mid text-slate-light hover:text-paper"
            }`}
          >
            Quotation Builder
          </button>
          <button 
            onClick={() => {
              setActiveTab("schedule");
              if (quotes.length && !selectedQuoteId) setSelectedQuoteId(String(quotes[0].id));
            }} 
            className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider border transition-colors ${
              activeTab === "schedule" ? "bg-signal text-ink border-signal" : "bg-ink border-ink-mid text-slate-light hover:text-paper"
            }`}
          >
            Outlay & Schedules
          </button>
          <button 
            onClick={() => setActiveTab("variance")} 
            className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider border transition-colors ${
              activeTab === "variance" ? "bg-signal text-ink border-signal" : "bg-ink border-ink-mid text-slate-light hover:text-paper"
            }`}
          >
            Margin Variance Alerts
          </button>
        </div>
      </header>

      {/* Global Alerts */}
      {successMsg && (
        <div className="border border-green-500/20 bg-green-500/10 p-4 flex gap-3 text-sm text-paper rounded-sm">
          <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="border border-red-500/20 bg-red-500/10 p-4 flex gap-3 text-sm text-paper rounded-sm">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {sourceWarnings.length > 0 && (
        <div className="border border-amber-500/20 bg-amber-500/10 p-4 flex gap-3 text-sm text-paper rounded-sm">
          <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0" />
          <div className="space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-wider text-amber-200">Partial source availability</p>
            {sourceWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </div>
      )}

      {/* Tab 1: Ledger */}
      {activeTab === "ledger" && (
        <section className="bg-ink border border-ink-mid rounded-sm p-5 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-mono text-xs tracking-widest text-paper uppercase">Quotations Ledger</h2>
            <button onClick={loadQuotes} className="text-slate hover:text-paper p-1.5 border border-ink-mid rounded-sm">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center items-center h-48 text-slate-light">
              <Loader2 className="w-6 h-6 animate-spin text-signal mr-2" /> Loading ledger...
            </div>
          ) : quotes.length === 0 ? (
            <div className="flex flex-col justify-center items-center text-center p-12 border border-dashed border-ink-mid rounded-sm min-h-[300px]">
              <FileText className="w-12 h-12 text-slate mb-4" />
              <h3 className="text-sm font-semibold text-paper">No Estimator Data</h3>
              <p className="text-xs text-slate-light mt-1 max-w-sm">No construction quotations recorded yet. Utilize the builder to generate the project BOQ.</p>
              <button onClick={() => setActiveTab("builder")} className="mt-5 border border-signal/50 bg-signal/5 px-4 py-2 font-mono text-xs uppercase text-signal hover:bg-signal/15">
                Create First Estimate
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-y border-ink-mid font-mono uppercase text-slate tracking-wider">
                  <tr>
                    <th className="p-3">Ref Code</th>
                    <th className="p-3">Client</th>
                    <th className="p-3">Project Title</th>
                    <th className="p-3">Direct Costs</th>
                    <th className="p-3">Prelims</th>
                    <th className="p-3">Total (incl VAT)</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/50">
                  {quotes.map((q) => {
                    const meta = q.metadata || {};
                    return (
                      <tr key={q.id} className="hover:bg-ink-light">
                        <td className="p-3 font-mono font-bold text-paper">{meta.reference_number || "SNC-QT-MOCK"}</td>
                        <td className="p-3 text-paper font-semibold">{q.client_name}</td>
                        <td className="p-3 text-slate-light">{meta.project_title || "General Works"}</td>
                        <td className="p-3 font-mono text-slate-light">{currency} {Number(meta.direct_costs || q.quote_amount * 0.75).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="p-3 font-mono text-slate-light">{currency} {Number(meta.preliminaries || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="p-3 font-mono text-signal font-bold">{currency} {Number(q.quote_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                          <button 
                            onClick={() => { setPrintQuoteData(q); setPrintType("quotation"); }} 
                            className="inline-flex items-center gap-1 border border-ink-mid hover:border-signal/50 bg-ink-light px-2.5 py-1 font-mono text-[9px] uppercase text-paper hover:text-signal"
                          >
                            Quotation
                          </button>
                          <button 
                            onClick={() => { setPrintQuoteData(q); setPrintType("boq"); }} 
                            className="inline-flex items-center gap-1 border border-ink-mid hover:border-signal/50 bg-ink-light px-2.5 py-1 font-mono text-[9px] uppercase text-paper hover:text-signal"
                          >
                            BOQ
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Tab 2: Builder */}
      {activeTab === "builder" && (
        <form onSubmit={handleSaveQuotation} className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left Column: Metadata & Project Parameters */}
          <div className="bg-ink border border-ink-mid p-5 rounded-sm space-y-4 h-fit">
            <h2 className="font-mono text-xs tracking-widest text-paper uppercase border-b border-ink-mid pb-2 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-signal" /> Pricing Formula Parameters
            </h2>

            <label className="block">
              <span className="font-mono text-[9px] uppercase text-slate">Client Organization *</span>
              <input 
                required
                type="text" 
                placeholder="e.g. Apex Mining Ltd" 
                value={clientName} 
                onChange={(e) => setClientName(e.target.value)} 
                className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Client Email</span>
                <input 
                  type="email" 
                  placeholder="contact@client.com" 
                  value={clientEmail} 
                  onChange={(e) => setClientEmail(e.target.value)} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
                />
              </label>

              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Project Title *</span>
                <input 
                  required
                  type="text" 
                  placeholder="e.g. Concentrator foundations" 
                  value={projectTitle} 
                  onChange={(e) => setProjectTitle(e.target.value)} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Reference No</span>
                <input 
                  type="text" 
                  value={quoteRef} 
                  onChange={(e) => setQuoteRef(e.target.value)} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
                />
              </label>

              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Quote Date</span>
                <input 
                  type="date" 
                  value={quoteDate} 
                  onChange={(e) => setQuoteDate(e.target.value)} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-ink-mid pt-4">
              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Prelims Cost ($)</span>
                <input 
                  type="number" 
                  value={preliminaries} 
                  onChange={(e) => setPreliminaries(Number(e.target.value))} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
                />
              </label>

              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Overhead Alloc %</span>
                <input 
                  type="number" 
                  value={overheadPct} 
                  onChange={(e) => setOverheadPct(Number(e.target.value))} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Contingency %</span>
                <input 
                  type="number" 
                  value={contingencyPct} 
                  onChange={(e) => setContingencyPct(Number(e.target.value))} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
                />
              </label>

              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Target Profit %</span>
                <input 
                  type="number" 
                  value={profitPct} 
                  onChange={(e) => setProfitPct(Number(e.target.value))} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-ink-mid pt-4">
              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Currency</span>
                <select 
                  value={currency} 
                  onChange={(e) => setCurrency(e.target.value)} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal cursor-pointer"
                >
                  <option value="USD">USD ($)</option>
                  <option value="ZWG">ZWG (ZiG)</option>
                </select>
              </label>

              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Validity Days</span>
                <input 
                  type="number" 
                  value={validDays} 
                  onChange={(e) => setValidDays(Number(e.target.value))} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
                />
              </label>
            </div>
          </div>

          {/* Right Column: Line Items & Pricing Build Up */}
          <div className="xl:col-span-2 space-y-6">
            <div className="bg-ink border border-ink-mid p-5 rounded-sm space-y-4">
              <div className="flex justify-between items-center border-b border-ink-mid pb-2">
                <h2 className="font-mono text-xs tracking-widest text-paper uppercase">Bill of Quantities (BOQ)</h2>
                <button 
                  type="button" 
                  onClick={addLineItem}
                  className="inline-flex items-center gap-1 border border-signal/50 bg-signal/5 px-2.5 py-1 font-mono text-[10px] uppercase text-signal hover:bg-signal/15"
                >
                  <Plus className="w-3.5 h-3.5" /> Add BOQ Item
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[650px]">
                  <thead className="font-mono uppercase text-slate tracking-wider border-b border-ink-mid pb-2">
                    <tr>
                      <th className="pb-2 w-[45%]">Work Item / Description</th>
                      <th className="pb-2 w-[10%]">Qty</th>
                      <th className="pb-2 w-[10%]">Unit</th>
                      <th className="pb-2 w-[15%]">Unit Rate</th>
                      <th className="pb-2 text-right">Total</th>
                      <th className="pb-2 text-center w-[12%]">Rate Builder</th>
                      <th className="pb-2 w-[8%] text-center">Delete</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid/30">
                    {lineItems.map((item, index) => (
                      <tr key={index} className="py-2">
                        <td className="py-2 pr-3">
                          <input 
                            required
                            type="text" 
                            placeholder="e.g. Excavation / Structural Masonry..." 
                            value={item.description} 
                            onChange={(e) => handleLineItemChange(index, "description", e.target.value)} 
                            className="w-full border border-ink-mid bg-ink px-2.5 py-1.5 text-xs text-paper outline-none focus:border-signal"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input 
                            required
                            type="number" 
                            min="1" 
                            value={item.qty} 
                            onChange={(e) => handleLineItemChange(index, "qty", e.target.value)} 
                            className="w-full border border-ink-mid bg-ink px-2.5 py-1.5 text-xs text-paper outline-none focus:border-signal"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input 
                            required
                            type="text" 
                            placeholder="m3" 
                            value={item.unit} 
                            onChange={(e) => handleLineItemChange(index, "unit", e.target.value)} 
                            className="w-full border border-ink-mid bg-ink px-2.5 py-1.5 text-xs text-paper outline-none focus:border-signal"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input 
                            required
                            type="number" 
                            min="0"
                            step="0.01" 
                            value={item.rate} 
                            onChange={(e) => handleLineItemChange(index, "rate", e.target.value)} 
                            className="w-full border border-ink-mid bg-ink px-2.5 py-1.5 text-xs text-paper outline-none focus:border-signal"
                          />
                        </td>
                        <td className="py-2 font-mono text-paper font-semibold text-right whitespace-nowrap">
                          {Number(item.qty * item.rate).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 text-center">
                          <button 
                            type="button" 
                            onClick={() => openRateBuilder(index)}
                            className="border border-signal/40 bg-signal/5 px-2 py-1 font-mono text-[9px] uppercase text-signal hover:bg-signal/20"
                          >
                            Build Rate
                          </button>
                        </td>
                        <td className="py-2 text-center">
                          <button 
                            type="button" 
                            onClick={() => removeLineItem(index)}
                            disabled={lineItems.length === 1}
                            className="text-slate hover:text-red-400 disabled:opacity-30"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Estimate Formulas Summary block */}
              <div className="border-t border-ink-mid pt-4 flex flex-col md:flex-row justify-between items-start gap-4">
                <div className="space-y-1.5 text-xs text-slate-light max-w-sm">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-signal" />
                    <span>Direct cost built from sub-item rate calculators.</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-signal" />
                    <span>Taxes and overhead distributions apply dynamically.</span>
                  </div>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={applyVat} 
                      onChange={(e) => setApplyVat(e.target.checked)} 
                      className="accent-signal"
                    />
                    <span>Include 15% ZIMRA VAT</span>
                  </label>
                </div>

                <div className="w-full md:w-80 space-y-1.5 text-xs font-mono border border-ink-mid bg-ink p-4 rounded-sm">
                  <div className="flex justify-between">
                    <span className="text-slate">DIRECT COSTS:</span>
                    <span className="text-paper">{currency} {directCosts.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">PRELIMINARIES:</span>
                    <span className="text-paper">{currency} {preliminaries.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">OVERHEADS ({overheadPct}%):</span>
                    <span className="text-paper">{currency} {overheadAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">CONTINGENCY ({contingencyPct}%):</span>
                    <span className="text-paper">{currency} {contingencyAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">PROFIT MARGIN ({profitPct}%):</span>
                    <span className="text-paper text-green-400">+{currency} {profitAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between border-t border-ink-mid pt-1.5">
                    <span className="text-slate font-bold">SUBTOTAL:</span>
                    <span className="text-paper font-bold">{currency} {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">VAT (15%):</span>
                    <span className="text-paper">{currency} {vat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between border-t border-ink-mid pt-1.5 font-bold text-sm">
                    <span className="text-signal">ESTIMATED PRICE:</span>
                    <span className="text-signal">{currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Terms and Submission */}
            <div className="bg-ink border border-ink-mid p-5 rounded-sm space-y-4">
              <label className="block">
                <span className="font-mono text-xs tracking-widest text-paper uppercase block mb-2">Terms and Conditions</span>
                <textarea 
                  value={terms} 
                  onChange={(e) => setTerms(e.target.value)} 
                  rows={4} 
                  className="w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
                />
              </label>

              <button 
                type="submit" 
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 border border-signal/50 bg-signal/10 hover:bg-signal/20 px-6 py-2.5 font-mono text-xs uppercase tracking-wider text-signal disabled:opacity-50 transition-all"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving Estimate...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" /> Save Estimate & Generate Project Brain
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Tab 3: Outlay & Schedules */}
      {activeTab === "schedule" && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quote selector sidebar */}
          <div className="bg-ink border border-ink-mid p-5 rounded-sm space-y-4 h-fit">
            <h2 className="font-mono text-xs tracking-widest text-paper uppercase border-b border-ink-mid pb-2">Active Project Baselines</h2>
            
            <label className="block">
              <span className="font-mono text-[9px] uppercase text-slate">Select Approved Estimate</span>
              <select 
                value={selectedQuoteId}
                onChange={(e) => setSelectedQuoteId(e.target.value)}
                className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal cursor-pointer"
              >
                {quotes.length ? (
                  quotes.map((q) => (
                    <option key={q.id} value={String(q.id)}>
                      {String(q.metadata?.project_title || q.client_name)} ({q.metadata?.reference_number})
                    </option>
                  ))
                ) : (
                  <option value="">-- Fallback Demo Project --</option>
                )}
              </select>
            </label>

            <div className="border border-ink-mid bg-ink-light p-3.5 space-y-2 rounded-sm text-xs">
              <div className="flex justify-between">
                <span className="text-slate">Contract Total:</span>
                <span className="text-paper font-bold font-mono">USD {Number(activeQuote?.quote_amount).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate">Scheduled Duration:</span>
                <span className="text-paper font-bold font-mono">18 Weeks</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate">Labour Hours Budget:</span>
                <span className="text-paper font-mono">1,450 Hrs</span>
              </div>
            </div>

            <button 
              onClick={() => { setPrintQuoteData(activeQuote); setPrintType("schedule"); }}
              className="w-full inline-flex items-center justify-center gap-1.5 border border-signal/50 bg-signal/5 px-4 py-2 font-mono text-[10px] uppercase text-signal hover:bg-signal/15"
            >
              <Printer className="w-3.5 h-3.5" /> Print Project Outlay Document
            </button>
          </div>

          {/* Outlay schedule view (2 Columns) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Outlay Gantt visualization */}
            <div className="bg-ink border border-ink-mid p-5 rounded-sm space-y-4">
              <div className="flex justify-between items-center border-b border-ink-mid pb-2">
                <h3 className="font-mono text-xs tracking-widest text-paper uppercase flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-signal" /> Phase Outlay Timeline (18 Weeks)
                </h3>
                <span className="text-[10px] font-mono text-slate">GANTT BASELINE</span>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-paper">Phase 1: site mobilisation & prelims</span>
                    <span className="text-slate">W1 - W2 (100% complete)</span>
                  </div>
                  <div className="h-2 bg-ink-light border border-ink-mid rounded-full overflow-hidden flex">
                    <div className="h-full bg-signal" style={{ width: "100%" }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-paper">Phase 2: excavation & backhoe earthworks</span>
                    <span className="text-slate">W3 - W5 (85% complete)</span>
                  </div>
                  <div className="h-2 bg-ink-light border border-ink-mid rounded-full overflow-hidden flex">
                    <div className="h-full bg-signal" style={{ width: "85%" }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-paper">Phase 3: structural foundations & reinforcing steel</span>
                    <span className="text-slate">W6 - W10 (20% complete)</span>
                  </div>
                  <div className="h-2 bg-ink-light border border-ink-mid rounded-full overflow-hidden flex">
                    <div className="h-full bg-signal" style={{ width: "20%" }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-paper">Phase 4: brickwork & plumbing core</span>
                    <span className="text-slate">W11 - W14 (Scheduled)</span>
                  </div>
                  <div className="h-2 bg-ink-light border border-ink-mid rounded-full overflow-hidden flex">
                    <div className="h-full bg-signal/10" style={{ width: "0%" }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-paper">Phase 5: finishes & handover demobilisation</span>
                    <span className="text-slate">W15 - W18 (Scheduled)</span>
                  </div>
                  <div className="h-2 bg-ink-light border border-ink-mid rounded-full overflow-hidden flex">
                    <div className="h-full bg-signal/10" style={{ width: "0%" }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Weekly running schedule breakdown */}
            <div className="bg-ink border border-ink-mid p-5 rounded-sm space-y-4">
              <div className="flex justify-between items-center border-b border-ink-mid pb-2">
                <h3 className="font-mono text-xs tracking-widest text-paper uppercase flex items-center gap-2">
                  <Clock className="w-4 h-4 text-signal" /> Weekly Running Target Schedule
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate">WEEK SELECTOR</span>
                  <select 
                    value={selectedWeek} 
                    onChange={(e) => setSelectedWeek(Number(e.target.value))}
                    className="border border-ink-mid bg-ink px-2 py-1 text-[11px] text-paper font-mono outline-none"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(w => (
                      <option key={w} value={w}>Week {w}</option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedWeek <= 3 ? (
                <div className="space-y-4 text-xs">
                  <div className="border border-ink-mid bg-ink-light p-3.5 rounded-sm">
                    <h4 className="font-bold text-paper text-sm">Week 1-3 Deliverables: Earthworks & Grading</h4>
                    <p className="text-slate-light mt-1">Focus on site excavation, leveling, and drainage channels. Mobilize Backhoe Loader.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="border border-ink-mid p-3 space-y-2">
                      <span className="font-mono text-[9px] uppercase text-slate">Weekly Material Targets</span>
                      <ul className="list-disc pl-4 space-y-1 text-slate-light">
                        <li>500 L Diesel Fuel (excl. backup generator)</li>
                        <li>50m Sub-surface piping</li>
                        <li>12 Ton Grade A gravel backfill</li>
                      </ul>
                    </div>
                    <div className="border border-ink-mid p-3 space-y-2">
                      <span className="font-mono text-[9px] uppercase text-slate">Daily Foreman Task Board</span>
                      <ul className="list-disc pl-4 space-y-1 text-slate-light">
                        <li>Excavate 15m line of footings daily</li>
                        <li>Direct 3 structural laborers, 1 loader operator</li>
                        <li>Record meters on daily site report log</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 text-xs">
                  <div className="border border-ink-mid bg-ink-light p-3.5 rounded-sm">
                    <h4 className="font-bold text-paper text-sm">Week {selectedWeek} Deliverables: Foundation Concrete Pour</h4>
                    <p className="text-slate-light mt-1">Focus on slab reinforcement rebar mesh laying and volumetric concrete pour.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="border border-ink-mid p-3 space-y-2">
                      <span className="font-mono text-[9px] uppercase text-slate">Weekly Material Targets</span>
                      <ul className="list-disc pl-4 space-y-1 text-slate-light">
                        <li>270 Bags PC15 Portland Cement</li>
                        <li>18 Tons aggregate stone mixture</li>
                        <li>2.5 Tons reinforced rebar mesh (12mm)</li>
                      </ul>
                    </div>
                    <div className="border border-ink-mid p-3 space-y-2">
                      <span className="font-mono text-[9px] uppercase text-slate">Daily Foreman Task Board</span>
                      <ul className="list-disc pl-4 space-y-1 text-slate-light">
                        <li>Tie rebar alignment block Sector A-C</li>
                        <li>Volumetric concrete pour rate: 10m3 daily</li>
                        <li>Verify concrete setting compression tests</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Tab 4: Margin Variance Alerts */}
      {activeTab === "variance" && (
        <section className="space-y-6">
          {/* Target margin metrics bar */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-ink border border-ink-mid p-4 rounded-sm">
              <span className="font-mono text-[9px] uppercase text-slate">Contract Total Value</span>
              <p className="font-mono text-xl text-paper mt-1">USD 87,025.00</p>
            </div>
            <div className="bg-ink border border-ink-mid p-4 rounded-sm">
              <span className="font-mono text-[9px] uppercase text-slate">Baseline Profit Margin</span>
              <p className="font-mono text-xl text-green-400 mt-1">12.0% ($10,443)</p>
            </div>
            <div className="bg-ink border border-ink-mid p-4 rounded-sm">
              <span className="font-mono text-[9px] uppercase text-slate">Actual Site Spending</span>
              <p className="font-mono text-xl text-paper mt-1">USD 14,850.00</p>
            </div>
            <div className="bg-ink border border-ink-mid p-4 rounded-sm">
              <span className="font-mono text-[9px] uppercase text-slate">Margin Risk Index</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="font-mono text-sm text-red-500 font-bold uppercase">THREATENED (-$1,252)</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Variance Alerts Column (2 Columns) */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex justify-between items-center border-b border-ink-mid pb-2">
                <h3 className="font-mono text-xs tracking-widest text-paper uppercase flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-red-500 animate-pulse" /> Real-time Site Variance Requests
                </h3>
                <span className="text-[10px] font-mono text-red-500">{varianceAlerts.filter(a => a.status === "pending").length} PENDING EXECUTIVE DECISION</span>
              </div>

              {varianceAlerts.length === 0 ? (
                <div className="border border-ink-mid bg-ink p-12 text-center text-slate-light text-xs rounded-sm">
                  All site material requests correspond exactly to the BOQ baseline. No threats recorded.
                </div>
              ) : (
                <div className="space-y-4">
                  {varianceAlerts.map((alert) => (
                    <div key={alert.id} className={`border p-4 rounded-sm space-y-3 ${
                      alert.status === "approved" ? "border-green-500/20 bg-green-500/5 opacity-80" : 
                      alert.status === "rejected" ? "border-red-500/20 bg-red-500/5 opacity-80" :
                      "border-red-500/40 bg-red-500/5"
                    }`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-mono text-[9px] uppercase text-slate-light block">{alert.scope}</span>
                          <h4 className="text-sm font-bold text-paper mt-0.5">{alert.item}</h4>
                        </div>
                        <span className={`px-2 py-0.5 text-[8px] font-mono uppercase font-bold rounded-full ${
                          alert.status === "approved" ? "bg-green-500/10 text-green-400 border border-green-500/20" :
                          alert.status === "rejected" ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                          "bg-red-500/10 text-red-500 border border-red-500/25 animate-pulse"
                        }`}>
                          {alert.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-4 gap-2 text-xs font-mono border border-ink-mid/60 bg-ink-light p-2.5 rounded-sm">
                        <div>
                          <span className="text-[8px] text-slate block uppercase">BOQ baseline</span>
                          <span className="text-paper">{alert.boqQty} {alert.unit}</span>
                        </div>
                        <div>
                          <span className="text-[8px] text-slate block uppercase">Requested</span>
                          <span className="text-paper font-bold">{alert.reqQty} {alert.unit}</span>
                        </div>
                        <div>
                          <span className="text-[8px] text-slate block uppercase">Overrun</span>
                          <span className="text-red-400 font-bold">+{alert.variance} {alert.unit}</span>
                        </div>
                        <div>
                          <span className="text-[8px] text-slate block uppercase">Margin impact</span>
                          <span className="text-red-500 font-bold">-${Math.abs(alert.impact).toFixed(2)}</span>
                        </div>
                      </div>

                      <div className="text-xs">
                        <span className="text-[9px] font-mono text-slate block uppercase">Foreman Justification</span>
                        <p className="text-slate-light mt-0.5 leading-relaxed">{alert.justification}</p>
                      </div>

                      {alert.status === "pending" && (
                        <div className="flex gap-2 justify-end pt-2 border-t border-ink-mid/40">
                          <button 
                            onClick={() => handleVarianceDecision(alert.id, "approved")}
                            className="bg-green-500/20 hover:bg-green-500/30 text-green-400 font-mono text-[9px] uppercase px-3 py-1.5 border border-green-500/30 transition-all rounded-sm"
                          >
                            Approve Override & Mobilise Stock
                          </button>
                          <button 
                            onClick={() => handleVarianceDecision(alert.id, "rejected")}
                            className="bg-red-500/20 hover:bg-red-500/30 text-red-400 font-mono text-[9px] uppercase px-3 py-1.5 border border-red-500/30 transition-all rounded-sm"
                          >
                            Reject & Hold Request
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cost Controls and Supplier Registry comparisons (1 Column) */}
            <div className="bg-ink border border-ink-mid p-5 rounded-sm space-y-5 h-fit text-xs">
              <h3 className="font-mono text-xs tracking-widest text-paper uppercase border-b border-ink-mid pb-2 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-signal" /> Supplier Registry Audits
              </h3>

              <p className="text-slate-light leading-relaxed">
                The Project Brain references the database supplier registers to prevent foremen from procuring materials at marked-up or unapproved rates.
              </p>

              <div className="space-y-3.5 pt-2">
                <div className="border border-ink-mid p-3 rounded-sm space-y-1.5">
                  <div className="flex justify-between items-center font-mono">
                    <span className="text-paper font-semibold">Cement Bags (PC15)</span>
                    <span className="text-green-400">OK</span>
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-slate-light">
                    <span>Registry Standard Rate:</span>
                    <span>$12.00 / bag</span>
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-slate-light">
                    <span>Cheapest Source (PRAZ):</span>
                    <span>Halsted Builders ($11.85)</span>
                  </div>
                </div>

                <div className="border border-ink-mid p-3 rounded-sm space-y-1.5">
                  <div className="flex justify-between items-center font-mono">
                    <span className="text-paper font-semibold">Crushed Aggregate</span>
                    <span className="text-amber-500">WARNING</span>
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-slate-light">
                    <span>Registry Standard Rate:</span>
                    <span>$25.00 / m3</span>
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-slate-light">
                    <span>Site Requested Rate:</span>
                    <span className="text-amber-400 font-bold">$29.50 / m3 (+18%)</span>
                  </div>
                  <p className="text-[9px] text-slate mt-1 italic">Notice: Site Engineer requested local quarry without dispatch approval.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Rate Builder Modal Overlay */}
      {selectedRowIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-ink border border-ink-light rounded-sm w-full max-w-3xl p-5 space-y-4">
            <div className="flex justify-between items-start border-b border-ink-mid pb-3">
              <div>
                <h3 className="text-lg font-display text-paper">Estimate Rate Builder</h3>
                <p className="text-xs text-slate-light mt-0.5">Build unit rate for: &ldquo;{lineItems[selectedRowIndex].description || "Selected Row"}&rdquo;</p>
              </div>
              <button 
                onClick={() => setSelectedRowIndex(null)}
                className="text-slate hover:text-paper text-sm font-mono border border-ink-mid px-2 py-1"
              >
                Close
              </button>
            </div>

            <div className="overflow-y-auto max-h-[350px] space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-mono text-[9px] text-slate uppercase">Cost Breakdown Ledger</span>
                <button 
                  type="button" 
                  onClick={addBuildupRow}
                  className="inline-flex items-center gap-1 border border-signal/40 bg-signal/5 px-2.5 py-1 font-mono text-[9px] uppercase text-signal hover:bg-signal/15"
                >
                  <Plus className="w-3 h-3" /> Add Component
                </button>
              </div>

              {tempBuildup.length === 0 ? (
                <p className="text-xs text-slate-light text-center py-6 border border-dashed border-ink-mid">No cost components. Add your first direct cost item (Material, Labour, or Equipment).</p>
              ) : (
                <div className="space-y-2">
                  {tempBuildup.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-center text-xs">
                      <select 
                        value={item.type}
                        onChange={(e) => {
                          const copy = [...tempBuildup];
                          copy[idx] = { ...copy[idx], type: e.target.value as any };
                          setTempBuildup(copy);
                        }}
                        className="border border-ink-mid bg-ink px-2 py-1.5 text-paper outline-none w-28"
                      >
                        <option value="material">Material</option>
                        <option value="labour">Labour</option>
                        <option value="equipment">Equipment</option>
                        <option value="other">Other</option>
                      </select>

                      <input 
                        type="text" 
                        placeholder="Component name (e.g. Cement bag)"
                        value={item.name}
                        onChange={(e) => {
                          const copy = [...tempBuildup];
                          copy[idx] = { ...copy[idx], name: e.target.value };
                          setTempBuildup(copy);
                        }}
                        className="border border-ink-mid bg-ink px-2.5 py-1.5 text-paper outline-none flex-1"
                      />

                      <input 
                        type="number" 
                        placeholder="Qty"
                        value={item.qty}
                        onChange={(e) => {
                          const copy = [...tempBuildup];
                          copy[idx] = { ...copy[idx], qty: Number(e.target.value) };
                          setTempBuildup(copy);
                        }}
                        className="border border-ink-mid bg-ink px-2 py-1.5 text-paper outline-none w-16 font-mono"
                      />

                      <input 
                        type="text" 
                        placeholder="Unit"
                        value={item.unit}
                        onChange={(e) => {
                          const copy = [...tempBuildup];
                          copy[idx] = { ...copy[idx], unit: e.target.value };
                          setTempBuildup(copy);
                        }}
                        className="border border-ink-mid bg-ink px-2 py-1.5 text-paper outline-none w-16"
                      />

                      <span className="text-slate">@</span>

                      <input 
                        type="number" 
                        placeholder="Rate"
                        value={item.rate}
                        onChange={(e) => {
                          const copy = [...tempBuildup];
                          copy[idx] = { ...copy[idx], rate: Number(e.target.value) };
                          setTempBuildup(copy);
                        }}
                        className="border border-ink-mid bg-ink px-2 py-1.5 text-paper outline-none w-20 font-mono"
                      />

                      <span className="font-mono text-paper font-semibold w-24 text-right">
                        ${Number(item.qty * item.rate).toFixed(2)}
                      </span>

                      <button 
                        type="button" 
                        onClick={() => removeBuildupRow(idx)}
                        className="text-slate hover:text-red-400 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-ink-mid pt-4 flex justify-between items-center text-xs font-mono">
              <div>
                <span className="text-slate uppercase block text-[9px]">Calculated Unit Rate</span>
                <span className="text-lg text-signal font-bold">${tempBuildup.reduce((acc, item) => acc + item.qty * item.rate, 0).toFixed(2)} / {lineItems[selectedRowIndex].unit}</span>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setSelectedRowIndex(null)}
                  className="border border-ink-mid px-4 py-2 text-slate-light hover:text-paper"
                >
                  Cancel
                </button>
                <button 
                  onClick={saveRateBuildup}
                  className="bg-signal text-ink px-4 py-2 font-bold uppercase hover:bg-signal-hover"
                >
                  Apply Rate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Printable Overlays (Quotation vs BOQ vs Schedule) */}
      {printQuoteData && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto no-scrollbar print:p-0 print:bg-white print:static print:h-auto">
          <div className="bg-ink border border-ink-mid rounded-sm w-full max-w-4xl p-8 relative space-y-6 flex flex-col justify-between print:border-0 print:p-0 print:bg-white print:text-black">
            
            {/* Control Bar (Hidden in Print) */}
            <div className="flex justify-between items-center border-b border-ink-mid pb-4 print:hidden">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <FileText className="w-5 h-5 text-signal" />
                  <h2 className="text-sm font-bold font-mono uppercase text-paper">Document Generator</h2>
                </div>
                <div className="flex bg-ink-light border border-ink-mid p-1 rounded-sm">
                  {(["quotation", "boq", "schedule"] as const).map(t => (
                    <button 
                      key={t}
                      onClick={() => setPrintType(t)}
                      className={`px-3 py-1 font-mono text-[9px] uppercase rounded-sm transition-all ${
                        printType === t ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 border border-signal bg-signal/15 px-4 py-2 font-mono text-xs uppercase text-signal hover:bg-signal/25"
                >
                  <Printer className="w-4 h-4" /> Print / Save PDF
                </button>
                <button 
                  onClick={() => setPrintQuoteData(null)}
                  className="border border-ink-mid px-4 py-2 font-mono text-xs uppercase text-slate-light hover:text-paper"
                >
                  Close
                </button>
              </div>
            </div>

            {/* PRINT VIEW AREA */}
            <div id="quotation-print-container" className="bg-ink-light border border-ink-mid p-8 max-w-[800px] mx-auto text-paper flex flex-col justify-between min-h-[900px] rounded-sm print:border-0 print:p-0 print:bg-white print:text-black print:w-full print:min-h-0">
              
              {/* Header block */}
              <div className="flex justify-between items-start border-b border-ink-mid pb-6 print:border-slate-300">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-signal rounded-sm flex items-center justify-center print:bg-black">
                      <span className="font-display text-ink font-bold text-base print:text-white font-bold">SNC</span>
                    </div>
                    <span className="font-display text-xl tracking-wider text-paper print:text-black font-bold">SIX NINE CONSTRUCTION</span>
                  </div>
                  <p className="text-[10px] text-slate-light mt-2 print:text-slate-500 leading-relaxed font-mono">
                    102 Samora Machel Avenue, Harare, Zimbabwe<br />
                    Phone: +263 242 770110 | Email: bids@sixnine.co.zw
                  </p>
                </div>
                <div className="text-right">
                  <h1 className="font-display text-3xl text-signal font-bold uppercase tracking-wider print:text-black">
                    {printType === "quotation" ? "QUOTATION" : printType === "boq" ? "BILL OF QUANTITIES" : "DELIVERY SCHEDULE"}
                  </h1>
                  <table className="mt-4 inline-block text-left font-mono text-[10px] print:text-slate-700">
                    <tbody>
                      <tr>
                        <td className="pr-3 text-slate font-bold">DOC REF:</td>
                        <td className="text-paper print:text-black font-bold">{printQuoteData.metadata?.reference_number || "SNC-QT-MOCK"}</td>
                      </tr>
                      <tr>
                        <td className="pr-3 text-slate">DATE:</td>
                        <td className="text-paper print:text-black">{printQuoteData.metadata?.quote_date || "2026-07-16"}</td>
                      </tr>
                      <tr>
                        <td className="pr-3 text-slate">VALID UNTIL:</td>
                        <td className="text-paper print:text-black font-bold">{printQuoteData.metadata?.valid_until || "2026-08-15"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bill To & Bill From */}
              <div className="grid grid-cols-2 gap-6 py-6 border-b border-ink-mid print:border-slate-300">
                <div>
                  <span className="font-mono text-[9px] text-slate uppercase block print:text-slate-500">PREPARED FOR</span>
                  <div className="mt-2 space-y-1">
                    <h4 className="text-sm font-bold text-paper print:text-black">{printQuoteData.client_name}</h4>
                    <p className="text-[11px] text-slate-light print:text-slate-600 font-mono">{printQuoteData.metadata?.client_email || "contact@client.com"}</p>
                    <p className="text-[11px] text-slate-light print:text-slate-600">Scope: {printQuoteData.metadata?.project_title || "General Operations"}</p>
                  </div>
                </div>
                <div>
                  <span className="font-mono text-[9px] text-slate uppercase block print:text-slate-500">PREPARED BY</span>
                  <div className="mt-2 space-y-1">
                    <h4 className="text-sm font-bold text-paper print:text-black">SNC Estimating Dept</h4>
                    <p className="text-[11px] text-slate-light print:text-slate-600 font-mono">bids@sixnine.co.zw</p>
                    <p className="text-[11px] text-slate-light print:text-slate-600">Issued under: Imperium System</p>
                  </div>
                </div>
              </div>

              {/* Dynamic Content Switching */}
              {printType === "quotation" && (
                <div className="py-6 flex-1 space-y-6">
                  <span className="font-mono text-[10px] text-slate uppercase block">COMMERCIAL ESTIMATE SUMMARY</span>
                  <div className="border border-ink-mid/60 rounded-sm p-4 bg-ink/30 print:border-slate-200">
                    <table className="w-full text-xs font-mono print:text-black">
                      <tbody className="divide-y divide-ink-mid/40">
                        <tr className="py-2.5">
                          <td className="py-2.5 text-slate print:text-slate-500">Direct Construction Costs (BOQ subtotal)</td>
                          <td className="py-2.5 text-right text-paper print:text-black">{printQuoteData.metadata?.currency || "USD"} {Number(printQuoteData.metadata?.direct_costs || printQuoteData.quote_amount * 0.75).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                        <tr className="py-2.5">
                          <td className="py-2.5 text-slate print:text-slate-500">Site Preliminaries and Mobilisation</td>
                          <td className="py-2.5 text-right text-paper print:text-black">{printQuoteData.metadata?.currency || "USD"} {Number(printQuoteData.metadata?.preliminaries || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                        <tr className="py-2.5">
                          <td className="py-2.5 text-slate print:text-slate-500">Company Overhead Allocations ({printQuoteData.metadata?.overhead_pct || 5}%)</td>
                          <td className="py-2.5 text-right text-paper print:text-black">{printQuoteData.metadata?.currency || "USD"} {Number((printQuoteData.metadata?.direct_costs || printQuoteData.quote_amount * 0.75) * ((printQuoteData.metadata?.overhead_pct || 5) / 100)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                        <tr className="py-2.5">
                          <td className="py-2.5 text-slate print:text-slate-500">Contingency Allocation ({printQuoteData.metadata?.contingency_pct || 5}%)</td>
                          <td className="py-2.5 text-right text-paper print:text-black">{printQuoteData.metadata?.currency || "USD"} {Number((printQuoteData.metadata?.direct_costs || printQuoteData.quote_amount * 0.75) * ((printQuoteData.metadata?.contingency_pct || 5) / 100)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                        <tr className="py-2.5">
                          <td className="py-2.5 text-slate print:text-slate-500">Target Profit Margin ({printQuoteData.metadata?.profit_pct || 12}%)</td>
                          <td className="py-2.5 text-right text-green-400 print:text-black">+{printQuoteData.metadata?.currency || "USD"} {Number((printQuoteData.metadata?.direct_costs || printQuoteData.quote_amount * 0.75) * ((printQuoteData.metadata?.profit_pct || 12) / 100)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {printType === "boq" && (
                <div className="py-6 flex-1 space-y-4">
                  <span className="font-mono text-[10px] text-slate uppercase block">DETAILED BILL OF QUANTITIES (BOQ)</span>
                  <table className="w-full text-left text-xs">
                    <thead className="font-mono text-[9px] text-slate uppercase border-b border-ink-mid print:border-slate-300 print:text-slate-500">
                      <tr>
                        <th className="pb-2 w-[55%]">Work Item Description</th>
                        <th className="pb-2 text-center w-[10%]">Qty</th>
                        <th className="pb-2 w-[10%]">Unit</th>
                        <th className="pb-2 text-right w-[12%]">Rate</th>
                        <th className="pb-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-mid/30 print:divide-slate-200">
                      {Array.isArray(printQuoteData.metadata?.items) ? (
                        printQuoteData.metadata.items.map((item: any, i: number) => (
                          <tr key={i} className="py-2.5 print:text-black">
                            <td className="py-2.5 pr-3 text-paper print:text-black font-medium">{item.description}</td>
                            <td className="py-2.5 text-center font-mono">{item.qty}</td>
                            <td className="py-2.5 font-mono">{item.unit}</td>
                            <td className="py-2.5 text-right font-mono">{Number(item.rate).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="py-2.5 text-right font-mono font-semibold">{(item.qty * item.rate).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))
                      ) : (
                        <tr className="print:text-black">
                          <td className="py-2.5 text-paper print:text-black font-medium">General Construction Package</td>
                          <td className="py-2.5 text-center font-mono">1</td>
                          <td className="py-2.5 font-mono">sum</td>
                          <td className="py-2.5 text-right font-mono">{Number(printQuoteData.quote_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className="py-2.5 text-right font-mono font-semibold">{Number(printQuoteData.quote_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {printType === "schedule" && (
                <div className="py-6 flex-1 space-y-6 text-xs">
                  <span className="font-mono text-[10px] text-slate uppercase block">PROJECT TIMELINE & OUTLAY SCHEDULE</span>
                  <div className="space-y-4">
                    <div className="border border-ink-mid p-3 rounded-sm print:border-slate-300 print:text-black">
                      <h4 className="font-mono font-bold text-paper print:text-black text-xs uppercase">Weeks 1-3: Mobilisation & Excavation</h4>
                      <p className="text-slate-light print:text-slate-600 mt-1">Deploy earthmoving plant. Clear Sector A foundations and grade slab block.</p>
                      <div className="mt-2 text-[10px] text-slate font-mono">Requires: Backhoe Loader, 500 L Diesel, 3 general labourers.</div>
                    </div>
                    <div className="border border-ink-mid p-3 rounded-sm print:border-slate-300 print:text-black">
                      <h4 className="font-mono font-bold text-paper print:text-black text-xs uppercase">Weeks 4-7: Concrete Pour & Steel Tie</h4>
                      <p className="text-slate-light print:text-slate-600 mt-1">Bind reinforcing mesh and conduct continuous slab pour. Compress test blocks.</p>
                      <div className="mt-2 text-[10px] text-slate font-mono">Requires: Cement PC15 (270 bags), Volumetric batch mixer, 4 plasterers.</div>
                    </div>
                    <div className="border border-ink-mid p-3 rounded-sm print:border-slate-300 print:text-black">
                      <h4 className="font-mono font-bold text-paper print:text-black text-xs uppercase">Weeks 8-12: Masonry Brickwork Core</h4>
                      <p className="text-slate-light print:text-slate-600 mt-1">Erect external load-bearing brickwork and load roof plate anchors.</p>
                      <div className="mt-2 text-[10px] text-slate font-mono">Requires: Common Bricks (15,000 units), 2 bricklayers, 1 scaffold set.</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Total calculations block */}
              <div className="border-t border-ink-mid pt-4 flex flex-col items-end print:border-slate-300">
                <div className="w-64 space-y-1.5 text-xs font-mono print:text-black">
                  <div className="flex justify-between">
                    <span className="text-slate print:text-slate-500">SUBTOTAL:</span>
                    <span className="text-paper print:text-black">{printQuoteData.metadata?.currency || "USD"} {Number(printQuoteData.metadata?.subtotal || printQuoteData.quote_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate print:text-slate-500">VAT (15%):</span>
                    <span className="text-paper print:text-black">{printQuoteData.metadata?.currency || "USD"} {Number(printQuoteData.metadata?.vat || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between border-t border-ink-mid pt-1.5 font-bold text-sm print:border-slate-300">
                    <span className="text-signal print:text-black">GRAND TOTAL:</span>
                    <span className="text-signal print:text-black font-bold">{printQuoteData.metadata?.currency || "USD"} {Number(printQuoteData.quote_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              {/* Terms and Conditions block */}
              <div className="border-t border-ink-mid mt-8 pt-4 print:border-slate-300 print:mt-12">
                <span className="font-mono text-[9px] text-slate uppercase block print:text-slate-500">TERMS AND CONDITIONS</span>
                <p className="text-[9px] text-slate-light mt-2 print:text-slate-600 leading-relaxed whitespace-pre-line font-mono">
                  {printQuoteData.metadata?.terms || terms}
                </p>
              </div>

              {/* Footer Stamp */}
              <div className="mt-8 border-t border-ink-mid/40 pt-4 flex justify-between items-center text-[8px] font-mono text-slate print:border-slate-200 print:text-slate-400">
                <span>PROJECT BRAIN BASELINE REF: {String(printQuoteData.id || "DRAFT-PREVIEW")}</span>
                <span>AUTHENTICATED BY EXECUTIVE AUTHORITY</span>
              </div>
            </div>

            {/* Print Stylesheet Overrides */}
            <style jsx global>{`
              @media print {
                body * {
                  visibility: hidden;
                }
                #quotation-print-container, #quotation-print-container * {
                  visibility: visible;
                }
                #quotation-print-container {
                  position: absolute;
                  left: 0;
                  top: 0;
                  width: 100%;
                  border: 0 !important;
                  padding: 0 !important;
                  margin: 0 !important;
                  background: white !important;
                  color: black !important;
                }
              }
            `}</style>

          </div>
        </div>
      )}
    </div>
  );
}
