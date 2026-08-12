"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { getMyProfile, completeModuleTour } from "@/lib/api";

/**
 * Per-module first-visit tour, gated on the global dashboard-shell tour
 * (DashboardShell's "aegis:onboarding:tour:<userId>" key) having already
 * been dealt with - a brand-new user's very first page load could otherwise
 * land straight on a module page and get the shell tour and a module tour
 * fighting over the screen at once. Once the shell tour is skipped or
 * completed, module tours become eligible to fire on first visit to each
 * module, same 700ms settle delay as the shell tour.
 */
export function useModuleTour(moduleKey: string) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  const userId = session?.user?.id ?? null;
  const storageKey = userId ? `aegis:onboarding:module-tour:${moduleKey}:${userId}` : null;
  const shellTourKey = userId ? `aegis:onboarding:tour:${userId}` : null;

  const openTour = useCallback(() => setOpen(true), []);

  const closeTour = useCallback(() => {
    setOpen(false);
    if (storageKey && typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, new Date().toISOString());
    }
  }, [storageKey]);

  const completeTour = useCallback(async () => {
    const completedAt = new Date().toISOString();
    setOpen(false);
    if (storageKey && typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, completedAt);
    }
    try {
      await completeModuleTour(moduleKey);
    } catch {
      // Local completion still prevents repeat prompts if the write fails.
    }
  }, [moduleKey, storageKey]);

  useEffect(() => {
    if (!session) {
      setOpen(false);
      setReady(false);
      return;
    }

    let mounted = true;
    const timer = window.setTimeout(async () => {
      try {
        const shellTourDone = shellTourKey ? Boolean(window.localStorage.getItem(shellTourKey)) : false;
        const localCompleted = storageKey ? Boolean(window.localStorage.getItem(storageKey)) : false;

        const response = await getMyProfile();
        const profile = response.data || {};
        const shellDoneOnProfile = Boolean(profile.onboarding_completed_at);
        const moduleTours = (profile.module_tours_completed || {}) as Record<string, unknown>;
        const completed = Boolean(moduleTours[moduleKey]);

        if (mounted && (shellTourDone || shellDoneOnProfile) && !completed && !localCompleted) {
          setOpen(true);
        }
      } catch {
        const shellTourDone = shellTourKey ? Boolean(window.localStorage.getItem(shellTourKey)) : false;
        const localCompleted = storageKey ? Boolean(window.localStorage.getItem(storageKey)) : false;
        if (mounted && shellTourDone && !localCompleted) {
          setOpen(true);
        }
      } finally {
        if (mounted) setReady(true);
      }
    }, 900);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [session, storageKey, shellTourKey, moduleKey]);

  return { open: open && ready, openTour, closeTour, completeTour };
}
