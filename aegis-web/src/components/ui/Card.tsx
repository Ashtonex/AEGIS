"use client";

import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "feature" | "metric" | "project" | "tender";
  padding?: "small" | "standard" | "feature" | "none";
  href?: string;
}

export function Card({ variant = "default", padding = "standard", className, children, ...props }: CardProps) {
  const baseClasses = "bg-snc-navy-raised border border-snc-border rounded-sm transition-all duration-200 ease-snc relative overflow-hidden block";
  
  const hoverClasses = "hover:border-snc-border-gold hover:shadow-[0_0_60px_var(--snc-gold-ghost)] hover:-translate-y-[2px]";

  const paddingClasses = {
    small: "p-6",
    standard: "p-8",
    feature: "p-10 md:p-12",
    none: "p-0",
  };

  const variantClasses = {
    default: "",
    feature: "border-t-2 border-t-snc-gold-primary",
    metric: "text-center border-t border-t-snc-gold-primary",
    project: "",
    tender: "",
  };

  // Metric variant usually overrides padding slightly or centers content, but padding class handles padding.
  // The 'block' allows it to be used as an anchor wrap gracefully.
  
  return (
    <div 
      className={cn(baseClasses, hoverClasses, paddingClasses[padding], variantClasses[variant], className)}
      {...props}
    >
      {children}
    </div>
  );
}
