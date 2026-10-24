"use client";

import { useEffect, useState } from "react";
import { BellRing, CheckCircle2, ShieldAlert, X } from "lucide-react";
import { getPwaConfig, savePushSubscription, sendPushTestNotification } from "@/lib/api";

function toUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

const DISMISSAL_KEY = "aegis:notifications-dismissed-at";
const DISMISSAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function PwaNotificationPrompt() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check support
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }

    // If already granted, no need for the onboarding banner
    if (Notification.permission === "granted") {
      return;
    }

    // If previously denied, do not spam prompts (respect user browser choice)
    if (Notification.permission === "denied") {
      return;
    }

    // If recently dismissed, honor the cooldown
    try {
      const dismissed = window.localStorage.getItem(DISMISSAL_KEY);
      if (dismissed && Date.now() - Number(dismissed) < DISMISSAL_WINDOW_MS) {
        return;
      }
    } catch {
      // Ignore storage errors
    }

    // Display banner after a short delay so the dashboard loads cleanly first
    const timer = setTimeout(() => {
      setVisible(true);
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISSAL_KEY, String(Date.now()));
    } catch {
      // Ignore
    }
  };

  const handleEnable = async () => {
    setLoading(true);
    setStatusMessage(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatusMessage("Notification permission was not granted.");
        setTimeout(() => setVisible(false), 3000);
        return;
      }

      // If in production with serviceWorker, configure Web Push
      if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
        const { data: config } = await getPwaConfig();
        if (config?.push_enabled && config.vapid_public_key) {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: toUint8Array(config.vapid_public_key) as BufferSource,
          });

          await savePushSubscription(subscription.toJSON() as Record<string, unknown>);
          await sendPushTestNotification({
            title: "AEGIS Alerts Activated",
            message: "You will now receive real-time updates for approvals and site notices.",
            action_url: "/dashboard/notifications",
          });
        }
      }

      setStatusMessage("Alerts successfully enabled!");
      setTimeout(() => setVisible(false), 2000);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Could not complete push setup.");
      setTimeout(() => setVisible(false), 4000);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <aside
      aria-label="Operations alerts prompt"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-xl animate-in fade-in slide-in-from-bottom-4 duration-300 sm:left-auto sm:right-6"
    >
      <div className="flex flex-col gap-3 rounded border border-signal/40 bg-ink-light p-4 shadow-2xl backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded border border-signal/30 bg-signal/10 text-signal">
            <BellRing className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-paper">
              Enable Operations Alerts
            </h2>
            <p className="mt-0.5 text-xs text-slate-light leading-relaxed">
              Stay updated on urgent requisition approvals, safety incidents, and milestone sign-offs.
            </p>
            {statusMessage && (
              <p className="mt-1 text-xs text-signal font-mono flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 inline" /> {statusMessage}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-slate hover:text-paper transition-colors"
          >
            Later
          </button>
          <button
            type="button"
            onClick={handleEnable}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded border border-signal bg-signal px-3 py-1.5 text-xs font-mono font-semibold uppercase tracking-wider text-ink transition-all hover:bg-signal-hover hover:border-signal-hover disabled:opacity-50"
          >
            {loading ? "Enabling..." : "Enable Alerts"}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-slate hover:text-paper p-1 ml-1"
            aria-label="Dismiss alert"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
