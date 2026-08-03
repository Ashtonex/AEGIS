"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    // A service worker must never run against the dev server: its
    // cache-first strategy for static assets has no expiry, and Next.js dev
    // mode occasionally serves a route chunk from a URL that stays stable
    // across restarts - once cached, the service worker serves that exact
    // stale response forever, surviving hard reloads AND full dev-server
    // restarts with a cleared .next cache. Production builds content-hash
    // every chunk filename, so this failure mode doesn't apply there.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          void registration.unregister();
        }
      });
      if ("caches" in window) {
        void caches.keys().then((keys) => {
          for (const key of keys) void caches.delete(key);
        });
      }
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // PWA registration is opportunistic; the app still works without it.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
