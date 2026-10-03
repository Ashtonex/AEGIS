import DashboardShell from "./DashboardShell";
import { LiveDataProvider } from "@/lib/live/LiveDataProvider";
import { SWRProvider } from "@/components/providers/SWRProvider";

// Moved down from src/app/layout.tsx, where `export const dynamic =
// "force-dynamic"` opted the ENTIRE app (marketing pages, /login, /news, ...)
// out of static optimization. The authenticated dashboard subtree is the part
// that is genuinely per-request, so the opt-out lives here now and public
// routes can be prerendered again.
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SWRProvider>
      <LiveDataProvider>
        <DashboardShell>{children}</DashboardShell>
      </LiveDataProvider>
    </SWRProvider>
  );
}
