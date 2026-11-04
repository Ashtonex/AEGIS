import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, ArrowLeft, Mail, ShieldCheck, ShieldX } from "lucide-react";
import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { NoticeStatusBadge } from "@/components/sections/NoticeStatusBadge";
import { getProcurementNotice } from "@/lib/api";
import { resolveBackendOrigin } from "@/lib/backend-url";
import type { ProcurementNotice } from "@/types/website";

type Props = {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

type CodeCheck = {
  status: "valid" | "revoked" | "invalid";
  document_number: string;
  issued_at: string | null;
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { reference } = await props.params;
  return constructMetadata({
    title: `${decodeURIComponent(reference)} | Tender Board | Six Nine Construction`,
    description: "Live status of a procurement notice issued by Six Nine Construction.",
  });
}

async function checkCode(code: string): Promise<CodeCheck | null> {
  try {
    const res = await fetch(`${resolveBackendOrigin()}/api/v1/public/verify/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json())?.data as CodeCheck) ?? null;
  } catch {
    return null;
  }
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Harare" });
}

function Timeline({ notice }: { notice: ProcurementNotice }) {
  const closingPassed = notice.closing_date ? new Date(notice.closing_date).getTime() < Date.now() : false;
  const rows = [
    ["Issued", formatDate(notice.published_at)],
    notice.closing_date ? [closingPassed ? "Closed for quotations" : "Closes for quotations", formatDate(notice.closing_date)] : null,
    notice.awarded_at ? ["Order issued", formatDate(notice.awarded_at)] : null,
    ["Last movement", formatDate(notice.last_activity_at)],
  ].filter(Boolean) as [string, string | null][];
  return (
    <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4 border border-ink-mid p-6 text-sm">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-slate uppercase tracking-wide text-xs">{label}</dt>
          <dd className="text-paper font-medium mt-1">{value || "—"}</dd>
        </div>
      ))}
      <div>
        <dt className="text-slate uppercase tracking-wide text-xs">Type</dt>
        <dd className="text-paper font-medium mt-1">{notice.type}</dd>
      </div>
      <div>
        <dt className="text-slate uppercase tracking-wide text-xs">Project</dt>
        <dd className="text-paper font-medium mt-1 break-words">{notice.project || "—"}</dd>
      </div>
    </dl>
  );
}

function CodePanel({ code, notice, result }: { code: string; notice: ProcurementNotice; result: CodeCheck | null }) {
  if (!notice.code_matches || !result) {
    return (
      <div className="border border-danger/50 bg-danger/10 p-6 flex gap-3">
        <ShieldX className="w-6 h-6 text-danger shrink-0" />
        <div className="text-sm">
          <p className="font-bold text-paper">Code {code} does not belong to this notice</p>
          <p className="text-slate-light mt-1">
            Do not rely on the document that carried it. Check the code on the{" "}
            <Link href={`/verify/${encodeURIComponent(code)}`} className="text-signal underline">verification page</Link>{" "}
            or contact {notice.contact_email}.
          </p>
        </div>
      </div>
    );
  }
  const valid = result.status === "valid";
  return (
    <div className={`border p-6 flex gap-3 ${valid ? "border-success/50 bg-success/10" : "border-danger/50 bg-danger/10"}`}>
      {valid ? <ShieldCheck className="w-6 h-6 text-success shrink-0" /> : <ShieldX className="w-6 h-6 text-danger shrink-0" />}
      <div className="text-sm min-w-0">
        <p className="font-bold text-paper">
          {valid
            ? `Genuine purchase order ${result.document_number}, issued by Six Nine Construction through AEGIS`
            : result.status === "revoked"
              ? `Purchase order ${result.document_number} has been revoked`
              : "Signature check failed: do not rely on this document"}
        </p>
        <p className="text-slate-light mt-1">
          Code <span className="font-mono">{code}</span>.{" "}
          <Link href={`/verify/${encodeURIComponent(code)}`} className="text-signal underline">
            Full verification and file check
          </Link>
        </p>
      </div>
    </div>
  );
}

export default async function NoticePage(props: Props) {
  const { reference: raw } = await props.params;
  const searchParams = await props.searchParams;
  const reference = decodeURIComponent(raw).toUpperCase();
  const code = typeof searchParams.code === "string" ? searchParams.code.trim().toUpperCase() : "";
  const notice = await getProcurementNotice(reference, code || undefined);
  const codeResult = notice && notice !== "error" && code && notice.code_matches ? await checkCode(code) : null;

  return (
    <PageWrapper>
      <PageHero
        title={notice && notice !== "error" ? notice.title : "Procurement Notice"}
        subtitle={`Notice ${reference}`}
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Tender Board", href: "/tenders" }, { label: reference }]}
      />
      <section className="py-16 bg-void min-h-[50vh]">
        <div className="container max-w-3xl mx-auto px-4 md:px-6 space-y-8">
          {notice === "error" && (
            <div className="border border-warning/50 bg-warning/10 p-6 flex gap-3">
              <AlertTriangle className="w-6 h-6 text-warning shrink-0" />
              <p className="text-paper">The tender board could not be reached. Please try again shortly.</p>
            </div>
          )}

          {notice === null && (
            <div className="border border-ink-mid bg-ink p-6">
              <p className="font-bold text-paper">No published notice {reference}</p>
              <p className="text-sm text-slate-light mt-1">
                Check the reference, or browse the <Link href="/tenders" className="text-signal underline">tender board</Link>.
              </p>
            </div>
          )}

          {notice && notice !== "error" && (
            <>
              {code && <CodePanel code={code} notice={notice} result={codeResult} />}

              <div className="border border-ink-mid bg-ink p-6">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <NoticeStatusBadge status={notice.status} label={notice.status_label} className="text-[11px]" />
                  <span className="font-mono text-[12px] text-slate break-all">{notice.reference}</span>
                </div>
                <p className="text-paper">{notice.status_description}</p>
              </div>

              <Timeline notice={notice} />

              {notice.description && (
                <div>
                  <h2 className="text-headline-sm text-paper mb-3">What is required</h2>
                  <p className="text-body text-slate-light whitespace-pre-line break-words">{notice.description}</p>
                </div>
              )}

              <div className="border border-ink-mid bg-ink p-6">
                <h2 className="text-headline-sm text-paper mb-2">
                  {notice.accepting_quotations ? "Submit a quotation" : "Questions about this notice"}
                </h2>
                <p className="text-sm text-slate-light mb-4">
                  {notice.accepting_quotations
                    ? `Email your quotation to our procurement team before the closing date, quoting ${notice.reference}.`
                    : `Contact our procurement team, quoting ${notice.reference}.`}
                </p>
                <a
                  href={`mailto:${notice.contact_email}?subject=${encodeURIComponent(`${notice.reference}: ${notice.title}`)}`}
                  className="inline-flex items-center gap-2 text-signal hover:text-paper break-all"
                >
                  <Mail className="w-4 h-4 shrink-0" />
                  {notice.contact_email}
                </a>
              </div>
            </>
          )}

          <Link href="/tenders" className="inline-flex items-center gap-2 text-sm text-slate hover:text-paper">
            <ArrowLeft className="w-4 h-4" /> All notices
          </Link>
        </div>
      </section>
    </PageWrapper>
  );
}
