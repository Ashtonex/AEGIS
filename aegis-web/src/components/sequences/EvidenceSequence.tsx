"use client";

/**
 * EvidenceSequence — Sequence 02
 * ─────────────────────────────────────────────────────────────────────────────
 * Volume III Objective: Prove the confidence was earned.
 *
 * Emotional arc:
 *   Arrival (dark, cinematic) → EVIDENCE (light, stark, archival data)
 *   The contrast is deliberate. Walking out of the cinema into daylight.
 *   The numbers are the design. Restraint is the aesthetic.
 *
 * Volume II Rules applied:
 *   - NO CARDS. Numbers and thin dividing lines only.
 *   - Surface: Paper (#F5F5F0) — maximum contrast shift from Arrival
 *   - Statistics count up EXACTLY ONCE when first scrolled into view
 *   - Data labels: monospace, uppercase, signal-coloured — engineering doc feel
 *   - Asymmetric grid: large stat left, supporting context right
 *   - Two competing visual weights max per viewport (number + label only)
 *   - No more than two adjacent stats share the same typographic weight
 *   - Exit: horizontal rule leads into Capability's dark surface below
 *
 * Layout architecture (CSS Grid, not Flexbox per Volume II mandate):
 *   Desktop: 12-column grid. Stat number spans col 1–7, context spans col 8–12
 *   Mobile: single column, stat stacked above context
 */

import { useRef, useState, useEffect } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { sequenceRevealVariants, sequenceFadeVariants, transitions } from "@/lib/motion";

