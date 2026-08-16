"use client";

import { LucideIcon } from "lucide-react";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center p-12 bg-ink border border-dashed border-ink-mid rounded-sm", className)}>
      <Icon className="w-12 h-12 text-ink-mid mb-6" strokeWidth={1} />
      <h3 className="font-sans font-semibold text-[18px] text-slate-light mb-2">{title}</h3>
      {description && (
        <p className="font-sans text-[14px] text-slate mb-6 max-w-sm">{description}</p>
      )}
      {action && (
        <Button variant="ghostWhite" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
