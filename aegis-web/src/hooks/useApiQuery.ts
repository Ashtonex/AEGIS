import { useState, useEffect, useCallback } from 'react';

interface UseApiQueryOptions<T> {
  enabled?: boolean;
  initialData?: T;
}

export function useApiQuery<T>(
  queryFn: () => Promise<T>,
  dependencies: any[] = [],
  options: UseApiQueryOptions<T> = {}
) {
  const { enabled = true, initialData } = options;
  const [data, setData] = useState<T | undefined>(initialData);
  const [isLoading, setIsLoading] = useState<boolean>(!initialData && enabled);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await queryFn();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    if (enabled) {
      execute();
    }
  }, [execute, enabled]);

  return { data, isLoading, error, refetch: execute };
}
