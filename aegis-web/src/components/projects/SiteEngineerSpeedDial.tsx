"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Zap,
  X,
  Award,
  Camera,
  AlertTriangle,
  Truck,
  Package,
  CloudRain,
  ChevronUp,
} from "lucide-react";

interface SiteEngineerSpeedDialProps {
  projectId: string;
}

export function SiteEngineerSpeedDial({ projectId }: SiteEngineerSpeedDialProps) {
  const [isOpen, setIsOpen] = useState(false);

  const actions = [
    {
      label: "Log Pour Card",
      desc: "5-point pre-pour checklist & cube sampling",
      icon: Award,
      href: `/dashboard/projects/${projectId}/quality`,
      tone: "text-amber-400 border-amber-500/40 bg-amber-950/40",
    },
    {
      label: "Geotagged Photo",
      desc: "Capture site element & weather diary",
      icon: Camera,
      href: `/dashboard/projects/${projectId}/documents`,
      tone: "text-sky-400 border-sky-500/40 bg-sky-950/40",
    },
    {
      label: "Report Snag / Defect",
      desc: "Mobile punch item with photo evidence",
      icon: AlertTriangle,
      href: `/dashboard/projects/${projectId}/quality`,
      tone: "text-red-400 border-red-500/40 bg-red-950/40",
    },
    {
      label: "Plant Shift Log",
      desc: "Log machine hours & diesel fuel burn",
      icon: Truck,
      href: `/dashboard/projects/${projectId}/plant`,
      tone: "text-emerald-400 border-emerald-500/40 bg-emerald-950/40",
    },
    {
      label: "Site Store Requisition",
      desc: "Order inventory without procurement access",
      icon: Package,
      href: `/dashboard/projects/${projectId}/materials`,
      tone: "text-purple-400 border-purple-500/40 bg-purple-950/40",
    },
    {
      label: "Weather Delay Notice",
      desc: "FIDIC / NEC statutory adverse weather claim",
      icon: CloudRain,
      href: `/dashboard/projects/${projectId}/risks`,
      tone: "text-cyan-400 border-cyan-500/40 bg-cyan-950/40",
    },
  ];

  return (
    <>
      {/* Backdrop overlay when speed dial is open */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity"
        />
      )}

      {/* Floating Speed Dial Container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end">
        {/* Speed Dial Menu Items */}
        {isOpen && (
          <div className="mb-3 flex flex-col items-end gap-2.5 animate-in fade-in slide-in-from-bottom-5 duration-200">
            <div className="border border-ink-mid bg-ink/95 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-light mb-1 shadow-lg">
              Site Field Actions
            </div>
            {actions.map((act) => {
              const Icon = act.icon;
              return (
                <Link
                  key={act.label}
                  href={act.href}
                  onClick={() => setIsOpen(false)}
                  className="group flex items-center gap-3 border border-ink-mid bg-ink/95 p-2.5 hover:border-signal hover:bg-ink-light active:scale-[0.98] transition-all shadow-xl rounded-sm touch-manipulation max-w-[280px]"
                >
                  <div className="text-right">
                    <p className="font-mono text-xs font-bold text-paper group-hover:text-signal transition-colors">
                      {act.label}
                    </p>
                    <p className="text-[10px] text-slate-light truncate">
                      {act.desc}
                    </p>
                  </div>
                  <div className={`p-2 border rounded-sm shrink-0 ${act.tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Master FAB Button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-2 px-4 py-3 border font-mono text-xs font-bold uppercase tracking-wider shadow-2xl transition-all active:scale-95 touch-manipulation ${
            isOpen
              ? "border-red-500 bg-red-600 text-white"
              : "border-signal bg-signal text-ink hover:bg-signal/90 shadow-signal/20"
          }`}
          aria-label="Toggle site actions speed dial"
        >
          {isOpen ? (
            <>
              <X className="h-5 w-5" />
              <span>Close</span>
            </>
          ) : (
            <>
              <Zap className="h-5 w-5 animate-pulse" />
              <span>Quick Action</span>
              <ChevronUp className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </>
  );
}
