"use client";

import Link from "next/link";
import { Card } from "../ui/Card";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface IndustryCardProps {
  title: string;
  description: string;
  slug: string;
  icon?: React.ReactNode;
  className?: string;
}

export function IndustryCard({ title, description, slug, icon, className }: IndustryCardProps) {
  return (
    <Link href={`/industries/${slug}`} className="block h-full group">
      <Card padding="standard" className={cn("h-full flex flex-col items-center text-center", className)}>
        <div className="w-16 h-16 rounded-full border border-snc-border bg-snc-navy flex items-center justify-center text-snc-gold-primary mb-6 group-hover:shadow-[0_0_20px_var(--snc-gold-ghost)] transition-all">
          {icon}
        </div>
        <h4 className="text-headline-md text-snc-text-primary mb-3 group-hover:text-snc-gold-primary transition-colors">{title}</h4>
        <p className="text-body text-snc-text-secondary mb-8 flex-1 line-clamp-3">{description}</p>
        <div className="mt-auto w-10 h-10 rounded-full border border-snc-border flex items-center justify-center group-hover:bg-snc-gold-primary group-hover:border-snc-gold-primary group-hover:text-snc-void transition-colors">
          <ArrowRight className="w-4 h-4" />
        </div>
      </Card>
    </Link>
  );
}
