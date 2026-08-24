import DashboardShell from "@/app/dashboard/DashboardShell";
import { LiveDataProvider } from "@/lib/live/LiveDataProvider";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiveDataProvider>
      <DashboardShell>{children}</DashboardShell>
    </LiveDataProvider>
  );
}
