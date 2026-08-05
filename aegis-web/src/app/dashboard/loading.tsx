import { Loader2 } from "lucide-react";

export default function DashboardLoading() {
  return (
    <div className="flex h-96 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-signal" />
    </div>
  );
}
