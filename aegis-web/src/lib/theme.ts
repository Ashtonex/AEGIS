export const THEME_PREFERENCES = ["ink", "paper", "slate", "contrast"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME: ThemePreference = "ink";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export const THEME_META_COLORS: Record<ThemePreference, string> = {
  ink: "#040810",
  paper: "#F5F5F0",
  slate: "#0E1724",
  contrast: "#000000",
};

export function applyThemeToDocument(theme: ThemePreference) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === "paper" ? "light" : "dark";
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_META_COLORS[theme]);
}
