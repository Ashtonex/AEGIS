"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMyProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  applyThemeToDocument,
  DEFAULT_THEME,
  isThemePreference,
  type ThemePreference,
} from "@/lib/theme";

type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  ready: boolean;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = "aegis.theme.preference";

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth();
  const [theme, setThemeState] = useState<ThemePreference>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(stored)) {
      setThemeState(stored);
      applyThemeToDocument(stored);
    } else {
      applyThemeToDocument(DEFAULT_THEME);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;

    async function loadServerTheme() {
      if (!session) return;
      try {
        const response = await getMyProfile();
        const serverTheme = response?.data?.theme_preference;
        if (!cancelled && isThemePreference(serverTheme)) {
          setThemeState(serverTheme);
          window.localStorage.setItem(STORAGE_KEY, serverTheme);
          applyThemeToDocument(serverTheme);
        }
      } catch {
        // Keep the locally stored or default theme.
      }
    }

    void loadServerTheme();
    return () => {
      cancelled = true;
    };
  }, [isLoading, session]);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(STORAGE_KEY, theme);
    applyThemeToDocument(theme);
  }, [theme, ready]);

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    setThemeState(nextTheme);
  }, []);

  const value = useMemo(() => ({ theme, setTheme, ready }), [theme, setTheme, ready]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return context;
}
