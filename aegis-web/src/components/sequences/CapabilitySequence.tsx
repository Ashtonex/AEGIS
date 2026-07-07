"use client";

/**
 * CapabilitySequence — Sequence 03
 * ─────────────────────────────────────────────────────────────────────────────
 * Volume III Objective: Demonstrate range without listing services like a menu.
 *
 * Emotional arc:
 *   Evidence (Paper, cold data) → CAPABILITY (Ink, dark, editorial authority)
 *   The visitor has seen the numbers. Now they see the discipline behind them.
 *   Each capability is a chapter — not a bullet point.
 *
 * Volume II Rules applied:
 *   - Surface: Ink (#0A1628) — back to dark, maximum contrast from Evidence
 *   - CSS Grid (NOT Flexbox) for all asymmetric layouts — Volume II mandate
 *   - Image alternates LEFT / RIGHT per entry — never same split twice
 *   - Large vertical cinematic image: one side
 *   - Stacked text-heavy descriptions: other side
 *   - Thin border rules separate entries — no card elevation
 *   - Hover Elevation on image: scale max 1.05, ease-in-out cubic only
 *   - No two adjacent entries share composition — alternation enforced by index
 *   - Signal: used only for reference numbers and hover state — < 5% surface
 *
 * Layout (CSS Grid, 12 columns, desktop):
 *   Even index (0, 2): Image LEFT  → col 1–5 | Text RIGHT → col 6–12
 *   Odd  index (1, 3): Text LEFT   → col 1–7  | Image RIGHT → col 8–12
 *   Mobile: always stacked, image above text
 *
 * [PLACEHOLDER] All images require replacement with real SNC site photography.
 *   /cap-civil.jpg       → real rebar/pour photography from active site
 *   /cap-plant.jpg       → real plant fleet imagery, earthmoving at scale
 *   /cap-structural.jpg  → real structural steel, weld or erection photography
 *   /cap-advisory.jpg    → real engineering review, site documentation hands
 */

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import Link from "next/link";
import {
  sequenceRevealVariants,
  sequenceFadeVariants,
  hoverElevation,
  transitions,
} from "@/lib/motion";

