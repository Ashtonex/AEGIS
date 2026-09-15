import localFont from "next/font/local";

// Same weight files @fontsource/inter, @fontsource/archivo, and
// @fontsource/jetbrains-mono bundle (copied in, not imported from
// node_modules, so a future @fontsource version bump can't silently move
// or rename them out from under this config) - self-hosted, no remote
// fetches at build time, same offline-safe build property the @fontsource
// CSS imports this replaces were chosen for. next/font/local additionally
// preloads these and generates the CSS variable below itself (no more
// render-blocking global stylesheet imports), matching the
// --font-body/--font-display/--font-jetbrains-mono variable names
// tailwind.config.ts already expects.
export const bodyFont = localFont({
  src: [
    { path: "./inter-400.woff2", weight: "400", style: "normal" },
    { path: "./inter-500.woff2", weight: "500", style: "normal" },
    { path: "./inter-700.woff2", weight: "700", style: "normal" },
    { path: "./inter-900.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
});

export const displayFont = localFont({
  src: [
    { path: "./archivo-700.woff2", weight: "700", style: "normal" },
    { path: "./archivo-900.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

export const monoFont = localFont({
  src: [
    { path: "./jetbrains-mono-500.woff2", weight: "500", style: "normal" },
    { path: "./jetbrains-mono-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
