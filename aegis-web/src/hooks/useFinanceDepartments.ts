import useSWR from "swr";
import { getFinanceDepartments } from "@/lib/api";

/**
 * The organisation's finance department list (Construction, Plant &
 * Equipment, Commercial, ...) - reference data that barely ever changes but
 * was independently refetched from scratch on every one of the 9 pages/
 * panels that need it (CRM leads/opportunities/tenders, Finance and three
 * of its panels, Projects). One shared SWR key means the first page to load
 * it pays the round trip and every other page within the cache window
 * (see DashboardSWRProvider) reads it instantly instead of refetching.
 */
export function useFinanceDepartments() {
  const { data, error, isLoading, mutate } = useSWR("finance-departments", () => getFinanceDepartments());
  return {
    departments: data?.data ?? [],
    error,
    isLoading,
    refetch: mutate,
  };
}
