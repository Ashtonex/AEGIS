import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

const buttonVariants = cva(
  "inline-flex items-center justify-center font-sans font-semibold text-[13px] uppercase tracking-[0.08em] rounded-sm transition-all duration-150 ease-out whitespace-nowrap min-w-[160px] disabled:opacity-40 disabled:pointer-events-none active:translate-y-0",
  {
    variants: {
      variant: {
        primary: "bg-snc-gold-primary text-snc-void hover:bg-snc-gold-hover hover:-translate-y-[1px]",
        default: "bg-snc-gold-primary text-snc-void hover:bg-snc-gold-hover hover:-translate-y-[1px]",
        ghostWhite: "bg-transparent border border-[rgba(245,245,240,0.25)] text-snc-text-primary hover:border-[rgba(245,245,240,0.6)] hover:bg-[rgba(245,245,240,0.04)] hover:-translate-y-[1px]",
        ghostGold: "bg-transparent border border-snc-gold-primary text-snc-gold-primary hover:bg-[rgba(200,150,12,0.08)] hover:-translate-y-[1px]",
        outline: "bg-transparent border border-snc-border text-snc-text-primary hover:border-snc-gold-primary hover:text-snc-gold-primary",
        ghost: "bg-transparent border border-transparent text-snc-text-primary hover:bg-[rgba(245,245,240,0.04)] hover:-translate-y-[1px]",
      },
      size: {
        default: "px-8 py-4", // 16px 32px roughly matches this in Tailwind
        sm: "px-4 py-2 min-w-0", // smaller variant for nav
        lg: "px-10 py-5", // larger variant
        full: "w-full px-8 py-4",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  isLoading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, isLoading, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isLoading || props.disabled}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
