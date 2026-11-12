import * as React from "react";
import { cn } from "@/lib/utils";

// shadcn/ui Input, compact dashboard size, themed to the DXL tokens.
// For the large marketing/onboarding fields keep using FormField.

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-sm border border-ink-mid bg-ink px-3 py-2 text-sm text-paper",
        "placeholder:text-slate transition-colors focus:border-signal focus:outline-none",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-paper",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-danger",
        className
      )}
      {...props}
    />
  );
}

export { Input };
