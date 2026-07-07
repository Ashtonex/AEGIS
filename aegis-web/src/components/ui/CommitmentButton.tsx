import React from "react";
import { cn } from "@/lib/utils";

interface CommitmentButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "large";
}

export const CommitmentButton = React.forwardRef<HTMLButtonElement, CommitmentButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => {
    const baseStyles = "inline-flex items-center justify-center rounded-sm font-sans font-semibold tracking-wide transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-snc-gold-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
    
    const variants = {
      primary: "bg-snc-gold-primary text-snc-void hover:bg-snc-gold-hover border border-transparent",
      secondary: "bg-snc-navy text-snc-text-primary border border-snc-border hover:border-snc-gold-primary hover:text-snc-gold-primary",
      ghost: "bg-transparent text-snc-text-primary hover:bg-snc-navy-raised hover:text-snc-gold-primary",
      danger: "bg-snc-danger text-white hover:bg-red-600 border border-transparent",
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
