import React from "react";
import { cn } from "@/lib/utils";

interface OperationalTableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
}

export function OperationalTable({ children, className, ...props }: OperationalTableProps) {
  return (
    <div className="w-full overflow-auto border border-ink-mid bg-ink-light">
      <table 
        className={cn("w-full text-left border-collapse", className)} 
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children, className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn("bg-ink-high border-b border-ink-mid", className)} {...props}>
      {children}
    </thead>
  );
}

export function TableRow({ children, className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr 
      className={cn(
        "border-b border-ink-mid/50 hover:bg-ink/50 transition-colors",
        className
      )} 
      {...props}
    >
      {children}
    </tr>
  );
}

export function TableHead({ children, className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th 
      className={cn(
        "h-12 px-4 text-left align-middle font-sans text-label text-slate uppercase tracking-wider",
        className
      )} 
      {...props}
    >
      {children}
    </th>
  );
}

export function TableCell({ children, className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td 
      className={cn(
        "p-4 align-middle text-body text-slate-light tabular-nums",
        className
      )} 
      {...props}
    >
      {children}
    </td>
  );
}

// ── Mobile Adaptive Data Presentation ─────────────────────────────────────────

export interface MobileDataCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  metrics?: { label: string; value: React.ReactNode }[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function MobileDataCard({
  title,
  subtitle,
  badge,
  metrics,
  actions,
  children,
  className,
  onClick,
}: MobileDataCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-sm border border-ink-mid bg-ink-light p-4 space-y-3 transition-colors active:border-signal/50",
        onClick && "cursor-pointer hover:border-signal/40",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-sans font-medium text-paper text-sm truncate">{title}</div>
          {subtitle && <div className="text-xs text-slate-light truncate mt-0.5">{subtitle}</div>}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>

      {metrics && metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-2 border-y border-ink-mid/40 py-2.5 text-xs">
          {metrics.map((m, idx) => (
            <div key={idx} className="min-w-0">
              <span className="text-slate block text-[11px] truncate">{m.label}</span>
              <span className="font-mono text-paper font-medium truncate block mt-0.5">{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {children}

      {actions && (
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-ink-mid/30">
          {actions}
        </div>
      )}
    </div>
  );
}

export function AdaptiveDataLayout({
  table,
  cards,
  className,
}: {
  table: React.ReactNode;
  cards: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="hidden md:block">{table}</div>
      <div className="block md:hidden space-y-3">{cards}</div>
    </div>
  );
}
