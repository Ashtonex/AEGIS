"use client";

/**
 * Installs the shared SWR cache and its defaults for the authenticated app.
 *
 * Mounted inside the dashboard tree rather than at the root layout so public
 * routes (login, marketing, intake) don't carry the provider. The cache is a
 * module-level singleton for the lifetime of the tab, which is what lets a
 * revisited screen paint from cache instead of re-fetching - see
 * src/lib/data.ts for why that matters here.
 */

import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import { swrDefaults } from "@/lib/data";

export function SWRProvider({ children }: { children: ReactNode }) {
  return <SWRConfig value={swrDefaults}>{children}</SWRConfig>;
}

export default SWRProvider;
