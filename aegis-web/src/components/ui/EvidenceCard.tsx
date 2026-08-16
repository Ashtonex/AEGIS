"use client";

import { cn } from "@/lib/utils";
import React from "react";

interface EvidenceCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  metric?: string;
  metricLabel?: string;
  children: React.ReactNode;
}

export function EvidenceCard({ title, metric, metricLabel, children, className, ...props }: EvidenceCardProps) {
  return (
    <div 
      className={cn(
        "bg-ink-light border border-ink-mid rounded-sm p-8 shadow-[0_4px_20px_rgba(0,0,0,0.25)]",
        "transition-all duration-300 ease-snc",
        "hover:border-signal-muted hover:bg-ink-high",
        className
      )}
      {...props}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <h3 className="text-headline-md text-paper mb-6">{title}</h3>
        
        {/* Evidence Content */}
        <div className="flex-grow text-body text-slate-light mb-8">
          {children}
        </div>
        
        {/* Proof Metric */}
        {metric && (
          <div className="mt-auto pt-6 border-t border-ink-mid/50">
            <div className="font-display text-display-lg text-signal leading-none mb-1">
              {metric}
            </div>
            {metricLabel && (
              <div className="text-label text-slate">
                {metricLabel}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
