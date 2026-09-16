"use client";

import { SWRConfig } from "swr";

/**
 * Global SWR defaults for the dashboard (see AEGIS Performance Audit item
 * 1.5 - "no data-fetching library at all... every navigation refetches from
 * scratch"). Wrapping the dashboard layout in this makes every `useSWR`
 * call share one cache: navigating away from a page and back within the
 * dedupingInterval repaints instantly from cache while a fresh fetch runs
 * behind it, instead of showing a loading spinner again.
 *
 * dedupingInterval is the practical equivalent of a "stale time" here - SWR
 * doesn't have a separate staleTime knob like React Query; a call to the
 * same key within this window reuses the in-flight/cached result instead of
 * firing a new request.
 */
export function DashboardSWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        dedupingInterval: 30000,
        revalidateOnFocus: true,
        revalidateIfStale: true,
        shouldRetryOnError: false,
        onError: (error, key) => {
          // Swallow-and-log rather than throw: individual pages already
          // render their own error state from useSWR's `error` return
          // value; an unhandled onError here would otherwise surface as a
          // noisy unhandled promise rejection in the console for the same
          // failure the page is already displaying.
          console.error(`SWR fetch failed for ${String(key)}:`, error);
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
