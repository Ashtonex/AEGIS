"use client";

/**
 * ArrivalSequence — Sequence 01
 * ─────────────────────────────────────────────────────────────────────────────
 * Volume III Objective: Institutional confidence within 4 seconds.
 *
 * Emotional arc:
 *   Second 0–1: Black. Silence. The site loads into darkness.
 *   Second 1–3: The image burns in — cinematic infrastructure, scale evident.
 *   Second 3+:  The headline locks into place, word by word. Identity declared.
 *
 * Volume II Rules applied:
 *   - Background crossfades every 6–8 seconds between two cinematic images
 *   - Typography: massive, Inter Black, tight tracking (-0.02em), locks in via
 *     Transition State (not a float, a lock)
 *   - Navigation: delayed arrival via arrivalNavVariants (300ms delay)
 *   - Scroll indicator: engineered, not decorative
 *   - Hover Elevation: N/A (no interactive cards in this sequence)
 *   - Exit: page scrolls directly into Evidence — no hard cut
 *
 * [PLACEHOLDER] Background images require real SNC site/drone photography.
 *               Current images: /arrival-01.jpg, /arrival-02.jpg (AI-generated stills)
 *               Replace with: morning mist bridge deck, crane at blue hour,
 *               rebar grids, structural steel weld detail.
 */

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import {
  arrivalVariants,
  arrivalTextVariants,
  arrivalLineVariants,
  scrollIndicatorVariants,
  transitions,
} from "@/lib/motion";

// ── Cinematic background images ───────────────────────────────────────────────
// [PLACEHOLDER] Replace with real SNC photography per Volume II library spec
const ARRIVAL_IMAGES = [
  "/arrival-01.jpg",
  "/arrival-02.jpg",
] as const;

// ── Crossfade interval — Volume II spec: 6–8 seconds ────────────────────────
const CROSSFADE_INTERVAL = 7000;

// ─────────────────────────────────────────────────────────────────────────────

