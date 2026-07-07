"use client";

/**
 * InfrastructureSequence — Sequence 04
 * ─────────────────────────────────────────────────────────────────────────────
 * Volume III Objective: Proof through scale, not a portfolio grid.
 *
 * Emotional arc:
 *   Capability (Ink, editorial, structured) → INFRASTRUCTURE (Ink, kinetic, scale)
 *   The visitor has read the disciplines. Now they see the work itself.
 *   The wall of projects communicates operational breadth — more than one client
 *   could ever need from a single contractor.
 *
 * Volume II Rules applied:
 *   - Surface: Ink — sustains dark mode but with maximum visual density/energy
 *   - CSS Grid with col-span + row-span — varying tile sizes, NO uniform grid
 *   - Hover Elevation: tile overlay animates in with stats, image zooms to 1.05
 *   - Interactive surface — this sequence is the kinetic break in the reel
 *   - Signal < 5%: used only for status badge and stat values on hover overlay
 *   - No cards with borders/shadows — the image IS the tile
 *   - Stats animate in on hover (not count-up — that was Evidence's device)
 *
 * Grid layout (12 columns, 2 rows of varying height):
 * ┌──────────────────────┬──────────────┐
 * │  PRJ-01 (col 1–7)   │ PRJ-02(8–12) │  Row A: tall (480px)
 * │   HIGHWAY / LARGE   │  MINING/MED  │
 * ├────────┬─────────────┴──────────────┤
 * │ PRJ-03 │  PRJ-04 (col 5–9)         │  Row B: medium (360px)
 * │(col1-4)│  COMMERCIAL / WIDE        │
 * │ BRIDGE │                           │
 * ├────────┴─────────────┬─────────────┤
 * │                      │   PRJ-05    │
 * │  (PRJ-04 cont.)      │ EARTHWORKS  │
 * └──────────────────────┴─────────────┘
 *
 * Mobile: single column stack, all tiles equal height 280px
 *
 * [PLACEHOLDER] All project data must be wired to Imperium API.
 * Integration point: GET /api/v1/projects?featured=true&limit=5
 * [PLACEHOLDER] All images require real SNC site/drone photography.
 */

