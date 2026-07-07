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
    <div className={cn("flex flex-col items-center justify-center text-center p-12 bg-snc-navy border border-dashed border-snc-border rounded-sm", className)}>
      <Icon className="w-12 h-12 text-snc-border mb-6" strokeWidth={1} />
      <h3 className="font-sans font-semibold text-[18px] text-snc-text-secondary mb-2">{title}</h3>
      {description && (
        <p className="font-sans text-[14px] text-snc-text-tertiary mb-6 max-w-sm">{description}</p>
      )}
      {action && (
        <Button variant="ghostWhite" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
