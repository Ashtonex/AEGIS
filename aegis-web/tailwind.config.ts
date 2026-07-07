/**
 * Tailwind Configuration — Project AEGIS DXL
 * ─────────────────────────────────────────────────────────────────────────────
 * Volume II Design Tokens encoded as named design tokens.
 * No arbitrary values in className strings — everything references a named token.
 *
 * Color Roles (never deviate from role, only swap hex if SNC brand requires):
 *   ink       → primary surfaces & dark text  (#0A1628)
 *   signal    → accent, <5% of any surface    (#C8960C)
 *   paper     → warm off-white background     (#F5F5F0)
 *   slate     → secondary text, dividers      (#4A5568)
 */
import type { Config } from "tailwindcss";

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
      colors: {
        // Public Gateway palette
        ink: {
          DEFAULT: "#0A1628",     // Primary Ink — deep navy
          light: "#152240",       // Elevated surface on ink
          mid: "#1E3A5F",         // Mid surface — borders, subtle dividers
        },
        signal: {
          DEFAULT: "#C8960C",     // Accent — bold amber. Use sparingly (<5%)
          muted: "#8B6A08",       // Muted signal for borders, ghosts
          ghost: "rgba(200,150,12,0.08)",
        },
        paper: {
          DEFAULT: "#F5F5F0",     // Warm off-white — NOT clinical white
          warm: "#EEEDE8",        // Slightly deeper for alternating surfaces
        },
        slate: {
          DEFAULT: "#4A5568",     // Muted / secondary text, dividers, captions
          light: "#718096",       // Lighter slate for tertiary elements
          dark: "#2D3748",        // Darker slate for strong borders
        },

        // Legacy aliases (keeps existing pages from breaking during migration)
        snc: {
          void: "var(--snc-void)",
          navy: {
            DEFAULT: "var(--snc-navy)",
            mid: "var(--snc-navy-mid)",
            raised: "var(--snc-navy-raised)",
            high: "var(--snc-navy-high)",
          },
          border: {
            DEFAULT: "var(--snc-border)",
            gold: "var(--snc-border-gold)",
          },
          gold: {
            DEFAULT: "var(--snc-gold-primary)",
            primary: "var(--snc-gold-primary)",
            hover: "var(--snc-gold-hover)",
            muted: "var(--snc-gold-muted)",
            ghost: "var(--snc-gold-ghost)",
          },
          text: {
            primary: "var(--snc-text-primary)",
            secondary: "var(--snc-text-secondary)",
            tertiary: "var(--snc-text-tertiary)",
            disabled: "var(--snc-text-disabled)",
          },
          electric: {
            DEFAULT: "var(--snc-electric)",
            ghost: "var(--snc-electric-ghost)",
          },
          danger: "var(--snc-danger)",
          success: "var(--snc-success)",
          warning: "var(--snc-warning)",
        },
      },

      // ── Volume II Typography ───────────────────────────────────────────────
      fontFamily: {
        // Inter for all display and body — strict, no decorative typefaces
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        display: ["var(--font-body)", "system-ui", "sans-serif"],
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

      // ── Border Radius — Razor precision, max 4px ───────────────────────────
      borderRadius: {
        none: "0px",
        sm: "4px",    // Maximum allowed — brutalist discipline
        md: "4px",
        lg: "4px",
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
    require("tailwindcss-animate"),
  ],
};

export default config;
