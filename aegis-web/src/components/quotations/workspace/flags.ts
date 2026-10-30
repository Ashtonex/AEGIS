/**
 * Rollout switch for the estimating workspace. On by default; set
 * NEXT_PUBLIC_QUOTATION_WORKSPACE=off at build time to hide the workspace
 * entry points and send /dashboard/quotations/[id] users to the legacy
 * builder. Both read and write the same records through the same server
 * controls, so switching back and forth loses nothing.
 */
export const QUOTATION_WORKSPACE_ENABLED = process.env.NEXT_PUBLIC_QUOTATION_WORKSPACE !== "off";

export function quotationWorkspaceHref(id: string, section?: string): string {
  return `/dashboard/quotations/${id}${section ? `?section=${section}` : ""}`;
}
