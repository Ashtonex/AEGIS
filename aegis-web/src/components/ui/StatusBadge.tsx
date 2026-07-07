import { cn } from "@/lib/utils";

type StatusType = "success" | "error" | "warning" | "neutral" | "active" | "data";

interface StatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  status: StatusType;
  label: string;
}

export function StatusBadge({ status, label, className, ...props }: StatusBadgeProps) {
  const statusConfig = {
    success: "border-[#2ECC71] text-[#2ECC71] bg-[#2ECC71]/10", // Success
    error: "border-[#E74C3C] text-[#E74C3C] bg-[#E74C3C]/10", // Error
    warning: "border-[#F39C12] text-[#F39C12] bg-[#F39C12]/10", // Warning
    neutral: "border-snc-text-tertiary text-snc-text-tertiary bg-snc-text-tertiary/10", // Gray
    active: "border-snc-gold-primary text-snc-gold-primary bg-snc-gold-primary/10", // Construction Orange
    data: "border-[#3498DB] text-[#3498DB] bg-[#3498DB]/10", // Info
  };

  return (
    <div 
      className={cn(
        "inline-flex items-center px-3 py-1 border rounded-sm text-label tracking-widest",
        statusConfig[status],
        className
      )}
      {...props}
    >
      {/* Optional: Add a small status dot indicator */}
      <span className={cn("w-1.5 h-1.5 mr-2 rounded-full", `bg-current`)} aria-hidden="true" />
      {label}
    </div>
  );
}