// ── Capability data ───────────────────────────────────────────────────────────
const CAPABILITIES = [
  {
    id: "civil",
    ref: "CAP-01",
    title: "Civil Engineering",
    subtitle: "Foundation-first infrastructure delivery.",
    description:
      "Heavy earthworks, road rehabilitation, drainage systems, and primary civil infrastructure executed with total programme discipline. From bulk excavation to final surfacing, SNC manages the complete civil scope under one contract, eliminating interface risk.",
    detail: "Active on 12 concurrent civil infrastructure programmes across Zimbabwe.",
    image: "/cap-civil.jpg",
    imageAlt: "Rebar grid before concrete pour — SNC civil engineering programme",
    href: "/capabilities#civil",
  },
  {
    id: "plant",
    ref: "CAP-02",
    title: "Plant & Logistics",
    subtitle: "Fleet ownership, not rental dependency.",
    description:
      "78+ owned and operated assets — excavators, articulated dump trucks, graders, compactors, and specialist plant — deployed through our Dreamcast division. Ownership means availability. No third-party dependency on critical path equipment.",
    detail: "Current fleet utilisation rate: 94.2% across all active deployments.",
    image: "/cap-plant.jpg",
    imageAlt: "Earthmoving excavator at dusk — Dreamcast fleet operations",
    href: "/capabilities#plant",
  },
  {
    id: "structural",
    ref: "CAP-03",
    title: "Structural Construction",
    subtitle: "Vertical integration from concrete to cladding.",
    description:
      "Commercial, industrial, and specialised architectural construction. SNC delivers the structural frame, concrete works, and envelope as an integrated package — reducing programme risk and maintaining single-point accountability from ground to roof.",
    detail: "Delivered across mining, government, commercial, and industrial sectors.",
    image: "/cap-structural.jpg",
    imageAlt: "Structural steel weld detail — SNC construction programme",
    href: "/capabilities#structural",
  },
  {
    id: "advisory",
    ref: "CAP-04",
    title: "Technical Advisory",
    subtitle: "Engineering intelligence before ground breaks.",
    description:
      "Feasibility studies, cost-engineering, risk modelling, and procurement advisory. SNC's technical team provides the analytical layer that protects clients from scope creep, procurement failure, and programme overrun — applied before the first excavation.",
    detail: "Engaged on pre-construction advisory for USD 180M+ in planned infrastructure.",
    image: "/cap-advisory.jpg",
    imageAlt: "Engineer reviewing blueprint drawings — SNC technical advisory",
    href: "/capabilities#advisory",
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────

export function CapabilitySequence() {
  const shouldReduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, {
    once: true,
    margin: "-5% 0px",
  });

  return (
    <section
      id="capability"
      ref={sectionRef}
      aria-labelledby="capability-heading"
      className="bg-ink relative"
    >
      {/* ── Section header ──────────────────────────────────────────────────── */}
      <motion.div
        className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 pt-24 pb-16 flex items-end justify-between border-b border-ink-mid"
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={0}
        variants={sequenceRevealVariants}
      >
        <div>
          <h2
            id="capability-heading"
            className="font-mono text-[11px] tracking-[0.12em] uppercase text-signal mb-4"
          >
            03 — Capability
          </h2>
          {/*
           * Volume II: Typography creates hierarchy.
           * The large heading here is deliberately restraint-sized compared to Evidence's numbers.
           * Capability is about range, not scale — the images carry the weight.
           */}
          <p className="font-black text-[clamp(32px,4vw,52px)] leading-[1.0] tracking-[-0.02em] text-paper max-w-xl">
            Four disciplines.<br />One point of accountability.
          </p>
        </div>

        {/* Sequence counter — ambient data texture */}
        <span
          className="hidden md:block font-mono text-[10px] tracking-[0.15em] uppercase text-slate/40"
          aria-hidden="true"
        >
          03 / 07
        </span>
      </motion.div>

      {/* ── Capability entries — one per row, CSS Grid, alternating layout ─── */}
      <div className="divide-y divide-ink-mid">
        {CAPABILITIES.map((cap, index) => (
          <CapabilityEntry
            key={cap.id}
            capability={cap}
            index={index}
            isInView={isInView}
            shouldReduceMotion={shouldReduceMotion ?? false}
          />
        ))}
      </div>

      {/* ── Footer rail — link to full capabilities ──────────────────────── */}
      <motion.div
        className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 py-16 border-t border-ink-mid flex items-center justify-between"
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={6}
        variants={sequenceRevealVariants}
      >
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-slate/50">
          Full technical capability specifications available on request
        </p>
        <Link
          href="/capabilities"
          className="group inline-flex items-center gap-3 font-mono text-[11px] tracking-[0.1em] uppercase text-paper border-b border-paper/20 pb-0.5 transition-all duration-fast hover:text-signal hover:border-signal"
          aria-label="View full capabilities"
        >
          All capabilities
          <svg viewBox="0 0 16 8" fill="none" className="w-4 h-4 transition-transform duration-fast group-hover:translate-x-1" aria-hidden="true">
            <path d="M0 4h14M11 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </motion.div>
    </section>
  );
}

// ── CapabilityEntry — the atomic layout unit ──────────────────────────────────
interface CapabilityEntryProps {
  capability: (typeof CAPABILITIES)[number];
  index: number;
  isInView: boolean;
  shouldReduceMotion: boolean;
}

function CapabilityEntry({
  capability,
  index,
  isInView,
  shouldReduceMotion,
}: CapabilityEntryProps) {
  // Alternation rule — enforced by index parity, never overridden
  const imageOnLeft = index % 2 === 0;

  return (
    <motion.div
      className="max-w-[1440px] mx-auto"
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      custom={index + 1}
      variants={sequenceRevealVariants}
    >
      {/*
       * CSS Grid — 12 columns, Volume II mandate
       * Even: image spans col 1–5, text spans col 6–12
       * Odd:  text spans col 1–7, image spans col 8–12
       * Mobile: single column, image stacked above text always
       */}
      <div
        className={`
          grid grid-cols-1 lg:grid-cols-12 min-h-[600px] lg:min-h-[680px]
        `}
      >
        {/* ── Image panel ──────────────────────────────────────────────────── */}
        <motion.div
          className={`
            relative overflow-hidden
            ${imageOnLeft
              ? "lg:col-span-5 lg:col-start-1 order-first"
              : "lg:col-span-4 lg:col-start-9 order-first lg:order-last"
            }
            h-[360px] lg:h-auto
          `}
          // Hover Elevation: image zoom max 1.05 — Volume II spec
          initial="rest"
          whileHover={shouldReduceMotion ? {} : "hover"}
        >
          {/* Duotone gradient overlay — unifies imagery into one world */}
          <div
            className="absolute inset-0 z-10 mix-blend-multiply"
            style={{
              background: "linear-gradient(135deg, rgba(10,22,40,0.4) 0%, transparent 60%)",
            }}
            aria-hidden="true"
          />

          {/* Image with hover zoom */}
          <motion.div
            className="absolute inset-0"
            variants={
              shouldReduceMotion
                ? {}
                : {
                    rest: hoverElevation.image.rest,
                    hover: hoverElevation.image.hover,
                  }
            }
          >
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${capability.image})` }}
              role="img"
              aria-label={capability.imageAlt}
            />
          </motion.div>

          {/* Reference number — bottom corner, engineering doc texture */}
          <div className="absolute bottom-6 left-6 z-20" aria-hidden="true">
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-paper/50">
              {capability.ref}
            </span>
          </div>
        </motion.div>

        {/* ── Text panel ───────────────────────────────────────────────────── */}
        <div
          className={`
            flex flex-col justify-center
            px-6 md:px-10 lg:px-16 py-16 lg:py-20
            ${imageOnLeft
              ? "lg:col-span-7 lg:col-start-6"
              : "lg:col-span-8 lg:col-start-1 lg:pr-24"
            }
          `}
        >
          {/* Eyebrow */}
          <motion.div
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={(index + 1) * 1.2}
            variants={sequenceFadeVariants}
          >
            <span className="dxl-eyebrow mb-6 block">
              {capability.ref}
            </span>
          </motion.div>

          {/* Capability title — dominant typographic element of this panel */}
          <motion.h3
            className="font-black text-[clamp(36px,5vw,64px)] leading-[0.95] tracking-[-0.025em] text-paper mb-4"
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={(index + 1) * 1.3}
            variants={sequenceRevealVariants}
          >
            {capability.title}
          </motion.h3>

          {/* Subtitle — signal-adjacent but in paper, slightly reduced weight */}
          <motion.p
            className="font-semibold text-[16px] text-signal mb-8 tracking-[-0.01em]"
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={(index + 1) * 1.4}
            variants={sequenceFadeVariants}
          >
            {capability.subtitle}
          </motion.p>

          {/* Separator rule */}
          <motion.div
            className="w-full h-px bg-ink-mid mb-8 origin-left"
            initial={{ scaleX: 0 }}
            animate={isInView ? { scaleX: 1 } : { scaleX: 0 }}
            transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1], delay: (index + 1) * 0.1 }}
            aria-hidden="true"
          />

          {/* Description */}
          <motion.p
            className="text-[16px] leading-[1.7] text-slate-light mb-8 max-w-[540px]"
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={(index + 1) * 1.5}
            variants={sequenceRevealVariants}
          >
            {capability.description}
          </motion.p>

          {/* Operational detail — monospace, data texture */}
          <motion.p
            className="font-mono text-[11px] tracking-[0.08em] uppercase text-slate/60 mb-10"
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={(index + 1) * 1.6}
            variants={sequenceFadeVariants}
          >
            {/* [PLACEHOLDER] Wire to Imperium API: activeProjects, fleetUtilisation */}
            {capability.detail}
          </motion.p>

          {/* Commit link — understated, no large CTA button */}
          <motion.div
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={(index + 1) * 1.7}
            variants={sequenceFadeVariants}
          >
            <Link
              href={capability.href}
              className="group inline-flex items-center gap-3 font-mono text-[11px] tracking-[0.1em] uppercase text-paper/60 border-b border-paper/10 pb-0.5 transition-all duration-fast hover:text-signal hover:border-signal"
              aria-label={`Learn more about SNC ${capability.title}`}
            >
              Capability specification
              <svg
                viewBox="0 0 16 8"
                fill="none"
                className="w-4 h-4 transition-transform duration-fast group-hover:translate-x-1"
                aria-hidden="true"
              >
                <path
                  d="M0 4h14M11 1l3 3-3 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
