import React from "react";
import { cn } from "@/lib/utils";

interface OperationalTableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
}

export function OperationalTable({ children, className, ...props }: OperationalTableProps) {
  return (
    <div className="w-full overflow-auto border border-snc-border bg-snc-navy-raised">
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
    <thead className={cn("bg-snc-navy-high border-b border-snc-border", className)} {...props}>
      {children}
    </thead>
  );
}

export function TableRow({ children, className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr 
      className={cn(
        "border-b border-snc-border/50 hover:bg-snc-navy/50 transition-colors",
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
        "h-12 px-4 text-left align-middle font-sans text-label text-snc-text-tertiary uppercase tracking-wider",
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
        "p-4 align-middle text-body text-snc-text-secondary tabular-nums",
        className
      )} 
      {...props}
    >
      {children}
    </td>
  );
}
