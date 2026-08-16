import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="min-h-screen pt-[104px] flex items-center justify-center bg-[var(--dxl-void)]">
      <Loader2 className="w-8 h-8 text-[var(--dxl-signal)] animate-spin" />
    </div>
  );
}
