"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { useAppTheme } from "@/components/theme/AppThemeProvider";

// The app's single toast outlet (mounted once in the root layout).
// Call toasts with `import { toast } from "sonner"`.
// Colours come from the DXL tokens, so toasts follow every theme.

function Toaster(props: ToasterProps) {
  const { theme } = useAppTheme();

  return (
    <Sonner
      theme={theme === "paper" ? "light" : "dark"}
      position="bottom-right"
      closeButton
      visibleToasts={5}
      duration={5000}
      icons={{
        success: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
        error: <AlertCircle className="h-4 w-4 text-red-400" />,
        warning: <AlertTriangle className="h-4 w-4 text-signal" />,
        info: <Info className="h-4 w-4 text-sky-400" />,
        loading: <Loader2 className="h-4 w-4 animate-spin text-slate-light" />,
      }}
      style={
        {
          "--normal-bg": "var(--dxl-ink-light)",
          "--normal-text": "var(--dxl-paper)",
          "--normal-border": "var(--dxl-ink-mid)",
          "--border-radius": "6px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "font-sans shadow-2xl",
          title: "!text-xs !font-semibold tracking-tight",
          description: "!text-xs !text-slate-light leading-relaxed",
          success: "!border-emerald-500",
          error: "!border-red-500",
          warning: "!border-signal",
          actionButton: "!bg-signal !text-void !font-mono !text-[10px] !uppercase !tracking-wider",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
