import DashboardShell from "./DashboardShell";
import { LiveDataProvider } from "@/lib/live/LiveDataProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiveDataProvider>
      <DashboardShell>{children}</DashboardShell>
    </LiveDataProvider>
  );
}
