"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <ErrorState
        title="Something went wrong"
        message="An unexpected error occurred loading this page. Try again, or head back home."
        onRetry={reset}
        className="max-w-lg"
      />
    </div>
  );
}
