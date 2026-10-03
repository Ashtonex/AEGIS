"use client";

/**
 * Shared client data layer.
 *
 * Why this exists
 * ---------------
 * Every dashboard page fetched its own data with a hand-rolled
 * `useEffect` + `useState` + `setLoading` block calling into `src/lib/api.ts`
 * directly. That pattern has four consequences this app was paying for on
 * every single navigation:
 *
 * 1. **No cache.** Navigating away from a page and back re-fetched everything
 *    from scratch, so a screen the user had already loaded seconds earlier
 *    still showed a spinner. Most of the perceived slowness of moving around
 *    the app was this, not the API.
 * 2. **No deduplication.** Two components on one page needing the same
 *    resource fired two identical requests.
 * 3. **No revalidation story.** Data went stale silently, and the only way to
 *    refresh was a full page reload.
 * 4. **No shared error/loading contract**, so every page invented its own -
 *    which is a large part of why the UI felt inconsistent from screen to
 *    screen.
 *
 * SWR fixes all four with a stale-while-revalidate cache: a screen you have
 * visited before paints instantly from cache while the fresh value is fetched
 * behind it. That is what makes navigation feel immediate instead of
 * spinner-gated.
 *
 * This module deliberately does NOT re-wrap the ~650 individual functions in
 * `api.ts`. It provides a thin generic binding so a page can adopt the cache
 * by changing its fetch call rather than its data shape.
 */

import useSWR, { SWRConfiguration, useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import { useCallback } from "react";

import { ApiError } from "./api";

/**
 * Defaults applied via `<SWRProvider>`.
 *
 * `revalidateOnFocus` is off: this is a dense operational ERP where users
 * routinely alt-tab between the app and email or a spreadsheet, and
 * re-fetching a dozen endpoints on every window focus would add load without
 * adding much freshness. Freshness comes from `dedupingInterval` expiry,
 * explicit invalidation after mutations, and the existing WebSocket
 * live-change signals (see imperium-api/core/realtime.py), which already tell
 * the client exactly which resource changed.
 */
export const swrDefaults: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  // Collapses duplicate requests for the same key fired within this window,
  // which is what stops two panels on one page double-fetching.
  dedupingInterval: 5_000,
  keepPreviousData: true,
  errorRetryCount: 2,
  shouldRetryOnError: (error: unknown) => {
    // Retrying a 401/403/404 is pointless and, for permission errors, just
    // generates noise in the audit log.
    if (error instanceof ApiError) {
      return error.status >= 500;
    }
    return true;
  },
};

export type ResourceState<T> = {
  data: T | undefined;
  error: ApiError | Error | undefined;
  /** True only on the first load, when there is nothing to show yet. */
  isLoading: boolean;
  /** True while refreshing in the background with data already on screen. */
  isRefreshing: boolean;
  refresh: () => Promise<T | undefined>;
};

/**
 * Cached read of an API resource.
 *
 * `key` is the cache identity. Pass `null` to skip the request entirely -
 * the standard way to express "wait until I have the id I need":
 *
 *   const { data } = useResource(projectId ? `project:${projectId}` : null,
 *                                () => getProject(projectId!));
 *
 * `fetcher` should call the existing `api.ts` function, so response shapes,
 * error mapping, timeouts and auth headers stay exactly as they are today.
 */
export function useResource<T>(
  key: string | readonly unknown[] | null,
  fetcher: () => Promise<T>,
  config?: SWRConfiguration,
): ResourceState<T> {
  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(
    key,
    fetcher,
    { ...swrDefaults, ...config },
  );

  const refresh = useCallback(() => mutate(), [mutate]);

  return {
    data,
    error: error as ApiError | Error | undefined,
    isLoading,
    // `isValidating` is also true during the very first fetch; a background
    // refresh is specifically "validating while we already have something".
    isRefreshing: isValidating && !isLoading && data !== undefined,
    refresh,
  };
}

/**
 * Write helper that invalidates the read caches a mutation affects.
 *
 * Pass the cache-key prefixes the write invalidates. Anything whose key
 * starts with one of them is revalidated once the write resolves, so a
 * created or edited record shows up without a page reload:
 *
 *   const { trigger, isMutating } = useResourceMutation(
 *     (payload: LeadInput) => createLead(payload),
 *     { invalidates: ["leads"] },
 *   );
 */
export function useResourceMutation<TArg, TResult>(
  action: (arg: TArg) => Promise<TResult>,
  options?: { invalidates?: readonly string[] },
) {
  const { mutate } = useSWRConfig();
  const invalidates = options?.invalidates ?? [];

  const { trigger, isMutating, error, reset } = useSWRMutation<
    TResult,
    ApiError | Error,
    string,
    TArg
  >(
    // A stable local key - this mutation is not itself a cached resource.
    "mutation",
    (_key: string, { arg }: { arg: TArg }) => action(arg),
    {
      onSuccess: () => {
        if (invalidates.length === 0) return;
        void mutate(
          (key) =>
            typeof key === "string" &&
            invalidates.some((prefix) => key.startsWith(prefix)),
          undefined,
          { revalidate: true },
        );
      },
    },
  );

  return { trigger, isMutating, error, reset };
}

/**
 * Imperatively invalidate cached resources by key prefix.
 *
 * Intended for the WebSocket live-change handler: the server pushes
 * "table X changed" (it deliberately never pushes row bodies - see
 * imperium-api/core/realtime.py), and the client drops the matching cache
 * entries so the next render refetches exactly what changed.
 */
export function useInvalidate() {
  const { mutate } = useSWRConfig();

  return useCallback(
    (...prefixes: readonly string[]) => {
      if (prefixes.length === 0) return;
      return mutate(
        (key) =>
          typeof key === "string" &&
          prefixes.some((prefix) => key.startsWith(prefix)),
        undefined,
        { revalidate: true },
      );
    },
    [mutate],
  );
}
