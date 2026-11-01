import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { resolveBackendOrigin } from "@/lib/backend-url";
import { AlertTriangle, ShieldCheck, ShieldX } from "lucide-react";
import { FileHashCheck, VerifyCodeForm } from "../VerifyClient";

export const metadata = constructMetadata({
  title: "Document Verification | Six Nine Construction",
  description: "AEGIS verification result for a Six Nine Construction document.",
});

type Verification = {
  status: "valid" | "revoked" | "invalid";
  verification_code: string;
  signature_valid: boolean;
  record_consistent: boolean;
  issuer: string;
  document_type: string;
  document_number: string;
  title: string | null;
  project_name: string | null;
  counterparty: string | null;
  amount: string | null;
  currency: string | null;
  document_status: string | null;
  issued_at: string | null;
  issued_by_name: string | null;
  file_sha256: string;
  file_size: number;
  filename: string | null;
  key_id: string;
  algorithm: string;
  revoked_at: string | null;
  revoked_reason: string | null;
};

const DOCUMENT_TYPES: Record<string, string> = {
  purchase_order: "Purchase order",
  purchase_order_extract: "Purchase order extract",
  draft_purchase_order: "Draft purchase order (not a valid order)",
};

async function lookup(code: string): Promise<Verification | null | "error"> {
  try {
    const res = await fetch(`${resolveBackendOrigin()}/api/v1/public/verify/${encodeURIComponent(code)}`, {
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) return "error";
    const body = await res.json();
    return body?.data ?? "error";
  } catch {
    return "error";
  }
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Harare" });
}

function formatAmount(amount: string | null, currency: string | null) {
  if (amount === null) return "—";
  const value = Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency || "USD"} ${value}`;
}

export default async function VerifyResultPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const decoded = decodeURIComponent(code);
  const result = await lookup(decoded);

  return (
    <PageWrapper>
      <PageHero
        title="Document Verification"
        subtitle="Checked against the AEGIS register of documents issued by Six Nine Construction."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Verify a Document", href: "/verify" }, { label: decoded }]}
      />
      <section className="py-16 bg-[var(--dxl-void)] min-h-[50vh]">
        <div className="container max-w-3xl space-y-8">
          {result === "error" && (
            <div className="border border-amber-700 bg-amber-950/40 p-6 flex gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
              <p className="text-[var(--dxl-paper)]">The verification service could not be reached. Please try again shortly.</p>
            </div>
          )}

          {result === null && (
            <div className="border border-red-700 bg-red-950/40 p-6 flex gap-3">
              <ShieldX className="w-6 h-6 text-red-400 shrink-0" />
              <div>
                <p className="font-bold text-[var(--dxl-paper)]">No document found for code {decoded}</p>
                <p className="text-sm text-[var(--dxl-slate-light)] mt-1">
                  Check the code for typing errors. If it is correct, the document was not issued by Six Nine Construction
                  through AEGIS: do not rely on it.
                </p>
              </div>
            </div>
          )}

          {result && result !== "error" && (
            <>
              <div
                className={`p-6 flex gap-4 border ${
                  result.status === "valid" ? "border-emerald-700 bg-emerald-950/40" : "border-red-700 bg-red-950/40"
                }`}
              >
                {result.status === "valid" ? (
                  <ShieldCheck className="w-8 h-8 text-emerald-400 shrink-0" />
                ) : (
                  <ShieldX className="w-8 h-8 text-red-400 shrink-0" />
                )}
                <div>
                  <p className="text-xl font-bold text-[var(--dxl-paper)]">
                    {result.status === "valid" && "Genuine document, signature valid"}
                    {result.status === "revoked" && "This document has been revoked"}
                    {result.status === "invalid" && "Signature check failed: do not rely on this document"}
                  </p>
                  <p className="text-sm text-[var(--dxl-slate-light)] mt-1">
                    {result.status === "valid" &&
                      `Issued by ${result.issuer} through AEGIS and signed with key ${result.key_id}.`}
                    {result.status === "revoked" &&
                      `Revoked ${formatDate(result.revoked_at)}${result.revoked_reason ? `: ${result.revoked_reason}` : ""}.`}
                    {result.status === "invalid" && "The record no longer matches its signature. Contact Six Nine Construction."}
                  </p>
                  {result.document_type === "draft_purchase_order" && (
                    <p className="text-sm text-amber-300 mt-2 font-semibold">
                      This is a draft for pricing and planning. It is not a purchase order and commits Six Nine Construction to
                      nothing.
                    </p>
                  )}
                </div>
              </div>

              <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4 border border-[var(--dxl-ink-mid)] p-6 text-sm">
                {[
                  ["Verification code", result.verification_code],
                  ["Document", DOCUMENT_TYPES[result.document_type] || result.document_type],
                  ["Number", result.document_number],
                  ["Status when issued", result.document_status || "—"],
                  ["Supplier", result.counterparty || "—"],
                  ["Project", result.project_name || "—"],
                  ["Amount", formatAmount(result.amount, result.currency)],
                  ["Issued", formatDate(result.issued_at)],
                  ["Issued by", result.issued_by_name || "—"],
                  ["Title", result.title || "—"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[var(--dxl-slate-light)] uppercase tracking-wide text-xs">{label}</dt>
                    <dd className="text-[var(--dxl-paper)] font-medium mt-1 break-words">{value}</dd>
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <dt className="text-[var(--dxl-slate-light)] uppercase tracking-wide text-xs">File fingerprint (SHA-256)</dt>
                  <dd className="text-[var(--dxl-paper)] font-mono text-xs mt-1 break-all">{result.file_sha256}</dd>
                </div>
              </dl>

              <FileHashCheck expectedHash={result.file_sha256} />
            </>
          )}

          <div>
            <p className="text-sm text-[var(--dxl-slate-light)] mb-3">Verify another document</p>
            <VerifyCodeForm />
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