import { useState, useRef } from "react";
import { motion, useInView, AnimatePresence, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { sequenceRevealVariants, hoverElevation, transitions } from "@/lib/motion";

// ── Project data — [PLACEHOLDER] wire to Imperium API ────────────────────────
const FEATURED_PROJECTS = [
  {
    id: "SNC-015",
    title: "6400sqm Warehouse",
    client: "Mega Market",
    sector: "Industrial Infrastructure",
    status: "Completed",
    budget: "Confidential",
    duration: "14 months",
    scope: "Steel portal frame, structural envelope, and civils",
    image: "/snc_industrial_warehouse.png",
    grid: "lg:col-span-7 lg:row-span-2",
  },
  {
    id: "SNC-014",
    title: "Container Stacking Pad",
    client: "Africa University",
    sector: "Civil Infrastructure",
    status: "Completed",
    budget: "Confidential",
    duration: "8 months",
    scope: "Heavy duty concrete paving and groundworks",
    image: "/snc_civil_yard.png",
    grid: "lg:col-span-5 lg:row-span-1",
  },
  {
    id: "SNC-013",
    title: "Office Block Extension",
    client: "Mega Market",
    sector: "Commercial Construction",
    status: "Completed",
    budget: "Confidential",
    duration: "12 months",
    scope: "Multi-story concrete frame and finishing",
    image: "/snc_commercial_office.png",
    grid: "lg:col-span-5 lg:row-span-1",
  },
  {
    id: "SNC-012",
    title: "Wheat Mill Civils",
    client: "Mega Market",
    sector: "Industrial Engineering",
    status: "Completed",
    budget: "Confidential",
    duration: "10 months",
    scope: "Complex civil works for milling plant",
    image: "/proj-earthworks.jpg",
    grid: "lg:col-span-4 lg:row-span-1",
  },
  {
    id: "SNC-011",
    title: "Transport Yard",
    client: "Mega Market",
    sector: "Civil Paving",
    status: "Completed",
    budget: "Confidential",
    duration: "6 months",
    scope: "Heavy haulage surface preparation",
    image: "/proj-highway.jpg",
    grid: "lg:col-span-4 lg:row-span-1",
  },
  {
    id: "SNC-010",
    title: "Hotel Renovations",
    client: "Troutbeck Resort",
    sector: "Hospitality Renovation",
    status: "Completed",
    budget: "Confidential",
    duration: "18 months",
    scope: "Structural upgrades and luxury finishing",
    image: "/proj-commercial.jpg",
    grid: "lg:col-span-4 lg:row-span-1",
  },
  {
    id: "SNC-009",
    title: "Maize Milling Project",
    client: "Mega Market",
    sector: "Industrial Plant",
    status: "Completed",
    budget: "Confidential",
    duration: "11 months",
    scope: "Plant construction and silo foundations",
    image: "/proj-mining.jpg",
    grid: "lg:col-span-6 lg:row-span-1",
  },
  {
    id: "SNC-008",
    title: "4500sqm Warehouse",
    client: "Mega Market",
    sector: "Industrial Infrastructure",
    status: "Completed",
    budget: "Confidential",
    duration: "9 months",
    scope: "Warehouse structure and polished concrete flooring",
    image: "/snc_industrial_warehouse.png",
    grid: "lg:col-span-6 lg:row-span-1",
  },
  {
    id: "SNC-007",
    title: "Boys Hostel Block",
    client: "Hillcrest Schools",
    sector: "Institutional Buildings",
    status: "Completed",
    budget: "Confidential",
    duration: "14 months",
    scope: "Multi-level residential block construction",
    image: "/proj-commercial.jpg",
    grid: "lg:col-span-3 lg:row-span-1",
  },
  {
    id: "SNC-006",
    title: "Lower Transport Yard",
    client: "Mega Market",
    sector: "Civil Infrastructure",
    status: "Completed",
    budget: "Confidential",
    duration: "5 months",
    scope: "Logistics yard paving",
    image: "/proj-highway.jpg",
    grid: "lg:col-span-5 lg:row-span-1",
  },
  {
    id: "SNC-005",
    title: "Dining Hall Renovations",
    client: "St Charles Lwanga",
    sector: "Institutional Renovation",
    status: "Completed",
    budget: "Confidential",
    duration: "4 months",
    scope: "Refurbishment and structural repair",
    image: "/snc_commercial_office.png",
    grid: "lg:col-span-4 lg:row-span-1",
  },
  {
    id: "SNC-004",
    title: "Concrete Paving Dry Port",
    client: "GMS Dry Port",
    sector: "Civil Infrastructure",
    status: "Completed",
    budget: "Confidential",
    duration: "10 months",
    scope: "Extensive concrete paving for dry port operations",
    image: "/snc_civil_yard.png",
    grid: "lg:col-span-8 lg:row-span-1",
  },
  {
    id: "SNC-003",
    title: "Residents Units",
    client: "Eastern Highlands Trust",
    sector: "Residential Development",
    status: "Completed",
    budget: "Confidential",
    duration: "16 months",
    scope: "Turnkey residential construction",
    image: "/proj-commercial.jpg",
    grid: "lg:col-span-4 lg:row-span-1",
  },
  {
    id: "SNC-002",
    title: "Pie Shop Renovation",
    client: "Surrey Mutare Depot",
    sector: "Commercial Renovation",
    status: "Completed",
    budget: "Confidential",
    duration: "3 months",
    scope: "Retail space fit-out and refurbishment",
    image: "/snc_commercial_office.png",
    grid: "lg:col-span-5 lg:row-span-1",
  },
  {
    id: "SNC-001",
    title: "Pallet Shade",
    client: "Mega Market",
    sector: "Industrial Infrastructure",
    status: "Completed",
    budget: "Confidential",
    duration: "2 months",
    scope: "Steel shade structure",
    image: "/proj-bridge.jpg",
    grid: "lg:col-span-7 lg:row-span-1",
  }
] as const;

const STATUS_COLORS: Record<string, string> = {
  Completed: "text-[#2ECC71] border-[#2ECC71]/40 bg-[#2ECC71]/10",
  Active: "text-signal border-signal/40 bg-signal/10",
  "In Progress": "text-[#3498DB] border-[#3498DB]/40 bg-[#3498DB]/10",
};

// ─────────────────────────────────────────────────────────────────────────────

export function InfrastructureSequence() {
  const shouldReduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-5% 0px" });

  return (
    <section
      id="infrastructure"
      ref={sectionRef}
      aria-labelledby="infrastructure-heading"
      className="bg-ink relative"
    >
      {/* ── Section header ──────────────────────────────────────────────────── */}
      <motion.div
        className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 pt-24 pb-16 flex items-end justify-between"
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={0}
        variants={sequenceRevealVariants}
      >
        <div>
          <h2
            id="infrastructure-heading"
            className="font-mono text-[11px] tracking-[0.12em] uppercase text-signal mb-4"
          >
            04 — Infrastructure
          </h2>
          <p className="font-black text-[clamp(28px,4vw,48px)] leading-[1.0] tracking-[-0.02em] text-paper max-w-2xl">
            Scale measured in kilometres,<br className="hidden md:block" /> cubic metres, and months delivered.
          </p>
        </div>
        <div className="hidden lg:flex flex-col items-end gap-1">
          <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-slate/40">04 / 07</span>
          <Link
            href="/projects"
            className="group inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.1em] uppercase text-paper/50 border-b border-paper/10 pb-0.5 transition-all duration-fast hover:text-signal hover:border-signal mt-2"
          >
            Full portfolio
            <svg viewBox="0 0 16 8" fill="none" className="w-3 h-3 transition-transform duration-fast group-hover:translate-x-1" aria-hidden="true">
              <path d="M0 4h14M11 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </motion.div>

      {/* ── Project Wall — CSS Grid, varying tile sizes ──────────────────────── */}
      {/*
       * Volume II: "Edge-to-edge interactive project wall. Vary tile sizes — no uniform grid."
       * grid-rows are sized by min-height on each tile, not by fixed row tracks,
       * so the layout breathes with content and screen size.
       */}
      <div className="px-0 lg:px-0">
        {/* Desktop: asymmetric CSS Grid */}
        <div className="hidden lg:grid grid-cols-12 auto-rows-[320px] gap-px bg-ink-mid">
          {FEATURED_PROJECTS.map((project, index) => (
            <motion.div
              key={project.id}
              className={project.grid}
              initial="hidden"
              animate={isInView ? "visible" : "hidden"}
              custom={index + 1}
              variants={sequenceRevealVariants}
            >
              <ProjectTile
                project={project}
                shouldReduceMotion={shouldReduceMotion ?? false}
                priority={index === 0}
              />
            </motion.div>
          ))}
        </div>

        {/* Mobile: single column stack */}
        <div className="lg:hidden flex flex-col gap-px bg-ink-mid">
          {FEATURED_PROJECTS.map((project, index) => (
            <motion.div
              key={project.id}
              className="h-[300px]"
              initial="hidden"
              animate={isInView ? "visible" : "hidden"}
              custom={index + 1}
              variants={sequenceRevealVariants}
            >
              <ProjectTile
                project={project}
                shouldReduceMotion={shouldReduceMotion ?? false}
                priority={index === 0}
              />
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── Footer rail ─────────────────────────────────────────────────────── */}
      <motion.div
        className="max-w-[1440px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 py-16 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 border-t border-ink-mid"
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={7}
        variants={sequenceRevealVariants}
      >
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-slate/50">
          {/* [PLACEHOLDER] Wire to Imperium: totalProjects, totalContractValue */}
          184 projects completed · USD 340M+ contract value executed
        </p>
        <Link
          href="/projects"
          className="group inline-flex items-center gap-3 font-mono text-[11px] tracking-[0.1em] uppercase text-paper border-b border-paper/20 pb-0.5 transition-all duration-fast hover:text-signal hover:border-signal"
        >
          Access full project register
          <svg viewBox="0 0 16 8" fill="none" className="w-4 h-4 transition-transform duration-fast group-hover:translate-x-1" aria-hidden="true">
            <path d="M0 4h14M11 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </motion.div>
    </section>
  );
}

// ── ProjectTile — the interactive unit ────────────────────────────────────────
interface ProjectTileProps {
  project: (typeof FEATURED_PROJECTS)[number];
  shouldReduceMotion: boolean;
  priority?: boolean;
}

function ProjectTile({ project, shouldReduceMotion, priority }: ProjectTileProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      className="relative w-full h-full overflow-hidden bg-ink cursor-pointer group"
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      // Keyboard accessibility
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      tabIndex={0}
      role="article"
      aria-label={`${project.title} — ${project.sector}`}
    >
      {/* ── Background image — slow zoom on hover ──────────────────────────── */}
      <motion.div
        className="absolute inset-0"
        variants={shouldReduceMotion ? {} : {
          rest: hoverElevation.image.rest,
          hover: hoverElevation.image.hover,
        }}
        initial="rest"
        animate={isHovered && !shouldReduceMotion ? "hover" : "rest"}
      >
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${project.image})` }}
        />
      </motion.div>

      {/* ── Permanent gradient overlay — ensures project ID legible at rest ── */}
      <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/30 to-transparent z-10" />

      {/* ── Rest state — project ID and sector, bottom-left ─────────────────── */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 z-20 p-6"
        animate={{
          opacity: isHovered ? 0 : 1,
          y: isHovered ? 8 : 0,
        }}
        transition={transitions.fast}
      >
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-paper/50 block mb-1">
          {project.id}
        </span>
        <h3 className="font-bold text-[16px] leading-[1.2] text-paper tracking-[-0.01em]">
          {project.title}
        </h3>
        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-slate-light mt-1">
          {project.sector}
        </p>
      </motion.div>

      {/* ── Hover overlay — full stats reveal ────────────────────────────────── */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            className="absolute inset-0 z-30 flex flex-col justify-end"
            style={{ background: "linear-gradient(to top, rgba(10,22,40,0.97) 0%, rgba(10,22,40,0.7) 60%, transparent 100%)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transitions.fast}
          >
            <div className="p-6 md:p-8">
              {/* Status badge */}
              <div className="mb-4">
                <span
                  className={`inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 border ${STATUS_COLORS[project.status] ?? STATUS_COLORS["Completed"]}`}
                >
                  <span className="w-1 h-1 rounded-full bg-current" aria-hidden="true" />
                  {project.status}
                </span>
              </div>

              {/* Project title — larger on hover */}
              <motion.h3
                className="font-black text-[clamp(18px,2.5vw,28px)] leading-[1.1] tracking-[-0.02em] text-paper mb-2"
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ ...transitions.reveal, delay: 0.05 }}
              >
                {project.title}
              </motion.h3>

              <motion.p
                className="font-mono text-[11px] tracking-[0.08em] uppercase text-slate-light mb-6"
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ ...transitions.reveal, delay: 0.1 }}
              >
                {project.client}
              </motion.p>

              {/* Stats row — the proof layer */}
              <motion.div
                className="grid grid-cols-3 gap-4 pt-4 border-t border-paper/10"
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ ...transitions.reveal, delay: 0.15 }}
              >
                {[
                  { label: "Contract Value", value: project.budget },
                  { label: "Programme", value: project.duration },
                  { label: "Sector", value: project.sector.split(" ")[0] },
                ].map((stat) => (
                  <div key={stat.label}>
                    <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-slate/60 mb-1">
                      {stat.label}
                    </div>
                    <div className="font-bold text-[14px] leading-none text-signal tracking-[-0.01em]">
                      {stat.value}
                    </div>
                  </div>
                ))}
              </motion.div>

              {/* Scope line */}
              <motion.p
                className="font-mono text-[10px] tracking-[0.08em] text-slate/50 mt-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...transitions.reveal, delay: 0.2 }}
              >
                {project.scope}
              </motion.p>

              {/* Commit link */}
              <motion.div
                className="mt-5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...transitions.reveal, delay: 0.22 }}
              >
                <Link
                  href={`/projects/${project.id.toLowerCase()}`}
                  className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.1em] uppercase text-paper border-b border-paper/20 pb-0.5 transition-colors duration-micro hover:text-signal hover:border-signal"
                  tabIndex={isHovered ? 0 : -1}
                >
                  Project brief
                  <svg viewBox="0 0 16 8" fill="none" className="w-3 h-3" aria-hidden="true">
                    <path d="M0 4h14M11 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
