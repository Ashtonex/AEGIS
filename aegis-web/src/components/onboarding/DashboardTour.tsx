"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, X } from "lucide-react";
import { createPortal } from "react-dom";

type TourStep = {
  title: string;
  body: string;
  target?: string;
  placement?: "top" | "right" | "bottom" | "left" | "center";
};

type TourPosition = {
  top: number;
  left: number;
  placement: NonNullable<TourStep["placement"]>;
  highlight?: DOMRect;
};

const STEPS: TourStep[] = [
  {
    title: "Hey welcome to SNC AEGIS",
    body: "This short tour points out the places you will use to scan work, move between modules, and return to your profile.",
    placement: "center",
  },
  {
    title: "Search from here",
    body: "Use this bar to jump into records, modules, and operational pages without drilling through every menu.",
    target: "dashboard-search",
    placement: "bottom",
  },
  {
    title: "Move between modules",
    body: "The sidebar groups the system by function so you can move between executive, project, finance, and compliance work quickly.",
    target: "dashboard-nav",
    placement: "right",
  },
  {
    title: "Keep your profile current",
    body: "Use profile settings to keep your contact details and work information current. Your tour completion is saved there as well.",
    target: "dashboard-profile",
    placement: "bottom",
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function DashboardTour({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: () => Promise<void> | void;
}) {
  const [mounted, setMounted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [position, setPosition] = useState<TourPosition | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  const step = useMemo(() => STEPS[stepIndex] ?? STEPS[0], [stepIndex]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setStepIndex(0);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const target = step.target
        ? (document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null)
        : null;
      const highlight = target?.getBoundingClientRect() ?? undefined;
      const bubble = bubbleRef.current?.getBoundingClientRect();
      const placement = step.placement ?? "bottom";
      const width = bubble?.width ?? 360;
      const height = bubble?.height ?? 180;
      const padding = 16;

      if (!highlight || placement === "center") {
        const left = clamp(window.innerWidth / 2 - width / 2, padding, window.innerWidth - width - padding);
        const top = clamp(window.innerHeight / 2 - height / 2, padding, window.innerHeight - height - padding);
        setPosition({ left, top, placement: "center" });
        return;
      }

      const topPlacement = highlight.top - height - 14;
      const bottomPlacement = highlight.bottom + 14;
      const rightPlacement = highlight.right + 14;
      const leftPlacement = highlight.left - width - 14;

      let left = highlight.left + highlight.width / 2 - width / 2;
      let top = bottomPlacement;
      let resolvedPlacement: NonNullable<TourStep["placement"]> = placement;

      if (placement === "top") {
        top = topPlacement;
        if (top < padding) {
          top = bottomPlacement;
          resolvedPlacement = "bottom";
        }
      } else if (placement === "left") {
        left = leftPlacement;
        if (left < padding) {
          left = rightPlacement;
          resolvedPlacement = "right";
        }
      } else if (placement === "right") {
        left = rightPlacement;
        if (left + width > window.innerWidth - padding) {
          left = leftPlacement;
          resolvedPlacement = "left";
        }
      }

      left = clamp(left, padding, Math.max(padding, window.innerWidth - width - padding));
      top = clamp(top, padding, Math.max(padding, window.innerHeight - height - padding));
      setPosition({ left, top, placement: resolvedPlacement, highlight });
    };

    const raf = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, step]);

  if (!mounted || !open) return null;

  const isLastStep = stepIndex === STEPS.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        aria-label="Close onboarding tour"
        className="absolute inset-0 cursor-default bg-black/65"
        onClick={onClose}
      />
      {position?.highlight && (
        <div
          className="pointer-events-none absolute rounded-md ring-2 ring-signal ring-offset-4 ring-offset-ink shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]"
          style={{
            top: position.highlight.top - 4,
            left: position.highlight.left - 4,
            width: position.highlight.width + 8,
            height: position.highlight.height + 8,
          }}
        />
      )}
      <div
        ref={bubbleRef}
        className="absolute w-[min(24rem,calc(100vw-2rem))] border border-ink-mid bg-ink-light text-paper shadow-2xl"
        style={{
          top: position?.top ?? 24,
          left: position?.left ?? 24,
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-mid px-4 py-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
              Step {stepIndex + 1} of {STEPS.length}
            </p>
            <h2 className="mt-1 text-sm font-semibold text-paper">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-light transition-colors hover:text-paper"
            aria-label="Dismiss tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-4">
          <p className="text-sm leading-6 text-slate-light">{step.body}</p>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-ink-mid px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-light transition-colors hover:text-paper"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
              disabled={stepIndex === 0}
              className="inline-flex items-center gap-2 border border-ink-mid px-3 py-2 text-xs font-semibold uppercase tracking-widest text-slate-light transition-colors hover:border-signal hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            {!isLastStep ? (
              <button
                type="button"
                onClick={() => setStepIndex((current) => Math.min(STEPS.length - 1, current + 1))}
                className="inline-flex items-center gap-2 border border-signal bg-signal px-3 py-2 text-xs font-semibold uppercase tracking-widest text-ink transition-colors hover:bg-signal/90"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onComplete}
                className="inline-flex items-center gap-2 border border-signal bg-signal px-3 py-2 text-xs font-semibold uppercase tracking-widest text-ink transition-colors hover:bg-signal/90"
              >
                Finish
                <CheckCircle2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
