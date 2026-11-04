import Link from "next/link";
import { Mail } from "lucide-react";
import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { NoticeBoardClient } from "@/components/sections/NoticeBoardClient";
import { getTenders } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import type { ProcurementNotice } from "@/types/website";

const PROCUREMENT_EMAIL = "procurement@sixnineconstruction.com";

export const metadata = constructMetadata({
  title: "Tender Board | Six Nine Construction",
  description: "Procurement notices issued by Six Nine Construction, with the live status of each request and order.",
});

export default async function TendersPage() {
  const res = await getTenders({ limit: 200 }).catch(() => null);
  const notices: ProcurementNotice[] = res?.success ? res.data : [];
  const unavailable = !res?.success;

  const count = (...statuses: ProcurementNotice["status"][]) => notices.filter((n) => statuses.includes(n.status)).length;
  const stats = [
    { label: "Active", value: count("open"), accent: "border-l-signal" },
    { label: "In progress", value: count("evaluating", "awarded", "in_delivery"), accent: "border-l-info" },
    { label: "Fulfilled", value: count("fulfilled"), accent: "border-l-success" },
  ];

  return (
    <PageWrapper>
      <PageHero
        title="Tender Board"
        subtitle="Requests for quotation and orders issued by Six Nine Construction, each with its live status."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Tender Board" }]}
      />

      <section className="py-8 bg-ink border-b border-ink-mid">
        <div className="container max-w-[1400px] mx-auto px-4 md:px-10 lg:px-16 xl:px-20">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
            {stats.map((s) => (
              <div key={s.label} className={`p-6 border-l-[2px] ${s.accent} bg-ink-light`}>
                <div className="text-slate font-sans text-[11px] font-semibold uppercase tracking-[0.08em] mb-2">{s.label}</div>
                <div className="text-display-lg text-paper">{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-void min-h-[50vh]">
        <div className="container max-w-[1400px] mx-auto px-4 md:px-10 lg:px-16 xl:px-20">
          {unavailable && (
            <p className="mb-6 border border-warning/40 bg-warning/10 p-4 text-sm text-paper">
              The tender board could not be loaded just now. Please try again shortly.
            </p>
          )}

          <NoticeBoardClient notices={notices} />

          <div className="grid gap-6 md:grid-cols-2">
            <div className="p-8 border border-ink-mid bg-ink rounded-sm">
              <h2 className="text-headline-md text-paper mb-2">Responding to a notice</h2>
              <p className="text-body text-slate-light mb-6">
                Send your quotation or questions to our procurement team, quoting the notice reference.
              </p>
              <a
                href={`mailto:${PROCUREMENT_EMAIL}`}
                className="inline-flex items-center gap-2 text-signal hover:text-paper break-all"
              >
                <Mail className="w-4 h-4 shrink-0" />
                {PROCUREMENT_EMAIL}
              </a>
            </div>
            <div className="p-8 border border-signal/30 bg-signal-ghost rounded-sm flex flex-col justify-between gap-6">
              <div>
                <h2 className="text-headline-md text-paper mb-2">Not registered yet?</h2>
                <p className="text-body text-slate-light">Suppliers must complete vendor registration before quoting.</p>
              </div>
              <Link href="/suppliers/register" className="self-start">
                <Button variant="primary" className="whitespace-nowrap">Register as Supplier</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
