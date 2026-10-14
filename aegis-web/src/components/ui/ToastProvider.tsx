"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextValue {
  toast: (options: Omit<ToastItem, "id">) => string;
  success: (message: string, title?: string) => string;
  error: (message: string, title?: string) => string;
  warning: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Global export for non-React callers
let globalToastHandler: ToastContextValue | null = null;

export const toast = {
  success: (message: string, title?: string) => globalToastHandler?.success(message, title),
  error: (message: string, title?: string) => globalToastHandler?.error(message, title),
  warning: (message: string, title?: string) => globalToastHandler?.warning(message, title),
  info: (message: string, title?: string) => globalToastHandler?.info(message, title),
  dismiss: (id: string) => globalToastHandler?.dismiss(id),
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (options: Omit<ToastItem, "id">): string => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const duration = options.duration ?? (options.type === "error" ? 6000 : 4000);

      const newItem: ToastItem = { ...options, id, duration };

      setToasts((prev) => [newItem, ...prev.slice(0, 4)]); // max 5 concurrent toasts

      if (duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }

      return id;
    },
    [dismiss]
  );

  const success = useCallback((message: string, title?: string) => addToast({ type: "success", message, title }), [addToast]);
  const error = useCallback((message: string, title?: string) => addToast({ type: "error", message, title }), [addToast]);
  const warning = useCallback((message: string, title?: string) => addToast({ type: "warning", message, title }), [addToast]);
  const info = useCallback((message: string, title?: string) => addToast({ type: "info", message, title }), [addToast]);

  useEffect(() => {
    globalToastHandler = { toast: addToast, success, error, warning, info, dismiss };
    return () => {
      globalToastHandler = null;
    };
  }, [addToast, success, error, warning, info, dismiss]);

  return (
    <ToastContext.Provider value={{ toast: addToast, success, error, warning, info, dismiss }}>
      {children}
      {/* Toast Viewport */}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 rounded border p-3.5 shadow-2xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2 ${
              item.type === "success"
                ? "bg-ink-light/95 border-emerald-500/40 text-paper"
                : item.type === "error"
                ? "bg-ink-light/95 border-red-500/50 text-paper"
                : item.type === "warning"
                ? "bg-ink-light/95 border-signal/50 text-paper"
                : "bg-ink-light/95 border-ink-mid text-paper"
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {item.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              {item.type === "error" && <AlertCircle className="h-4 w-4 text-red-400" />}
              {item.type === "warning" && <AlertTriangle className="h-4 w-4 text-signal" />}
              {item.type === "info" && <Info className="h-4 w-4 text-sky-400" />}
            </div>

            <div className="flex-1 min-w-0">
              {item.title && <p className="text-xs font-semibold text-paper tracking-tight">{item.title}</p>}
              <p className="text-xs text-slate-light leading-relaxed">{item.message}</p>
              {item.action && (
                <button
                  type="button"
                  onClick={() => {
                    item.action?.onClick();
                    dismiss(item.id);
                  }}
                  className="mt-2 text-[10px] font-mono uppercase tracking-wider text-signal hover:text-signal-hover underline font-medium"
                >
                  {item.action.label}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="text-slate hover:text-paper p-1 -mr-1 shrink-0"
              aria-label="Dismiss toast"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
