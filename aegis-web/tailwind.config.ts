/**
 * Tailwind Configuration — Project AEGIS DXL
 * ─────────────────────────────────────────────────────────────────────────────
 * Volume II Design Tokens encoded as named design tokens.
 * No arbitrary values in className strings — everything references a named token.
 *
 * Color Roles (values live in src/styles/globals.css --dxl-* vars, themeable
 * per html[data-theme]; defaults shown below):
 *   ink       → primary surfaces & dark text  (#0A1628)
 *   signal    → accent, <5% of any surface    (#C8960C)
 *   paper     → warm off-white background     (#F5F5F0)
 *   slate     → secondary text, dividers      (#4A5568)
 */
import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // ── Container ────────────────────────────────────────────────────────────
    container: {
      center: true,
      padding: {
        DEFAULT: "1.5rem",
        md: "2.5rem",
        lg: "4rem",
        xl: "5rem",
      },
    },

    extend: {
      // ── Volume II Color Tokens ─────────────────────────────────────────────
      // Every color reads from the --dxl-* custom properties in globals.css,
      // which are re-pointed per html[data-theme] — so every class below is
      // theme-reactive automatically, with no separate legacy alias layer.
      colors: {
        ink: {
          DEFAULT: "var(--dxl-ink)",       // Primary Ink — deep navy
          light: "var(--dxl-ink-light)",   // Elevated surface on ink
          mid: "var(--dxl-ink-mid)",       // Mid surface — borders, subtle dividers
          high: "var(--dxl-ink-high)",     // Raised chip/icon-box surface
        },
        signal: {
          DEFAULT: "var(--dxl-signal)",        // Accent — bold amber. Use sparingly (<5%)
          muted: "var(--dxl-signal-muted)",    // Muted signal for borders, ghosts
          ghost: "var(--dxl-signal-ghost)",
          hover: "var(--dxl-signal-hover)",    // Brightened signal for hover states
          border: "var(--dxl-signal-border)",  // Signal-tinted border accent
        },
        paper: {
          DEFAULT: "var(--dxl-paper)",       // Warm off-white — NOT clinical white
          warm: "var(--dxl-paper-warm)",     // Slightly deeper for alternating surfaces
        },
        slate: {
          DEFAULT: "var(--dxl-slate)",       // Muted / secondary text, dividers, captions
          light: "var(--dxl-slate-light)",   // Lighter slate for tertiary elements
          dark: "var(--dxl-slate-dark)",     // Darker slate for strong borders
        },
        void: "var(--dxl-void)",             // Deepest background, below ink
        success: "var(--dxl-success)",
        warning: "var(--dxl-warning)",
        danger: "var(--dxl-danger)",
        info: {
          DEFAULT: "var(--dxl-info)",
          ghost: "var(--dxl-info-ghost)",
        },
      },

      // ── Volume II Typography ───────────────────────────────────────────────
      fontFamily: {
        // Inter for body copy
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        // Archivo for headings/display — self-hosted, has a true 900 Black weight
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        // JetBrains Mono for data labels, coords, reference numbers
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },

      fontSize: {
        // Cinematic display scale — hero titles
        "display-2xl": ["clamp(80px,10vw,140px)", { lineHeight: "0.95", letterSpacing: "-0.02em", fontWeight: "900" }],
        "display-xl":  ["clamp(64px,8vw,96px)",  { lineHeight: "0.95", letterSpacing: "-0.02em", fontWeight: "900" }],
        "display-lg":  ["clamp(48px,6vw,72px)",  { lineHeight: "1.0",  letterSpacing: "-0.02em", fontWeight: "800" }],
        "display-md":  ["clamp(40px,5vw,56px)",  { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "800" }],
        // Sequence headline scale
        "headline-xl": ["clamp(32px,4vw,48px)",  { lineHeight: "1.1",  letterSpacing: "-0.015em", fontWeight: "700" }],
        "headline-lg": ["clamp(24px,3vw,36px)",  { lineHeight: "1.2",  letterSpacing: "-0.01em",  fontWeight: "700" }],
        "headline-md": ["clamp(20px,2.5vw,28px)",{ lineHeight: "1.3",  letterSpacing: "-0.01em",  fontWeight: "600" }],
        // Body scale
        "body-xl":  ["20px", { lineHeight: "1.6", fontWeight: "400" }],
        "body-lg":  ["18px", { lineHeight: "1.6", fontWeight: "400" }],
        "body":     ["16px", { lineHeight: "1.6", fontWeight: "400" }],
        "body-sm":  ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        // Data / micro-label scale (monospace, engineering documentation feel)
        "data-label": ["12px", { lineHeight: "1", letterSpacing: "0.1em", fontWeight: "500" }],
        "data-sm":    ["11px", { lineHeight: "1", letterSpacing: "0.12em", fontWeight: "600" }],
      },

      // ── Volume II Spacing — 8px base unit ─────────────────────────────────
      spacing: {
        // Core 8pt grid values (Tailwind's defaults use 4px, we override some key sizes)
        "18": "72px",
        "22": "88px",
        "28": "112px",
        "36": "144px",
        // Named semantic spacers — per Volume II minimums
        "sequence-mobile": "64px",   // Minimum vertical breathing room on mobile
        "sequence-desk":   "128px",  // Minimum vertical breathing room on desktop
        // Legacy semantic names
        micro: "4px",
        tight: "16px",
        base: "32px",
        loose: "64px",
        vast: "128px",
      },

      // ── Max Widths ─────────────────────────────────────────────────────────
      maxWidth: {
        "container": "1440px",
        "reading":   "800px",
        "narrow":    "640px",
        "wide":      "1200px",
      },

      // ── Border Radius — disciplined scale, still no soft/pill defaults ─────
      borderRadius: {
        none: "0px",
        sm: "4px",    // Chips, badges, small icon boxes — stays crisp
        md: "8px",    // Secondary surfaces
        lg: "14px",   // Cards — enough to read as a surface, not a box
        full: "9999px",  // Only for pill-shaped status indicators
      },

      // ── CSS Grid Span Utilities ────────────────────────────────────────────
      // Asymmetrical editorial grid support — Volume II mandate
      gridColumn: {
        "span-7": "span 7 / span 7",
        "span-5": "span 5 / span 5",
        "span-8": "span 8 / span 8",
        "span-4": "span 4 / span 4",
      },
      gridRow: {
        "span-2": "span 2 / span 2",
        "span-3": "span 3 / span 3",
      },

      // ── Keyframes ─────────────────────────────────────────────────────────
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "100% 50%" },
          "100%": { backgroundPosition: "0 50%" },
        },
        "pulse-signal": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "scroll-down": {
          "0%, 100%": { transform: "translateY(0)", opacity: "1" },
          "50%": { transform: "translateY(8px)", opacity: "0.3" },
        },
      },
      animation: {
        shimmer: "shimmer 1.8s ease-in-out infinite",
        "pulse-signal": "pulse-signal 2s ease-in-out infinite",
        "scroll-down": "scroll-down 1.6s ease-in-out infinite",
      },

      // ── Transition Timing — Volume II cubic only ───────────────────────────
      transitionTimingFunction: {
        "dxl": "cubic-bezier(0.4, 0, 0.2, 1)",
        "snc": "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      },
      transitionDuration: {
        "micro": "180ms",
        "fast": "250ms",
        "reveal": "550ms",
        "slow": "750ms",
        "cinematic": "1200ms",
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
  ],
};

export default config;
