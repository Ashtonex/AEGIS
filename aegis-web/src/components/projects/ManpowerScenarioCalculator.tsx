"use client";

import React, { useState, useMemo } from "react";
import {
  Users,
  Clock,
  TrendingUp,
  AlertCircle,
  DollarSign,
  Calendar,
  Zap,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
  Sliders,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface ManpowerScenarioProps {
  initialRemainingHours?: number;
  initialBaseWorkers?: number;
  initialHourlyRate?: number;
  initialTargetDays?: number;
  projectName?: string;
  onClose?: () => void;
}

export function ManpowerScenarioCalculator({
  initialRemainingHours = 4000,
  initialBaseWorkers = 12,
  initialHourlyRate = 7.5,
  initialTargetDays = 30,
  projectName = "Active Site Project",
  onClose,
}: ManpowerScenarioProps) {
  // Inputs
  const [workloadHours, setWorkloadHours] = useState<number>(initialRemainingHours);
  const [baseWorkers, setBaseWorkers] = useState<number>(initialBaseWorkers);
  const [hourlyRate, setHourlyRate] = useState<number>(initialHourlyRate);
  const [targetDays, setTargetDays] = useState<number>(initialTargetDays);

  // Scenario A: Headcount increase
  const [addedWorkers, setAddedWorkers] = useState<number>(10);

  // Scenario B: Overtime hours per worker per day
  const [overtimeHoursPerDay, setOvertimeHoursPerDay] = useState<number>(2);

  // Scenario Calculations
  const analysis = useMemo(() => {
    const standardDailyHoursPerWorker = 8;
    const otRateMultiplier = 1.5;

    // BASELINE (Current crew, standard 8h/day)
    const baseDailyHours = baseWorkers * standardDailyHoursPerWorker;
    const baseDailyCost = baseDailyHours * hourlyRate;
    const baseDaysToComplete = baseDailyHours > 0 ? Math.ceil(workloadHours / baseDailyHours) : 0;
    const baseTotalCost = workloadHours * hourlyRate;

    // SCENARIO A: INCREASE HEADCOUNT (Added workers, 8h/day)
    const totalWorkersA = baseWorkers + addedWorkers;
    const dailyHoursA = totalWorkersA * standardDailyHoursPerWorker;
    const dailyCostA = dailyHoursA * hourlyRate;
    const daysToCompleteA = dailyHoursA > 0 ? Math.ceil(workloadHours / dailyHoursA) : 0;
    const daysSavedA = Math.max(0, baseDaysToComplete - daysToCompleteA);
    // Supervision/tool overhead estimate: +5% cost if adding > 15 workers, +10% if > 40 workers
    const overheadFactorA = addedWorkers > 40 ? 1.10 : addedWorkers > 15 ? 1.05 : 1.0;
    const totalCostA = workloadHours * hourlyRate * overheadFactorA;
    const costDeltaA = totalCostA - baseTotalCost;

    // SCENARIO B: INCREASE WORKING HOURS (Overtime @ 1.5x on existing crew)
    // Fatigue factor: 1h OT = 98% efficiency, 2h OT = 93% efficiency, 3h OT = 87%, 4h OT = 80%
    const fatigueEfficiency =
      overtimeHoursPerDay <= 1 ? 0.98 :
      overtimeHoursPerDay <= 2 ? 0.93 :
      overtimeHoursPerDay <= 3 ? 0.86 : 0.78;

    const regularHoursPerDayB = baseWorkers * standardDailyHoursPerWorker;
    const otHoursPerDayB = baseWorkers * overtimeHoursPerDay;
    const effectiveDailyHoursB = (regularHoursPerDayB + otHoursPerDayB) * fatigueEfficiency;
    const dailyCostB =
      (regularHoursPerDayB * hourlyRate) +
      (otHoursPerDayB * hourlyRate * otRateMultiplier);
    const daysToCompleteB = effectiveDailyHoursB > 0 ? Math.ceil(workloadHours / effectiveDailyHoursB) : 0;
    const daysSavedB = Math.max(0, baseDaysToComplete - daysToCompleteB);
    const totalCostB = daysToCompleteB * dailyCostB;
    const costDeltaB = totalCostB - baseTotalCost;

    // SCENARIO C: 1 PERSON TODAY VS 100 WORKERS TOMORROW STRESS TEST
    const soloDailyHours = 1 * standardDailyHoursPerWorker;
    const soloDays = Math.ceil(workloadHours / soloDailyHours);
    const soloDailyCost = soloDailyHours * hourlyRate;
    const hundredDailyHours = 100 * standardDailyHoursPerWorker;
    const hundredDays = Math.ceil(workloadHours / hundredDailyHours);
    const hundredDailyCost = hundredDailyHours * hourlyRate;

    // Recommendation logic
    let recommendation = "";
    let recommendationTone: "signal" | "emerald" | "amber" = "signal";

    if (daysToCompleteA <= targetDays && daysToCompleteB <= targetDays) {
      if (totalCostA < totalCostB) {
        recommendation = `Headcount expansion (+${addedWorkers} workers) delivers target completion ${daysSavedA} days sooner and saves ${formatCurrency(totalCostB - totalCostA)} compared to overtime fatigue premiums.`;
        recommendationTone = "emerald";
      } else {
        recommendation = `Overtime (${overtimeHoursPerDay} hrs/day) meets schedule while avoiding recruitment, site onboarding, and supervision overhead for a small team.`;
        recommendationTone = "signal";
      }
    } else if (daysToCompleteA <= targetDays) {
      recommendation = `Only Headcount Expansion (+${addedWorkers} workers) meets your ${targetDays}-day milestone target. Overtime on current crew is physically insufficient.`;
      recommendationTone = "emerald";
    } else if (daysToCompleteB <= targetDays) {
      recommendation = `Overtime schedule achieves your deadline in ${daysToCompleteB} days.`;
      recommendationTone = "signal";
    } else {
      recommendation = `Neither scenario alone meets the ${targetDays}-day deadline! A blended strategy (adding headcount + 1.5h overtime) is required to prevent liquidated damages.`;
      recommendationTone = "amber";
    }

    return {
      base: {
        dailyHours: baseDailyHours,
        dailyCost: baseDailyCost,
        daysToComplete: baseDaysToComplete,
        totalCost: baseTotalCost,
      },
      headcount: {
        totalWorkers: totalWorkersA,
        dailyHours: dailyHoursA,
        dailyCost: dailyCostA,
        daysToComplete: daysToCompleteA,
        daysSaved: daysSavedA,
        totalCost: totalCostA,
        costDelta: costDeltaA,
        overheadPct: Math.round((overheadFactorA - 1) * 100),
      },
      overtime: {
        otHours: overtimeHoursPerDay,
        effectiveDailyHours: Math.round(effectiveDailyHoursB),
        dailyCost: dailyCostB,
        daysToComplete: daysToCompleteB,
        daysSaved: daysSavedB,
        totalCost: totalCostB,
        costDelta: costDeltaB,
        fatiguePenaltyPct: Math.round((1 - fatigueEfficiency) * 100),
      },
      stressTest: {
        soloDays,
        soloDailyCost,
        hundredDays,
        hundredDailyCost,
      },
      recommendation,
      recommendationTone,
    };
  }, [workloadHours, baseWorkers, hourlyRate, targetDays, addedWorkers, overtimeHoursPerDay]);

  return (
    <div className="rounded-xl border border-ink-mid/70 bg-[#0B0E14] p-5 shadow-2xl backdrop-blur-md">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-mid/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-signal/30 bg-signal/10 text-signal">
              <Sliders className="h-4 w-4" />
            </span>
            <h3 className="text-base font-semibold text-paper">
              Manpower & Labour Sensitivity Scenario Simulator
            </h3>
          </div>
          <p className="mt-0.5 text-xs text-slate-light">
            Decide whether to increase headcount vs authorize overtime on {projectName}. Model daily cash burn and finish dates.
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded border border-ink-mid px-2.5 py-1 font-mono text-xs text-slate-light hover:text-paper"
          >
            Close
          </button>
        )}
      </div>

      {/* Control Parameters */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 border-b border-ink-mid/40 pb-4">
        <div className="rounded-lg border border-ink-mid/50 bg-ink/60 p-2.5">
          <label className="block font-mono text-[10px] uppercase text-slate">Workload (Man-Hours)</label>
          <input
            type="number"
            min={100}
            step={100}
            value={workloadHours}
            onChange={(e) => setWorkloadHours(Math.max(1, Number(e.target.value)))}
            className="mt-1 w-full bg-transparent font-mono text-sm font-semibold text-paper focus:outline-none"
          />
          <span className="text-[10px] text-slate-light">{Math.round(workloadHours / 8)} mandays</span>
        </div>

        <div className="rounded-lg border border-ink-mid/50 bg-ink/60 p-2.5">
          <label className="block font-mono text-[10px] uppercase text-slate">Current Site Crew</label>
          <input
            type="number"
            min={1}
            max={500}
            value={baseWorkers}
            onChange={(e) => setBaseWorkers(Math.max(1, Number(e.target.value)))}
            className="mt-1 w-full bg-transparent font-mono text-sm font-semibold text-paper focus:outline-none"
          />
          <span className="text-[10px] text-slate-light">Base artisans & labourers</span>
        </div>

        <div className="rounded-lg border border-ink-mid/50 bg-ink/60 p-2.5">
          <label className="block font-mono text-[10px] uppercase text-slate">Avg Cost Rate ($/hr)</label>
          <input
            type="number"
            min={1}
            step={0.5}
            value={hourlyRate}
            onChange={(e) => setHourlyRate(Math.max(0.1, Number(e.target.value)))}
            className="mt-1 w-full bg-transparent font-mono text-sm font-semibold text-paper focus:outline-none"
          />
          <span className="text-[10px] text-slate-light">{formatCurrency(hourlyRate * 8)}/man-day</span>
        </div>

        <div className="rounded-lg border border-ink-mid/50 bg-ink/60 p-2.5">
          <label className="block font-mono text-[10px] uppercase text-slate">Target Deadline (Days)</label>
          <input
            type="number"
            min={1}
            value={targetDays}
            onChange={(e) => setTargetDays(Math.max(1, Number(e.target.value)))}
            className="mt-1 w-full bg-transparent font-mono text-sm font-semibold text-paper focus:outline-none"
          />
          <span className="text-[10px] text-slate-light">Days remaining to complete</span>
        </div>
      </div>

      {/* Dynamic Sliders for Scenarios */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Scenario A Interactive Controls */}
        <div className="rounded-xl border border-sky-500/30 bg-sky-950/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sky-400 font-semibold text-xs uppercase tracking-wider">
              <Users className="h-4 w-4" /> Scenario A: Increase Headcount
            </div>
            <span className="rounded bg-sky-500/20 px-2 py-0.5 font-mono text-xs font-bold text-sky-300">
              +{addedWorkers} workers ({baseWorkers + addedWorkers} total)
            </span>
          </div>
          <div className="mt-3">
            <input
              type="range"
              min={1}
              max={100}
              value={addedWorkers}
              onChange={(e) => setAddedWorkers(Number(e.target.value))}
              className="w-full accent-sky-400 cursor-pointer"
            />
            <div className="flex justify-between font-mono text-[10px] text-slate-light mt-1">
              <span>+1 worker</span>
              <span>+25 workers</span>
              <span>+50 workers</span>
              <span>+100 workers</span>
            </div>
          </div>
        </div>

        {/* Scenario B Interactive Controls */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs uppercase tracking-wider">
              <Clock className="h-4 w-4" /> Scenario B: Increase Working Hours (Overtime @ 1.5x)
            </div>
            <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-xs font-bold text-amber-300">
              +{overtimeHoursPerDay} hrs/day ({8 + overtimeHoursPerDay}h shift)
            </span>
          </div>
          <div className="mt-3">
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.5}
              value={overtimeHoursPerDay}
              onChange={(e) => setOvertimeHoursPerDay(Number(e.target.value))}
              className="w-full accent-amber-400 cursor-pointer"
            />
            <div className="flex justify-between font-mono text-[10px] text-slate-light mt-1">
              <span>+30 min</span>
              <span>+1 hr</span>
              <span>+2 hrs</span>
              <span>+3 hrs</span>
              <span>+4 hrs (Fatigue Limit)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Side-by-Side Comparison Matrix */}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* Baseline Card */}
        <div className="rounded-xl border border-ink-mid/60 bg-ink/40 p-4">
          <div className="flex items-center justify-between border-b border-ink-mid/40 pb-2">
            <span className="font-mono text-xs uppercase tracking-wider text-slate">Status Quo (Base Crew)</span>
            <span className="rounded bg-slate-500/10 px-2 py-0.5 font-mono text-[11px] text-slate-light">
              {baseWorkers} workers · 8h
            </span>
          </div>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate">Daily Labor Burn:</span>
              <span className="font-mono font-semibold text-paper">{formatCurrency(analysis.base.dailyCost)}/day</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">Daily Output:</span>
              <span className="font-mono text-paper">{analysis.base.dailyHours} man-hours/day</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">Days to Complete:</span>
              <span className={`font-mono font-bold ${analysis.base.daysToComplete > targetDays ? "text-rose-400" : "text-emerald-400"}`}>
                {analysis.base.daysToComplete} days
              </span>
            </div>
            <div className="flex justify-between border-t border-ink-mid/30 pt-2 font-mono">
              <span className="text-slate">Total Project Labor:</span>
              <span className="font-bold text-paper">{formatCurrency(analysis.base.totalCost)}</span>
            </div>
          </div>
          {analysis.base.daysToComplete > targetDays && (
            <div className="mt-3 rounded border border-rose-500/20 bg-rose-950/20 px-2.5 py-1 text-[11px] text-rose-300">
              Late by {analysis.base.daysToComplete - targetDays} days without intervention!
            </div>
          )}
        </div>

        {/* Scenario A Card */}
        <div className="rounded-xl border border-sky-500/40 bg-sky-950/20 p-4">
          <div className="flex items-center justify-between border-b border-sky-500/20 pb-2">
            <span className="font-mono text-xs uppercase tracking-wider text-sky-400 font-semibold">
              Option A: +{addedWorkers} Workers
            </span>
            <span className="rounded bg-sky-500/20 px-2 py-0.5 font-mono text-[11px] text-sky-300">
              {analysis.headcount.totalWorkers} on site
            </span>
          </div>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate">Daily Labor Burn:</span>
              <span className="font-mono font-semibold text-paper">{formatCurrency(analysis.headcount.dailyCost)}/day</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">Daily Output:</span>
              <span className="font-mono text-paper">{analysis.headcount.dailyHours} man-hours/day</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">Days to Complete:</span>
              <span className={`font-mono font-bold ${analysis.headcount.daysToComplete <= targetDays ? "text-emerald-400" : "text-amber-400"}`}>
                {analysis.headcount.daysToComplete} days ({analysis.headcount.daysSaved} days saved)
              </span>
            </div>
            <div className="flex justify-between border-t border-sky-500/20 pt-2 font-mono">
              <span className="text-slate">Total Project Labor:</span>
              <span className="font-bold text-paper">{formatCurrency(analysis.headcount.totalCost)}</span>
            </div>
          </div>
          <div className="mt-3 rounded border border-sky-500/30 bg-sky-950/30 px-2.5 py-1 text-[11px] text-sky-200">
            {analysis.headcount.overheadPct > 0 ? `+${analysis.headcount.overheadPct}% supervision factor` : "Standard supervision headroom"}
          </div>
        </div>

        {/* Scenario B Card */}
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-4">
          <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
            <span className="font-mono text-xs uppercase tracking-wider text-amber-400 font-semibold">
              Option B: +{overtimeHoursPerDay}h Overtime
            </span>
            <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[11px] text-amber-300">
              1.5x Overtime Rate
            </span>
          </div>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate">Daily Labor Burn:</span>
              <span className="font-mono font-semibold text-paper">{formatCurrency(analysis.overtime.dailyCost)}/day</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">Effective Daily Output:</span>
              <span className="font-mono text-paper">{analysis.overtime.effectiveDailyHours} man-hours/day</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">Days to Complete:</span>
              <span className={`font-mono font-bold ${analysis.overtime.daysToComplete <= targetDays ? "text-emerald-400" : "text-amber-400"}`}>
                {analysis.overtime.daysToComplete} days ({analysis.overtime.daysSaved} days saved)
              </span>
            </div>
            <div className="flex justify-between border-t border-amber-500/20 pt-2 font-mono">
              <span className="text-slate">Total Project Labor:</span>
              <span className="font-bold text-amber-300">{formatCurrency(analysis.overtime.totalCost)}</span>
            </div>
          </div>
          <div className="mt-3 rounded border border-amber-500/30 bg-amber-950/30 px-2.5 py-1 text-[11px] text-amber-200">
            Includes {analysis.overtime.fatiguePenaltyPct}% fatigue penalty & 1.5x wage premium
          </div>
        </div>
      </div>

      {/* 1 Person Today vs 100 Workers Tomorrow Metric Banner */}
      <div className="mt-4 rounded-xl border border-ink-mid/60 bg-gradient-to-r from-ink-light/20 via-ink/50 to-ink-light/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-signal" />
            <span className="text-paper font-semibold">Scale Reality Check:</span>
            <span className="text-slate-light">
              1 operative alone takes <strong className="text-amber-300">{analysis.stressTest.soloDays} days</strong> ({formatCurrency(analysis.stressTest.soloDailyCost)}/day).
            </span>
          </div>
          <div>
            <span className="text-slate-light">
              100 operatives crush the workload in <strong className="text-emerald-300">{analysis.stressTest.hundredDays} days</strong> ({formatCurrency(analysis.stressTest.hundredDailyCost)}/day cash burn).
            </span>
          </div>
        </div>
      </div>

      {/* Executive Strategic Recommendation */}
      <div className="mt-4 rounded-xl border border-signal/40 bg-signal/10 p-4">
        <div className="flex items-start gap-3">
          <Zap className="h-5 w-5 text-signal shrink-0 mt-0.5" />
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-signal font-bold">
              Executive Decision Verdict
            </div>
            <p className="mt-1 text-sm text-paper font-medium">
              {analysis.recommendation}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
