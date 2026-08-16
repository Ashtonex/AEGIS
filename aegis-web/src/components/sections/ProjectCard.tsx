"use client";

import Link from "next/link";
import Image from "next/image";
import { Project } from "@/types/website";
import { Card } from "../ui/Card";
import { MapPin, ArrowRight } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

interface ProjectCardProps {
  project: Project;
  variant?: "grid" | "featured" | "related";
  className?: string;
}

export function ProjectCard({ project, variant = "grid", className }: ProjectCardProps) {
  if (variant === "featured") {
    return (
      <Link href={`/projects/${project.slug}`} className="block h-full group">
        <Card variant="project" padding="none" className={cn("h-full flex flex-col overflow-hidden", className)}>
          <div className="aspect-[16/10] bg-ink-mid relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-t from-ink-high via-ink-light/40 to-transparent z-10" />
            {project.featuredImage ? (
              <Image
                src={project.featuredImage}
                alt={project.title}
                width={800}
                height={500}
                quality={85}
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 800px"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-snc"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate group-hover:scale-105 transition-transform duration-700">IMAGE PLACEHOLDER</div>
            )}
            
            <div className="absolute bottom-0 left-0 right-0 p-8 z-20">
              <span className="text-label mb-4 block">{project.category}</span>
              <h3 className="text-headline-lg text-paper mb-2 group-hover:text-signal transition-colors">{project.title}</h3>
              <div className="flex items-center gap-4 text-caption">
                <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-slate" /> {project.province}</span>
                {project.value && <span>{formatCurrency(project.value)}</span>}
              </div>
            </div>
          </div>
        </Card>
      </Link>
    );
  }

  return (
    <Link href={`/projects/${project.slug}`} className="block h-full group">
      <Card variant="project" padding="none" className={cn("h-full flex flex-col overflow-hidden", className)}>
        <div className="aspect-video bg-ink-mid relative overflow-hidden">
          {project.featuredImage ? (
            <Image
              src={project.featuredImage}
              alt={project.title}
              width={640}
              height={360}
              quality={85}
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 640px"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-snc"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate group-hover:scale-105 transition-transform duration-700">IMAGE PLACEHOLDER</div>
          )}
          <div className="absolute top-4 left-4 z-10 bg-[rgba(10,22,40,0.8)] backdrop-blur-sm border border-ink-mid px-3 py-1">
            <span className="text-[10px] font-sans font-semibold tracking-widest uppercase text-paper">
              {project.category}
            </span>
          </div>
        </div>
        <div className="p-8 flex flex-col flex-1 border-t border-ink-mid bg-ink-light group-hover:bg-ink-high transition-colors">
          <h3 className="text-headline-md text-paper mb-3 group-hover:text-signal transition-colors">{project.title}</h3>
          <p className="text-body text-slate-light mb-6 line-clamp-2 flex-1">{project.description}</p>
          
          <div className="flex items-center justify-between pt-4 border-t border-ink-mid/50">
            <span className="flex items-center gap-1.5 text-caption"><MapPin className="w-3.5 h-3.5" /> {project.province}</span>
            <span className="flex items-center gap-1.5 text-signal font-sans font-semibold text-[11px] uppercase tracking-widest">
              View <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
