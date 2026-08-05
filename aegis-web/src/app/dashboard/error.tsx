"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

export default function DashboardError({
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
    <div className="flex items-center justify-center p-12">
      <ErrorState
        title="Something went wrong"
        message="This section of the dashboard failed to load. Try again, or contact support if the problem persists."
        onRetry={reset}
        className="max-w-lg"
      />
    </div>
  );
}
