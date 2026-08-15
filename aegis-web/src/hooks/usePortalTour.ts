"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { getMyProfile, completeModuleTour } from "@/lib/api";

/**
 * A portal-specific sibling of useModuleTour. That hook gates the tour on
 * the internal DashboardShell's global tour having already fired
 * ("aegis:onboarding:tour:<userId>" / profile.onboarding_completed_at) -
 * external portal users (client/supplier/subcontractor) never render
 * DashboardShell, so that flag is never set and the tour would never open.
 * This hook drops that gate: it opens on first visit once the profile/local
 * state confirms the tour hasn't been completed yet, nothing else required.
 */
export function usePortalTour(moduleKey: string) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  const userId = session?.user?.id ?? null;
  const storageKey = userId ? `aegis:onboarding:module-tour:${moduleKey}:${userId}` : null;

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
        const localCompleted = storageKey ? Boolean(window.localStorage.getItem(storageKey)) : false;
        if (localCompleted) return;

        const response = await getMyProfile();
        const profile = response.data || {};
        const moduleTours = (profile.module_tours_completed || {}) as Record<string, unknown>;
        const completed = Boolean(moduleTours[moduleKey]);

        if (mounted && !completed) setOpen(true);
      } catch {
        const localCompleted = storageKey ? Boolean(window.localStorage.getItem(storageKey)) : false;
        if (mounted && !localCompleted) setOpen(true);
      } finally {
        if (mounted) setReady(true);
      }
    }, 700);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [session, storageKey, moduleKey]);

  return { open: open && ready, openTour, closeTour, completeTour };
}
