import { useCallback, useEffect, useState } from "react";

interface UseApiQueriesOptions {
  enabled?: boolean;
  // Keys whose rejection should surface as `error` instead of a warning
  // string. Every other source's rejection becomes an entry in `warnings`.
  criticalKeys?: string[];
  // Human-readable label per source key, used to build the warning string
  // ("<label> could not be loaded."). Falls back to the key itself.
  labels?: Record<string, string>;
}

type QueryMap = Record<string, () => Promise<unknown>>;
type QueryData<T extends QueryMap> = { [K in keyof T]?: Awaited<ReturnType<T[K]>> };

// Multi-source counterpart to useApiQuery: runs N named fetches via
// Promise.allSettled, same shape every dashboard page that needs more than
// one source (finance, procurement, fleet, ...) was hand-rolling. A
// designated subset of sources ("critical") promote their rejection to
// `error`; the rest degrade to a `warnings` string instead of failing the
// whole page.
export function useApiQueries<T extends QueryMap>(
  sources: T,
  dependencies: unknown[] = [],
  options: UseApiQueriesOptions = {}
) {
  const { enabled = true, criticalKeys = [], labels = {} } = options;
  const [data, setData] = useState<QueryData<T>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);

  const execute = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const keys = Object.keys(sources) as (keyof T)[];
    const results = await Promise.allSettled(keys.map((key) => sources[key]()));

    const nextData: QueryData<T> = {};
    const nextWarnings: string[] = [];
    let criticalError: Error | null = null;

    keys.forEach((key, index) => {
      const result = results[index];
      if (result.status === "fulfilled") {
        nextData[key] = result.value as Awaited<ReturnType<T[typeof key]>>;
        return;
      }
      if (criticalKeys.includes(key as string)) {
        criticalError = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        return;
      }
      const label = labels[key as string] || String(key);
      nextWarnings.push(`${label} could not be loaded.`);
    });

    setData(nextData);
    setWarnings(nextWarnings);
    setError(criticalError);
    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    if (enabled) {
      execute();
    }
  }, [execute, enabled]);

  return { data, warnings, error, isLoading, refetch: execute };
}
