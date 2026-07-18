"use client";

/**
 * OperationsSequence — Sequence 05
 * ─────────────────────────────────────────────────────────────────────────────
 * Volume III Objective: Show the company in motion, historically and physically.
 *
 * Emotional arc:
 *   Infrastructure (dark, kinetic, image-dominant) → OPERATIONS (dark, calm, data)
 *   The visitor has seen the projects. Now they see the history behind them —
 *   a company that has been building continuously, not recently.
 *   The horizontal scroll forces the eye to move left-to-right, like reading
 *   a timeline on a site hoarding. Calm, organised, institutional memory.
 *
 * Volume II Rules applied:
 *   - Surface: #0D1117 (slightly cooler than Ink) — emotional distinction without
 *     a full palette swap; this is the "operational systems" register
 *   - Full-viewport horizontal scroll with scroll-snap — the layout device
 *   - Each year = a node on the rail; click/hover expands milestones vertically
 *   - AnimatePresence for milestone panels — no layout shift, clean exit
 *   - Timeline rail draws from left to right on scroll-into-view (single motion)
 *   - Signal: used only on active year node and milestone accent dots
 *   - No cards — milestones are pure text rows with thin rule separators
 *   - Keyboard navigable: arrow keys move between years
 *   - Mobile: same timeline, touch-scrollable, tap to expand
 *
 * [PLACEHOLDER] Milestone data must be replaced with real SNC corporate history.
 * Integration: this data could be served from a CMS or Imperium content API.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, useInView, AnimatePresence, useReducedMotion } from "framer-motion";
import { sequenceRevealVariants, sequenceFadeVariants, transitions } from "@/lib/motion";

// ── Company history data — [PLACEHOLDER] replace with real SNC milestones ────
const TIMELINE = [
  {
    year: "2019",
    headline: "Establishment",
    summary: "Six Nine Construction incorporated. First civil contract awarded.",
    milestones: [
      { ref: "M-001", label: "Incorporation", desc: "SNC registered as private company, Harare." },
      { ref: "M-002", label: "First Contract", desc: "USD 2.1M civil works contract awarded by Harare Municipality." },
      { ref: "M-003", label: "Fleet Launch", desc: "Initial fleet of 8 owned plant assets commissioned." },
    ],
  },
  {
    year: "2020",
    headline: "Mining Entry",
    summary: "First mining sector engagement. Fleet doubled. Revenue +140%.",
    milestones: [
      { ref: "M-011", label: "Zimplats Engagement", desc: "Pre-qualification approved for Zimplats contractor register." },
      { ref: "M-012", label: "Fleet Expansion", desc: "17 additional assets procured. Total fleet: 25 units." },
      { ref: "M-013", label: "Revenue Milestone", desc: "USD 8.4M contract value executed in FY2020." },
    ],
  },
  {
    year: "2021",
    headline: "Infrastructure Scale",
    summary: "First government infrastructure contract. Road sector entry.",
    milestones: [
      { ref: "M-021", label: "ZINARA Award", desc: "USD 14M road rehabilitation contract, Mashonaland East." },
      { ref: "M-022", label: "Bridge Portfolio", desc: "First bridge contract: 60m RC span, Mazowe." },
      { ref: "M-023", label: "ISO 9001", desc: "ISO 9001:2015 Quality Management System certified." },
    ],
  },
  {
    year: "2022",
    headline: "Dreamcast Division",
    summary: "Plant & Logistics arm formalised. 50+ fleet assets operational.",
    milestones: [
      { ref: "M-031", label: "Dreamcast Launch", desc: "Dedicated plant hire and logistics division formally established." },
      { ref: "M-032", label: "Fleet Milestone", desc: "50 owned assets in active deployment across 8 concurrent sites." },
      { ref: "M-033", label: "Mining Growth", desc: "Zimplats Phase IV civil infrastructure: USD 47M programme." },
    ],
  },
  {
    year: "2023",
    headline: "Digital Systems",
    summary: "Project AEGIS platform development initiated. PRAZ Category A.",
    milestones: [
      { ref: "M-041", label: "AEGIS Initiated", desc: "Proprietary ERP and project intelligence platform development begun." },
      { ref: "M-042", label: "PRAZ Category A", desc: "Highest contractor classification awarded by PRAZ." },
      { ref: "M-043", label: "Revenue Milestone", desc: "Cumulative contract value crosses USD 200M mark." },
    ],
  },
  {
    year: "2024",
    headline: "National Scale",
    summary: "Government highway programme. 78+ fleet assets. USD 320M cumulative.",
    milestones: [
      { ref: "M-051", label: "Highway Award", desc: "Harare–Beitbridge rehabilitation: USD 82M, 14.2km dual carriageway." },
      { ref: "M-052", label: "Fleet Peak", desc: "78+ owned and operated assets across all divisions." },
      { ref: "M-053", label: "Safety Record", desc: "Zero lost-time injuries maintained across all active programmes." },
    ],
  },
  {
    year: "2025",
    headline: "Current Operations",
    summary: "184 projects delivered. USD 340M+ executed. 12 concurrent sites.",
    milestones: [
      { ref: "M-061", label: "AEGIS Live", desc: "Project AEGIS platform deployed across all operational divisions." },
      { ref: "M-062", label: "Active Sites", desc: "12 concurrent construction programmes in active delivery." },
      { ref: "M-063", label: "Expansion", desc: "Regional expansion: pre-qualification in Zambia and Mozambique." },
    ],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────

export function OperationsSequence() {
  const shouldReduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-5% 0px" });
  const [activeYear, setActiveYear] = useState<string>("2025"); // Default: most recent

  // Keyboard navigation between years
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, yearIndex: number) => {
      if (e.key === "ArrowRight" && yearIndex < TIMELINE.length - 1) {
        setActiveYear(TIMELINE[yearIndex + 1].year);
      } else if (e.key === "ArrowLeft" && yearIndex > 0) {
        setActiveYear(TIMELINE[yearIndex - 1].year);
      } else if (e.key === "Enter" || e.key === " ") {
        setActiveYear(TIMELINE[yearIndex].year);
      }
    },
    []
  );

  return (
    <section
      id="operations"
      ref={sectionRef}
      aria-labelledby="operations-heading"
      // Slightly cooler surface than pure Ink — emotional distinction
      className="relative overflow-hidden"
      style={{ backgroundColor: "#0D1117" }}
    >
      {/* ── Section header ──────────────────────────────────────────────────── */}
      <motion.div
        className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 pt-24 pb-20 flex items-end justify-between"
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={0}
        variants={sequenceRevealVariants}
      >
        <div>
          <h2
            id="operations-heading"
            className="font-mono text-[11px] tracking-[0.12em] uppercase text-signal mb-4"
          >
            05 — Operations
          </h2>
          <p className="font-black text-[clamp(28px,4vw,48px)] leading-[1.0] tracking-[-0.02em] text-paper max-w-xl">
            Six years of continuous<br className="hidden md:block" /> infrastructure delivery.
          </p>
        </div>
        <div className="hidden lg:block text-right">
          <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-slate/40 block">
            05 / 07
          </span>
          <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-slate/50 mt-2 max-w-[240px] text-right leading-relaxed">
            {/* [PLACEHOLDER] Live active site count from Imperium */}
            12 active sites · 78+ assets deployed
          </p>
        </div>
      </motion.div>

      {/* ── Timeline rail — horizontal scroll ──────────────────────────────── */}
      <motion.div
        className="relative"
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={1}
        variants={sequenceRevealVariants}
      >
        {/* The rail container — horizontal scroll with snap */}
        <div
          ref={scrollRef}
          className="overflow-x-auto hide-scrollbar pb-0"
          style={{
            scrollSnapType: "x proximity",
            WebkitOverflowScrolling: "touch",
          }}
          role="tablist"
          aria-label="Company timeline — navigate years to view milestones"
        >
          <div className="flex min-w-max px-6 md:px-10 lg:px-16 xl:px-20">
            {/* Connecting rail line — draws itself on view */}
            <div className="absolute left-0 right-0 top-[28px] z-0 px-6 md:px-10 lg:px-16 xl:px-20 pointer-events-none" aria-hidden="true">
              <motion.div
                className="h-px w-full bg-ink-mid origin-left"
                initial={{ scaleX: 0 }}
                animate={isInView ? { scaleX: 1 } : { scaleX: 0 }}
                transition={{ duration: shouldReduceMotion ? 0 : 1.0, ease: [0.4, 0, 0.2, 1], delay: 0.3 }}
              />
            </div>

            {TIMELINE.map((entry, index) => (
              <YearNode
                key={entry.year}
                entry={entry}
                index={index}
                isActive={activeYear === entry.year}
                isInView={isInView}
                shouldReduceMotion={shouldReduceMotion ?? false}
                onSelect={() => setActiveYear(entry.year)}
                onKeyDown={(e) => handleKeyDown(e, index)}
              />
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Milestone panel — expands below the timeline ───────────────────── */}
      <div
        className="border-t border-ink-mid mt-0"
        role="tabpanel"
        aria-label={`Milestones for ${activeYear}`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeYear}
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={transitions.reveal}
          >
            {TIMELINE.filter((e) => e.year === activeYear).map((entry) => (
              <MilestonePanel key={entry.year} entry={entry} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <motion.div
        className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 py-16 border-t border-ink-mid flex items-center justify-between"
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={4}
        variants={sequenceRevealVariants}
      >
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-slate/50">
          Incorporated 2019 · Harare, Zimbabwe
        </p>
        <a
          href="/about"
          className="group inline-flex items-center gap-3 font-mono text-[11px] tracking-[0.1em] uppercase text-paper border-b border-paper/20 pb-0.5 transition-all duration-fast hover:text-signal hover:border-signal"
        >
          Corporate history
          <svg viewBox="0 0 16 8" fill="none" className="w-4 h-4 transition-transform duration-fast group-hover:translate-x-1" aria-hidden="true">
            <path d="M0 4h14M11 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </motion.div>
    </section>
  );
}

// ── YearNode — a node on the horizontal timeline rail ────────────────────────
interface YearNodeProps {
  entry: (typeof TIMELINE)[number];
  index: number;
  isActive: boolean;
  isInView: boolean;
  shouldReduceMotion: boolean;
  onSelect: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

function YearNode({
  entry,
  index,
  isActive,
  isInView,
  shouldReduceMotion,
  onSelect,
  onKeyDown,
}: YearNodeProps) {
  return (
    <motion.button
      className={`
        relative flex flex-col items-center pt-0 pb-8
        transition-colors duration-fast group
        focus:outline-none
        ${index === 0 ? "pr-16 md:pr-24" : "px-8 md:px-16 lg:px-20"}
      `}
      style={{ scrollSnapAlign: "start" }}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      role="tab"
      aria-selected={isActive}
      aria-label={`${entry.year}: ${entry.headline}`}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      custom={index * 0.08}
      variants={sequenceFadeVariants}
    >
      {/* Node dot — on the rail line */}
      <div className="relative z-10 mb-5 mt-[22px]">
        <motion.div
          className={`
            rounded-full transition-all duration-fast ease-dxl
            ${isActive
              ? "w-4 h-4 bg-signal shadow-[0_0_16px_rgba(200,150,12,0.5)]"
              : "w-2 h-2 bg-ink-mid border border-slate/50 group-hover:border-signal/60 group-hover:bg-signal/20"
            }
          `}
          animate={isActive ? { scale: 1 } : { scale: 1 }}
        />
        {/* Active year: vertical drop line to content */}
        {isActive && (
          <motion.div
            className="absolute top-full left-1/2 -translate-x-1/2 w-px bg-gradient-to-b from-signal to-transparent"
            initial={{ height: 0 }}
            animate={{ height: 32 }}
            transition={transitions.reveal}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Year label */}
      <span
        className={`
          font-black text-[clamp(20px,2.5vw,32px)] leading-none tracking-[-0.02em] block
          transition-colors duration-fast
          ${isActive ? "text-paper" : "text-slate/50 group-hover:text-slate-light"}
        `}
      >
        {entry.year}
      </span>

      {/* Headline — only shows on active */}
      <AnimatePresence>
        {isActive && (
          <motion.span
            className="font-mono text-[10px] tracking-[0.1em] uppercase text-signal mt-1.5 whitespace-nowrap"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={transitions.fast}
          >
            {entry.headline}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

// ── MilestonePanel — expands below the active year node ──────────────────────
interface MilestonePanelProps {
  entry: (typeof TIMELINE)[number];
}

function MilestonePanel({ entry }: MilestonePanelProps) {
  return (
    <div className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 py-12 md:py-16">
      {/* Summary headline */}
      <p className="font-semibold text-[16px] md:text-[18px] leading-[1.5] text-slate-light mb-10 max-w-xl">
        {entry.summary}
      </p>

      {/* Milestones — text rows only, thin rule separators, no cards */}
      <div className="divide-y divide-ink-mid max-w-3xl">
        {entry.milestones.map((milestone, i) => (
          <motion.div
            key={milestone.ref}
            className="py-5 grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-8 items-baseline"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1], delay: i * 0.07 }}
          >
            {/* Reference number */}
            <div className="md:col-span-2">
              <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-signal">
                {milestone.ref}
              </span>
            </div>

            {/* Label */}
            <div className="md:col-span-3">
              <span className="font-semibold text-[14px] text-paper tracking-[-0.01em]">
                {milestone.label}
              </span>
            </div>

            {/* Description */}
            <div className="md:col-span-7">
              <span className="text-[14px] leading-[1.6] text-slate">
                {milestone.desc}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
