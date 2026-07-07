"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-sm animate-[shimmer_1.8s_ease-in-out_infinite]",
        "bg-[linear-gradient(90deg,var(--snc-navy-raised)_25%,var(--snc-navy-high)_50%,var(--snc-navy-raised)_75%)] bg-[length:400%_100%]",
        className
      )}
      {...props}
    />
  );
}

export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div className={cn("bg-snc-navy-raised border border-snc-border rounded-sm p-8 flex flex-col gap-4", className)}>
      <Skeleton className="w-full aspect-video mb-2" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-full mt-4" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

export function SkeletonTenderRow({ className }: SkeletonProps) {
  return (
    <div className={cn("flex items-center justify-between p-4 border-b border-snc-border", className)}>
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-24 rounded-sm" />
    </div>
  );
}

export function SkeletonArticle({ className }: SkeletonProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Skeleton className="w-full aspect-[4/3]" />
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-8 w-5/6" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
}

export function SkeletonLeadership({ className }: SkeletonProps) {
  return (
    <div className={cn("flex flex-col items-center gap-4 text-center", className)}>
      <Skeleton className="w-full aspect-square rounded-full max-w-[200px]" />
      <Skeleton className="h-6 w-1/2 mt-2" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}

export function SkeletonStat({ className }: SkeletonProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Skeleton className="h-12 w-24" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export function SkeletonHeroText({ className }: SkeletonProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Skeleton className="h-16 w-full max-w-2xl" />
      <Skeleton className="h-16 w-5/6 max-w-xl" />
      <Skeleton className="h-16 w-4/6 max-w-lg" />
    </div>
  );
}
