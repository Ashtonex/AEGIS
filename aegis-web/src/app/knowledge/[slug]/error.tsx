"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen pt-[104px] flex items-center justify-center bg-[var(--snc-void)] px-6">
      <ErrorState
        title="Something went wrong"
        message="This page failed to load. Try again, or head back home."
        onRetry={reset}
        className="max-w-lg"
      />
    </div>
  );
}
