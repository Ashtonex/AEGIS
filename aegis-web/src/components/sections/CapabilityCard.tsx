"use client";

import Link from "next/link";
import Image from "next/image";
import { Card } from "../ui/Card";
import { ArrowRight, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CapabilityCardProps {
  title: string;
  description: string;
  slug: string;
  icon?: React.ReactNode;
  image?: string;
  className?: string;
}

export function CapabilityCard({ title, description, slug, icon, image, className }: CapabilityCardProps) {
  return (
    <Link href={`/capabilities/${slug}`} className="block h-full group">
      <Card padding="none" className={cn("h-full flex flex-col overflow-hidden", className)}>
        {image && (
          <div className="w-full h-56 relative overflow-hidden bg-snc-navy-mid">
            <div className="absolute inset-0 bg-gradient-to-t from-snc-navy-raised to-transparent z-10" />
            <Image
              src={image}
              alt={title}
              width={600}
              height={224}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-snc opacity-80"
            />
            <div className="absolute top-6 left-6 z-20 w-12 h-12 rounded-sm bg-[rgba(10,22,40,0.8)] backdrop-blur-md border border-snc-border flex items-center justify-center text-snc-gold-primary">
              {icon || <ChevronRight className="w-5 h-5" />}
            </div>
          </div>
        )}
        
        <div className="p-8 md:p-10 flex flex-col flex-1 relative z-20 bg-snc-navy-raised group-hover:bg-snc-navy-high transition-colors">
          {!image && (
            <div className="mb-8 w-12 h-12 rounded-sm bg-snc-void border border-snc-border flex items-center justify-center text-snc-gold-primary group-hover:border-snc-gold-primary group-hover:bg-snc-gold-primary group-hover:text-snc-void transition-colors">
              {icon || <ChevronRight className="w-6 h-6" />}
            </div>
          )}
          <h3 className="text-headline-lg text-snc-text-primary mb-4 group-hover:text-snc-gold-primary transition-colors">{title}</h3>
          <p className="text-body text-snc-text-secondary mb-10 flex-1">{description}</p>
          <div className="flex items-center gap-2 font-sans font-semibold text-[13px] uppercase tracking-[0.08em] text-snc-gold-primary mt-auto pt-6 border-t border-snc-border/50">
            Explore Sector <ArrowRight className="w-4 h-4 group-hover:translate-x-2 transition-transform" />
          </div>
        </div>
      </Card>
    </Link>
  );
}
