"use client";

import Link from "next/link";
import Image from "next/image";
import { Article } from "@/types/website";
import { Card } from "../ui/Card";
import { ArrowRight } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";

interface ArticleCardProps {
  article: Article;
  variant?: "grid" | "featured";
  className?: string;
  basePath?: string;
}

export function ArticleCard({ article, variant = "grid", className, basePath = "/news" }: ArticleCardProps) {
  if (variant === "featured") {
    return (
      <Link href={`${basePath}/${article.slug}`} className="block h-full group">
        <Card padding="none" className={cn("h-full flex flex-col md:flex-row overflow-hidden", className)}>
          <div className="w-full md:w-1/2 aspect-video md:aspect-auto bg-snc-navy-mid relative overflow-hidden">
            {article.featuredImage ? (
              <Image
                src={article.featuredImage}
                alt={article.title}
                width={800}
                height={450}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-snc"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-snc-text-tertiary group-hover:scale-105 transition-transform duration-700">IMAGE PLACEHOLDER</div>
            )}
          </div>
          <div className="w-full md:w-1/2 p-10 md:p-12 flex flex-col justify-center bg-snc-navy-raised group-hover:bg-snc-navy-high transition-colors">
            <div className="flex items-center gap-4 mb-6">
              <span className="text-[10px] font-sans font-semibold uppercase tracking-widest text-snc-gold-primary border border-snc-gold-primary/30 px-2 py-1 rounded-sm">{article.category}</span>
              <span className="text-caption">{formatDate(article.publishDate)}</span>
            </div>
            <h3 className="text-headline-lg text-snc-text-primary mb-4 group-hover:text-snc-gold-primary transition-colors">{article.title}</h3>
            <p className="text-body text-snc-text-secondary mb-8 line-clamp-3">{article.excerpt}</p>
            <div className="flex items-center gap-2 text-snc-gold-primary font-sans font-semibold text-[11px] uppercase tracking-[0.08em]">
              Read Article <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </Card>
      </Link>
    );
  }

  return (
    <Link href={`${basePath}/${article.slug}`} className="block h-full group">
      <Card padding="none" className={cn("h-full flex flex-col overflow-hidden", className)}>
        <div className="aspect-video bg-snc-navy-mid relative overflow-hidden">
          {article.featuredImage ? (
            <Image
              src={article.featuredImage}
              alt={article.title}
              width={640}
              height={360}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-snc"
            />
          ) : (
             <div className="w-full h-full flex items-center justify-center text-snc-text-tertiary group-hover:scale-105 transition-transform duration-700">IMAGE PLACEHOLDER</div>
          )}
        </div>
        <div className="p-8 flex flex-col flex-1 bg-snc-navy-raised group-hover:bg-snc-navy-high transition-colors">
          <div className="flex items-center gap-4 mb-4">
            <span className="text-[10px] font-sans font-semibold uppercase tracking-widest text-snc-text-tertiary border border-snc-border px-2 py-1 rounded-sm">{article.category}</span>
            <span className="text-caption">{formatDate(article.publishDate)}</span>
          </div>
          <h4 className="text-headline-md text-snc-text-primary mb-3 group-hover:text-snc-gold-primary transition-colors">{article.title}</h4>
          <p className="text-body text-snc-text-secondary line-clamp-2 mb-8 flex-1">{article.excerpt}</p>
          <div className="flex items-center justify-between mt-auto pt-4 border-t border-snc-border/50">
             <span className="text-snc-text-secondary font-sans font-semibold text-[11px] uppercase tracking-widest group-hover:text-snc-text-primary transition-colors">Read More</span>
             <ArrowRight className="w-3.5 h-3.5 text-snc-text-secondary group-hover:text-snc-text-primary group-hover:translate-x-1 transition-all" />
          </div>
        </div>
      </Card>
    </Link>
  );
}
