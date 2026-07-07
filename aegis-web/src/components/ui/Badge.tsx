import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--snc-navy-border)] text-[var(--snc-mist)]",
        gold: "border-[var(--snc-gold)] text-[var(--snc-gold)] bg-[var(--snc-gold-ghost)]",
        grey: "border-transparent bg-[var(--snc-dim)] text-[var(--snc-mist)]",
        green: "border-[var(--snc-success)] text-[var(--snc-success)] bg-[var(--snc-success)]/10",
        red: "border-[var(--snc-danger)] text-[var(--snc-danger)] bg-[var(--snc-danger)]/10",
        blue: "border-[var(--snc-info)] text-[var(--snc-info)] bg-[var(--snc-info)]/10",
        outline: "text-[var(--snc-text)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