export function ArrivalSequence() {
  const shouldReduceMotion = useReducedMotion();
  const [activeImage, setActiveImage] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Start crossfade cycle after initial load
  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (shouldReduceMotion) return; // No crossfade in reduced-motion mode
    intervalRef.current = setInterval(() => {
      setActiveImage((prev) => (prev + 1) % ARRIVAL_IMAGES.length);
    }, CROSSFADE_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [shouldReduceMotion]);

  return (
    <section
      id="arrival"
      aria-label="SNC arrival sequence — institutional confidence"
      className="relative min-h-[100dvh] flex flex-col justify-end overflow-hidden bg-ink"
    >
      {/* ── Cinematic Background Layer ──────────────────────────────────────── */}
      {/* Two-image crossfade — Volume II: crossfades every 6–8 seconds */}
      <div className="absolute inset-0 z-0" aria-hidden="true">
        {ARRIVAL_IMAGES.map((src, i) => (
          <motion.div
            key={src}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{
              opacity: shouldReduceMotion
                ? i === 0 ? 1 : 0
                : i === activeImage ? 1 : 0,
            }}
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { duration: 1.0, ease: [0.4, 0, 0.2, 1] }
            }
          >
            {/* Slow cinematic zoom — Volume II: image zoom max 1.05 */}
            <motion.div
              className="absolute inset-0"
              initial={{ scale: 1 }}
              animate={{ scale: shouldReduceMotion ? 1 : 1.06 }}
              transition={{
                duration: shouldReduceMotion ? 0 : 14,
                ease: [0.4, 0, 0.2, 1],
              }}
              style={{
                backgroundImage: `url(${src})`,
                backgroundSize: "cover",
                backgroundPosition: "center 40%",
              }}
            />
          </motion.div>
        ))}

        {/* ── Gradient overlays — creates depth, ensures text legibility ──── */}
        {/* Bottom-to-top — text sits here */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/70 to-transparent" />
        {/* Top overlay — navigation legibility */}
        <div className="absolute inset-0 bg-gradient-to-b from-ink/60 via-transparent to-transparent" />
        {/* Vignette edges */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(10,22,40,0.7)_100%)]" />
      </div>

      {/* ── Content — sits above the image layer ───────────────────────────── */}
      <div className="relative z-10 w-full">
        <div className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">

          {/* ── Sequence identifier — data label ─────────────────────────── */}
          <motion.div
            className="mb-8 md:mb-12"
            custom={0}
            variants={arrivalTextVariants}
            initial="hidden"
            animate={isLoaded ? "visible" : "hidden"}
          >
            <span className="dxl-eyebrow">
              {/* [PLACEHOLDER] Replace ZW–00 with SNC registration / project code */}
              SNC — ZW·00·AEGIS
            </span>
          </motion.div>

          {/* ── Signal line — enters first, establishes the vertical measure ── */}
          <motion.div
            className="w-16 h-[2px] bg-signal mb-8 origin-left"
            custom={0.1}
            variants={arrivalLineVariants}
            initial="hidden"
            animate={isLoaded ? "visible" : "hidden"}
            aria-hidden="true"
          />

          {/* ── Primary headline — locks into place ──────────────────────── */}
          {/* Volume II: 96–140px hero, tight tracking, line-height 0.95 */}
          <h1 className="font-black leading-[0.95] tracking-[-0.02em] text-paper mb-6 max-w-[1100px]">
            {/* Line 1 — arrives first */}
            <motion.span
              className="block text-[clamp(48px,7vw,96px)]"
              custom={0.3}
              variants={arrivalTextVariants}
              initial="hidden"
              animate={isLoaded ? "visible" : "hidden"}
            >
              Infrastructure
            </motion.span>
            {/* Line 2 — arrives second, slightly delayed */}
            <motion.span
              className="block text-[clamp(48px,7vw,96px)]"
              custom={0.5}
              variants={arrivalTextVariants}
              initial="hidden"
              animate={isLoaded ? "visible" : "hidden"}
            >
              Built to Last.
            </motion.span>
            {/* Accent word — signal color, appears last */}
            <motion.span
              className="block text-[clamp(48px,7vw,96px)] text-signal"
              custom={0.7}
              variants={arrivalTextVariants}
              initial="hidden"
              animate={isLoaded ? "visible" : "hidden"}
            >
              {/* Signal occupies <5% of the headline visual weight */}
              Precisely.
            </motion.span>
          </h1>

          {/* ── Body copy — operational mandate ─────────────────────────── */}
          <motion.p
            className="text-[18px] leading-[1.6] text-slate-light max-w-[560px] mb-12 font-light"
            custom={0.9}
            variants={arrivalTextVariants}
            initial="hidden"
            animate={isLoaded ? "visible" : "hidden"}
          >
            Six Nine Constructions delivers civil engineering, structural
            construction, and plant logistics at national scale — on time,
            on budget, without compromise.
          </motion.p>

          {/* ── Primary commit actions ────────────────────────────────────── */}
          <motion.div
            className="flex flex-col sm:flex-row items-start gap-4 mb-16 md:mb-24"
            custom={1.1}
            variants={arrivalTextVariants}
            initial="hidden"
            animate={isLoaded ? "visible" : "hidden"}
          >
            {/* Primary Commit */}
            <Link href="/tenders" className="group">
              <motion.button
                className="inline-flex items-center gap-3 bg-signal text-ink font-bold text-[13px] tracking-[0.08em] uppercase px-8 py-4 transition-colors duration-fast ease-dxl hover:bg-[#E8B422]"
                whileHover={shouldReduceMotion ? {} : { y: -2 }}
                transition={transitions.fast}
                aria-label="View open tender opportunities"
              >
                Tender Opportunities
                <ArrowRight className="w-4 h-4 transition-transform duration-fast group-hover:translate-x-1" />
              </motion.button>
            </Link>

            {/* Secondary Commit */}
            <Link href="/projects" className="group">
              <motion.button
                className="inline-flex items-center gap-3 border border-paper/30 text-paper font-semibold text-[13px] tracking-[0.08em] uppercase px-8 py-4 transition-all duration-fast ease-dxl hover:border-paper/70 hover:bg-paper/5"
                whileHover={shouldReduceMotion ? {} : { y: -2 }}
                transition={transitions.fast}
                aria-label="Explore SNC project portfolio"
              >
                View Portfolio
              </motion.button>
            </Link>
          </motion.div>

          {/* ── Trust indicators — ISO, certifications ───────────────────── */}
          <motion.div
            className="flex items-center gap-6 pb-12 md:pb-20 border-t border-white/10 pt-6"
            custom={1.3}
            variants={arrivalTextVariants}
            initial="hidden"
            animate={isLoaded ? "visible" : "hidden"}
          >
            {[
              "ISO 9001:2015",
              "PRAZ Category A",
              "CIFOZ Class A",
              "15+ Years",
            ].map((cert, i) => (
              <div key={cert} className="flex items-center gap-6">
                <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-slate-light">
                  {cert}
                </span>
                {i < 3 && (
                  <div
                    className="w-px h-4 bg-white/20"
                    aria-hidden="true"
                  />
                )}
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* ── Engineered Scroll Indicator — Volume II: not decorative ────────── */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2"
        initial="hidden"
        animate={isLoaded ? "visible" : "hidden"}
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { delay: 2.0, duration: 0.6, ease: [0.4, 0, 0.2, 1] } },
        }}
        aria-hidden="true"
      >
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-slate rotate-90 mb-4">
          Scroll
        </span>
        <div className="w-[1px] h-12 bg-gradient-to-b from-paper/50 to-transparent relative overflow-hidden">
          <motion.div
            className="absolute inset-x-0 top-0 h-6 bg-signal"
            animate={
              shouldReduceMotion
                ? {}
                : {
                    y: ["-100%", "200%"],
                    transition: {
                      duration: 1.6,
                      ease: [0.4, 0, 0.2, 1],
                      repeat: Infinity,
                      repeatType: "loop",
                    },
                  }
            }
          />
        </div>
      </motion.div>

      {/* ── Image counter — ambient data texture ─────────────────────────── */}
      <motion.div
        className="absolute bottom-8 right-6 md:right-10 lg:right-16 xl:right-20 z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: isLoaded ? 1 : 0 }}
        transition={{ delay: 1.8, ...transitions.slow }}
        aria-hidden="true"
      >
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-slate">
          {String(activeImage + 1).padStart(2, "0")}{" "}
          <span className="text-paper/20">/{" "}</span>
          {String(ARRIVAL_IMAGES.length).padStart(2, "0")}
        </span>
      </motion.div>
    </section>
  );
}

// ── Inline icon — keeps component self-contained ──────────────────────────────
function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
