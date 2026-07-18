"use client";

/**
 * RelationshipSequence — Sequence 07
 * ─────────────────────────────────────────────────────────────────────────────
 * Volume III Objective: Close the reel on a human note, without sentimentality.
 *
 * Emotional arc:
 *   Portal (Ink, systemic, interface) → RELATIONSHIP (Paper, bright, definitive)
 *   The loop closes. We return to the stark daylight of the Evidence sequence.
 *   No marketing fluff. No generic contact forms (corporate clients don't use them).
 *   Just direct lines of communication laid out with engineering precision.
 *
 * Volume II Rules applied:
 *   - Surface: Paper (#F5F5F0) — hard inversion back to light.
 *   - Layout: Minimalist, asymmetric grid. Extreme whitespace.
 *   - Typography: Massive typographic statement, supported by monospace data blocks.
 *   - Elements: No forms, no rounded buttons. Text links only.
 *   - Signal: Used exclusively for the final call-to-action arrow.
 */

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { sequenceRevealVariants, sequenceFadeVariants } from "@/lib/motion";
import { ArrowUpRight } from "lucide-react";

export function RelationshipSequence() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-5% 0px" });

  return (
    <section
      id="relationship"
      ref={sectionRef}
      aria-labelledby="relationship-heading"
      className="bg-paper relative py-24 md:py-32 xl:py-48"
    >
      <div className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
        
        {/* ── Sequence identifier ────────────────────────────────────────── */}
        <motion.div
          className="flex justify-between items-baseline mb-16 md:mb-24"
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          custom={0}
          variants={sequenceRevealVariants}
        >
          <h2
            id="relationship-heading"
            className="font-mono text-[11px] tracking-[0.12em] uppercase text-signal"
          >
            07 — Relationship
          </h2>
          <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-slate/40">
            End Sequence
          </span>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-8">
          
          {/* ── Left: Massive Statement ──────────────────────────────────── */}
          <motion.div
            className="lg:col-span-7 flex flex-col justify-center"
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={1}
            variants={sequenceRevealVariants}
          >
            <h3 className="font-black text-[clamp(48px,6vw,96px)] leading-[0.95] tracking-[-0.03em] text-ink mb-8">
              Built to last.<br />
              Ready to build.
            </h3>
            
            <p className="text-[18px] md:text-[22px] leading-[1.5] text-slate max-w-lg">
              Engage Six Nine Construction for national-scale infrastructure delivery, 
              structural works, and heavy plant deployment.
            </p>
          </motion.div>

          {/* ── Right: Technical Contact Coordinates ─────────────────────── */}
          <motion.div
            className="lg:col-span-4 lg:col-start-9 flex flex-col justify-center gap-12"
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            custom={2}
            variants={sequenceFadeVariants}
          >
            {/* Procurement / Tenders */}
            <div>
              <span className="dxl-eyebrow mb-4 block">Procurement & Tenders</span>
              <a 
                href="mailto:tenders@sixnine.co.zw" 
                className="group inline-flex items-center gap-3 font-mono text-[14px] md:text-[16px] text-ink transition-colors hover:text-signal"
              >
                tenders@sixnine.co.zw
                <ArrowUpRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" />
              </a>
            </div>

            {/* Corporate Operations */}
            <div>
              <span className="dxl-eyebrow mb-4 block">Corporate Operations</span>
              <a 
                href="mailto:operations@sixnine.co.zw" 
                className="group inline-flex items-center gap-3 font-mono text-[14px] md:text-[16px] text-ink transition-colors hover:text-signal"
              >
                operations@sixnine.co.zw
                <ArrowUpRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" />
              </a>
              <div className="mt-3 font-mono text-[12px] text-slate/70">
                +263 242 123 456
              </div>
            </div>

            {/* Physical Headquarters */}
            <div>
              <span className="dxl-eyebrow mb-4 block">Headquarters</span>
              <address className="not-italic font-mono text-[12px] leading-[1.6] text-slate/80 uppercase tracking-[0.05em]">
                14 Infrastructure Way<br />
                Borrowdale, Harare<br />
                Zimbabwe
              </address>
            </div>
            
          </motion.div>
        </div>

      </div>
    </section>
  );
}
