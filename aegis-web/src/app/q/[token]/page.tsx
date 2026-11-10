import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { resolveBackendOrigin } from "@/lib/backend-url";
import { AlertTriangle, FileWarning, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { StaffLeafActions } from "./StaffLeafActions";

export const metadata = constructMetadata({
  title: "Form Verification | Six Nine Construction",
  description: "AEGIS check of a Six Nine Construction printed form.",
});

// What the QR code on a printed SNC form (payment voucher, petty cash
// voucher, purchase order ...) resolves to. The QR encodes
// HTTPS://<host>/Q/<token>; next.config rewrites /Q/ to this page.

type ScanResult = {
  result: "approved" | "recorded" | "unrecorded" | "not_issued" | "voided" | "lost" | "cancelled" | "specimen";
  message: string;
  token: string;
  issuer?: string;
  document_type?: string;
  document_title?: string;
  serial_label?: string;
  book_label?: string;
  leaf_index?: number;
  leaf_count?: number;
  holder?: string;
  issued_department?: string | null;
  issued_at?: string | null;
  recorded_at?: string | null;
  scan_count?: number;
  first_scanned_at?: string | null;
};

async function lookup(token: string): Promise<ScanResult | null | "error"> {
  try {
    const res = await fetch(`${resolveBackendOrigin()}/api/v1/public/stationery/${encodeURIComponent(token)}`, {
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

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Harare" });
}

const TONE = {
  good: { box: "border-emerald-700 bg-emerald-950/40", icon: ShieldCheck, iconClass: "text-emerald-400" },
  wait: { box: "border-amber-700 bg-amber-950/40", icon: ShieldAlert, iconClass: "text-amber-400" },
  bad: { box: "border-red-700 bg-red-950/40", icon: ShieldX, iconClass: "text-red-400" },
} as const;

const HEADLINES: Record<ScanResult["result"], { title: string; tone: keyof typeof TONE }> = {
  approved: { title: "Genuine and approved", tone: "good" },
  recorded: { title: "Genuine, awaiting approval", tone: "wait" },
  unrecorded: { title: "Genuine form, not yet recorded in AEGIS", tone: "wait" },
  not_issued: { title: "Do not accept: book not issued", tone: "bad" },
  voided: { title: "Do not accept: this form was cancelled", tone: "bad" },
  lost: { title: "Do not accept: book reported lost", tone: "bad" },
  cancelled: { title: "Do not accept: book withdrawn", tone: "bad" },
  specimen: { title: "Design specimen, not a valid form", tone: "wait" },
};

export default async function StationeryScanPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const decoded = decodeURIComponent(token);
  const result = await lookup(decoded);
  const headline = result && result !== "error" ? HEADLINES[result.result] : null;
  const tone = headline ? TONE[headline.tone] : null;
  const Icon = tone?.icon ?? FileWarning;

  return (
    <PageWrapper>
      <PageHero
        title="Form Verification"
        subtitle="Checked against the AEGIS register of printed Six Nine Construction stationery."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Form verification" }]}
      />
      <section className="py-12 sm:py-16 bg-[var(--dxl-void)] min-h-[50vh]">
        <div className="container max-w-3xl space-y-8">
          {result === "error" && (
            <div className="border border-amber-700 bg-amber-950/40 p-6 flex gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
              <p className="text-[var(--dxl-paper)]">The verification service could not be reached. Please try again shortly.</p>
            </div>
          )}

          {result === null && (
            <div className="border border-red-700 bg-red-950/40 p-6 flex gap-3">
              <ShieldX className="w-8 h-8 text-red-400 shrink-0" />
              <div>
                <p className="text-xl font-bold text-[var(--dxl-paper)]">Not a Six Nine Construction document</p>
                <p className="text-sm text-[var(--dxl-slate-light)] mt-1">
                  This QR code was not printed by Six Nine Construction. Do not accept the form, and report it to
                  info@snc.co.zw.
                </p>
              </div>
            </div>
          )}

          {result && result !== "error" && headline && tone && (
            <>
              <div className={`p-6 flex gap-4 border ${tone.box}`}>
                <Icon className={`w-8 h-8 shrink-0 ${tone.iconClass}`} />
                <div>
                  <p className="text-xl font-bold text-[var(--dxl-paper)]">{headline.title}</p>
                  <p className="text-sm text-[var(--dxl-slate-light)] mt-1">{result.message}</p>
                </div>
              </div>

              {result.result !== "specimen" && (
                <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4 border border-[var(--dxl-ink-mid)] p-6 text-sm">
                  {[
                    ["Form", result.document_title || "—"],
                    ["Serial number", result.serial_label || "—"],
                    ["Book", result.book_label ? `${result.book_label} · ${result.leaf_index} of ${result.leaf_count}` : "—"],
                    ["Kept by", [result.holder, result.issued_department].filter(Boolean).join(" · ") || "—"],
                    ["Book issued", formatDate(result.issued_at)],
                    ["Recorded in AEGIS", formatDate(result.recorded_at)],
                    ["Issuer", result.issuer || "Six Nine Construction"],
                    ["Times scanned", String(result.scan_count ?? "—")],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[var(--dxl-slate-light)] uppercase tracking-wide text-xs">{label}</dt>
                      <dd className="text-[var(--dxl-paper)] font-medium mt-1 break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {result.result !== "specimen" && <StaffLeafActions token={result.token} />}

              <p className="text-xs text-[var(--dxl-slate-light)]">
                A printed signature on its own does not make an SNC form valid. Rely on it only when this page says it is
                approved. Questions: info@snc.co.zw · +263 77 100 1750.
              </p>
            </>
          )}
        </div>
      </section>
    </PageWrapper>
  );
}
