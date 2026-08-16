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
