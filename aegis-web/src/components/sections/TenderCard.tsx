"use client";

import Link from "next/link";
import { Tender } from "@/types/website";
import { Calendar, MapPin, FileDown, ArrowRight } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { motion } from "framer-motion";

interface TenderCardProps {
  tender: Tender;
  variant?: "card" | "row";
  className?: string;
  onRegisterInterest?: (id: string) => void;
}

export function TenderCard({ tender, variant = "row", className, onRegisterInterest }: TenderCardProps) {
  const isRow = variant === "row";
  
  // A tender is "new" if issued within 7 days of current mock time (July 13, 2026)
  const isNew = (() => {
    if (!tender.issueDate) return false;
    const issueTime = new Date(tender.issueDate).getTime();
    const currentTime = new Date("2026-07-13T09:44:09+02:00").getTime();
    const diffDays = (currentTime - issueTime) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 7;
  })();

  const StatusBadge = () => {
    let colorClass = "text-snc-text-tertiary border-snc-border bg-transparent";
    if (tender.status === "Open") colorClass = "text-snc-success border-snc-success/30 bg-snc-success/10";
    else if (tender.status === "Closing Soon") colorClass = "text-snc-warning border-snc-warning/30 bg-snc-warning/10";
    else if (tender.status === "Closed") colorClass = "text-snc-text-tertiary border-snc-border bg-snc-navy-raised";
    else if (tender.status === "Awarded") colorClass = "text-snc-electric border-snc-electric/30 bg-snc-electric/10";

    return (
      <span className={cn("px-2 py-1 text-[10px] font-sans font-semibold uppercase tracking-widest border rounded-sm", colorClass)}>
        {tender.status}
      </span>
    );
  };

  const NewIndicator = () => {
    if (!isNew) return null;
    return (
      <motion.span
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ 
          opacity: [0.8, 1, 0.8],
          scale: [0.98, 1.02, 0.98]
        }}
        transition={{ 
          duration: 2, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="px-2 py-0.5 text-[9px] font-sans font-semibold uppercase tracking-widest bg-snc-gold-primary/20 text-snc-gold-primary border border-snc-gold-primary/40 rounded-sm flex items-center gap-1"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-snc-gold-primary animate-ping" />
        New
      </motion.span>
    );
  };

  if (isRow) {
    return (
      <div className={cn("grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 p-6 border-b border-snc-border hover:bg-snc-navy-raised/50 transition-colors group", className)}>
        <div className="lg:col-span-2 flex flex-col items-start gap-2">
          <span className="text-[12px] font-mono text-snc-text-tertiary">{tender.reference}</span>
          <div className="flex flex-wrap gap-2 items-center">
            <StatusBadge />
            <NewIndicator />
          </div>
        </div>
        <div className="lg:col-span-4">
          <h4 className="font-sans font-semibold text-[15px] text-snc-text-primary group-hover:text-snc-gold-primary transition-colors mb-1">{tender.title}</h4>
          <span className="text-[12px] text-snc-text-secondary">{tender.category}</span>
        </div>
        <div className="lg:col-span-3 flex flex-col gap-1 text-[13px] text-snc-text-secondary">
          <span className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-snc-text-tertiary" /> {tender.province}</span>
          <span className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-snc-text-tertiary" /> Closes: {formatDate(tender.closingDate)}</span>
        </div>
        <div className="lg:col-span-3 flex items-center justify-end gap-4">
          <button className="text-snc-text-secondary hover:text-snc-text-primary transition-colors flex items-center gap-1 font-sans text-[11px] font-semibold uppercase tracking-[0.08em]">
            <FileDown className="w-3.5 h-3.5" /> RFP
          </button>
          <button 
            onClick={() => onRegisterInterest?.(tender.id)}
            className="text-snc-gold-primary hover:text-snc-gold-hover transition-colors flex items-center gap-1 font-sans text-[11px] font-semibold uppercase tracking-[0.08em]"
          >
            Interest <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <Card variant="tender" padding="standard" className={cn("h-full flex flex-col", className)}>
      <div className="flex justify-between items-start mb-6">
        <span className="text-[12px] font-mono text-snc-text-tertiary">{tender.reference}</span>
        <div className="flex flex-wrap gap-2 items-center justify-end">
          <StatusBadge />
          <NewIndicator />
        </div>
      </div>
      <h4 className="text-headline-md text-snc-text-primary mb-4 flex-1">{tender.title}</h4>
      <div className="space-y-2 text-caption mb-8">
        <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-snc-text-tertiary" /> {tender.province}</div>
        <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-snc-text-tertiary" /> Closes: {formatDate(tender.closingDate)}</div>
      </div>
      <div className="flex flex-col gap-3">
        <Button variant="ghostWhite" size="full" className="gap-2">
          <FileDown className="w-4 h-4" /> Download RFP
        </Button>
        <Button 
          variant="primary" 
          size="full"
          onClick={() => onRegisterInterest?.(tender.id)}
        >
          Register Interest
        </Button>
      </div>
    </Card>
  );
}
