"use client";

import { useEffect, useState } from "react";
import { BellPlus, Loader2, BellOff, BellRing } from "lucide-react";

import { deletePushSubscription, getPwaConfig, savePushSubscription, sendPushTestNotification } from "@/lib/api";

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

export function PwaPushButton() {
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermission("unsupported");
      return;
    }

    setPermission(Notification.permission);
    void navigator.serviceWorker.ready.then(async (registration) => {
      const subscription = await registration.pushManager.getSubscription();
      setSubscribed(Boolean(subscription));
    });
  }, []);

  const enablePush = async () => {
    setNotice(null);
    if (permission === "unsupported") {
      setNotice("This browser does not support push notifications.");
      return;
    }

    setLoading(true);
    try {
      const { data: config } = await getPwaConfig();
      if (!config?.push_enabled || !config.vapid_public_key) {
        setNotice("Push notifications are not configured on this deployment.");
        return;
      }

      const currentPermission = permission === "granted" ? "granted" : await Notification.requestPermission();
      setPermission(currentPermission);
      if (currentPermission !== "granted") {
        setNotice("Notification permission was not granted.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toUint8Array(config.vapid_public_key) as BufferSource,
      });

      await savePushSubscription(subscription.toJSON() as Record<string, unknown>);
      await sendPushTestNotification({
        title: "AEGIS alerts enabled",
        message: "This device is now subscribed to browser alerts and sync updates.",
        action_url: "/dashboard/notifications",
      });
      setSubscribed(true);
      setNotice("Push notifications enabled for this device.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to enable push notifications.");
    } finally {
      setLoading(false);
    }
  };

  const disablePush = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await deletePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setNotice("Push notifications disabled on this device.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to disable push notifications.");
    } finally {
      setLoading(false);
    }
  };

  if (permission === "unsupported") {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={subscribed ? () => void disablePush() : () => void enablePush()}
        disabled={loading}
        className="inline-flex items-center gap-2 border border-ink-mid px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-slate-light hover:border-signal hover:text-paper disabled:opacity-50"
        title={subscribed ? "Disable device alerts" : "Enable device alerts"}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : subscribed ? (
          <BellOff className="h-3.5 w-3.5" />
        ) : (
          <BellPlus className="h-3.5 w-3.5" />
        )}
        {subscribed ? "Alerts on" : "Enable alerts"}
      </button>
      {notice ? <span className="max-w-56 text-[10px] text-slate-light">{notice}</span> : <BellRing className="h-4 w-4 text-slate-light" />}
    </div>
  );
}
