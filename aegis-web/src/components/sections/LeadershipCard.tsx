"use client";

import { LeadershipProfile } from "@/types/website";
import Image from "next/image";
import { Card } from "../ui/Card";
import { Linkedin } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeadershipCardProps {
  profile: LeadershipProfile;
  className?: string;
}

export function LeadershipCard({ profile, className }: LeadershipCardProps) {
  return (
    <Card padding="none" className={cn("overflow-hidden flex flex-col group", className)}>
      <div className="aspect-[4/5] bg-snc-navy-mid relative overflow-hidden">
        {profile.image ? (
          <Image
            src={profile.image}
            alt={profile.name}
            width={400}
            height={500}
            className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500 ease-snc"
          />
        ) : (
          <div className="w-full h-full bg-[linear-gradient(to_top_right,var(--snc-navy-mid),var(--snc-navy-high))] flex flex-col items-center justify-center text-snc-text-tertiary group-hover:scale-105 transition-transform duration-500">
             <div className="w-24 h-24 rounded-full border border-snc-border/50 mb-4" />
             <span className="text-[10px] uppercase tracking-widest text-snc-text-tertiary">Portrait</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-snc-void via-transparent to-transparent opacity-80" />
      </div>
      <div className="p-8 bg-snc-navy-raised relative border-t-[2px] border-snc-gold-primary flex-1 flex flex-col">
        <h4 className="text-headline-md text-snc-text-primary mb-1 group-hover:text-snc-gold-primary transition-colors">{profile.name}</h4>
        <p className="font-sans font-semibold text-[13px] text-snc-gold-primary mb-4">{profile.title}</p>
        <p className="text-body text-snc-text-secondary line-clamp-3 mb-6 flex-1">{profile.bio}</p>
        {profile.linkedIn && (
          <a href={profile.linkedIn} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-sans font-semibold text-[11px] uppercase tracking-widest text-snc-text-tertiary hover:text-snc-text-primary transition-colors">
            <Linkedin className="w-4 h-4" /> Connect
          </a>
        )}
      </div>
    </Card>
  );
}
