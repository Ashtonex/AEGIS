import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "System Error",
  message = "An unexpected error occurred while communicating with Project Imperium.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-12 text-center border border-[var(--dxl-danger)]/30 rounded-sm bg-[var(--dxl-ink-light)]",
        className
      )}
    >
      <div className="w-16 h-16 rounded-full bg-[var(--dxl-danger)]/10 flex items-center justify-center mb-6">
        <AlertTriangle className="w-8 h-8 text-[var(--dxl-danger)]" />
      </div>
      <h3 className="text-xl font-bold text-[var(--dxl-paper)] mb-3">{title}</h3>
      <p className="text-[var(--dxl-slate-light)] max-w-md mb-8">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try Again
        </Button>
      )}
    </div>
  );
}
