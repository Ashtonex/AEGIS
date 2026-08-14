"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, CrmActivity, getCrmActivities } from "@/lib/api";

export function useCalendarActivities(rangeStart: Date, rangeEnd: Date) {
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startKey = rangeStart.toISOString();
  const endKey = rangeEnd.toISOString();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await getCrmActivities({
        start_date: startKey,
        end_date: endKey,
        limit: 500,
      });
      setActivities(Array.isArray(response.data) ? (response.data as CrmActivity[]) : []);
      setError(null);
    } catch (refreshError) {
      const message = refreshError instanceof ApiError
        ? refreshError.message
        : "Calendar activities could not be loaded.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey, endKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { activities, isLoading, error, refresh };
}
