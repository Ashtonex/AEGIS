import DashboardShell from "./DashboardShell";
import { LiveDataProvider } from "@/lib/live/LiveDataProvider";
import { DashboardSWRProvider } from "@/lib/swrConfig";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardSWRProvider>
      <LiveDataProvider>
        <DashboardShell>{children}</DashboardShell>
      </LiveDataProvider>
    </DashboardSWRProvider>
  );
}
