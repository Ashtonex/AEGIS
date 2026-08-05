import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <p className="font-sans text-[13px] font-semibold uppercase tracking-[0.08em] text-snc-gold-primary">
          404
        </p>
        <h1 className="mt-2 text-3xl font-bold text-snc-text-primary">Page not found</h1>
        <p className="mt-3 max-w-md text-snc-text-secondary">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
      </div>
      <Button asChild variant="primary">
        <Link href="/">Back to home</Link>
      </Button>
    </div>
  );
}
