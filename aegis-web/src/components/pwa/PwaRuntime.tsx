"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";

type VersionPayload = {
  app_version: string;
  build_timestamp: string;
  commit_sha?: string | null;
};

function readLocalVersion(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalVersion(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures; update prompts will still work on this session.
  }
}

async function fetchVersion(): Promise<VersionPayload | null> {
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as VersionPayload;
  } catch {
    return null;
  }
}

export function PwaRuntime() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(true);
  const refreshRef = useRef<number | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    let mounted = true;
    void navigator.serviceWorker.ready.then((swRegistration) => {
      if (!mounted) return;
      setRegistration(swRegistration);
    });

    const onControllerChange = () => {
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      mounted = false;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  useEffect(() => {
    if (!registration) return;

    if (registration.waiting) {
      setUpdateAvailable(true);
    }

    const onUpdateFound = () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          setUpdateAvailable(true);
        }
      });
    };

    registration.addEventListener("updatefound", onUpdateFound);
    return () => registration.removeEventListener("updatefound", onUpdateFound);
  }, [registration]);

  useEffect(() => {
    let cancelled = false;

    const checkVersion = async () => {
      const payload = await fetchVersion();
      if (!payload || cancelled) return;

      const remoteVersion = `${payload.app_version}:${payload.build_timestamp}:${payload.commit_sha ?? ""}`;
      if (!currentVersion) {
        setCurrentVersion(remoteVersion);
        setLatestVersion(remoteVersion);
        writeLocalVersion("aegis:last-version", remoteVersion);
        return;
      }

      setLatestVersion(remoteVersion);
      if (remoteVersion !== currentVersion) {
        setUpdateAvailable(true);
      }
    };

    void checkVersion();
    refreshRef.current = window.setInterval(() => {
      void checkVersion();
      if (registration?.update) {
        void registration.update();
      }
    }, 5 * 60 * 1000);

    const onFocus = () => {
      void checkVersion();
      if (registration?.update) {
        void registration.update();
      }
    };

    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      if (refreshRef.current) {
        window.clearInterval(refreshRef.current);
        refreshRef.current = null;
      }
    };
  }, [currentVersion, registration]);

  useEffect(() => {
    const stored = readLocalVersion("aegis:last-version");
    if (stored && stored !== currentVersion) {
      setCurrentVersion(stored);
    }
  }, [currentVersion]);

  const versionLabel = useMemo(() => {
    if (!latestVersion) return "version pending";
    return latestVersion;
  }, [latestVersion]);

  const reloadNow = async () => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
  };

  if (!updateAvailable || !bannerVisible) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div className="flex w-full max-w-2xl items-center justify-between gap-4 border border-signal/30 bg-ink-light px-4 py-3 text-sm text-paper shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center border border-signal/30 bg-signal/10">
            <AlertTriangle className="h-4 w-4 text-signal" />
          </div>
          <div>
            <p className="font-medium">A newer AEGIS release is available.</p>
            <p className="text-[11px] text-slate-light">Current install: {versionLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reloadNow}
            className="inline-flex items-center gap-2 border border-signal/40 bg-signal/10 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-signal hover:bg-signal/15"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload
          </button>
          <button
            type="button"
            onClick={() => setBannerVisible(false)}
            className="inline-flex h-8 w-8 items-center justify-center border border-ink-mid text-slate-light hover:text-paper"
            aria-label="Dismiss update notice"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
