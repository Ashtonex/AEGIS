/**
 * DXL Motion Utility — Volume II Spec
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the SINGLE SOURCE OF TRUTH for all motion in the AEGIS DXL gateway.
 * No component may define transition values inline. Every Sequence consumes
 * the variants exported from this file.
 *
 * Volume II Motion Rules:
 * - Curves: ease-in-out cubic ONLY. No spring, no bounce, no elastic.
 * - Micro-interactions: 180–300ms
 * - Sequence reveals: 500–800ms
 * - Hover Elevation: cards lift exactly 4px; images zoom max 1.05
 * - Respect prefers-reduced-motion: substitute simple fades
 */

import type { Variants } from "framer-motion";

// ─── Core Easing Curve ────────────────────────────────────────────────────────
// The singular cubic-bezier used across the entire system
export const DXL_EASE = [0.4, 0, 0.2, 1] as const;

// ─── Duration Constants ────────────────────────────────────────────────────────
export const DURATION = {
  micro: 0.18,       // 180ms — micro-interactions (focus, state changes)
  fast: 0.25,        // 250ms — button commits, nav items
  reveal: 0.55,      // 550ms — sequence element reveals
  slow: 0.75,        // 750ms — sequence-level entrances
  cinematic: 1.2,    // 1200ms — full-screen cinematic transitions
  crossfade: 1.0,    // 1000ms — background image crossfades
} as const;

// ─── Shared Transition Presets ─────────────────────────────────────────────────
export const transitions = {
  micro: { duration: DURATION.micro, ease: DXL_EASE },
  fast: { duration: DURATION.fast, ease: DXL_EASE },
  reveal: { duration: DURATION.reveal, ease: DXL_EASE },
  slow: { duration: DURATION.slow, ease: DXL_EASE },
  cinematic: { duration: DURATION.cinematic, ease: DXL_EASE },
} as const;

// ─── Arrival Sequence Variants ─────────────────────────────────────────────────
// Used by <ArrivalSequence /> — the first impression
export const arrivalVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DURATION.cinematic, ease: DXL_EASE },
  },
};

export const arrivalTextVariants: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: (custom: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATION.slow,
      ease: DXL_EASE,
      delay: custom,
    },
  }),
};

export const arrivalLineVariants: Variants = {
  hidden: { scaleX: 0 },
  visible: (custom: number = 0) => ({
    scaleX: 1,
    transition: {
      duration: DURATION.reveal,
      ease: DXL_EASE,
      delay: custom,
    },
  }),
};

export const arrivalNavVariants: Variants = {
  hidden: { opacity: 0, y: -16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.fast, ease: DXL_EASE, delay: 0.3 },
  },
};

// ─── Sequence Reveal Variants (used by all sequences below fold) ───────────────
export const sequenceRevealVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (custom: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATION.reveal,
      ease: DXL_EASE,
      delay: custom * 0.12,
    },
  }),
};

export const sequenceFadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: (custom: number = 0) => ({
    opacity: 1,
    transition: {
      duration: DURATION.reveal,
      ease: DXL_EASE,
      delay: custom * 0.1,
    },
  }),
};

// ─── Hover Elevation Variants ─────────────────────────────────────────────────
// Cards lift exactly 4px. Images zoom max 1.05. No exceptions.
export const hoverElevation = {
  card: {
    rest: { y: 0, transition: transitions.fast },
    // translateY(-4px) — the exact spec from Volume II
    hover: { y: -4, transition: transitions.fast },
  },
  image: {
    rest: { scale: 1, transition: { duration: DURATION.slow, ease: DXL_EASE } },
    hover: { scale: 1.05, transition: { duration: DURATION.slow, ease: DXL_EASE } },
  },
};

// ─── Counter Animation ─────────────────────────────────────────────────────────
// Statistics count up exactly once when scrolled into view — never re-trigger.
export const counterConfig = {
  duration: 2.0,  // 2s count-up for data credibility
  ease: DXL_EASE,
};

// ─── Stagger Container Config ─────────────────────────────────────────────────
export const staggerContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

// ─── Navigation Scroll Variants ────────────────────────────────────────────────
// Nav shrinks and blurs on scroll — Volume II spec
export const navScrollConfig = {
  scrolled: {
    padding: "0.75rem 0",
    backdropFilter: "blur(12px)",
    backgroundColor: "rgba(10, 22, 40, 0.92)",
  },
  top: {
    padding: "1.5rem 0",
    backdropFilter: "blur(0px)",
    backgroundColor: "rgba(10, 22, 40, 0)",
  },
};

// ─── Scroll Indicator Variants ─────────────────────────────────────────────────
export const scrollIndicatorVariants: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: {
    opacity: [0, 1, 0],
    y: [0, 8, 0],
    transition: {
      duration: 1.6,
      ease: DXL_EASE,
      repeat: Infinity,
      repeatType: "loop",
    },
  },
};

// ─── Reduced Motion Fallback ───────────────────────────────────────────────────
// When prefers-reduced-motion is active, replace all transitions with simple fades
export const reducedMotionVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.01 } },
};
