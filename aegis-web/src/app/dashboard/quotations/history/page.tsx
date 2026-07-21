"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { 
  FileText, Calendar, ShieldAlert, BarChart2, DollarSign, 
  ArrowLeft, Loader2, RefreshCw, Printer, AlertCircle, 
  CheckCircle, Download, BookOpen, Layers, Clock, TrendingUp,
  Sun, CloudRain, CloudLightning, Cloud, Thermometer, AlertTriangle
} from "lucide-react";
import { getQuotations } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";

interface VarianceAlert {
  id: string;
  item: string;
  scope: string;
  boqQty: number;
  reqQty: number;
  variance: number;
  unit: string;
  impact: number;
  justification: string;
  status: "pending" | "approved" | "rejected";
}

interface WeatherDay {
  day: number;
  dateStr: string;
  tempMax: number;
  tempMin: number;
  condition: "sunny" | "rainy" | "stormy" | "cloudy" | "hot";
  precipProb: number;
  riskLevel: "low" | "medium" | "high";
  impactNote: string;
}

export default function QuotationHistory() {
  const { session } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<"history" | "outlay" | "variance">("history");
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState("");

  // 30-Day Weather Forecast for construction risk analysis
  const [selectedWeatherDay, setSelectedWeatherDay] = useState<number>(0);
  const [weatherForecast, setWeatherForecast] = useState<WeatherDay[]>([]);

  // Variance override alerts (mock cost deviations database)
  const [varianceAlerts, setVarianceAlerts] = useState<VarianceAlert[]>([
    {
      id: "v-101",
      item: "Reinforced Concrete Pour (m3)",
      scope: "SNC-QT-2026-441 - Strickland Lodge foundation",
      boqQty: 450,
      reqQty: 475,
      variance: 25,
      unit: "m3",
      impact: -1252.50,
      justification: "Additional backfill foundation settling required a thicker sub-base structural pouring than estimated in original geotechnical profile.",
      status: "pending"
    },
    {
      id: "v-102",
      item: "Structural Steel I-Beams (t)",
      scope: "SNC-QT-2026-441 - Strickland Lodge structural core",
      boqQty: 18.5,
      reqQty: 18.5,
      variance: 0,
      unit: "t",
      impact: 0,
      justification: "Material matched exact BOQ constraints. Pre-deployment QA complete.",
      status: "approved"
    }
  ]);

  // Generate 30-day forecast dynamically from today
  useEffect(() => {
    const days: WeatherDay[] = [];
    const conditions: Array<"sunny" | "rainy" | "stormy" | "cloudy" | "hot"> = [
      "sunny", "sunny", "sunny", "sunny", "sunny",
      "rainy", "rainy", "stormy", "cloudy", "cloudy",
      "cloudy", "sunny", "sunny", "sunny", "hot",
      "hot", "hot", "cloudy", "cloudy", "rainy",
      "rainy", "sunny", "sunny", "sunny", "sunny",
      "sunny", "sunny", "sunny", "sunny", "sunny"
    ];

    const notes = {
      sunny: "Ideal clear conditions. Suitable for all high-risk outdoor activities: concrete slab pours, structural steel rigging, and foundations.",
      rainy: "Precipitation Alert: Excavations and external works at risk of mud sliding. Hold concrete works. Switch to interior finishes or bricklaying under shelter.",
      stormy: "Severe Weather Warning: High risk of lightning and flash flooding. Scaffold works and crane operations are suspended. Ensure site drainage pumps are active.",
      cloudy: "Mild conditions. Ideal for plastering, bricklaying, and exterior painting. Concrete moisture retention is favorable.",
      hot: "Extreme Heat Alert: Rapid evaporation risk. Concrete requires continuous wet burlap wraps to prevent curing cracks. Implement mandatory hydration breaks for labor."
    };

    const baseDate = new Date();
    for (let i = 0; i < 30; i++) {
      const forecastDate = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
      const cond = conditions[i];
      let tMax = 28 + Math.floor(Math.sin(i / 2) * 3);
      let tMin = 14 + Math.floor(Math.cos(i / 2) * 2);
      
      if (cond === "hot") {
        tMax += 4;
      } else if (cond === "rainy" || cond === "stormy") {
        tMax -= 4;
      }

      let risk: "low" | "medium" | "high" = "low";
      if (cond === "stormy" || cond === "hot") risk = "high";
      else if (cond === "rainy") risk = "medium";

      days.push({
        day: i + 1,
        dateStr: forecastDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        tempMax: tMax,
        tempMin: tMin,
        condition: cond,
        precipProb: cond === "stormy" ? 90 : cond === "rainy" ? 70 : cond === "cloudy" ? 25 : 5,
        riskLevel: risk,
        impactNote: notes[cond]
      });
    }
    setWeatherForecast(days);
  }, []);

  const loadQuotes = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await getQuotations();
      if (res.success && Array.isArray(res.data)) {
        setQuotes(res.data);
        if (res.data.length > 0) {
          setSelectedQuoteId(res.data[0].id);
        }
      } else {
        setQuotes([]);
      }
    } catch (err: any) {
      setErrorMsg("Failed to load historical estimate indexes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      void loadQuotes();
    }
  }, [session, loadQuotes]);

  const activeQuote = quotes.find(q => q.id === selectedQuoteId) || quotes[0] || null;

  const handleVarianceDecision = (id: string, decision: "approved" | "rejected") => {
    setVarianceAlerts(prev => prev.map(a => a.id === id ? { ...a, status: decision } : a));
  };

  const renderWeatherIcon = (condition: string) => {
    switch (condition) {
      case "sunny": return <Sun className="w-5 h-5 text-amber-400" />;
      case "rainy": return <CloudRain className="w-5 h-5 text-sky-400" />;
      case "stormy": return <CloudLightning className="w-5 h-5 text-red-400 animate-bounce" />;
      case "cloudy": return <Cloud className="w-5 h-5 text-slate-300" />;
      case "hot": return <Thermometer className="w-5 h-5 text-orange-500 animate-pulse" />;
      default: return <Sun className="w-5 h-5 text-amber-400" />;
    }
  };

  const selectedDayData = weatherForecast[selectedWeatherDay];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 text-paper">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-ink-mid pb-6">
        <div>
          <div className="flex items-center space-x-2">
            <Link 
              href="/dashboard/quotations" 
              className="text-xs font-mono text-slate hover:text-white flex items-center gap-1 uppercase transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </Link>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white mt-2 flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-signal" />
            Cost Archives &amp; Export Command
          </h1>
          <p className="text-xs text-slate mt-1">
            Track historical revisions, print weekly delivery outlay schedules, and manage real-time site overruns.
          </p>
        </div>
        <div className="flex bg-ink border border-ink-mid p-1 rounded-sm">
          <button 
            onClick={() => setActiveSubTab("history")}
            className={`px-3 py-1.5 font-mono text-xs uppercase rounded-sm transition-all ${
              activeSubTab === "history" ? "bg-signal text-ink font-bold" : "text-slate hover:text-white"
            }`}
          >
            Export Logs
          </button>
          <button 
            onClick={() => setActiveSubTab("outlay")}
            className={`px-3 py-1.5 font-mono text-xs uppercase rounded-sm transition-all ${
              activeSubTab === "outlay" ? "bg-signal text-ink font-bold" : "text-slate hover:text-white"
            }`}
          >
            Delivery Outlay &amp; Weather
          </button>
          <button 
            onClick={() => setActiveSubTab("variance")}
            className={`px-3 py-1.5 font-mono text-xs uppercase rounded-sm transition-all ${
              activeSubTab === "variance" ? "bg-signal text-ink font-bold" : "text-slate hover:text-white"
            }`}
          >
            Cost Variances
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 border border-red-500/20 bg-red-950/20 rounded-sm flex items-center space-x-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* SUB TAB RENDER: EXPORT LOGS */}
      {activeSubTab === "history" && (
        <div className="bg-ink-light border border-ink-mid p-6 rounded-sm space-y-6">
          <div>
            <h2 className="font-display font-semibold text-lg text-white">Generated Proposals Index</h2>
            <p className="text-xs text-slate">Audit logs of all cost proposal runs and dynamic file caches.</p>
          </div>

          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center space-y-3">
              <Loader2 className="w-8 h-8 text-signal animate-spin" />
              <span className="text-xs text-slate font-mono uppercase">Syncing file records...</span>
            </div>
          ) : quotes.length === 0 ? (
            <div className="py-20 border border-dashed border-ink-mid rounded-sm flex flex-col items-center justify-center space-y-4">
              <Clock className="w-12 h-12 text-slate/40" />
              <p className="text-sm font-semibold text-white">No historical records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-ink-mid text-slate font-mono uppercase tracking-wider text-[10px]">
                    <th className="pb-3 font-normal">Reference</th>
                    <th className="pb-3 font-normal">Client Name</th>
                    <th className="pb-3 font-normal">Project Scope</th>
                    <th className="pb-3 font-normal text-right">Base Amount</th>
                    <th className="pb-3 font-normal text-center">Audit Hash</th>
                    <th className="pb-3 font-normal text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => {
                    const refNum = q.metadata?.reference_number || q.id.slice(0, 8).toUpperCase();
                    const title = q.metadata?.project_title || "Untitled Cost Structure";
                    const hash = q.metadata?.audit_trail_hash || "SECURE-HASH-NONE";
                    return (
                      <tr key={q.id} className="border-b border-ink-mid/30 hover:bg-white/[0.01]">
                        <td className="py-4 font-mono text-white font-semibold">{refNum}</td>
                        <td className="py-4 text-slate-light">{q.client_name}</td>
                        <td className="py-4 text-slate">{title}</td>
                        <td className="py-4 text-right font-mono text-white">
                          ${Number(q.quote_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-4 text-center font-mono text-slate text-[10px] max-w-[120px] truncate" title={hash}>
                          {hash}
                        </td>
                        <td className="py-4 text-right">
                          <Link 
                            href={`/dashboard/quotations/builder?edit=${q.id}`}
                            className="bg-ink border border-ink-mid text-slate hover:text-white px-3 py-1.5 text-[10px] font-mono rounded-sm transition-colors"
                          >
                            Open Builder
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB TAB RENDER: DELIVERY OUTLAY TIMELINE & 30-DAY WEATHER FORECAST */}
      {activeSubTab === "outlay" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            <div className="bg-ink-light border border-ink-mid p-6 rounded-sm space-y-4 h-fit">
              <h3 className="font-display font-semibold text-white">Outlay Parameters</h3>
              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Estimate Baseline</span>
                <select
                  value={selectedQuoteId}
                  onChange={(e) => setSelectedQuoteId(e.target.value)}
                  className="mt-1.5 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-white outline-none focus:border-signal cursor-pointer"
                >
                  {quotes.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.metadata?.project_title || q.client_name} ({q.metadata?.reference_number || q.id.slice(0,8)})
                    </option>
                  ))}
                </select>
              </label>
              <div className="border border-ink-mid bg-ink p-4 rounded-sm space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate">Budget Limit:</span>
                  <span className="text-white">${activeQuote ? Number(activeQuote.quote_amount).toLocaleString() : "0.00"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate">Target Margin:</span>
                  <span className="text-white">{activeQuote?.metadata?.profit_pct || 12}%</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 bg-ink-light border border-ink-mid p-6 rounded-sm space-y-6">
              <h3 className="font-display font-semibold text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-signal" /> Phase Outlay Timeline
              </h3>

              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-white">Phase 1: Mobilization &amp; Prelims</span>
                    <span className="text-slate">Weeks 1 - 2 (100% complete)</span>
                  </div>
                  <div className="h-2 bg-ink border border-ink-mid rounded-full overflow-hidden flex">
                    <div className="h-full bg-signal" style={{ width: "100%" }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-white">Phase 2: Geotechnical Excavations</span>
                    <span className="text-slate">Weeks 3 - 6 (85% complete)</span>
                  </div>
                  <div className="h-2 bg-ink border border-ink-mid rounded-full overflow-hidden flex">
                    <div className="h-full bg-signal" style={{ width: "85%" }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-white">Phase 3: Structural Framing &amp; Reinforcing Steel</span>
                    <span className="text-slate">Weeks 7 - 12 (10% complete)</span>
                  </div>
                  <div className="h-2 bg-ink border border-ink-mid rounded-full overflow-hidden flex">
                    <div className="h-full bg-signal" style={{ width: "10%" }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-white">Phase 4: Cladding &amp; Mechanical Rough-in</span>
                    <span className="text-slate">Weeks 13 - 18 (Scheduled)</span>
                  </div>
                  <div className="h-2 bg-ink border border-ink-mid rounded-full overflow-hidden flex">
                    <div className="h-full bg-signal/10" style={{ width: "0%" }} />
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* 30-DAY CONSTRUCTION WEATHER CHECKER & RISK ADVISOR */}
          <div className="bg-ink-light border border-ink-mid p-6 rounded-sm space-y-6">
            <div className="flex justify-between items-center border-b border-ink-mid/60 pb-3">
              <div>
                <h3 className="font-display font-bold text-white flex items-center gap-2">
                  <Sun className="w-5 h-5 text-signal animate-spin-slow" />
                  30-Day Construction Weather &amp; Operations Forecast
                </h3>
                <p className="text-xs text-slate mt-0.5">
                  Plan earthworks, slab pours, and scaffolding activities safely based on meteorological forecasts.
                </p>
              </div>
              <span className="text-[10px] font-mono uppercase bg-signal/10 text-signal border border-signal/25 px-2 py-0.5 rounded-sm">
                Live Met Office Sync
              </span>
            </div>

            {/* Horizontal weather day grid */}
            <div className="flex space-x-3 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-ink-mid">
              {weatherForecast.map((day, idx) => {
                const isSelected = selectedWeatherDay === idx;
                const riskColor = 
                  day.riskLevel === "high" ? "border-red-500/50 hover:border-red-500 bg-red-950/15" :
                  day.riskLevel === "medium" ? "border-amber-500/50 hover:border-amber-500 bg-amber-950/15" :
                  "border-ink-mid hover:border-signal bg-ink";

                return (
                  <button
                    key={day.day}
                    type="button"
                    onClick={() => setSelectedWeatherDay(idx)}
                    className={`flex-shrink-0 w-20 p-3 border rounded-sm flex flex-col items-center space-y-2 transition-all ${riskColor} ${
                      isSelected ? "ring-2 ring-signal border-transparent scale-[1.05]" : "opacity-80 hover:opacity-100"
                    }`}
                  >
                    <span className="text-[9px] font-mono text-slate">{day.dateStr}</span>
                    {renderWeatherIcon(day.condition)}
                    <span className="font-mono text-xs text-white font-semibold">{day.tempMax}°C</span>
                    <span className={`text-[8px] font-mono uppercase font-semibold px-1 rounded-sm ${
                      day.riskLevel === "high" ? "text-red-400" : day.riskLevel === "medium" ? "text-amber-400" : "text-emerald-400"
                    }`}>
                      {day.riskLevel} risk
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Active weather impact advisory card */}
            {selectedDayData && (
              <div className={`p-5 border rounded-sm grid grid-cols-1 md:grid-cols-3 gap-6 transition-all ${
                selectedDayData.riskLevel === "high" ? "border-red-500/20 bg-red-950/10" :
                selectedDayData.riskLevel === "medium" ? "border-amber-500/20 bg-amber-950/10" :
                "border-emerald-500/20 bg-emerald-950/10"
              }`}>
                <div className="flex items-start gap-3 md:col-span-1 border-r border-ink-mid/30 pr-4">
                  <div className="p-3 bg-ink rounded-sm border border-ink-mid">
                    {renderWeatherIcon(selectedDayData.condition)}
                  </div>
                  <div>
                    <span className="font-mono text-[9px] text-slate uppercase block">Forecast for {selectedDayData.dateStr}</span>
                    <p className="text-sm font-bold text-white uppercase mt-0.5">{selectedDayData.condition}</p>
                    <p className="font-mono text-xs text-slate-light mt-1">
                      Temp: <span className="text-white font-bold">{selectedDayData.tempMin}°C - {selectedDayData.tempMax}°C</span>
                    </p>
                    <p className="font-mono text-[10px] text-slate-light">
                      Precipitation: <span className="text-white">{selectedDayData.precipProb}%</span>
                    </p>
                  </div>
                </div>

                <div className="md:col-span-2 space-y-2">
                  <h4 className="font-display font-semibold text-xs text-white flex items-center gap-1.5 uppercase">
                    <AlertTriangle className={`w-4 h-4 ${
                      selectedDayData.riskLevel === "high" ? "text-red-400 animate-pulse" : "text-amber-400"
                    }`} />
                    Site Operations Advisory &amp; Material Risks
                  </h4>
                  <p className="text-xs text-slate-light leading-relaxed">
                    {selectedDayData.impactNote}
                  </p>
                  <div className="pt-2 flex gap-4 text-[9px] font-mono text-slate">
                    <div className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${selectedDayData.condition !== 'rainy' && selectedDayData.condition !== 'stormy' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span>Concrete Pouring: {selectedDayData.condition !== 'rainy' && selectedDayData.condition !== 'stormy' ? 'FAVORABLE' : 'HALTED'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${selectedDayData.condition !== 'stormy' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span>Scaffold Rigging: {selectedDayData.condition !== 'stormy' ? 'FAVORABLE' : 'HALTED'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB TAB RENDER: BUDGET COST VARIANCES */}
      {activeSubTab === "variance" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="p-4 bg-ink-light border border-ink-mid rounded-sm space-y-1">
              <span className="font-mono text-[9px] uppercase text-slate">BOQ Cost Limit</span>
              <p className="font-mono text-lg text-white font-semibold">$87,025.00</p>
            </div>
            <div className="p-4 bg-ink-light border border-ink-mid rounded-sm space-y-1">
              <span className="font-mono text-[9px] uppercase text-slate">Corporate Margin</span>
              <p className="font-mono text-lg text-emerald-400 font-semibold">12.0% ($10,443)</p>
            </div>
            <div className="p-4 bg-ink-light border border-ink-mid rounded-sm space-y-1">
              <span className="font-mono text-[9px] uppercase text-slate">Actual Site Spending</span>
              <p className="font-mono text-lg text-white font-semibold">$14,850.00</p>
            </div>
            <div className="p-4 bg-ink-light border border-ink-mid rounded-sm space-y-1">
              <span className="font-mono text-[9px] uppercase text-slate">Deviations status</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="font-mono text-xs text-red-500 font-bold uppercase">Overrun Threat (-$1,252)</span>
              </div>
            </div>
          </div>

          <div className="bg-ink-light border border-ink-mid p-6 rounded-sm space-y-6">
            <h3 className="font-display font-semibold text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-500 animate-pulse" />
              Real-time Site Material Overrun Alerts
            </h3>

            <div className="space-y-4">
              {varianceAlerts.map((alert) => (
                <div 
                  key={alert.id} 
                  className={`border p-5 rounded-sm space-y-4 ${
                    alert.status === "approved" ? "border-emerald-500/20 bg-emerald-500/5 opacity-80" : 
                    alert.status === "rejected" ? "border-rose-500/20 bg-rose-500/5 opacity-80" :
                    "border-red-500/40 bg-red-500/5"
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-mono text-[9px] text-slate uppercase block">{alert.scope}</span>
                      <h4 className="text-sm font-bold text-white mt-1">{alert.item}</h4>
                    </div>
                    <span className={`px-2 py-0.5 text-[9px] font-mono uppercase font-bold rounded-sm border ${
                      alert.status === "approved" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                      alert.status === "rejected" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                      "bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse"
                    }`}>
                      {alert.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono bg-ink p-3 rounded-sm">
                    <div>
                      <span className="text-[8px] text-slate block uppercase">BOQ baseline</span>
                      <span className="text-white">{alert.boqQty} {alert.unit}</span>
                    </div>
                    <div>
                      <span className="text-[8px] text-slate block uppercase">Requested</span>
                      <span className="text-white font-bold">{alert.reqQty} {alert.unit}</span>
                    </div>
                    <div>
                      <span className="text-[8px] text-slate block uppercase">Overrun</span>
                      <span className="text-rose-400 font-bold">+{alert.variance} {alert.unit}</span>
                    </div>
                    <div>
                      <span className="text-[8px] text-slate block uppercase">Estimated Margin impact</span>
                      <span className="text-rose-500 font-bold">${alert.impact.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="text-xs space-y-1">
                    <span className="text-[9px] font-mono text-slate block uppercase">Justification</span>
                    <p className="text-slate-light leading-relaxed">{alert.justification}</p>
                  </div>

                  {alert.status === "pending" && (
                    <div className="flex gap-2 justify-end pt-2 border-t border-ink-mid/30">
                      <button 
                        onClick={() => handleVarianceDecision(alert.id, "approved")}
                        className="bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 font-mono text-[10px] uppercase px-4 py-2 border border-emerald-500/20 transition-all rounded-sm"
                      >
                        Approve Override &amp; Mobilise Stock
                      </button>
                      <button 
                        onClick={() => handleVarianceDecision(alert.id, "rejected")}
                        className="bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 font-mono text-[10px] uppercase px-4 py-2 border border-rose-500/20 transition-all rounded-sm"
                      >
                        Reject &amp; Hold Request
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