// ── Evidence data — [PLACEHOLDER] wire to Imperium API when available ─────────
// Integration point: GET /api/v1/metrics/public-summary
// Returns: { projectsCompleted, fleetAssets, contractValue, ltiFrequency, yearsActive, regionsActive }
const EVIDENCE_STATS = [
  {
    id: "projects",
    value: 184,
    suffix: "",
    prefix: "",
    label: "Projects Delivered",
    descriptor: "Civil engineering, structural construction, and earthmoving contracts completed across Zimbabwe since incorporation.",
    // [PLACEHOLDER] Replace with Imperium API: projectsCompleted
  },
  {
    id: "fleet",
    value: 78,
    suffix: "+",
    prefix: "",
    label: "Fleet Assets Deployed",
    descriptor: "Owned and operated machinery including excavators, graders, articulated trucks, and specialist plant — all in active deployment.",
    // [PLACEHOLDER] Replace with Imperium API: fleetAssets
  },
  {
    id: "value",
    value: 340,
    suffix: "M",
    prefix: "USD ",
    label: "Contract Value Executed",
    descriptor: "Cumulative value of executed contracts across mining infrastructure, road rehabilitation, and commercial construction sectors.",
    // [PLACEHOLDER] Replace with Imperium API: contractValue
  },
  {
    id: "safety",
    value: 0,
    suffix: "",
    prefix: "",
    label: "Lost Time Injuries",
    descriptor: "Zero lost-time injuries recorded across all active project sites. Safety is a system, not a slogan.",
    // [PLACEHOLDER] Replace with Imperium API: ltiFrequency
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────

export function EvidenceSequence() {
  const shouldReduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, {
    once: true,      // Count up exactly once — Volume II mandate
    margin: "-10% 0px",
  });

  return (
    <section
      id="evidence"
      ref={sectionRef}
      aria-labelledby="evidence-heading"
      // Paper surface — maximum contrast from the dark Arrival sequence
      className="bg-paper relative overflow-hidden"
    >
      {/* ── Sequence identifier — top-left ───────────────────────────────── */}
      <motion.div
        className="absolute top-16 right-6 md:right-10 lg:right-16 xl:right-20"
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={0}
        variants={sequenceFadeVariants}
        aria-hidden="true"
      >
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-slate/40">
          02 / Evidence
        </span>
      </motion.div>

      {/* ── Section header ─────────────────────────────────────────────────── */}
      <div className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 pt-24 pb-12 border-b border-slate/10">
        <motion.div
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          custom={0}
          variants={sequenceRevealVariants}
        >
          {/* Invisible h2 for SEO/accessibility — design hierarchy handled by numbers */}
          <h2
            id="evidence-heading"
            className="font-mono text-[11px] tracking-[0.12em] uppercase text-signal mb-0"
          >
            Evidence of Capability
          </h2>
        </motion.div>
      </div>

      {/* ── Stats — each on its own row, separated by hairline rules ─────── */}
      <div className="max-w-[1440px] mx-auto">
        {EVIDENCE_STATS.map((stat, index) => (
          <StatRow
            key={stat.id}
            stat={stat}
            index={index}
            isInView={isInView}
            shouldReduceMotion={shouldReduceMotion ?? false}
            isLast={index === EVIDENCE_STATS.length - 1}
          />
        ))}
      </div>

      {/* ── Bottom context line ───────────────────────────────────────────── */}
      <motion.div
        className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 py-16 flex flex-col md:flex-row items-start md:items-center justify-between gap-6"
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={5}
        variants={sequenceRevealVariants}
      >
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-slate/60 max-w-md">
          {/* [PLACEHOLDER] Wire to Imperium API: latestMilestone */}
          Latest milestone: Zimplats Phase IV access road, 14.2km, completed ahead of schedule — Q2 2026
        </p>
        <a
          href="/projects"
          className="group inline-flex items-center gap-3 font-mono text-[11px] tracking-[0.1em] uppercase text-ink border-b border-ink/30 pb-0.5 transition-colors duration-fast hover:text-signal hover:border-signal"
          aria-label="View full project portfolio"
        >
          Full portfolio
          <svg viewBox="0 0 16 8" fill="none" className="w-4 h-4 transition-transform duration-fast group-hover:translate-x-1" aria-hidden="true">
            <path d="M0 4h14M11 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </motion.div>
    </section>
  );
}

// ── StatRow — the atomic unit of this sequence ────────────────────────────────
interface StatRowProps {
  stat: (typeof EVIDENCE_STATS)[number];
  index: number;
  isInView: boolean;
  shouldReduceMotion: boolean;
  isLast: boolean;
}

function StatRow({ stat, index, isInView, shouldReduceMotion, isLast }: StatRowProps) {
  return (
    <motion.div
      className={`
        grid grid-cols-1 lg:grid-cols-12 gap-0
        px-6 md:px-10 lg:px-16 xl:px-20
        py-12 lg:py-16
        ${!isLast ? "border-b border-slate/10" : ""}
        group cursor-default
      `}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      custom={index + 1}
      variants={sequenceRevealVariants}
    >
      {/* ── Left: The Number (col-span 7) ──────────────────────────────────── */}
      {/*
       * CSS Grid asymmetric layout — Volume II mandate
       * Number occupies 7/12 columns on desktop
       * The number IS the design. Nothing competes with it.
       */}
      <div className="lg:col-span-7 flex flex-col gap-2 mb-8 lg:mb-0">

        {/* Data label — monospace, engineering doc feel */}
        <span
          className="font-mono text-[11px] tracking-[0.12em] uppercase text-signal block mb-4"
          aria-hidden="true"
        >
          {/* Sequence index — like an engineering drawing reference */}
          {String(index + 1).padStart(2, "0")} — {stat.label}
        </span>

        {/* The massive number — the dominant focal point */}
        <div
          className="font-black leading-[0.88] tracking-[-0.04em] text-ink flex items-baseline gap-3"
          style={{ fontSize: "clamp(72px, 12vw, 160px)" }}
          aria-label={`${stat.prefix}${stat.value}${stat.suffix}`}
        >
          {stat.prefix && (
            <span
              className="font-light tracking-[-0.02em] text-slate"
              style={{ fontSize: "clamp(24px, 4vw, 48px)" }}
            >
              {stat.prefix}
            </span>
          )}

          {/* Animated counter — counts up once on scroll ───────────────────── */}
          <CountUp
            target={stat.value}
            shouldAnimate={isInView}
            shouldReduceMotion={shouldReduceMotion}
          />

          {stat.suffix && (
            <span
              className="font-black text-signal"
              style={{ fontSize: "clamp(36px, 6vw, 80px)" }}
            >
              {stat.suffix}
            </span>
          )}
        </div>
      </div>

      {/* ── Right: Context (col-span 5) ────────────────────────────────────── */}
      {/*
       * Supporting element — lower visual weight than the number
       * One area of intentional silence (empty space above descriptor)
       */}
      <div className="lg:col-span-5 lg:flex lg:flex-col lg:justify-end lg:pb-4 lg:pl-16 lg:border-l lg:border-slate/10">
        <p className="text-[16px] leading-[1.65] text-slate max-w-[400px]">
          {stat.descriptor}
        </p>

        {/* Micro-signal — thin line below, reinforces engineering rigour */}
        <div
          className="w-8 h-[1px] bg-signal mt-6 origin-left transition-transform duration-reveal"
          style={{ transform: isInView ? "scaleX(1)" : "scaleX(0)" }}
          aria-hidden="true"
        />
      </div>
    </motion.div>
  );
}

// ── CountUp — animates the number from 0 to target, exactly once ─────────────
interface CountUpProps {
  target: number;
  shouldAnimate: boolean;
  shouldReduceMotion: boolean;
}

function CountUp({ target, shouldAnimate, shouldReduceMotion }: CountUpProps) {
  const [displayed, setDisplayed] = useState(shouldReduceMotion ? target : 0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    // Volume II mandate: count up exactly once, never re-trigger
    if (!shouldAnimate || hasAnimated.current) return;
    if (shouldReduceMotion) {
      setDisplayed(target);
      hasAnimated.current = true;
      return;
    }

    hasAnimated.current = true;

    const DURATION = 2000; // 2 seconds — data credibility
    const startTime = performance.now();

    // Ease-out curve — decelerates toward the final number
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / DURATION, 1);
      const easedProgress = easeOut(progress);
      setDisplayed(Math.round(easedProgress * target));

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        setDisplayed(target); // Guarantee exact final value
      }
    };

    requestAnimationFrame(tick);
  }, [shouldAnimate, target, shouldReduceMotion]);

  return <span aria-hidden="true">{displayed.toLocaleString()}</span>;
}
