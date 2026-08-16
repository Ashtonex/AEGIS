"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "feature" | "metric" | "project" | "tender";
  padding?: "small" | "standard" | "feature" | "none";
  href?: string;
}

export function Card({ variant = "default", padding = "standard", className, children, ...props }: CardProps) {
  const baseClasses = "bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] transition-colors duration-200 ease-snc relative overflow-hidden block";

  const hoverClasses = "hover:border-signal-border hover:shadow-[0_0_60px_var(--dxl-signal-ghost),0_18px_36px_-16px_rgba(0,0,0,0.6)]";

  const paddingClasses = {
    small: "p-5 sm:p-6",
    standard: "p-6 sm:p-8",
    feature: "p-8 sm:p-10 md:p-12",
    none: "p-0",
  };

  const variantClasses = {
    default: "",
    feature: "border-t-2 border-t-signal",
    metric: "text-center border-t border-t-signal",
    project: "",
    tender: "",
  };

  // Metric variant usually overrides padding slightly or centers content, but padding class handles padding.
  // The 'block' allows it to be used as an anchor wrap gracefully.

  return (
    <motion.div
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className={cn(baseClasses, hoverClasses, paddingClasses[padding], variantClasses[variant], className)}
      {...(props as React.ComponentProps<typeof motion.div>)}
    >
      {children}
    </motion.div>
  );
}
