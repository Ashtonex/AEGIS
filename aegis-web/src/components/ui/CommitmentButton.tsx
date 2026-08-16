import React from "react";
import { cn } from "@/lib/utils";

interface CommitmentButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "large";
}

export const CommitmentButton = React.forwardRef<HTMLButtonElement, CommitmentButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => {
    const baseStyles = "inline-flex items-center justify-center rounded-sm font-sans font-semibold tracking-wide transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
    
    const variants = {
      primary: "bg-signal text-void hover:bg-signal-hover border border-transparent",
      secondary: "bg-ink text-paper border border-ink-mid hover:border-signal hover:text-signal",
      ghost: "bg-transparent text-paper hover:bg-ink-light hover:text-signal",
      danger: "bg-danger text-white hover:bg-red-600 border border-transparent",
    };

    const sizes = {
      default: "h-12 px-6 py-3 text-sm",
      large: "h-14 px-8 py-4 text-base",
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  }
);
CommitmentButton.displayName = "CommitmentButton";
